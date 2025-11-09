/**
 * Data Transfer Objects (DTOs) for API endpoints
 * These define the shape of data sent to and from the API
 */

// ============================================================================
// User & Profile DTOs
// ============================================================================

export interface UserProfileDTO {
  id: string;
  deviceId: string;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserPreferenceDTO {
  id: string;
  type: string; // "question_style", "topic_avoid", "conversation_pace", etc.
  instruction: string; // Natural language instruction for LLM
  confidence: number; // 0-1
  strength: number; // 0-1
  createdAt: string;
  updatedAt: string;
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
  audioSegmentId?: string; // Reference to audio storage if applicable
}

export interface ConversationDTO {
  id: string;
  userId: string;
  transcript: ConversationTurn[] | null;
  abbreviatedTranscript: ConversationTurn[] | null;
  summary: string | null;
  status: string; // "active", "completed", "abandoned"
  createdAt: string;
  endedAt: string | null;
  triggerMethod: string | null;
  entitiesExtracted: boolean;
  neo4jSyncedAt: string | null;
}

export interface ConversationSummaryDTO {
  id: string;
  summary: string | null;
  status: string;
  createdAt: string;
  endedAt: string | null;
  triggerMethod: string | null;
}

export interface CreateConversationDTO {
  triggerMethod?: string; // "manual", "scheduled", "notification", etc.
}

export interface ConversationExchangeDTO {
  userMessage: string; // Full transcribed user utterance
  turnNumber: number; // Sequential turn in conversation (1, 2, 3...)
}

export interface ConversationExchangeResponseDTO {
  response: {
    text: string; // Cosmo's response text
    audioUrl?: string; // Optional: pre-generated TTS audio URL
    turnNumber: number;
    timestamp: string;
    onboardingComplete?: boolean;
  };
  conversationHistory: ConversationTurn[]; // Updated full history (sliding window)
}

export interface EndConversationResponseDTO {
  conversation: {
    id: string;
    status: string;
    endedAt: string;
    summary: string | null;
  };
}

// ============================================================================
// Artifact DTOs
// ============================================================================

export interface ArtifactDTO {
  id: string;
  conversationId: string | null;
  type: string; // "blog_post", "plan", "notes", "decision_framework"
  title: string | null;
  content: string | null;
  createdAt: string;
  neo4jNodeId: string | null;
  userId: string | null;
}

// ============================================================================
// Init Endpoint DTOs
// ============================================================================

export interface ConversationStatsDTO {
  totalConversations: number;
  totalMinutes: number;
  lastConversationAt: string | null;
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
  hasMore: boolean;
}

export interface PaginatedArtifactsDTO {
  artifacts: ArtifactDTO[];
  total: number;
  hasMore: boolean;
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
