import { z } from 'zod';
import type { BaseMessage } from '@langchain/core/messages';

// ============================================================================
// Schemas
// ============================================================================

export const ExtractedEntitySchema = z.object({
  name: z.string(),
  entity_type: z.enum(['Person', 'Concept', 'Entity']),
  confidence: z.number().int().min(1).max(10),
  subpoints: z.array(z.string()).default([]),
});

export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

export const ExtractionOutputSchema = z.object({
  entities: z.array(ExtractedEntitySchema),
});

// ============================================================================
// State Interfaces
// ============================================================================

export interface PipelineState {
  conversationId: string;
  userId: string;
  transcript: string;
  summary: string;
  sourceType: string;
  entities: ExtractedEntity[];
  sourceEntityKey: string;
}

export interface PipelineConfig {
  conversationId: string;
  userId: string;
  sourceType: 'voice-memo' | 'conversation' | 'meeting' | 'phone-call' | 'voice-note';
  sampleDataPath: string;
  outputDir: string;
  startPhase: number; // Valid values: 0, 1, 2, 4, 5 (Phase 3 removed)
  maxPhase: number; // Valid values: 0, 1, 2, 4, 5 (Phase 3 removed)
  mockUserName?: string;
}

export interface Phase4Output {
  messages: BaseMessage[];
  iterations: number;
  completed: boolean;
  created_entity_keys: string[];
  relationship_creations: number;
  tool_invocations: Array<{
    name: string;
    args: Record<string, unknown>;
    result: string;
    success: boolean;
  }>;
}
