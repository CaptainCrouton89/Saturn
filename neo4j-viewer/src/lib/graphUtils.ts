import type { NodeType } from '@/components/graph/types';

// Map node types to Cosmo design system colors
// These match the Neo4j node colors from the design document
export const NODE_COLORS: Record<NodeType, string> = {
  User: '#5F6F65', // secondary - central importance
  Person: '#8B7355', // node-people (primary)
  Project: '#7A9B8E', // node-projects (info)
  Idea: '#D4A574', // node-ideas (accent)
  Topic: '#9B8579', // node-topics
  Conversation: '#C9C5BC', // border - subtle/background
  Note: '#B8A99A', // note color (muted brown)
  Artifact: '#A8B5AB', // artifact color (muted green)
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
