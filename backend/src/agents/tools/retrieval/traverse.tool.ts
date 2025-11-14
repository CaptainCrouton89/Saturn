/**
 * Traverse Tool - Execute Cypher queries directly
 *
 * Allows the agent to navigate the graph with custom Cypher queries
 * for specific information gathering after initial exploration.
 *
 * Reference: tech.md lines 214-226 (Traverse tool specification)
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { TraverseInputSchema } from '../../schemas/ingestion.js';
import { neo4jService } from '../../../db/neo4j.js';
import { NoteObject } from '../../../types/graph.js';

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
 * Shorten entity key to first 12 characters
 */
function shortenEntityKey(entityKey: string): string {
  return entityKey.substring(0, 12);
}

/**
 * Convert notes array to bullet points
 */
function formatNotes(notes: NoteObject[] | unknown): string {
  if (!Array.isArray(notes) || notes.length === 0) return '';
  if (notes[0] && typeof notes[0] === 'object' && 'content' in notes[0]) {
    return (notes as NoteObject[]).map((note) => `- ${note.content}`).join('\n');
  }
  return notes.map((note) => `- ${String(note)}`).join('\n');
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
      const shortKey = shortenEntityKey(String(result.entity_key));
      const name = result.name || result.canonical_name || 'Unnamed';
      const nodeType = result.node_type;
      const description = result.description ? String(result.description) : '';
      const notes = formatNotes(result.notes);
      const state = result.state || '';
      const confidence = result.confidence !== undefined ? Number(result.confidence).toFixed(1) : '';
      const accessCount = result.access_count !== undefined ? String(result.access_count) : '';
      const updatedAt = formatDateDayOnly(result.updated_at as string | undefined);

      const nodeParts: string[] = [`## ${name} (entity_key: ${shortKey})`];
      
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
        if (!['entity_key', 'node_type', 'name', 'canonical_name', 'description', 'notes', 'state', 'confidence', 'access_count', 'updated_at'].includes(key)) {
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
 * Traverse tool for executing custom Cypher queries
 *
 * Factory function that binds userId to the tool instance for security.
 *
 * Input:
 * - cypher: Cypher query to execute
 * - verbose: If false, truncate content fields (notes, description, etc.)
 *
 * Output:
 * - results: Array of query results
 * - total_results: Number of results returned
 *
 * @param userId - User ID to inject as query parameter for security
 * @returns Configured traverse tool
 */
export function createTraverseTool(userId: string) {
  return new DynamicStructuredTool({
    name: 'traverse',
    description:
      'Execute a custom Cypher query to navigate the knowledge graph. ' +
      'Use after explore to get specific details about nodes and relationships. ' +
      'Set verbose=false to truncate long content fields for efficiency. ' +
      'IMPORTANT: All queries must include user_id constraint for security. ' +
      'Example: MATCH (p:Person {user_id: $user_id}) WHERE p.canonical_name = "John" RETURN p ' +
      'The $user_id parameter is automatically provided.',
    schema: TraverseInputSchema,
    func: async ({ cypher, verbose }): Promise<string> => {
      if (!cypher || cypher.trim().length === 0) {
        throw new Error('Cypher query cannot be empty');
      }

      // Security check: prevent dangerous write operations
      const lowerCypher = cypher.toLowerCase();
      const dangerousKeywords = ['delete', 'detach', 'remove', 'drop', 'create constraint', 'create index'];

      for (const keyword of dangerousKeywords) {
        if (lowerCypher.includes(keyword)) {
          throw new Error(
            `Dangerous operation not allowed in traverse tool: ${keyword}. Use node/relationship creation tools instead.`
          );
        }
      }

      // Security: Validate query includes user_id constraint
      const hasUserIdConstraint =
        lowerCypher.includes('user_id:') || lowerCypher.includes('user_id =') || lowerCypher.includes('user_id=');

      if (!hasUserIdConstraint) {
        return '## Error\n\nSecurity: Cypher queries must include user_id constraint to prevent cross-user data access\n\n**Example**: `MATCH (p:Person {user_id: $user_id}) RETURN p`';
      }

      try {
        // Execute the query with user_id parameter injection
        const rawResults = await neo4jService.executeQuery<Record<string, unknown>>(cypher, { user_id: userId });

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
        throw new Error(`Cypher query execution failed: ${error.message}`);
      }
      throw new Error('Cypher query execution failed with unknown error');
    }
    },
  });
}
