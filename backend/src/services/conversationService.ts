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
    _data: CreateConversationDTO
  ): Promise<ConversationDTO> {
    const supabase = supabaseService.getClient();

    const { data: source, error } = await supabase
      .from('source')
      .insert({
        user_id: userId,
        source_type: 'conversation',
        content_raw: [],
        entities_extracted: false,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create conversation: ${error.message}`);
    }

    if (!source.created_at) {
      throw new Error('Invalid source data: missing created_at');
    }
    if (source.entities_extracted === null || source.entities_extracted === undefined) {
      throw new Error('Invalid source data: missing entities_extracted');
    }
    if (!source.user_id) {
      throw new Error('Invalid source data: missing user_id');
    }

    return {
      id: source.id,
      user_id: source.user_id,
      transcript: [],
      summary: source.summary,
      status: 'active', // Always active for new conversations
      created_at: source.created_at,
      started_at: source.started_at,
      ended_at: source.ended_at,
      trigger_method: null, // No longer stored
      entities_extracted: source.entities_extracted,
      neo4j_synced_at: source.neo4j_synced_at,
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

    // Get current conversation source
    const { data: source, error: fetchError } = await supabase
      .from('source')
      .select('*')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .eq('source_type', 'conversation')
      .single();

    if (fetchError) {
      throw new Error(`Failed to fetch conversation: ${fetchError.message}`);
    }

    if (!source) {
      throw new Error('Conversation not found');
    }

    if (source.ended_at) {
      throw new Error('Conversation has already ended');
    }

    // Get existing transcript from Supabase - it stores serialized LangChain messages
    const existingTranscript = (source.content_raw as unknown as SerializedMessage[]) ?? [];

    // Check if this is an onboarding conversation (no longer stored in source table - would need separate tracking if needed)
    const isOnboarding = false;

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

    // Update source with new transcript (cast to Json for database)
    const { error: updateError } = await supabase
      .from('source')
      .update({
        content_raw: serializedTranscript as unknown as never,
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
        message: msg.content,
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

    // Step 1: Fetch source to get transcript for summary generation
    const { data: existingSource, error: fetchError } = await supabase
      .from('source')
      .select('content_raw')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .eq('source_type', 'conversation')
      .single();

    if (fetchError) {
      throw new Error(`Failed to fetch conversation: ${fetchError.message}`);
    }

    if (!existingSource) {
      throw new Error('Conversation not found');
    }

    // Step 2: Generate summary from transcript (with graceful degradation)
    let summary: string | null = null;

    try {
      const transcript = existingSource.content_raw as unknown as SerializedMessage[];

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

    // Step 3: Update source with ended_at and summary
    const { data: source, error: updateError } = await supabase
      .from('source')
      .update({
        ended_at: new Date().toISOString(),
        summary,
      })
      .eq('id', conversationId)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to end conversation: ${updateError.message}`);
    }

    if (!source) {
      throw new Error('Failed to end conversation: source not found after update');
    }

    if (!source.ended_at) {
      throw new Error('Invalid source data: missing ended_at');
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
        id: source.id,
        status: 'completed',
        ended_at: source.ended_at,
        summary: source.summary,
      },
    };
  }

  /**
   * Get a specific conversation by ID
   */
  async getConversation(conversationId: string, userId: string): Promise<ConversationDTO> {
    const supabase = supabaseService.getClient();

    const { data: source, error } = await supabase
      .from('source')
      .select('*')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .eq('source_type', 'conversation')
      .single();

    if (error) {
      throw new Error(`Failed to fetch conversation: ${error.message}`);
    }

    if (!source) {
      throw new Error('Conversation not found');
    }

    if (!source.created_at) {
      throw new Error('Invalid source data: missing created_at');
    }
    if (source.entities_extracted === null || source.entities_extracted === undefined) {
      throw new Error('Invalid source data: missing entities_extracted');
    }
    if (!source.user_id) {
      throw new Error('Invalid source data: missing user_id');
    }

    return {
      id: source.id,
      user_id: source.user_id,
      transcript: source.content_raw as unknown as ConversationTurn[],
      summary: source.summary,
      status: source.ended_at ? 'completed' : 'active', // Derive from ended_at
      created_at: source.created_at,
      started_at: source.started_at,
      ended_at: source.ended_at,
      trigger_method: null, // No longer stored
      entities_extracted: source.entities_extracted,
      neo4j_synced_at: source.neo4j_synced_at,
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
      .from('source')
      .select('id, summary, created_at, started_at, ended_at', { count: 'exact' })
      .eq('user_id', userId)
      .eq('source_type', 'conversation')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Filter by status: active = no ended_at, completed = has ended_at
    if (status === 'active') {
      query = query.is('ended_at', null);
    } else if (status === 'completed') {
      query = query.not('ended_at', 'is', null);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to list conversations: ${error.message}`);
    }

    const conversations: ConversationSummaryDTO[] = (data ?? []).map((source) => {
      if (!source.created_at) {
        throw new Error(`Invalid source data: missing created_at for source ${source.id}`);
      }

      // Convert PostgreSQL timestamps to ISO 8601 format for iOS compatibility
      // PostgreSQL format: "2025-11-09 21:14:04.718652"
      // iOS expects: "2025-11-09T21:14:04.718652Z"
      const createdAt = new Date(source.created_at).toISOString();
      const endedAt = source.ended_at ? new Date(source.ended_at).toISOString() : null;

      // Derive status from ended_at
      const derivedStatus = source.ended_at ? 'completed' : 'active';

      return {
        id: source.id,
        summary: source.summary,
        status: derivedStatus,
        created_at: createdAt,
        ended_at: endedAt,
        trigger_method: null, // No longer stored in source table
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
