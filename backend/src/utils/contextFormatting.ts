/**
 * Context Formatting Utilities
 *
 * Formats nodes and relationships as markdown for agent context.
 * Used by MERGE and CREATE agents to provide pre-formatted context.
 */

import type { Concept, Entity, EntityType, NoteObject, Person } from '../types/graph.js';
import { normalizeEntityName } from './entityKeyHelpers.js';
import { parseNotes } from './notes.js';

// Union type for all node types that can be formatted
export type FormattableNode = Person | Concept | Entity;

// Type for relationships with simplified properties
export interface FormattedRelationship {
  from_entity_key: string;
  from_name?: string; // Optional name for display
  to_entity_key: string;
  to_name?: string; // Optional name for display
  relationship_type: string;
  description?: string;
  attitude?: number; // 1-5 scale
  proximity?: number; // 1-5 scale
  notes?: NoteObject[];
}

/**
 * Filter notes to only include those from the specified source
 */
function filterNotesBySource(notes: NoteObject[] | any, sourceEntityKey?: string): NoteObject[] {
  if (!sourceEntityKey) {
    // No filtering - return all notes
    const parsed = parseNotes(notes);
    return parsed;
  }

  const parsed = parseNotes(notes);
  return parsed.filter(note => note.source_entity_key === sourceEntityKey);
}

/**
 * Determines the lifetime label from expires_at timestamp
 */
function getLifetimeLabel(expiresAt: string | null | undefined): string {
  if (!expiresAt) {
    return 'forever';
  }

  const expires = new Date(expiresAt);
  const now = new Date();
  const diffMs = expires.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays <= 7) {
    return 'week';
  } else if (diffDays <= 30) {
    return 'month';
  } else if (diffDays <= 365) {
    return 'year';
  } else {
    return 'forever';
  }
}

/**
 * Formats notes array as markdown bullet list
 * @param notes - Array of notes to format (or raw notes data that needs parsing)
 * @param maxNotes - Optional maximum number of notes to include
 */
function formatNotesAsMarkdown(notes: NoteObject[] | any | undefined, maxNotes?: number): string {
  if (!notes) {
    return '';
  }

  // Defensive: ensure notes is an array (use parseNotes utility)
  let notesArray: NoteObject[];
  if (Array.isArray(notes)) {
    notesArray = notes;
  } else {
    // Use parseNotes to handle string/JSON/object formats
    notesArray = parseNotes(notes);
  }

  if (!Array.isArray(notesArray) || notesArray.length === 0) {
    return '';
  }

  const notesToFormat = maxNotes ? notesArray.slice(0, maxNotes) : notesArray;

  return notesToFormat
    .map((note) => {
      const lifetime = getLifetimeLabel(note.expires_at);
      return `- ${note.content} (${lifetime})`;
    })
    .join('\n');
}

/**
 * Determines node type from the node object (returns lowercase EntityType)
 */
export function getNodeType(node: FormattableNode): EntityType {
  // Check for Person-specific properties
  if ('is_owner' in node) {
    return 'person';
  }
  // Concept and Entity are harder to distinguish, but Concept typically has more fields
  // For now, we'll use a simple heuristic - if it has 'confidence' it's likely a Concept
  if ('confidence' in node) {
    return 'concept';
  }
  return 'entity';
}

/**
 * Formats a single node (Person/Concept/Entity) as markdown
 * 
 * @param node - The node to format
 * @param nodeType - Optional node type override (lowercase EntityType, otherwise inferred)
 * @returns Formatted markdown string
 */
export function formatNodeAsMarkdown(
  node: FormattableNode,
  nodeType?: EntityType
): string {
  const entityType = nodeType || getNodeType(node);
  const name = 'name' in node ? node.name : 'Unknown';
  const entityKey = node.entity_key;
  const description = 'description' in node ? node.description : undefined;

  const lines: string[] = [];

  // Header with type and name (use Neo4j label for display)
  lines.push(`### ${entityType}: ${name} (${entityKey})`);

  // Description
  if (description) {
    lines.push(`**Description**: ${description}`);
    lines.push('');
  }

  // Notes section
  const notes = 'notes' in node ? node.notes : undefined;
  if (notes && notes.length > 0) {
    lines.push('**Notes**:');
    lines.push(formatNotesAsMarkdown(notes));
  }

  return lines.join('\n');
}

/**
 * Configuration for neighbor formatting
 * All properties are optional - sensible defaults provided
 */
export interface FormatNeighborsConfig {
  /** Include description field for each neighbor (default: true) */
  includeDescription?: boolean;
  /** Include notes for each neighbor (default: true) */
  includeNotes?: boolean;
  /** Maximum number of notes per neighbor (default: undefined = all notes) */
  maxNotesPerNeighbor?: number;
  /** Group notes by lifetime (week/month/year/forever) (default: true) */
  groupByLifetime?: boolean;
  /** Include lifetime labels on each note (default: true) */
  includeLifetimeLabels?: boolean;
  /** Custom order for lifetime groups (default: ['week', 'month', 'year', 'forever']) */
  lifetimeOrder?: ('week' | 'month' | 'year' | 'forever')[];
  /** Output format: 'xml' (default) | 'markdown' | 'compact' */
  format?: 'xml' | 'markdown' | 'compact';
  /** Include similarity score for SemanticNeighbor inputs (default: false) */
  includeSimilarityScore?: boolean;
  /** Include entity_key (default: true for compact, false for xml/markdown) */
  includeEntityKey?: boolean;
  /** Include node_type/entity_type label (default: true) */
  includeNodeType?: boolean;
  /** Filter neighbors below this similarity threshold (default: undefined) */
  minSimilarityScore?: number;
  /** Only include neighbors of these types (default: undefined = all) */
  nodeTypesToInclude?: EntityType[];
  /** Sort by 'similarity' | 'name' | 'none' (default: 'similarity' for SemanticNeighbor, 'none' for GraphNode) */
  sortBy?: 'similarity' | 'name' | 'none';
  /** Filter notes by source entity key (default: undefined = no filtering) */
  sourceEntityKey?: string;
}

/**
 * Pre-built configurations for common use cases
 */
export const NEIGHBOR_FORMAT_PRESETS = {
  /** Minimal: Name only, no notes (~30 chars) */
  minimal: {
    includeDescription: false,
    includeNotes: false,
    format: 'compact' as const,
  },
  /** Efficient: Description + limited notes (~250 chars) */
  efficient: {
    includeDescription: true,
    includeNotes: true,
    maxNotesPerNeighbor: 3,
    format: 'xml' as const,
  },
  /** Full: All notes with lifetime grouping (~500 chars) - DEFAULT */
  full: {
    includeDescription: true,
    includeNotes: true,
    groupByLifetime: true,
    includeLifetimeLabels: true,
    format: 'xml' as const,
  },
  /** Simplified: Self-closing tags only (for relationship agent) */
  simplified: {
    includeDescription: false,
    includeNotes: false,
    includeNodeType: true,
    format: 'xml' as const,
  },
} as const;

const DEFAULT_CONFIG: FormatNeighborsConfig = {
  includeDescription: true,
  includeNotes: true,
  maxNotesPerNeighbor: undefined,
  groupByLifetime: true,
  includeLifetimeLabels: true,
  lifetimeOrder: ['week', 'month', 'year', 'forever'],
  format: 'xml',
  includeSimilarityScore: false,
  includeEntityKey: false,
  includeNodeType: true,
  minSimilarityScore: undefined,
  nodeTypesToInclude: undefined,
  sortBy: undefined,
  sourceEntityKey: undefined,
};

/**
 * Format neighbors as XML-like markdown (default) or other formats
 * Supports both GraphNode[] and SemanticNeighbor[] inputs
 *
 * XML format (default) matches the format expected by agent prompts:
 * ```
 * <node name="normalized_name" type="person">
 * Description text here...
 *
 * **Notes**:
 * - note content (lifetime)
 * </node>
 * ```
 *
 * @param neighbors - Array of neighbors to format
 * @param config - Optional configuration (merged with defaults)
 * @returns Formatted string
 */
// Base neighbor type that both SemanticNeighbor and retrieval GraphNode satisfy
interface BaseNeighbor {
  entity_key: string;
  name?: string | null; // Optional for GraphNode, required for SemanticNeighbor (handled in normalization)
  description?: string | null;
  notes?: NoteObject[];
  entity_type?: EntityType;
  node_type?: string; // Allow retrieval GraphNode's node_type field
  similarity_score?: number; // Allow SemanticNeighbor's similarity_score field
  [key: string]: unknown; // Allow other properties
}

export function formatNeighborsAsMarkdown(
  neighbors: BaseNeighbor[],
  config?: Partial<FormatNeighborsConfig>
): string {
  if (neighbors.length === 0) {
    return '';
  }

  // Merge config with defaults
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  const cfg = {
    includeDescription: mergedConfig.includeDescription!,
    includeNotes: mergedConfig.includeNotes!,
    maxNotesPerNeighbor: mergedConfig.maxNotesPerNeighbor ?? undefined,
    groupByLifetime: mergedConfig.groupByLifetime!,
    includeLifetimeLabels: mergedConfig.includeLifetimeLabels!,
    lifetimeOrder: mergedConfig.lifetimeOrder || ['week', 'month', 'year', 'forever'],
    format: mergedConfig.format || 'xml',
    includeSimilarityScore: mergedConfig.includeSimilarityScore!,
    includeEntityKey: mergedConfig.includeEntityKey!,
    includeNodeType: mergedConfig.includeNodeType!,
    minSimilarityScore: mergedConfig.minSimilarityScore ?? undefined,
    nodeTypesToInclude: mergedConfig.nodeTypesToInclude ?? undefined,
    sortBy: mergedConfig.sortBy ?? undefined,
  };

  // Normalize to common format
  let normalized = neighbors.map(n => ({
    name: n.name || 'Unknown',
    entity_key: n.entity_key,
    entity_type: (n.entity_type || ('node_type' in n ? (n as { node_type?: string }).node_type : undefined)) as EntityType | undefined,
    description: n.description || undefined,
    notes: n.notes as NoteObject[] | undefined,
    similarity_score: ('similarity_score' in n ? n.similarity_score : undefined) as number | undefined,
  }));

  // Filter by similarity threshold
  if (cfg.minSimilarityScore !== undefined) {
    normalized = normalized.filter(n =>
      n.similarity_score !== undefined && n.similarity_score >= cfg.minSimilarityScore!
    );
  }

  // Filter by node types
  if (cfg.nodeTypesToInclude) {
    normalized = normalized.filter(n =>
      n.entity_type && cfg.nodeTypesToInclude!.includes(n.entity_type)
    );
  }

  // Sort
  const sortBy = cfg.sortBy || (normalized[0]?.similarity_score !== undefined ? 'similarity' : 'none');
  if (sortBy === 'similarity') {
    normalized.sort((a, b) => (b.similarity_score ?? 0) - (a.similarity_score ?? 0));
  } else if (sortBy === 'name') {
    normalized.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Format based on selected format
  if (cfg.format === 'xml') {
    return formatNeighborsAsXml(normalized, cfg);
  } else if (cfg.format === 'compact') {
    return formatNeighborsAsCompact(normalized, cfg);
  } else {
    return formatNeighborsAsMarkdownHeaders(normalized, cfg);
  }
}

/**
 * Format neighbors as XML-like tags (preferred format for agent prompts)
 */
function formatNeighborsAsXml(
  neighbors: Array<{
    name: string;
    entity_key: string;
    entity_type?: EntityType;
    description?: string;
    notes?: NoteObject[];
  }>,
  cfg: typeof DEFAULT_CONFIG
): string {
  return neighbors.map((neighbor) => {
    // Normalize name for tag using shared utility
    const normalizedName = normalizeEntityName(neighbor.name);

    const parts: string[] = [];

    // Opening tag with normalized name and type
    const typeAttr = cfg.includeNodeType && neighbor.entity_type ? ` type="${neighbor.entity_type}"` : '';

    // Check if we have any content to display (description or notes)
    const hasDescription = cfg.includeDescription && neighbor.description;
    const hasNotes = cfg.includeNotes && neighbor.notes && neighbor.notes.length > 0;
    const hasContent = hasDescription || hasNotes;

    if (!hasContent) {
      // Use self-closing tag if no content
      parts.push(`<node name="${normalizedName}"${typeAttr} />`);
      return parts.join('\n');
    }

    // Otherwise use opening/closing tags
    parts.push(`<node name="${normalizedName}"${typeAttr}>`);

    // Description as paragraph
    if (hasDescription && neighbor.description) {
      parts.push(neighbor.description);
      parts.push('');
    }

    // Notes
    if (hasNotes && neighbor.notes && neighbor.notes.length > 0) {
      // Apply source filtering if configured
      const filteredNotes = filterNotesBySource(neighbor.notes, cfg.sourceEntityKey);

      if (filteredNotes.length > 0) {
        const notesToShow = cfg.maxNotesPerNeighbor
          ? filteredNotes.slice(0, cfg.maxNotesPerNeighbor)
          : filteredNotes;

        parts.push('**Notes**:');

        if (cfg.groupByLifetime) {
          // Group notes by lifetime
          const grouped = new Map<string, string[]>();
          for (const note of notesToShow) {
            const lifetime = getLifetimeLabel(note.expires_at);
            if (!grouped.has(lifetime)) {
              grouped.set(lifetime, []);
            }
            grouped.get(lifetime)!.push(note.content);
          }

          // Output in lifetime order
          for (const lifetime of (cfg.lifetimeOrder || ['week', 'month', 'year', 'forever'])) {
            const notesForLifetime = grouped.get(lifetime);
            if (notesForLifetime && notesForLifetime.length > 0) {
              for (const content of notesForLifetime) {
                const label = cfg.includeLifetimeLabels ? ` (${lifetime})` : '';
                parts.push(`- ${content}${label}`);
              }
            }
          }
        } else {
          // Output notes in original order with lifetime labels
          for (const note of notesToShow) {
            const lifetime = cfg.includeLifetimeLabels ? ` (${getLifetimeLabel(note.expires_at)})` : '';
            parts.push(`- ${note.content}${lifetime}`);
          }
        }
      }
    }

    // Closing tag
    parts.push('</node>');

    return parts.join('\n');
  }).join('\n');
}

/**
 * Format neighbors as markdown headers (alternative format)
 */
function formatNeighborsAsMarkdownHeaders(
  neighbors: Array<{
    name: string;
    entity_key: string;
    entity_type?: EntityType;
    description?: string;
    notes?: NoteObject[];
    similarity_score?: number;
  }>,
  cfg: typeof DEFAULT_CONFIG
): string {
  const lines: string[] = [];

  neighbors.forEach((neighbor) => {
    const similarityText = cfg.includeSimilarityScore && neighbor.similarity_score
      ? ` (similarity: ${neighbor.similarity_score.toFixed(2)})`
      : '';
    const typeLabel = cfg.includeNodeType && neighbor.entity_type ? `${neighbor.entity_type}: ` : '';
    const keyText = cfg.includeEntityKey ? ` (${neighbor.entity_key})` : '';

    lines.push(`### ${typeLabel}${neighbor.name}${similarityText}${keyText}`);

    if (cfg.includeDescription && neighbor.description) {
      lines.push(`**Description**: ${neighbor.description}`);
      lines.push('');
    }

    if (cfg.includeNotes && neighbor.notes && neighbor.notes.length > 0) {
      const notesToShow = cfg.maxNotesPerNeighbor
        ? neighbor.notes.slice(0, cfg.maxNotesPerNeighbor)
        : neighbor.notes;

      lines.push('**Notes**:');
      lines.push(formatNotesAsMarkdown(notesToShow));
      lines.push('');
    }
  });

  return lines.join('\n');
}

/**
 * Format neighbors as compact single lines
 */
function formatNeighborsAsCompact(
  neighbors: Array<{
    name: string;
    entity_key: string;
    entity_type?: EntityType;
  }>,
  cfg: typeof DEFAULT_CONFIG
): string {
  return neighbors
    .map(n => {
      const type = cfg.includeNodeType && n.entity_type ? ` (${n.entity_type})` : '';
      const key = cfg.includeEntityKey ? ` [${n.entity_key}]` : '';
      return `- ${n.name}${type}${key}`;
    })
    .join('\n');
}

/**
 * Formats relationships as markdown
 *
 * @param relationships - Array of relationships to format
 * @returns Formatted markdown string
 */
export function formatRelationshipsAsMarkdown(
  relationships: FormattedRelationship[]
): string {
  if (relationships.length === 0) {
    return '';
  }

  const lines: string[] = [];

  relationships.forEach((rel) => {
    const fromName = rel.from_name || rel.from_entity_key;
    const toName = rel.to_name || rel.to_entity_key;

    lines.push(`### ${fromName} → ${toName}`);
    lines.push(`**Relationship Type**: ${rel.relationship_type}`);

    if (rel.description) {
      lines.push(`**Description**: ${rel.description}`);
    }

    if (rel.attitude !== undefined) {
      const attitudeLabels: Record<number, string> = {
        1: 'very negative',
        2: 'negative',
        3: 'neutral',
        4: 'positive',
        5: 'very positive',
      };
      const label = attitudeLabels[rel.attitude] || `level ${rel.attitude}`;
      lines.push(`**Attitude**: ${rel.attitude} (${label})`);
    }

    if (rel.proximity !== undefined) {
      const proximityLabels: Record<number, string> = {
        1: 'distant',
        2: 'somewhat distant',
        3: 'moderate',
        4: 'close',
        5: 'very close',
      };
      const label = proximityLabels[rel.proximity] || `level ${rel.proximity}`;
      lines.push(`**Proximity**: ${rel.proximity} (${label})`);
    }

    lines.push('');

    if (rel.notes && rel.notes.length > 0) {
      lines.push('**Notes**:');
      lines.push(formatNotesAsMarkdown(rel.notes, 3));
    }

    lines.push('');
  });

  return lines.join('\n');
}

/**
 * Format a single node as XML with optional source filtering
 *
 * @param node - The node to format
 * @param nodeType - Entity type (person, concept, entity)
 * @param config - Optional configuration including sourceEntityKey for filtering
 * @returns Formatted XML string
 */
export function formatSingleNodeAsXml(
  node: FormattableNode,
  nodeType: EntityType,
  config?: { sourceEntityKey?: string }
): string {
  const normalizedName = normalizeEntityName(node.name);
  const filteredNotes = filterNotesBySource(node.notes, config?.sourceEntityKey);

  const parts: string[] = [];
  parts.push(`<node name="${normalizedName}" type="${nodeType}">`);

  if ('description' in node && node.description) {
    parts.push(node.description);
    parts.push('');
  }

  if (filteredNotes.length > 0) {
    parts.push('**Notes**:');
    for (const note of filteredNotes) {
      parts.push(`- ${note.content}`);
    }
  }

  parts.push('</node>');
  return parts.join('\n');
}

/**
 * Format relationships as XML edge tags with optional source filtering
 *
 * @param relationships - Array of relationships to format
 * @param neighbors - Map of entity_key to neighbor data (for node notes)
 * @param config - Optional configuration including sourceEntityKey for filtering
 * @returns Formatted XML string
 */
export function formatRelationshipsAsXml(
  relationships: FormattedRelationship[],
  neighbors: Map<string, { description?: string | null; notes: string | any[] | null | undefined }>,
  config?: { sourceEntityKey?: string }
): string {
  if (relationships.length === 0) {
    return '';
  }

  const parts: string[] = [];

  for (const rel of relationships) {
    const toName = normalizeEntityName(rel.to_name || rel.to_entity_key);
    const filteredRelNotes = filterNotesBySource(rel.notes, config?.sourceEntityKey);

    parts.push(`<edge_to_node to="${toName}">`);

    // Relationship notes section
    parts.push('## Relationship Notes');
    if (rel.description) {
      parts.push(rel.description);
      parts.push('');
    }

    if (filteredRelNotes.length > 0) {
      for (const note of filteredRelNotes) {
        parts.push(`- ${note.content}`);
      }
      parts.push('');
    }

    // Connected node notes section
    const neighborData = neighbors.get(rel.to_entity_key);
    if (neighborData) {
      const filteredNodeNotes = filterNotesBySource(neighborData.notes, config?.sourceEntityKey);

      // Determine node type from relationship type (simplified heuristic)
      let nodeTypeLabel = 'Node';
      if (rel.relationship_type === 'has_relationship_with') nodeTypeLabel = 'Person';
      else if (rel.relationship_type === 'engages_with') nodeTypeLabel = 'Concept';
      else if (rel.relationship_type === 'associated_with') nodeTypeLabel = 'Entity';

      parts.push(`## ${nodeTypeLabel} Notes`);
      if (neighborData.description) {
        parts.push(neighborData.description);
        parts.push('');
      }

      if (filteredNodeNotes.length > 0) {
        for (const note of filteredNodeNotes) {
          parts.push(`- ${note.content}`);
        }
      }
    }

    parts.push('</edge_to_node>');
    parts.push('');
  }

  return parts.join('\n');
}
