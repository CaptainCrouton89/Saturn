import { supabaseService } from '../db/supabase.js';

export interface UserPreference {
  id: string;
  userId: string;
  type: string | null;
  instruction: string | null;
  confidence: number | null;
  strength: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

class PreferenceRepository {
  /**
   * Fetch all preferences for a specific user
   * @param userId - The user's ID
   * @returns Array of user preferences (empty array if none exist)
   */
  async getAllByUserId(userId: string): Promise<UserPreference[]> {
    const supabase = supabaseService.getClient();

    const { data, error } = await supabase
      .from('user_preference')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch user preferences: ${error.message}`);
    }

    // Transform snake_case to camelCase
    // Filter out any preferences with null user_id (should never happen but be defensive)
    return (data || [])
      .filter((pref) => pref.user_id !== null)
      .map((pref) => ({
        id: pref.id,
        userId: pref.user_id!,
        type: pref.type ?? null,
        instruction: pref.instruction ?? null,
        confidence: pref.confidence ?? null,
        strength: pref.strength ?? null,
        createdAt: pref.created_at ?? null,
        updatedAt: pref.updated_at ?? null,
      }));
  }
}

export const preferenceRepository = new PreferenceRepository();
