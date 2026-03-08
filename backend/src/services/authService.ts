import crypto from 'crypto';
import { User } from '@supabase/supabase-js';
import { supabaseService } from '../db/supabase.js';
import { personRepository } from '../repositories/PersonRepository.js';
import { UserProfileDTO } from '../types/dto.js';

export interface RegisterResponse {
  user_id: string;
  access_token: string;
  refresh_token: string;
  is_new_user: boolean;
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
      await this.ensureUserProfileDTO(existingSession.user.id, deviceId);
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
  async getUserProfile(userId: string): Promise<UserProfileDTO | null> {
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
      display_name: data.display_name ?? null,
      bio: data.bio ?? null,
      created_at: data.created_at ?? '',
      updated_at: data.updated_at ?? '',
    };
  }

  /**
   * Generate a new API key for a user.
   * Returns the raw key (shown once), id, and key_prefix.
   */
  async generateApiKey(userId: string, label: string): Promise<{ id: string; key: string; key_prefix: string }> {
    const supabase = supabaseService.getClient();

    const rawBytes = crypto.randomBytes(32).toString('hex');
    const rawKey = `sk_${rawBytes}`;
    const keyPrefix = rawBytes.substring(0, 8);
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const { data, error } = await supabase
      .from('user_api_keys')
      .insert({
        user_id: userId,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        label,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create API key: ${error?.message}`);
    }

    return { id: data.id, key: rawKey, key_prefix: keyPrefix };
  }

  /**
   * Validate a raw API key and return the associated Supabase User.
   */
  async validateApiKey(rawKey: string): Promise<User> {
    const supabase = supabaseService.getClient();

    const prefix = rawKey.substring(3, 11);
    const { data: rows, error } = await supabase
      .from('user_api_keys')
      .select('id, user_id, key_hash')
      .eq('key_prefix', prefix)
      .is('revoked_at', null);

    if (error) {
      throw new Error(`Failed to query API keys: ${error.message}`);
    }

    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const match = rows?.find((row: { key_hash: string }) => row.key_hash === hash);

    if (!match) {
      throw new Error('Invalid API key');
    }

    // Update last_used_at
    const { error: updateError } = await supabase
      .from('user_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', match.id);

    if (updateError) {
      console.warn(`Failed to update last_used_at for API key ${match.id}: ${updateError.message}`);
    }

    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(match.user_id);
    if (userError || !userData.user) {
      throw new Error(`Failed to load user for API key: ${userError?.message}`);
    }

    return userData.user;
  }

  /**
   * Revoke an API key by setting revoked_at.
   */
  async revokeApiKey(keyId: string, userId: string): Promise<void> {
    const supabase = supabaseService.getClient();

    const { data, error } = await supabase
      .from('user_api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', keyId)
      .eq('user_id', userId)
      .select('id');

    if (error) {
      throw new Error(`Failed to revoke API key: ${error.message}`);
    }

    if (!data || data.length === 0) {
      throw new Error('API key not found or already revoked');
    }
  }

  /**
   * List all API keys for a user.
   */
  async listApiKeys(userId: string): Promise<Array<{ id: string; key_prefix: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null }>> {
    const supabase = supabaseService.getClient();

    const { data, error } = await supabase
      .from('user_api_keys')
      .select('id, key_prefix, label, created_at, last_used_at, revoked_at')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to list API keys: ${error.message}`);
    }

    return data ?? [];
  }

  /**
   * Get display name for a user.
   */
  async getDisplayName(userId: string): Promise<string | null> {
    const supabase = supabaseService.getClient();

    const { data, error } = await supabase
      .from('user_profiles')
      .select('display_name')
      .eq('id', userId)
      .single();

    if (error) {
      return null;
    }

    return data?.display_name ?? null;
  }

  /**
   * Update user profile fields (display_name, bio).
   */
  async updateProfile(userId: string, updates: { display_name?: string; bio?: string }): Promise<UserProfileDTO> {
    const supabase = supabaseService.getClient();

    const { data, error } = await supabase
      .from('user_profiles')
      .update(updates)
      .eq('id', userId)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to update profile: ${error.message}`);
    }

    // Sync display_name to Neo4j owner Person node
    if (updates.display_name) {
      try {
        await personRepository.findOrCreateOwner(userId, updates.display_name);
      } catch (neo4jError) {
        console.error(`Failed to sync display_name to Neo4j for user ${userId}:`, neo4jError);
      }
    }

    return {
      id: data.id,
      device_id: data.device_id,
      onboarding_completed: data.onboarding_completed ?? false,
      display_name: data.display_name ?? null,
      bio: data.bio ?? null,
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
    await this.ensureUserProfileDTO(userId, deviceId);

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

    await this.ensureUserProfileDTO(createdUser.user.id, deviceId, true);

    // Create Neo4j User node
    await this.ensureNeo4jUser(createdUser.user.id, deviceId);

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

  private async ensureNeo4jUser(userId: string, deviceId: string, displayName?: string): Promise<void> {
    const ownerName = displayName || `Device ${deviceId.substring(0, 8)}`;

    try {
      // Use findOrCreateOwner to ensure exactly one owner Person node per user
      await personRepository.findOrCreateOwner(userId, ownerName);
    } catch (error) {
      // Handle race condition: if another request created the owner between check and create,
      // Neo4j will throw a constraint violation error. Retry by fetching existing owner.
      if (error instanceof Error && (
        error.message.includes('already exists') ||
        error.message.includes('constraint') ||
        error.message.includes('duplicate')
      )) {
        const existingOwner = await personRepository.findOwner(userId);
        if (!existingOwner) {
          // If owner still doesn't exist after error, rethrow original error
          throw new Error(`Failed to create or find owner after race condition: ${error.message}`);
        }
        // Owner exists now, which is what we wanted - success
        return;
      }
      // Rethrow non-race-condition errors
      throw error;
    }
  }

  private async ensureUserProfileDTO(userId: string, deviceId: string, isNewUser = false): Promise<void> {
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
