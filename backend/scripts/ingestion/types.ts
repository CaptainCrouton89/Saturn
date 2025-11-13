import { z } from 'zod';

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

export interface NodeUpdate {
  content: string;
  timestamp: string;
  source_id: string;
  processed: boolean;
}

export interface NodeWithUpdates {
  identifier: string;
  entity_key?: string;
  entity_type: 'Person' | 'Concept' | 'Entity';
  updates: NodeUpdate[];
}

export interface PipelineState {
  conversationId: string;
  userId: string;
  transcript: string;
  summary: string;
  sourceType: string;
  entities: ExtractedEntity[];
  sourceEntityKey: string;
  episodeEntityKey: string;
  nodesWithUpdates: NodeWithUpdates[];
}

export interface PipelineConfig {
  conversationId: string;
  userId: string;
  sourceType: 'voice-memo' | 'conversation' | 'meeting' | 'phone-call' | 'voice-note';
  sampleDataPath: string;
  outputDir: string;
  startPhase: number;
  maxPhase: number;
  // Optional Episode configuration
  episodeId?: string; // If provided, associate Source with existing Episode
  episodeContextType?: string; // e.g., "call", "YC app work session"
  episodeImportance?: number; // 1-10 scale
}

// ============================================================================
// Neo4j Interfaces
// ============================================================================

export interface MockNode {
  entity_key: string;
  type: 'Person' | 'Concept' | 'Entity' | 'Episode' | 'Source';
  properties: Record<string, unknown>;
}

export interface MockRelationship {
  from_entity_key: string;
  to_entity_key: string;
  type: string;
  properties: Record<string, unknown>;
}
