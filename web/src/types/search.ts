// Simplified search types for knowledge graph visualization
// References types from components/graph/types.ts

import type { NodeType } from '@/components/graph/types';

// Graph node structure for search results
export interface GraphNode {
  id: string;
  name: string;
  type: NodeType; // 'Person' | 'Concept' | 'Entity' | 'Source' | 'Artifact'
  details: Record<string, unknown>;
}

// Graph link structure for search results
export interface GraphLink {
  source: string;
  target: string;
  label: string; // Relationship type (e.g., "thinks_about", "has_relationship_with")
  properties: Record<string, unknown>;
}

// Graph retrieval result
export interface GraphRetrievalResult {
  nodes: GraphNode[];
  links: GraphLink[];
  central_node_ids: string[];
  depth: number;
}

// Progress tracking for UI
export type PipelineStage = 'idle' | 'searching' | 'complete' | 'error';

export interface PipelineProgress {
  stage: PipelineStage;
  data?: GraphRetrievalResult;
  error?: string;
}
