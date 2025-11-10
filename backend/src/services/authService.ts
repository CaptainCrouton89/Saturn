import crypto from 'crypto';
import { supabaseService } from '../db/supabase.js';

export interface RegisterResponse {
  user_id: string;
  access_token: string;
  refresh_token: string;
  is_new_user: boolean;
}

export interface UserProfile {
  id: string;
  device_id: string;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export class AuthService {
  /**
   * Register or authenticate a device using Supabase Anonymous Auth
   * If device_id exists in user_profiles, returns existing session
   * If device_id is new, creates anonymous user and profile
   */
  async registerOrAuthenticateDevice(deviceId: string): Promise<RegisterResponse> {
    const supabase = supabaseService.getClient();
    const authEmail = this.buildDeviceEmail(deviceId);
    const authPassword = this.buildDevicePassword(deviceId);

    // Check if a profile with this device_id already exists
    const { data: existingProfile } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (existingProfile?.id) {
      return await this.signInExistingDevice(existingProfile.id, deviceId, authEmail, authPassword);
    }

    const existingSession = await this.trySignInWithPassword(authEmail, authPassword);

    if (existingSession) {
      await this.ensureUserProfile(existingSession.user.id, deviceId);
      return {
        user_id: existingSession.user.id,
        access_token: existingSession.session.access_token,
        refresh_token: existingSession.session.refresh_token,
        is_new_user: false,
      };
    }

    return await this.createDeviceUser(deviceId, authEmail, authPassword);
  }

  /**
   * Validate an access token and return the user
   */
  async validateToken(accessToken: string) {
    const supabase = supabaseService.getClient();

    const { data, error } = await supabase.auth.getUser(accessToken);

    if (error || !data.user) {
      throw new Error(`Invalid token: ${error?.message || 'Unknown error'}`);
    }

    return data.user;
  }

  /**
   * Mark user onboarding as completed
   */
  async completeOnboarding(userId: string): Promise<void> {
    const supabase = supabaseService.getClient();

    const { error } = await supabase
      .from('user_profiles')
      .update({ onboarding_completed: true })
      .eq('id', userId);

    if (error) {
      throw new Error(`Failed to complete onboarding: ${error.message}`);
    }
  }

  /**
   * Get user profile by ID
   */
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const supabase = supabaseService.getClient();

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      throw new Error(`Failed to get user profile: ${error.message}`);
    }

    return {
      id: data.id,
      device_id: data.device_id,
      onboarding_completed: data.onboarding_completed ?? false,
      created_at: data.created_at ?? '',
      updated_at: data.updated_at ?? '',
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshSession(refreshToken: string) {
    const supabase = supabaseService.getClient();

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      throw new Error(`Failed to refresh session: ${error?.message || 'Unknown error'}`);
    }

    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    };
  }

  private buildDeviceEmail(deviceId: string): string {
    const sanitized = deviceId.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `device-${sanitized}@${getDeviceAuthDomain()}`;
  }

  private buildDevicePassword(deviceId: string): string {
    return crypto.createHmac('sha256', getDeviceAuthSecret()).update(deviceId).digest('hex');
  }

  private async signInExistingDevice(
    userId: string,
    deviceId: string,
    email: string,
    password: string
  ): Promise<RegisterResponse> {
    await this.ensureSupabaseUserCredentials(userId, deviceId, email, password);
    await this.ensureUserProfile(userId, deviceId);

    const { session } = await this.signInWithPassword(email, password);

    return {
      user_id: userId,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      is_new_user: false,
    };
  }

  private async createDeviceUser(
    deviceId: string,
    email: string,
    password: string
  ): Promise<RegisterResponse> {
    const supabase = supabaseService.getClient();

    const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        device_id: deviceId,
      },
      app_metadata: {
        provider: 'device',
      },
    });

    if (createError || !createdUser?.user) {
      throw new Error(`Failed to create device user: ${createError?.message || 'Unknown error'}`);
    }

    await this.ensureUserProfile(createdUser.user.id, deviceId, true);

    const { session } = await this.signInWithPassword(email, password);

    return {
      user_id: createdUser.user.id,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      is_new_user: true,
    };
  }

  private async ensureSupabaseUserCredentials(
    userId: string,
    deviceId: string,
    email: string,
    password: string
  ): Promise<void> {
    const supabase = supabaseService.getClient();

    const { data: userData, error: fetchError } = await supabase.auth.admin.getUserById(userId);

    if (fetchError || !userData.user) {
      throw new Error(`Failed to fetch Supabase user: ${fetchError?.message || 'Unknown error'}`);
    }

    const needsUpdate =
      userData.user.email !== email ||
      userData.user.user_metadata?.device_id !== deviceId ||
      !userData.user.email_confirmed_at;

    if (needsUpdate) {
      const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
        email,
        password,
        email_confirm: true,
        user_metadata: {
          ...(userData.user.user_metadata || {}),
          device_id: deviceId,
        },
      });

      if (updateError) {
        throw new Error(`Failed to update Supabase user credentials: ${updateError.message}`);
      }
    }
  }

  private async ensureUserProfile(userId: string, deviceId: string, isNewUser = false): Promise<void> {
    const supabase = supabaseService.getClient();

    if (isNewUser) {
      const { error } = await supabase.from('user_profiles').insert({
        id: userId,
        device_id: deviceId,
        onboarding_completed: false,
      });

      if (error) {
        throw new Error(`Failed to create user profile: ${error.message}`);
      }

      return;
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .select('device_id')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load user profile: ${error.message}`);
    }

    if (!data) {
      const { error: insertError } = await supabase.from('user_profiles').insert({
        id: userId,
        device_id: deviceId,
        onboarding_completed: false,
      });

      if (insertError) {
        throw new Error(`Failed to create user profile: ${insertError.message}`);
      }

      return;
    }

    if (data.device_id !== deviceId) {
      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ device_id: deviceId })
        .eq('id', userId);

      if (updateError) {
        throw new Error(`Failed to update user profile: ${updateError.message}`);
      }
    }
  }

  private async signInWithPassword(email: string, password: string) {
    const supabase = supabaseService.getClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw error;
    }

    if (!data.session || !data.user) {
      throw new Error('Failed to create session: Missing session information');
    }

    return {
      session: data.session,
      user: data.user,
    };
  }

  private async trySignInWithPassword(email: string, password: string) {
    try {
      return await this.signInWithPassword(email, password);
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid login credentials') {
        return null;
      }
      if (error instanceof Error && error.message.includes('Invalid login credentials')) {
        return null;
      }
      throw error;
    }
  }
}

export const authService = new AuthService();

function getDeviceAuthSecret(): string {
  const secret = process.env.DEVICE_AUTH_SECRET;
  if (!secret) {
    throw new Error('DEVICE_AUTH_SECRET environment variable is required for device authentication.');
  }
  return secret;
}

function getDeviceAuthDomain(): string {
  return process.env.DEVICE_AUTH_DOMAIN || 'device.cosmo';
}
