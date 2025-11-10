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

// Format date string to readable format
export function formatDate(dateString: string | undefined): string {
  if (!dateString) return 'N/A';

  const date = new Date(dateString);

  // Return original string if invalid (don't throw)
  if (isNaN(date.getTime())) {
    return dateString;
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Relative dates for recent items
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;

  // Absolute date for older items
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

// Convert snake_case to Title Case for display labels
export function formatLabel(key: string): string {
  return key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Check if a value looks like a date
export function isDateString(value: unknown): boolean {
  if (typeof value !== 'string') return false;

  // Must contain time component or Z suffix (ISO timestamp)
  const hasTimeComponent = /\d{2}:\d{2}:\d{2}/.test(value) || value.endsWith('Z');
  if (!hasTimeComponent) return false;

  // Try parsing - if it works, it's a date
  const date = new Date(value);
  return !isNaN(date.getTime());
}

// Check if a key name indicates a date field
export function isDateKey(key: string): boolean {
  return key.endsWith('_at') || key.includes('date') || key === 'created' || key === 'updated';
}

// Determine value type for rendering
export function getValueType(
  key: string,
  value: unknown
): 'number' | 'percent' | 'date' | 'boolean' | 'array' | 'object' | 'string' | 'null' {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') {
    // Check if key name or value range suggests percentage
    if (key.includes('level') || key.includes('quality') || key.includes('engagement') || key.includes('score')) {
      return 'percent';
    }
    return value >= 0 && value <= 1 ? 'percent' : 'number';
  }
  if (typeof value === 'object') return 'object';
  // Only treat as date if key name suggests it AND value looks like a timestamp
  if (typeof value === 'string' && isDateKey(key) && isDateString(value)) return 'date';
  return 'string';
}

// Fields to skip when rendering properties generically
export const SKIP_FIELDS = new Set([
  '__typename',
  'id',
  'entity_key',
  'canonical_name',
  'normalized_name',
  'embedding',
  'properties',
  'last_update_source', // UUID for provenance tracking
]);

// Sort properties for consistent display order
export function sortProperties(entries: [string, unknown][]): [string, unknown][] {
  // Priority order for common fields
  const priority: Record<string, number> = {
    name: 1,
    status: 2,
    type: 3,
    summary: 4,
    description: 5,
    vision: 6,
  };

  return entries.sort(([keyA], [keyB]) => {
    const priorityA = priority[keyA] || 999;
    const priorityB = priority[keyB] || 999;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return keyA.localeCompare(keyB);
  });
}
