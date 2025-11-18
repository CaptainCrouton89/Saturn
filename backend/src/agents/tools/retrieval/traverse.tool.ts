/**
 * Traverse Tool - Execute Cypher queries directly
 *
 * Allows the agent to navigate the graph with custom Cypher queries
 * for specific information gathering after initial exploration.
 *
 * Reference: tech.md lines 214-226 (Traverse tool specification)
 *
 * Tracing: Wrapped with withSpan to track graph traversal operations,
 * hop counts, relationship directions, and result counts.
 */

import { tool } from 'ai';
import { trace } from '@opentelemetry/api';
import { TraverseInputSchema } from '../../schemas/ingestion.js';
import { neo4jService } from '../../../db/neo4j.js';
import { formatNotesMultiline } from '../../../utils/notes.js';
import { withSpan, TraceAttributes } from '../../../utils/tracing.js';

/**
 * Format ISO timestamp to day-level date (YYYY-MM-DD)
 */
function formatDateDayOnly(timestamp: string | undefined | null): string | undefined {
  if (!timestamp) return undefined;
  try {
    const date = new Date(timestamp);
    return date.toISOString().split('T')[0];
  } catch {
    return undefined;
  }
}

/**
 * Convert notes array to bullet points
 * DEPRECATED: Use formatNotesMultiline from utils/notes.ts instead
 */
function formatNotes(notes: unknown): string {
  return formatNotesMultiline(notes);
}

/**
 * Filter out unwanted fields from record
 */
function filterUnwantedFields(record: Record<string, unknown>): Record<string, unknown> {
  const {
    is_dirty,
    decay_gradient,
    recall_frequency,
    last_recall_interval,
    created_by,
    last_update_source,
    embedding,
    ...filtered
  } = record;

  // Remove empty arrays
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filtered)) {
    if (Array.isArray(value) && value.length === 0) {
      continue; // Skip empty arrays
    }
    cleaned[key] = value;
  }

  return cleaned;
}

/**
 * Format a value for markdown display
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    // Check if it's a date timestamp
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const dayOnly = formatDateDayOnly(value);
      return dayOnly || value;
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    // Check if it's notes array
    if (value[0] && typeof value[0] === 'object' && 'content' in value[0]) {
      return formatNotes(value);
    }
    return value.map((v) => formatValue(v)).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

/**
 * Format traverse results to markdown
 */
function formatTraverseToMarkdown(results: Array<Record<string, unknown>>): string {
  if (results.length === 0) {
    return '# Results\n\nNo results found.';
  }

  const parts: string[] = [`# Results (${results.length} total)\n`];

  for (let i = 0; i < results.length; i++) {
    const result = filterUnwantedFields(results[i]);
    const keys = Object.keys(result);
    
    if (keys.length === 0) {
      parts.push(`## Result ${i + 1}\n\n(empty)\n`);
      continue;
    }

    // Check if this looks like a node (has entity_key, node_type, name)
    if (result.entity_key && result.node_type) {
      const name = result.name || 'Unnamed';
      const nodeType = result.node_type;
      const description = result.description ? String(result.description) : '';
      const notes = formatNotes(result.notes);
      const state = result.state || '';
      const confidence = result.confidence !== undefined ? Number(result.confidence).toFixed(1) : '';
      const accessCount = result.access_count !== undefined ? String(result.access_count) : '';
      const updatedAt = formatDateDayOnly(result.updated_at as string | undefined);

      const nodeParts: string[] = [`## ${name}`];
      
      if (nodeType) nodeParts.push(`**Type**: ${nodeType}`);
      if (description) nodeParts.push(`**Description**: ${description}`);
      if (notes) nodeParts.push(`**Notes**:\n${notes}`);
      
      const metadataParts: string[] = [];
      if (state) metadataParts.push(`State: ${state}`);
      if (confidence) metadataParts.push(`Conf: ${confidence}`);
      if (accessCount) metadataParts.push(`Access: ${accessCount}`);
      if (updatedAt) metadataParts.push(`Updated: ${updatedAt}`);
      
      if (metadataParts.length > 0) {
        nodeParts.push(`**Metadata**: ${metadataParts.join(' | ')}`);
      }

      // Add other fields that aren't in the standard format
      const otherFields: string[] = [];
      for (const [key, value] of Object.entries(result)) {
        if (!['entity_key', 'node_type', 'name', 'description', 'notes', 'state', 'confidence', 'access_count', 'updated_at'].includes(key)) {
          const formatted = formatValue(value);
          if (formatted) {
            otherFields.push(`- **${key}**: ${formatted}`);
          }
        }
      }
      
      if (otherFields.length > 0) {
        nodeParts.push(`\n**Other Fields**:\n${otherFields.join('\n')}`);
      }

      parts.push(nodeParts.join(' | '));
    } else {
      // Generic record format
      parts.push(`## Result ${i + 1}\n`);
      for (const [key, value] of Object.entries(result)) {
        const formatted = formatValue(value);
        if (formatted) {
          parts.push(`- **${key}**: ${formatted}`);
        }
      }
    }
    
    parts.push(''); // Empty line between results
  }

  return parts.join('\n');
}

/**
 * Truncate long content fields to avoid overwhelming context
 *
 * @param value - Any value from query result
 * @param maxLength - Maximum length for strings (default: 200)
 * @returns Truncated value if string, otherwise unchanged
 */
function truncateContent(value: unknown, maxLength: number = 200): unknown {
  if (typeof value === 'string' && value.length > maxLength) {
    return value.substring(0, maxLength) + '...';
  }

  if (Array.isArray(value)) {
    return value.map((v) => truncateContent(v, maxLength));
  }

  if (value !== null && typeof value === 'object') {
    const truncated: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      // Truncate content fields (notes, description, etc.)
      if (['notes', 'description', 'content', 'summary'].includes(key)) {
        truncated[key] = truncateContent(val, maxLength);
      } else {
        truncated[key] = val;
      }
    }
    return truncated;
  }

  return value;
}

/**
 * Core traverse logic - can be called directly or wrapped in a tool
 */
export async function executeTraverse(
  userId: string,
  { entity_key, direction = 'outbound', max_hops = 1, verbose = false }: {
    entity_key: string;
    direction?: 'outbound' | 'inbound' | 'both';
    max_hops?: number;
    verbose?: boolean;
  }
): Promise<string> {
      // Build safe Cypher query based on direction and max_hops
      let relationshipPattern: string;

      if (direction === 'outbound') {
        relationshipPattern = '-[r]->'.repeat(max_hops);
      } else if (direction === 'inbound') {
        relationshipPattern = '<-[r]-'.repeat(max_hops);
      } else {
        // both directions
        relationshipPattern = '-[r]-'.repeat(max_hops);
      }

      // Build the Cypher query with user_id constraint baked in
      const cypher = `
        MATCH (start {entity_key: $entity_key, user_id: $user_id})
        OPTIONAL MATCH path = (start)${relationshipPattern}(end)
        WHERE end.user_id = $user_id OR end.user_id IS NULL
        WITH start, relationships(path) as rels, nodes(path) as pathNodes
        UNWIND range(0, size(rels)-1) as idx
        WITH start, rels[idx] as r, pathNodes[idx+1] as connected
        RETURN
          r.relationship_type as relationship_type,
          r.attitude as attitude,
          r.proximity as proximity,
          r.description as relationship_description,
          r.salience as salience,
          connected.entity_key as entity_key,
          connected.node_type as node_type,
          connected.name as name,
          connected.description as description,
          connected.notes as notes,
          connected.state as state,
          connected.confidence as confidence,
          connected.access_count as access_count,
          connected.updated_at as updated_at
      `.trim();

      try {
        // Execute the query with user_id and entity_key parameters
        const rawResults = await neo4jService.executeQuery<Record<string, unknown>>(cypher, {
          user_id: userId,
          entity_key: entity_key
        });

        // Handle case where starting node doesn't exist
        if (rawResults.length === 0) {
          return `# Results\n\nNo node found with entity_key: ${entity_key.substring(0, 12)}... or no relationships found.`;
        }

        // Process results based on verbose flag
        let results: Array<Record<string, unknown>>;

        if (verbose) {
          // Return full results
          results = rawResults;
        } else {
          // Truncate content fields
          results = rawResults.map((record) => {
            const truncated: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(record)) {
              truncated[key] = truncateContent(value);
            }
            return truncated;
          });
        }

      return formatTraverseToMarkdown(results);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Graph traversal failed: ${error.message}`);
    }
    throw new Error('Graph traversal failed with unknown error');
  }
}

/**
 * Wrapped execute function with tracing
 */
async function executeTraverseWithTracing(userId: string, params: Parameters<typeof executeTraverse>[1]): Promise<string> {
  if (!userId) {
    throw new Error('userId is required for traverse tool');
  }

  if (!params.entity_key) {
    throw new Error('entity_key is required for traverse operation');
  }

  const direction = params.direction ? params.direction : 'outbound';
  const maxHops = params.max_hops ? params.max_hops : 1;
  const verbose = params.verbose ? params.verbose : false;

  return withSpan('tool.traverse', {
    [TraceAttributes.OPERATION_NAME]: 'tool.traverse',
    'toolName': 'traverse',
    [TraceAttributes.USER_ID]: userId,
    'queryType': 'graph_traversal',
    'direction': direction,
    'maxHops': maxHops,
    'verbose': verbose,
    'inputSize': JSON.stringify(params).length,
  }, async () => {
    try {
      const result = await executeTraverse(userId, params);

      // Track traversal results metadata
      const span = trace.getActiveSpan();
      if (span) {
        span.setAttributes({
          'outputSize': result.length,
          'resultType': 'markdown',
        });
      }

      return result;
    } catch (error) {
      const span = trace.getActiveSpan();
      if (span) {
        span.addEvent('traverse_error', {
          'errorMessage': error instanceof Error ? error.message : 'Unknown error',
        });
      }
      throw error;
    }
  });
}

/**
 * Traverse tool for navigating the knowledge graph
 *
 * Factory function that binds userId to the tool instance for security.
 * Uses typed parameters instead of raw Cypher to guarantee security.
 *
 * @param userId - User ID to inject as query parameter for security
 * @returns Configured traverse tool
 */
export function createTraverseTool(userId: string) {
  return tool({
    description:
      'Navigate the knowledge graph from a specific node by following relationships. ' +
      'Use after explore to inspect relationships and connected nodes. ' +
      'Returns both the relationships and the nodes they connect to. ' +
      'Direction: outbound (->), inbound (<-), or both (<->). ' +
      'Set verbose=false to truncate long content fields for efficiency.',
    parameters: TraverseInputSchema,
    execute: async (params) => {
      return executeTraverseWithTracing(userId, params);
    },
  });
}
