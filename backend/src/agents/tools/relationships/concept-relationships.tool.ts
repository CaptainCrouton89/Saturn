/**
 * Concept-specific relationship tools
 *
 * Specialized tools for Concept agent to create relationships:
 * - Concept → Concept (relates_to)
 * - Concept → Person (involves)
 * - Concept → Entity (involves)
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { neo4jService } from '../../../db/neo4j.js';

/**
 * Create Concept → Concept (relates_to) relationship
 */
export const createConceptRelatesToConceptTool = tool(
  async (input: {
    from_concept_entity_key: string;
    to_concept_entity_key: string;
    notes?: string;
    relevance?: number;
  }) => {
    const { from_concept_entity_key, to_concept_entity_key, notes, relevance } = input;
    try {
      const props = { notes, relevance };
      const propEntries = Object.entries(props).filter(([_, v]) => v !== undefined);
      const propSetters =
        propEntries.length > 0
          ? propEntries.map(([key]) => `r.${key} = $${key}`).join(', ') + ','
          : '';

      const query = `
        MATCH (from:Concept {entity_key: $from_concept_entity_key})
        MATCH (to:Concept {entity_key: $to_concept_entity_key})
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
        from_concept_entity_key,
        to_concept_entity_key,
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
        message: `Created/updated relates_to from ${from_concept_entity_key} to ${to_concept_entity_key}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ success: false, error: errorMessage });
    }
  },
  {
    name: 'create_concept_relates_to_concept',
    description: 'Create/update relates_to relationship between Concepts. Properties: notes, relevance (1-5).',
    schema: z.object({
      from_concept_entity_key: z.string().describe('From Concept entity_key'),
      to_concept_entity_key: z.string().describe('To Concept entity_key'),
      notes: z.string().optional().describe('How they are related'),
      relevance: z.number().min(1).max(5).optional().describe('Closeness: 1-5'),
    }),
  }
);

/**
 * Create Concept → Person (involves) relationship
 */
export const createConceptInvolvesPersonTool = tool(
  async (input: {
    concept_entity_key: string;
    person_entity_key: string;
    notes?: string;
    relevance?: number;
  }) => {
    const { concept_entity_key, person_entity_key, notes, relevance } = input;
    try {
      const props = { notes, relevance };
      const propEntries = Object.entries(props).filter(([_, v]) => v !== undefined);
      const propSetters =
        propEntries.length > 0
          ? propEntries.map(([key]) => `r.${key} = $${key}`).join(', ') + ','
          : '';

      const query = `
        MATCH (concept:Concept {entity_key: $concept_entity_key})
        MATCH (person:Person {entity_key: $person_entity_key})
        MERGE (concept)-[r:involves]->(person)
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
        concept_entity_key,
        person_entity_key,
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
        message: `Created/updated involves from ${concept_entity_key} to ${person_entity_key}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ success: false, error: errorMessage });
    }
  },
  {
    name: 'create_concept_involves_person',
    description: 'Create/update involves relationship from Concept to Person. Properties: notes, relevance (1-5).',
    schema: z.object({
      concept_entity_key: z.string().describe('Concept entity_key'),
      person_entity_key: z.string().describe('Person entity_key'),
      notes: z.string().optional().describe("Person's involvement in the concept"),
      relevance: z.number().min(1).max(5).optional().describe('Importance: 1-5'),
    }),
  }
);

/**
 * Create Concept → Entity (involves) relationship
 */
export const createConceptInvolvesEntityTool = tool(
  async (input: {
    concept_entity_key: string;
    entity_entity_key: string;
    notes?: string;
    relevance?: number;
  }) => {
    const { concept_entity_key, entity_entity_key, notes, relevance } = input;
    try {
      const props = { notes, relevance };
      const propEntries = Object.entries(props).filter(([_, v]) => v !== undefined);
      const propSetters =
        propEntries.length > 0
          ? propEntries.map(([key]) => `r.${key} = $${key}`).join(', ') + ','
          : '';

      const query = `
        MATCH (concept:Concept {entity_key: $concept_entity_key})
        MATCH (entity:Entity {entity_key: $entity_entity_key})
        MERGE (concept)-[r:involves]->(entity)
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
        concept_entity_key,
        entity_entity_key,
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
        message: `Created/updated involves from ${concept_entity_key} to ${entity_entity_key}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ success: false, error: errorMessage });
    }
  },
  {
    name: 'create_concept_involves_entity',
    description: 'Create/update involves relationship from Concept to Entity. Properties: notes, relevance (1-5).',
    schema: z.object({
      concept_entity_key: z.string().describe('Concept entity_key'),
      entity_entity_key: z.string().describe('Entity entity_key'),
      notes: z.string().optional().describe("Entity's involvement in the concept"),
      relevance: z.number().min(1).max(5).optional().describe('Importance: 1-5'),
    }),
  }
);
