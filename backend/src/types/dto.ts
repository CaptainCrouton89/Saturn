/**
 * Data Transfer Objects (DTOs) for API endpoints
 * These define the shape of data sent to and from the API
 */

// ============================================================================
// User & Profile DTOs
// ============================================================================

export interface UserProfileDTO {
  id: string;
  device_id: string;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserPreferenceDTO {
  id: string;
  type: string; // "question_style", "topic_avoid", "conversation_pace", etc.
  instruction: string; // Natural language instruction for LLM
  confidence: number; // 0-1
  strength: number; // 0-1
  created_at: string;
  updated_at: string;
}

export interface CreatePreferenceDTO {
  type: string;
  instruction: string;
  strength: number; // 0-1, how strongly to enforce
}

// ============================================================================
// Source DTOs (unified conversation + information dump)
// ============================================================================

export interface ConversationTurn {
  speaker: 'user' | 'assistant';
  message: string;
  timestamp: string;
}

export interface SttTurn {
  speaker: string;
  message: string;
  timestamp: string;
}

// content_raw is stored as JSONB, type varies by source_type
export type ContentRaw = ConversationTurn[] | SttTurn[] | string;

export interface SourceDTO {
  id: string;
  user_id: string;
  source_type: 'conversation' | 'information_dump' | 'stt' | 'document';
  content_raw: ContentRaw;
  content_processed: string[] | null; // Array of bullet points after Phase 0 cleanup
  summary: string | null;
  entities_extracted: boolean;
  neo4j_synced_at: string | null;
  created_at: string;
  started_at: string | null; // For conversations only
  ended_at: string | null; // For conversations only
}

// Simplified for API responses that only need conversation data
export interface ConversationDTO {
  id: string;
  user_id: string;
  transcript: ConversationTurn[];
  summary: string | null;
  status: 'active' | 'completed'; // Derived from ended_at
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  trigger_method: string | null; // Kept for backward compat, always null
  entities_extracted: boolean;
  neo4j_synced_at: string | null;
}

export interface ConversationSummaryDTO {
  id: string;
  summary: string | null;
  status: string;
  created_at: string;
  ended_at: string | null;
  trigger_method: string | null;
}

export interface CreateConversationDTO {
  trigger_method?: string; // "manual", "scheduled", "notification", etc.
}

export interface ConversationExchangeDTO {
  user_message: string; // Full transcribed user utterance
  turn_number: number; // Sequential turn in conversation (1, 2, 3...)
}

export interface ConversationExchangeResponseDTO {
  response: {
    text: string; // Cosmo's response text
    audio_url?: string; // Optional: pre-generated TTS audio URL
    turn_number: number;
    timestamp: string;
    onboarding_complete?: boolean;
  };
  conversation_history: ConversationTurn[]; // Updated full history (sliding window)
}

export interface EndConversationResponseDTO {
  conversation: {
    id: string;
    status: string;
    ended_at: string;
    summary: string | null;
  };
}

// ============================================================================
// Artifact DTOs
// ============================================================================

export interface ArtifactDTO {
  id: string;
  conversation_id: string | null;
  type: string; // "blog_post", "plan", "notes", "decision_framework"
  title: string | null;
  content: string | null;
  created_at: string;
  neo4j_node_id: string | null;
  user_id: string | null;
}

// ============================================================================
// Init Endpoint DTOs
// ============================================================================

export interface ConversationStatsDTO {
  total_conversations: number;
  total_minutes: number;
  last_conversation_at: string | null;
}

export interface InitResponseDTO {
  user: UserProfileDTO;
  preferences: UserPreferenceDTO[];
  recentConversations: ConversationSummaryDTO[];
  stats: ConversationStatsDTO;
}

// ============================================================================
// Paginated Response DTOs
// ============================================================================

export interface PaginatedConversationsDTO {
  conversations: ConversationSummaryDTO[];
  total: number;
  has_more: boolean;
}

export interface PaginatedArtifactsDTO {
  artifacts: ArtifactDTO[];
  total: number;
  has_more: boolean;
}

// ============================================================================
// Standard API Response Wrappers
// ============================================================================

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  error: string;
  message: string;
  details?: string;
}

// ============================================================================
// Source Creation DTOs
// ============================================================================

/**
 * Request body for creating a new information dump source
 */
export interface CreateInformationDumpDTO {
  /** Full text content (required, 1-50,000 chars) */
  content: string;
}

/**
 * Response after successfully creating a source
 */
export interface CreateSourceResponseDTO {
  /** UUID of the created source */
  source_id: string;

  /** Current processing status */
  processing_status: 'queued' | 'processing' | 'completed' | 'failed';

  /** Human-readable message */
  message: string;

  /** When the source was created */
  created_at: string;
}

/**
 * Validation error detail for 400 responses
 */
export interface ValidationErrorDetail {
  /** Field that failed validation */
  field: string;

  /** Human-readable error message */
  message: string;
}

/**
 * Validation error response (400)
 */
export interface ValidationErrorResponse {
  /** Error type */
  error: 'Validation failed';

  /** Array of validation errors */
  details: ValidationErrorDetail[];
}

/**
 * Rate limit error response (429)
 */
export interface RateLimitErrorResponse {
  /** Error type */
  error: 'Rate limit exceeded';

  /** Human-readable message */
  message: string;

  /** Seconds until rate limit resets */
  retry_after: number;
}
