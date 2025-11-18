/**
 * Types for LoCoMo evaluation pipeline
 */

import type { MessageParam } from 'ai';
import type { EntityType } from '../../src/types/graph.js';
import type { ExtractedEntity } from '../ingestion/types.js';

/**
 * Explore tool output structure
 */
export interface ExploreOutput {
  nodes: Array<{
    entity_key: string;
    node_type: string;
    [key: string]: unknown;
  }>;
  edges: Array<{
    from_entity_key: string;
    to_entity_key: string;
    relationship_type: string;
    properties: Record<string, unknown>;
  }>;
  neighbors: Array<{
    entity_key: string;
    node_type: string;
    name?: string;
    description?: string;
    type?: string;
  }>;
  explanations?: {
    vector_search_hits: number;
    text_match_hits: number;
    total_unique_hits: number;
    top_concepts: number;
    top_entities: number;
    top_persons: number;
    top_sources: number;
  };
}

/**
 * Traverse tool output structure
 */
export interface TraverseOutput {
  results: Array<Record<string, unknown>>;
  total_results: number;
}

/**
 * Raw LoCoMo dialogue format from dataset
 */
export interface LoCoMoDialogue {
  dialogue_id: number;
  turns: string; // JSON string containing speaker_role[] and utterance[]
}

/**
 * Parsed dialogue turns
 */
export interface ParsedDialogue {
  dialogue_id: number;
  speaker_roles: string[];
  utterances: string[];
  speaker_names?: {
    Speaker_1: string;
    Speaker_2: string;
  };
}

/**
 * Conversation chunk with metadata
 */
export interface ConversationChunk {
  dialogue_id: number;
  chunk_index: number;
  total_chunks: number;
  turn_start: number;
  turn_end: number;
  transcript: string;
  token_count: number;
  overlap_with_previous: boolean;
}

/**
 * Chunking configuration
 */
export interface ChunkConfig {
  max_tokens: number;
  overlap_tokens: number;
  preserve_turn_boundaries: boolean;
}

/**
 * Phase output types
 */
export interface Phase1Output {
  all: ExtractedEntity[];
  filtered: ExtractedEntity[];
  filters: {
    confidenceThreshold: number;
    minSubpoints: number;
  };
}

export interface Phase2Output {
  source: {
    entity_key: string;
    user_id: string;
    source_type: string;
    content_raw: string;
    summary: string;
  };
  mentioned_entities: ExtractedEntity[];
}

export interface Phase4Output {
  messages: MessageParam[];
  iterations: number;
  completed: boolean;
}

/**
 * Result from multi-phase ingestion pipeline (Phase 0 → 4)
 *
 * Extended to include full orchestrator metadata for debugging failed chunks
 */
export interface IngestionResult {
  dialogue_id: number;
  user_id: string;
  chunk_index: number;
  source_id: string;
  source_entity_key: string;
  entities_created: number; // Entities linked to this source via [:mentions]
  mentions_linked: number; // Source→Entity mention edges created
  relationships_created: number; // Semantic relationships (Person↔Concept/Entity) created during resolution
  processing_time_ms: number;
  error?: string;

  // Full orchestrator metadata (added for debugging)
  contentProcessed?: string[]; // Normalized content bullets
  extractedEntities?: ExtractedEntity[]; // Raw entities from extraction phase
  merges?: Array<{
    // Entities that were merged with existing nodes
    name: string;
    entity_type: EntityType;
    description: string;
    subpoints?: string[];
    confidence: number;
    embedding: number[];
    resolved: boolean;
    entity_key?: string;
    resolution_reason: string;
  }>;
  creations?: Array<{
    // Entities that were created as new nodes
    name: string;
    entity_type: 'person' | 'concept' | 'entity';
    description: string;
    subpoints?: string[];
    confidence: number;
    embedding: number[];
    resolved: boolean;
    entity_key?: string;
    resolution_reason: string;
  }>;
  resolution_errors?: Array<{
    // Errors from resolution phase
    phase: string;
    message: string;
  }>;
  timings?: {
    // Detailed phase timings
    normalizeMs: number;
    extractionMs: number;
    resolutionMs: number;
    mentionsMs: number;
    totalMs: number;
  };
}

/**
 * Aggregated results for a full dialogue
 */
export interface DialogueIngestionResult {
  dialogue_id: number;
  user_id: string;
  total_chunks: number;
  total_turns: number;
  chunks_processed: number;
  chunks_failed: number;
  total_entities_created: number;
  total_mentions_linked: number;
  total_relationships_created: number;
  total_processing_time_ms: number;
  chunk_results: IngestionResult[];
  errors: string[];
}

/**
 * Evaluation state for evaluator agent (deprecated - kept for compatibility)
 */
export interface EvaluationState {
  user_id: string;
  query: string;
  explore_results?: ExploreOutput;
  traverse_results?: TraverseOutput;
  messages: MessageParam[];
  answer: string;
  iteration: number;
}

/**
 * Evaluation question (for future use)
 */
export interface EvaluationQuestion {
  question_id: string;
  dialogue_id: number;
  query: string;
  question_type: 'fact_recall' | 'relationship' | 'temporal' | 'reasoning';
  expected_facts?: string[];
  expected_entities?: string[];
  ground_truth_answer?: string;
}

/**
 * Evaluation metrics (for future use)
 */
export interface EvaluationMetrics {
  question_id: string;
  dialogue_id: number;
  precision: number;
  recall: number;
  f1_score: number;
  answer_quality_score?: number; // LLM judge score
  retrieval_latency_ms: number;
  nodes_retrieved: number;
  edges_retrieved: number;
}

/**
 * LoCoMo10 Dataset Types
 */

/**
 * Raw LoCoMo10 conversation format from dataset
 */
export interface LoCoMo10Conversation {
  sample_id: string;
  conversation: {
    speaker_a: string;
    speaker_b: string;
    [key: `session_${number}`]: LoCoMo10Turn[];
    [key: `session_${number}_date_time`]: string;
  };
  qa: LoCoMo10QA[];
  event_summary?: string;
  observation?: string;
  session_summary?: string;
}

/**
 * Single dialogue turn in LoCoMo10
 */
export interface LoCoMo10Turn {
  speaker: string;
  dia_id: string; // e.g., "D1:3"
  text: string;
  img_url?: string[];
  blip_caption?: string;
  query?: string;
}

/**
 * Question-answer pair from LoCoMo10
 */
export interface LoCoMo10QA {
  question: string;
  answer: string | number;
  evidence: string[]; // e.g., ["D1:3", "D2:5"]
  category: 1 | 2 | 3 | 4; // 1=factual, 2=temporal, 3=reasoning, 4=other
}

/**
 * Extracted session with metadata
 */
export interface LoCoMo10Session {
  sessionId: string;
  turns: LoCoMo10Turn[];
  dateTime: string;
}

/**
 * Single evaluation result for one question
 */
export interface LoCoMo10EvalResult {
  question_id: number;
  question: string;
  expected_answer: string;
  our_answer: string;
  category: number;
  evidence: string[];
  score: number; // 0-1 from LLM judge
  reasoning: string; // LLM judge explanation
  latency_ms: number;
}

/**
 * Complete evaluation report for one conversation
 */
export interface LoCoMo10EvalReport {
  sample_id: string;
  conversation_index: number;
  total_sessions: number;
  ingestion_time_ms: number;
  total_questions: number;
  results: LoCoMo10EvalResult[];
  avg_score: number;
  avg_latency_ms: number;
  category_scores: {
    factual: number;
    temporal: number;
    reasoning: number;
    other: number;
  };
}
