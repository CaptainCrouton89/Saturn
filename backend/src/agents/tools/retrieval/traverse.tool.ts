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

interface TraverseOutput {
  results: Array<Record<string, unknown>>;
  total_results: number;
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
        return JSON.stringify({
          error: 'Security: Cypher queries must include user_id constraint to prevent cross-user data access',
          example: 'MATCH (p:Person {user_id: $user_id}) RETURN p',
        });
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

      const output: TraverseOutput = {
        results,
        total_results: results.length,
      };

      return JSON.stringify(output, null, 2);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Cypher query execution failed: ${error.message}`);
      }
      throw new Error('Cypher query execution failed with unknown error');
    }
    },
  });
}
