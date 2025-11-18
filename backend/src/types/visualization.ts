/**
 * Graph Visualization Types
 * Used for Neo4j viewer and any graph visualization endpoints
 */

import type { Artifact, Concept, Entity, EntityType, Note, Person, Source } from './graph.js';

export type NodeType = EntityType | 'source' | 'note' | 'artifact';

export interface GraphNode {
  id: string;
  name: string;
  type: NodeType;
  val?: number; // Node size
  x?: number; // Position (set by force-graph)
  y?: number; // Position (set by force-graph)
  // All node properties (filtered to primitives)
  properties?: Record<string, string | number | boolean | null | undefined>;
  // Details uses actual domain types - dates will be serialized to strings in the service
  details?: Person | Concept | Entity | Source | Note | Artifact;
  // User's relationship to this node (populated for user→entity edges)
  userRelationship?: Record<string, unknown>;
}

export interface GraphLink {
  source: string;
  target: string;
  label?: string; // Relationship type
  value?: number; // Link strength
  properties?: Record<string, string | number | boolean | null | undefined>;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}
