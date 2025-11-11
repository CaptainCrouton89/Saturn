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
// Conversation DTOs
// ============================================================================

export interface ConversationTurn {
  speaker: 'user' | 'assistant';
  text: string;
  timestamp: string;
  audio_segment_id?: string; // Reference to audio storage if applicable
}

export interface ConversationDTO {
  id: string;
  user_id: string;
  transcript: ConversationTurn[] | null;
  abbreviated_transcript: ConversationTurn[] | null;
  summary: string | null;
  status: string; // "active", "completed", "abandoned"
  created_at: string;
  ended_at: string | null;
  trigger_method: string | null;
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
// Information Dump DTOs
// ============================================================================

/**
 * Request body for creating a new information dump
 */
export interface CreateInformationDumpDTO {
  /** Short title for the dump (required, 1-200 chars) */
  title: string;

  /** Optional short description/summary (max 200 chars) */
  label?: string;

  /** Full text content (required, 1-50,000 chars) */
  content: string;
}

/**
 * Response after successfully creating an information dump
 */
export interface InformationDumpResponseDTO {
  /** UUID of the created dump */
  information_dump_id: string;

  /** Current processing status */
  processing_status: 'queued' | 'processing' | 'completed' | 'failed';

  /** Human-readable message */
  message: string;

  /** When the dump was created */
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
