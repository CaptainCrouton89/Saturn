// Search pipeline types matching backend response structure

export interface VectorSearchResult {
  entity_id: string;
  entity_name: string;
  entity_type: string;
  similarity_score: number;
}

export interface RAGFilteringResult {
  entity_id: string;
  entity_name: string;
  entity_type: string;
  reasoning: string;
  relevance_score: number;
}

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface GraphLink {
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface GraphRetrievalResult {
  nodes: GraphNode[];
  links: GraphLink[];
  central_node_ids: string[];
  depth: number;
}

export interface PipelineStages {
  vector_search: VectorSearchResult[];
  rag_filtering: RAGFilteringResult[];
  graph_retrieval: GraphRetrievalResult;
}

export interface SearchPipelineResponse {
  query: string;
  user_id: string;
  pipeline_stages: PipelineStages;
  total_execution_time_ms: number;
}

// Progress tracking for UI
export type PipelineStage = 'idle' | 'vector_search' | 'rag_filtering' | 'graph_retrieval' | 'complete' | 'error';

export interface PipelineProgress {
  stage: PipelineStage;
  data: Partial<PipelineStages>;
  error?: string;
}
