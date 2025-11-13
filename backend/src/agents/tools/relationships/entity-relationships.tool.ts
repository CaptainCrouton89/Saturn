/**
 * Entity-specific relationship tools
 *
 * Specialized tools for Entity agent to create relationships:
 * - Entity → Entity (relates_to)
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { neo4jService } from '../../../db/neo4j.js';

/**
 * Create Entity → Entity (relates_to) relationship
 */
export const createEntityRelatesToEntityTool = tool(
  async (input: {
    from_entity_entity_key: string;
    to_entity_entity_key: string;
    relationship_type?: string;
    notes?: string;
    relevance?: number;
  }) => {
    const { from_entity_entity_key, to_entity_entity_key, relationship_type, notes, relevance } = input;
    try {
      const props = { relationship_type, notes, relevance };
      const propEntries = Object.entries(props).filter(([_, v]) => v !== undefined);
      const propSetters =
        propEntries.length > 0
          ? propEntries.map(([key]) => `r.${key} = $${key}`).join(', ') + ','
          : '';

      const query = `
        MATCH (from:Entity {entity_key: $from_entity_entity_key})
        MATCH (to:Entity {entity_key: $to_entity_entity_key})
        MERGE (from)-[r:relates_to]->(to)
        ON CREATE SET
          ${propSetters}
          r.created_at = datetime(),
          r.updated_at = datetime()
        ON MATCH SET
          ${propSetters}
          r.updated_at = datetime()
        RETURN r
      `;

      const params = {
        from_entity_entity_key,
        to_entity_entity_key,
        ...Object.fromEntries(propEntries),
      };

      const result = await neo4jService.executeQuery<{ r: unknown }>(query, params);

      if (!result[0]) {
        return JSON.stringify({
          success: false,
          error: 'Failed to create relationship - nodes may not exist',
        });
      }

      return JSON.stringify({
        success: true,
        message: `Created/updated relates_to from ${from_entity_entity_key} to ${to_entity_entity_key}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ success: false, error: errorMessage });
    }
  },
  {
    name: 'create_entity_relates_to_entity',
    description:
      'Create/update relates_to relationship between Entities. ' +
      'Properties: relationship_type (owns, part_of, near, competes_with), notes, relevance (1-5).',
    schema: z.object({
      from_entity_entity_key: z.string().describe('From Entity entity_key'),
      to_entity_entity_key: z.string().describe('To Entity entity_key'),
      relationship_type: z.string().optional().describe('Type: owns, part_of, near, competes_with, etc.'),
      notes: z.string().optional().describe('How they are related'),
      relevance: z.number().min(1).max(5).optional().describe('Strength: 1-5'),
    }),
  }
);
