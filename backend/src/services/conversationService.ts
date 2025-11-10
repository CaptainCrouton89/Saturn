import { supabaseService } from '../db/supabase.js';
import {
  ConversationDTO,
  ConversationSummaryDTO,
  CreateConversationDTO,
  ConversationExchangeDTO,
  ConversationExchangeResponseDTO,
  EndConversationResponseDTO,
  PaginatedConversationsDTO,
  ConversationTurn,
} from '../types/dto.js';
import { runConversation } from '../agents/orchestrator.js';
import { serializeMessages } from '../agents/utils/index.js';
import type { SerializedMessage } from '../agents/types/messages.js';
import { summaryService } from './summaryService.js';
import { enqueueConversationProcessing } from '../queue/memoryQueue.js';

export class ConversationService {
  /**
   * Mark user onboarding as complete
   * Called automatically when agent completes onboarding conversation
   */
  private async markOnboardingComplete(userId: string): Promise<void> {
    const supabase = supabaseService.getClient();

    const { error } = await supabase
      .from('user_profiles')
      .update({ onboarding_completed: true })
      .eq('id', userId);

    if (error) {
      console.error('Failed to mark onboarding complete:', error);
      // Don't throw - this is a background operation
    } else {
      console.log(`✅ Onboarding marked complete for user ${userId}`);
    }
  }

  /**
   * Create a new conversation
   */
  async createConversation(
    userId: string,
    data: CreateConversationDTO
  ): Promise<ConversationDTO> {
    const supabase = supabaseService.getClient();

    // Trigger method defaults to 'manual' if not provided - this is expected behavior
    const triggerMethod = data.trigger_method ? data.trigger_method : 'manual';

    const { data: conversation, error } = await supabase
      .from('conversation')
      .insert({
        user_id: userId,
        status: 'active',
        trigger_method: triggerMethod,
        transcript: [],
        entities_extracted: false,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create conversation: ${error.message}`);
    }

    if (!conversation.status) {
      throw new Error('Invalid conversation data: missing status');
    }
    if (!conversation.created_at) {
      throw new Error('Invalid conversation data: missing created_at');
    }
    if (conversation.entities_extracted === null || conversation.entities_extracted === undefined) {
      throw new Error('Invalid conversation data: missing entities_extracted');
    }

    if (!conversation.user_id) {
      throw new Error('Invalid conversation data: missing user_id');
    }

    return {
      id: conversation.id,
      user_id: conversation.user_id,
      transcript: conversation.transcript as unknown as ConversationTurn[] | null,
      abbreviated_transcript: conversation.abbreviated_transcript as unknown as ConversationTurn[] | null,
      summary: conversation.summary,
      status: conversation.status,
      created_at: conversation.created_at,
      ended_at: conversation.ended_at,
      trigger_method: conversation.trigger_method,
      entities_extracted: conversation.entities_extracted,
      neo4j_synced_at: conversation.neo4j_synced_at,
    };
  }

  /**
   * Process conversation exchange (user message + agent response)
   * This is where LangGraph integration will happen
   */
  async processExchange(
    conversationId: string,
    userId: string,
    exchange: ConversationExchangeDTO
  ): Promise<ConversationExchangeResponseDTO> {
    const supabase = supabaseService.getClient();

    // Get current conversation
    const { data: conversation, error: fetchError } = await supabase
      .from('conversation')
      .select('*')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !conversation) {
      throw new Error('Conversation not found');
    }

    if (conversation.status !== 'active') {
      throw new Error('Conversation is not active');
    }

    // Get existing transcript from Supabase - it stores serialized LangChain messages
    const existingTranscript = (conversation.transcript as unknown as SerializedMessage[]) ?? [];

    // Check if this is an onboarding conversation
    const isOnboarding = conversation.trigger_method === 'onboarding';

    // Run LangGraph agent with user message
    const { response, fullMessages, onboardingComplete } = await runConversation(
      conversationId,
      userId,
      exchange.user_message,
      existingTranscript,
      isOnboarding
    );

    // If onboarding is complete, update user profile
    if (onboardingComplete && isOnboarding) {
      await this.markOnboardingComplete(userId);
    }

    // Serialize all messages (including tool calls and tool results) for storage
    const serializedTranscript = serializeMessages(fullMessages);

    // Update conversation with new transcript (cast to Json for database)
    const { error: updateError } = await supabase
      .from('conversation')
      .update({
        transcript: serializedTranscript as unknown as never,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    if (updateError) {
      throw new Error(`Failed to update conversation: ${updateError.message}`);
    }

    // Convert serialized messages to ConversationTurn format for API response
    // Only include user and assistant messages (not tool messages)
    const conversationTurns: ConversationTurn[] = serializedTranscript
      .filter(msg => msg.type === 'human' || msg.type === 'ai')
      .map(msg => ({
        speaker: msg.type === 'human' ? 'user' : 'assistant',
        text: msg.content,
        timestamp: msg.timestamp,
      }));

    // Return response with sliding window (last 20 turns)
    const slidingWindowSize = 20;
    const conversationHistory =
      conversationTurns.length > slidingWindowSize
        ? conversationTurns.slice(-slidingWindowSize)
        : conversationTurns;

    const onboardingFinished = Boolean(onboardingComplete && isOnboarding);

    return {
      response: {
        text: response,
        turn_number: exchange.turn_number,
        timestamp: new Date().toISOString(),
        onboarding_complete: onboardingFinished,
      },
      conversation_history: conversationHistory,
    };
  }

  /**
   * End a conversation and generate summary
   */
  async endConversation(
    conversationId: string,
    userId: string
  ): Promise<EndConversationResponseDTO> {
    const supabase = supabaseService.getClient();

    // Step 1: Fetch conversation to get transcript for summary generation
    const { data: existingConversation, error: fetchError } = await supabase
      .from('conversation')
      .select('transcript')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existingConversation) {
      throw new Error('Conversation not found');
    }

    // Step 2: Generate summary from transcript (with graceful degradation)
    let summary: string | null = null;

    try {
      const transcript = existingConversation.transcript as unknown as SerializedMessage[];

      if (transcript && transcript.length > 0) {
        summary = await summaryService.generateConversationSummary(transcript);
        console.log(`✅ Generated summary for conversation ${conversationId}`);
      } else {
        console.log(`⚠️ Skipping summary generation for conversation ${conversationId}: empty transcript`);
      }
    } catch (error) {
      // Log error but don't fail the conversation ending
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to generate summary for conversation ${conversationId}:`, errorMessage);
      // Continue with null summary rather than failing entire request
    }

    // Step 3: Update conversation with status, ended_at, and summary
    const { data: conversation, error: updateError } = await supabase
      .from('conversation')
      .update({
        status: 'completed',
        ended_at: new Date().toISOString(),
        summary,
      })
      .eq('id', conversationId)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError || !conversation) {
      throw new Error('Failed to end conversation');
    }

    if (!conversation.status) {
      throw new Error('Invalid conversation data: missing status');
    }
    if (!conversation.ended_at) {
      throw new Error('Invalid conversation data: missing ended_at');
    }

    // Enqueue background job for memory extraction
    // This runs async - API returns immediately, worker processes in background
    try {
      await enqueueConversationProcessing(conversationId, userId);
      console.log(`✅ Enqueued memory extraction for conversation ${conversationId}`);
    } catch (error) {
      // Log error but don't fail the conversation ending
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to enqueue memory extraction for conversation ${conversationId}:`, errorMessage);
      // Continue - conversation is still marked as completed
    }

    return {
      conversation: {
        id: conversation.id,
        status: conversation.status,
        ended_at: conversation.ended_at,
        summary: conversation.summary,
      },
    };
  }

  /**
   * Get a specific conversation by ID
   */
  async getConversation(conversationId: string, userId: string): Promise<ConversationDTO> {
    const supabase = supabaseService.getClient();

    const { data: conversation, error } = await supabase
      .from('conversation')
      .select('*')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single();

    if (error || !conversation) {
      throw new Error('Conversation not found');
    }

    if (!conversation.status) {
      throw new Error('Invalid conversation data: missing status');
    }
    if (!conversation.created_at) {
      throw new Error('Invalid conversation data: missing created_at');
    }
    if (conversation.entities_extracted === null || conversation.entities_extracted === undefined) {
      throw new Error('Invalid conversation data: missing entities_extracted');
    }
    if (!conversation.user_id) {
      throw new Error('Invalid conversation data: missing user_id');
    }

    return {
      id: conversation.id,
      user_id: conversation.user_id,
      transcript: conversation.transcript as unknown as ConversationTurn[] | null,
      abbreviated_transcript: conversation.abbreviated_transcript as unknown as ConversationTurn[] | null,
      summary: conversation.summary,
      status: conversation.status,
      created_at: conversation.created_at,
      ended_at: conversation.ended_at,
      trigger_method: conversation.trigger_method,
      entities_extracted: conversation.entities_extracted,
      neo4j_synced_at: conversation.neo4j_synced_at,
    };
  }

  /**
   * List conversations for a user with pagination
   */
  async listConversations(
    userId: string,
    limit: number = 10,
    offset: number = 0,
    status?: string
  ): Promise<PaginatedConversationsDTO> {
    const supabase = supabaseService.getClient();

    let query = supabase
      .from('conversation')
      .select('id, summary, status, created_at, ended_at, trigger_method', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to list conversations: ${error.message}`);
    }

    const conversations: ConversationSummaryDTO[] = (data ?? []).map((conv) => {
      if (!conv.status) {
        throw new Error(`Invalid conversation data: missing status for conversation ${conv.id}`);
      }
      if (!conv.created_at) {
        throw new Error(`Invalid conversation data: missing created_at for conversation ${conv.id}`);
      }

      // Convert PostgreSQL timestamps to ISO 8601 format for iOS compatibility
      // PostgreSQL format: "2025-11-09 21:14:04.718652"
      // iOS expects: "2025-11-09T21:14:04.718652Z"
      const createdAt = new Date(conv.created_at).toISOString();
      const endedAt = conv.ended_at ? new Date(conv.ended_at).toISOString() : null;

      return {
        id: conv.id,
        summary: conv.summary,
        status: conv.status,
        created_at: createdAt,
        ended_at: endedAt,
        trigger_method: conv.trigger_method,
      };
    });

    const total = count ?? 0;
    const hasMore = offset + limit < total;

    return {
      conversations,
      total,
      has_more: hasMore,
    };
  }
}

export const conversationService = new ConversationService();
