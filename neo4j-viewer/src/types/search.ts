import type { GraphNode, GraphLink } from '../components/graph/types';

export type PipelineStage = 'vector_search' | 'rag_filtering' | 'graph_retrieval' | 'complete';

export interface VectorSearchResult {
  entity_id: string;
  entity_type: string;
  entity_name: string;
  similarity_score: number;
  excerpt?: string;
}

export interface RAGFilteredEntity {
  entity_id: string;
  entity_type: string;
  entity_name: string;
  relevance_score: number;
  reasoning: string;
}

export interface GraphRetrievalResult {
  nodes: GraphNode[];
  links: GraphLink[];
  central_node_ids: string[];
}

export interface PipelineProgress {
  stage: PipelineStage;
  progress: number; // 0-100
  message: string;
  data?: VectorSearchResult[] | RAGFilteredEntity[] | GraphRetrievalResult;
}

export interface SearchResult {
  query: string;
  pipeline_stages: {
    vector_search: VectorSearchResult[];
    rag_filtering: RAGFilteredEntity[];
    graph_retrieval: GraphRetrievalResult;
  };
  total_execution_time_ms: number;
}
