// Node types matching Neo4j schema
export type NodeType = 'Person' | 'Concept' | 'Entity' | 'Source' | 'Artifact' | string;

// Graph node structure - fully generic
export interface GraphNode {
  id: string;
  name: string;
  type: NodeType;
  val?: number; // Node size (optional)
  x?: number; // Position x (set by force-graph)
  y?: number; // Position y (set by force-graph)
  // Generic properties - can hold any data
  details?: Record<string, unknown>;
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
