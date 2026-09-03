import { NodeType } from '@/components/graph/types';

// Map node types to Cosmo design system colors.
// Keys are the normalized lowercase node types, one per Neo4j label.
export const NODE_COLORS: Record<NodeType, string> = {
  person: '#8B7355', // node-people - warm brown for people
  concept: '#9370DB', // purple - abstract/conceptual ideas
  entity: '#708090', // slate gray - neutral for entities (companies, places, etc.)
  event: '#C1666B', // clay red - things that happened
  source: '#D2B48C', // tan - archive/document color
  artifact: '#6B8E23', // olive green - outputs/products
  storyline: '#4F7CAC', // slate blue - narrative threads
  macro: '#7D6B7D', // muted plum - highest-level themes
};

// Get color for node type
export function getNodeColor(type: NodeType): string {
  return NODE_COLORS[type];
}

// Get node label with truncation
export function getNodeLabel(name: string | undefined, maxLength: number = 20): string {
  // Handle undefined/null/empty names
  if (!name) return 'Unnamed';
  return name.length > maxLength ? `${name.slice(0, maxLength)}...` : name;
}
