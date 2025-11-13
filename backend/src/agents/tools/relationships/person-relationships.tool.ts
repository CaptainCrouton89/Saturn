/**
 * Person-specific relationship tools
 *
 * Specialized tools for Person agent to create relationships:
 * - Person → Concept (thinks_about)
 * - Person → Person (has_relationship_with)
 * - Person → Entity (relates_to)
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { neo4jService } from '../../../db/neo4j.js';

/**
 * Create Person → Concept (thinks_about) relationship
 */
export const createPersonThinksAboutConceptTool = tool(
  async (input: { person_entity_key: string; concept_entity_key: string; mood?: string }) => {
    const { person_entity_key, concept_entity_key, mood } = input;
    try {
      const query = `
        MATCH (person:Person {entity_key: $person_entity_key})
        MATCH (concept:Concept {entity_key: $concept_entity_key})
        MERGE (person)-[r:thinks_about]->(concept)
        ON CREATE SET
          r.frequency = 1,
          r.created_at = datetime(),
          r.updated_at = datetime()
          ${mood ? ', r.mood = $mood' : ''}
        ON MATCH SET
          r.frequency = COALESCE(r.frequency, 0) + 1,
          r.updated_at = datetime()
          ${mood ? ', r.mood = $mood' : ''}
        RETURN r
      `;

      const params = { person_entity_key, concept_entity_key, ...(mood && { mood }) };
      const result = await neo4jService.executeQuery<{ r: unknown }>(query, params);

      if (!result[0]) {
        return JSON.stringify({
          success: false,
          error: 'Failed to create relationship - nodes may not exist',
        });
      }

      return JSON.stringify({
        success: true,
        message: `Created/updated thinks_about from ${person_entity_key} to ${concept_entity_key}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ success: false, error: errorMessage });
    }
  },
  {
    name: 'create_person_thinks_about_concept',
    description: 'Create/update thinks_about relationship from Person to Concept. Properties: mood (emotional stance).',
    schema: z.object({
      person_entity_key: z.string().describe('Person entity_key'),
      concept_entity_key: z.string().describe('Concept entity_key'),
      mood: z
        .string()
        .optional()
        .describe('Emotional stance: dreads, excited_by, loves, misses, wants, fears, etc.'),
    }),
  }
);

/**
 * Create Person → Person (has_relationship_with) relationship
 */
export const createPersonRelationshipTool = tool(
  async (input: {
    from_person_entity_key: string;
    to_person_entity_key: string;
    attitude_towards_person?: string;
    closeness?: number;
    relationship_type?: string;
    notes?: string;
  }) => {
    const { from_person_entity_key, to_person_entity_key, attitude_towards_person, closeness, relationship_type, notes } =
      input;
    try {
      const props = { attitude_towards_person, closeness, relationship_type, notes };
      const propEntries = Object.entries(props).filter(([_, v]) => v !== undefined);
      const propSetters =
        propEntries.length > 0
          ? propEntries.map(([key]) => `r.${key} = $${key}`).join(', ') + ','
          : '';

      const query = `
        MATCH (from:Person {entity_key: $from_person_entity_key})
        MATCH (to:Person {entity_key: $to_person_entity_key})
        MERGE (from)-[r:has_relationship_with]->(to)
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
        from_person_entity_key,
        to_person_entity_key,
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
        message: `Created/updated has_relationship_with from ${from_person_entity_key} to ${to_person_entity_key}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ success: false, error: errorMessage });
    }
  },
  {
    name: 'create_person_relationship',
    description:
      'Create/update has_relationship_with between two People. ' +
      'Properties: attitude_towards_person, closeness (1-5), relationship_type (colleague, friend, family), notes.',
    schema: z.object({
      from_person_entity_key: z.string().describe('From Person entity_key'),
      to_person_entity_key: z.string().describe('To Person entity_key'),
      attitude_towards_person: z
        .string()
        .optional()
        .describe('Emotional stance: hostile, unfriendly, neutral, friendly, close, loving'),
      closeness: z.number().min(1).max(5).optional().describe('How well they know each other: 1-5'),
      relationship_type: z.string().optional().describe('Type: colleague, friend, family, partner, etc.'),
      notes: z.string().optional().describe('Rich text description of relationship'),
    }),
  }
);

/**
 * Create Person → Entity (relates_to) relationship
 */
export const createPersonRelatesToEntityTool = tool(
  async (input: {
    person_entity_key: string;
    entity_entity_key: string;
    relationship_type?: string;
    notes?: string;
    relevance?: number;
  }) => {
    const { person_entity_key, entity_entity_key, relationship_type, notes, relevance } = input;
    try {
      const props = { relationship_type, notes, relevance };
      const propEntries = Object.entries(props).filter(([_, v]) => v !== undefined);
      const propSetters =
        propEntries.length > 0
          ? propEntries.map(([key]) => `r.${key} = $${key}`).join(', ') + ','
          : '';

      const query = `
        MATCH (person:Person {entity_key: $person_entity_key})
        MATCH (entity:Entity {entity_key: $entity_entity_key})
        MERGE (person)-[r:relates_to]->(entity)
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
        person_entity_key,
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
        message: `Created/updated relates_to from ${person_entity_key} to ${entity_entity_key}`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ success: false, error: errorMessage });
    }
  },
  {
    name: 'create_person_relates_to_entity',
    description:
      'Create/update relates_to relationship from Person to Entity. ' +
      'Properties: relationship_type (work, life, other), notes, relevance (1-5).',
    schema: z.object({
      person_entity_key: z.string().describe('Person entity_key'),
      entity_entity_key: z.string().describe('Entity entity_key'),
      relationship_type: z.string().optional().describe('Type: work, life, other, etc.'),
      notes: z.string().optional().describe('Rich text description'),
      relevance: z.number().min(1).max(5).optional().describe('Importance: 1-5'),
    }),
  }
);
