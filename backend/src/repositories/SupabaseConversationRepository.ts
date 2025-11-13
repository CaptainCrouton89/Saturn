import { supabaseService } from '../db/supabase.js';

export interface ConversationSummary {
  id: string;
  userId: string;
  status: string | null;
  createdAt: string | null;
  endedAt: string | null;
  triggerMethod: string | null;
  summary: string | null;
  entitiesExtracted: boolean | null;
  neo4jSyncedAt: string | null;
}

export interface ConversationStats {
  totalConversations: number;
  totalMinutes: number;
  lastConversationAt: string | null;
}

class SupabaseConversationRepository {
  /**
   * Fetch recent conversations for a user (summary data only, no transcripts)
   * @param userId - The user's ID
   * @param limit - Maximum number of conversations to return
   * @returns Array of conversation summaries
   */
  async getRecentByUserId(userId: string, limit: number = 10): Promise<ConversationSummary[]> {
    const supabase = supabaseService.getClient();

    const { data, error } = await supabase
      .from('source')
      .select('id, user_id, created_at, ended_at, summary, entities_extracted, neo4j_synced_at')
      .eq('user_id', userId)
      .eq('source_type', 'conversation')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch recent conversations: ${error.message}`);
    }

    // Transform snake_case to camelCase
    // Filter out any conversations with null user_id (should never happen but be defensive)
    return (data || [])
      .filter((conv) => conv.user_id !== null)
      .map((conv) => ({
        id: conv.id,
        userId: conv.user_id!,
        status: conv.ended_at ? 'completed' : 'active', // Derive from ended_at
        createdAt: conv.created_at,
        endedAt: conv.ended_at,
        triggerMethod: null, // No longer stored
        summary: conv.summary,
        entitiesExtracted: conv.entities_extracted,
        neo4jSyncedAt: conv.neo4j_synced_at,
      }));
  }

  /**
   * Calculate conversation statistics for a user
   * @param userId - The user's ID
   * @returns Conversation statistics (count, total minutes, last conversation timestamp)
   */
  async getStatsByUserId(userId: string): Promise<ConversationStats> {
    const supabase = supabaseService.getClient();

    // Fetch all conversations for stats calculation
    const { data, error } = await supabase
      .from('source')
      .select('created_at, ended_at')
      .eq('user_id', userId)
      .eq('source_type', 'conversation');

    if (error) {
      throw new Error(`Failed to fetch conversation stats: ${error.message}`);
    }

    const conversations = data || [];

    // Calculate total conversations
    const totalConversations = conversations.length;

    // Calculate total minutes (sum of durations)
    let totalMinutes = 0;
    for (const conv of conversations) {
      if (conv.created_at && conv.ended_at) {
        const start = new Date(conv.created_at).getTime();
        const end = new Date(conv.ended_at).getTime();
        const durationMs = end - start;
        const durationMinutes = durationMs / (1000 * 60);
        totalMinutes += durationMinutes;
      }
    }

    // Round to 2 decimal places
    totalMinutes = Math.round(totalMinutes * 100) / 100;

    // Find most recent conversation timestamp
    let lastConversationAt: string | null = null;
    if (conversations.length > 0) {
      const timestamps = conversations
        .map((conv) => conv.created_at)
        .filter((timestamp): timestamp is string => timestamp !== null)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

      lastConversationAt = timestamps[0] || null;
    }

    return {
      totalConversations,
      totalMinutes,
      lastConversationAt,
    };
  }
}

export const supabaseConversationRepository = new SupabaseConversationRepository();
