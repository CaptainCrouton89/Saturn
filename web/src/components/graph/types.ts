// Node types matching Neo4j schema
export type NodeType = 'Person' | 'Concept' | 'Entity' | 'Source' | 'Artifact';

// Graph node structure
export interface GraphNode {
  id: string;
  name: string;
  type: NodeType;
  val?: number; // Node size (optional)
  x?: number; // Position x (set by force-graph)
  y?: number; // Position y (set by force-graph)
  // Type-specific properties
  details?: PersonDetails | ConceptDetails | EntityDetails | SourceDetails | ArtifactDetails;
}

// Type-specific detail interfaces matching tech.md schema

export interface PersonDetails {
  canonical_name: string;
  name: string;
  is_owner?: boolean;
  appearance?: string; // physical description
  situation?: string; // current life circumstances, what they're going through
  history?: string; // background, how you know them, past context
  personality?: string; // traits, communication style, quirks
  expertise?: string; // what they're good at, professional domain
  interests?: string; // hobbies, passions, topics they care about
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface ConceptDetails {
  name: string;
  description?: string; // 1 sentence overview of most important information
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface EntityDetails {
  name: string;
  type: 'company' | 'place' | 'object' | 'group' | 'institution' | 'product' | 'technology' | string;
  description?: string; // 1 sentence overview of most important information
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface SourceDetails {
  content: {
    type: 'transcript' | string;
    content: string | Record<string, unknown>;
  };
  description?: string; // 1 sentence
  created_at?: string;
  updated_at: string;
}

export interface ArtifactDetails {
  content: {
    type: 'action' | 'md_file' | string;
    output: string | Record<string, unknown>;
  };
  description?: string; // 1 sentence
  updated_at: string;
}

// Graph edge structure
export interface GraphLink {
  source: string; // Node ID
  target: string; // Node ID
  label?: string; // Relationship type (e.g., "thinks_about", "has_relationship_with", "relates_to")
  value?: number; // Link strength (optional)
  // Relationship properties - generic since backend handles schema validation
  properties?: Record<string, string | number | boolean | null | undefined>;
}

// Complete graph data structure
export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}
