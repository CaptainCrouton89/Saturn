import { supabaseService } from '../db/supabase';
import { UserPreferenceDTO, CreatePreferenceDTO } from '../types/dto';

export class PreferenceService {
  /**
   * Get all preferences for a user
   */
  async getUserPreferences(userId: string): Promise<UserPreferenceDTO[]> {
    const supabase = supabaseService.getClient();

    const { data, error } = await supabase
      .from('user_preference')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch preferences: ${error.message}`);
    }

    return (data ?? []).map((pref) => {
      if (!pref.type || !pref.instruction) {
        throw new Error(`Invalid preference data: missing type or instruction`);
      }
      if (pref.confidence === null || pref.confidence === undefined) {
        throw new Error(`Invalid preference data: missing confidence`);
      }
      if (pref.strength === null || pref.strength === undefined) {
        throw new Error(`Invalid preference data: missing strength`);
      }
      if (!pref.created_at) {
        throw new Error(`Invalid preference data: missing created_at`);
      }
      if (!pref.updated_at) {
        throw new Error(`Invalid preference data: missing updated_at`);
      }

      return {
        id: pref.id,
        type: pref.type,
        instruction: pref.instruction,
        confidence: pref.confidence,
        strength: pref.strength,
        createdAt: pref.created_at,
        updatedAt: pref.updated_at,
      };
    });
  }

  /**
   * Create a new preference for a user
   */
  async createPreference(
    userId: string,
    preferenceData: CreatePreferenceDTO
  ): Promise<UserPreferenceDTO> {
    const supabase = supabaseService.getClient();

    // Validate strength is between 0 and 1
    if (preferenceData.strength < 0 || preferenceData.strength > 1) {
      throw new Error('Strength must be between 0 and 1');
    }

    const { data, error } = await supabase
      .from('user_preference')
      .insert({
        user_id: userId,
        type: preferenceData.type,
        instruction: preferenceData.instruction,
        strength: preferenceData.strength,
        confidence: 1.0, // User-created preferences have full confidence
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create preference: ${error.message}`);
    }

    if (!data.type || !data.instruction) {
      throw new Error(`Invalid preference data returned: missing type or instruction`);
    }
    if (data.confidence === null || data.confidence === undefined) {
      throw new Error(`Invalid preference data returned: missing confidence`);
    }
    if (data.strength === null || data.strength === undefined) {
      throw new Error(`Invalid preference data returned: missing strength`);
    }
    if (!data.created_at) {
      throw new Error(`Invalid preference data returned: missing created_at`);
    }
    if (!data.updated_at) {
      throw new Error(`Invalid preference data returned: missing updated_at`);
    }

    return {
      id: data.id,
      type: data.type,
      instruction: data.instruction,
      confidence: data.confidence,
      strength: data.strength,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}

export const preferenceService = new PreferenceService();
