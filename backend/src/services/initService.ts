import { authService } from './authService.js';
import { preferenceRepository } from '../repositories/PreferenceRepository.js';
import { supabaseConversationRepository } from '../repositories/SupabaseConversationRepository.js';
import {
  InitResponseDTO,
  UserProfileDTO,
  UserPreferenceDTO,
  ConversationSummaryDTO,
  ConversationStatsDTO,
} from '../types/dto.js';

export class InitService {
  /**
   * Get all initialization data for app launch
   * Fetches user profile, preferences, recent conversations, and stats
   */
  async getInitData(userId: string): Promise<InitResponseDTO> {
    // Fetch all data in parallel for better performance
    const [userProfile, preferences, recentConversations, stats] = await Promise.all([
      authService.getUserProfile(userId),
      preferenceRepository.getAllByUserId(userId),
      supabaseConversationRepository.getRecentByUserId(userId, 10),
      supabaseConversationRepository.getStatsByUserId(userId),
    ]);

    if (!userProfile) {
      throw new Error('User profile not found');
    }

    // Map user profile to DTO (already in snake_case)
    const user: UserProfileDTO = {
      id: userProfile.id,
      device_id: userProfile.device_id,
      onboarding_completed: userProfile.onboarding_completed !== null ? userProfile.onboarding_completed : false,
      created_at: userProfile.created_at !== null ? userProfile.created_at : new Date().toISOString(),
      updated_at: userProfile.updated_at !== null ? userProfile.updated_at : new Date().toISOString(),
    };

    // Map preferences to DTOs (filter out any with null required fields)
    const preferenceDTOs: UserPreferenceDTO[] = preferences
      .filter((pref) =>
        pref.type !== null &&
        pref.instruction !== null &&
        pref.confidence !== null &&
        pref.strength !== null &&
        pref.createdAt !== null &&
        pref.updatedAt !== null
      )
      .map((pref) => ({
        id: pref.id,
        type: pref.type!,
        instruction: pref.instruction!,
        confidence: pref.confidence!,
        strength: pref.strength!,
        created_at: pref.createdAt!,
        updated_at: pref.updatedAt!,
      }));

    // Map conversations to DTOs (filter out any with null required fields)
    const conversationDTOs: ConversationSummaryDTO[] = recentConversations
      .filter((conv) => conv.status !== null && conv.createdAt !== null)
      .map((conv) => ({
        id: conv.id,
        summary: conv.summary,
        status: conv.status!,
        created_at: conv.createdAt!,
        ended_at: conv.endedAt,
        trigger_method: conv.triggerMethod,
      }));

    // Map stats to DTO
    const statsDTO: ConversationStatsDTO = {
      total_conversations: stats.totalConversations,
      total_minutes: stats.totalMinutes,
      last_conversation_at: stats.lastConversationAt,
    };

    return {
      user,
      preferences: preferenceDTOs,
      recentConversations: conversationDTOs,
      stats: statsDTO,
    };
  }
}

export const initService = new InitService();
