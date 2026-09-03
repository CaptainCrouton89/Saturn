// Node types matching the Neo4j labels in backend/src/constants/graph.ts.
// The backend emits the label verbatim from the full-graph route (`Person`) and
// lowercased from Explore (`person`); web/src/lib/api.ts normalizes both to this
// closed lowercase union at the API boundary.
export const NODE_TYPES = [
  'person',
  'concept',
  'entity',
  'event',
  'source',
  'artifact',
  'storyline',
  'macro',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

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
