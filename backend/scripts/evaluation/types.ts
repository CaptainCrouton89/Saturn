/**
 * Types for LoCoMo evaluation pipeline
 */

import { BaseMessage } from '@langchain/core/messages';
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
  messages: BaseMessage[];
  iterations: number;
  completed: boolean;
}

/**
 * Result from multi-phase ingestion pipeline (Phase 0 → 4)
 */
export interface IngestionResult {
  dialogue_id: number;
  user_id: string;
  chunk_index: number;
  source_id: string;
  source_entity_key: string;
  entities_created: number; // Entities linked to this source via [:mentions]
  relationships_created: number; // Relationships created during ingestion
  processing_time_ms: number;
  error?: string;
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
  total_relationships_created: number;
  total_processing_time_ms: number;
  chunk_results: IngestionResult[];
  errors: string[];
}

/**
 * LangGraph state for evaluator agent
 */
export interface EvaluationState {
  user_id: string;
  query: string;
  explore_results?: ExploreOutput;
  traverse_results?: TraverseOutput;
  messages: BaseMessage[];
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
