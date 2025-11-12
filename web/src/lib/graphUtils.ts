import { NodeType } from '@/components/graph/types';

// Map node types to Cosmo design system colors
// These match the Neo4j node colors from the design document
export const NODE_COLORS: Record<NodeType, string> = {
  Person: '#8B7355', // node-people - warm brown for people
  Concept: '#9370DB', // purple - abstract/conceptual ideas
  Entity: '#708090', // slate gray - neutral for entities (companies, places, etc.)
  Source: '#D2B48C', // tan - archive/document color
  Artifact: '#6B8E23', // olive green - outputs/products
};

// Get color for node type
export function getNodeColor(type: NodeType): string {
  return NODE_COLORS[type];
}

// Get node label with truncation
export function getNodeLabel(name: string, maxLength: number = 20): string {
  return name.length > maxLength ? `${name.slice(0, maxLength)}...` : name;
}

// Calculate link distance based on relationship strength
export function getLinkDistance(value?: number): number {
  if (!value) return 100;
  return 150 - (value * 50); // Closer relationships = shorter distance
}
