/**
 * Relationship creation/update tools for LangGraph agents
 *
 * Implements tools for creating and updating relationships between nodes
 * with dynamic property validation based on relationship type.
 *
 * Validates relationship properties against schemas from tech.md (lines 57-118)
 * and ignores extra fields not in the schema for each relationship type.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { neo4jService } from '../../../db/neo4j.js';
import {
  PersonThinksAboutConceptSchema,
  PersonHasRelationshipWithPersonSchema,
  ConceptRelatesToConceptSchema,
  ConceptInvolvesPersonSchema,
  ConceptInvolvesEntitySchema,
  ConceptProducedArtifactSchema,
  PersonRelatesToEntitySchema,
  EntityRelatesToEntitySchema,
} from '../../schemas/ingestion.js';

/**
 * Map of relationship types to their property validation schemas
 */
const RELATIONSHIP_SCHEMAS = {
  thinks_about: PersonThinksAboutConceptSchema,
  has_relationship_with: PersonHasRelationshipWithPersonSchema,
  relates_to_concept: ConceptRelatesToConceptSchema,
  involves_person: ConceptInvolvesPersonSchema,
  involves_entity: ConceptInvolvesEntitySchema,
  produced: ConceptProducedArtifactSchema,
  relates_to_entity: PersonRelatesToEntitySchema,
  relates_to_entity_entity: EntityRelatesToEntitySchema,
} as const;

/**
 * Map of relationship type to Cypher relationship name
 * Handles polymorphic relationships (e.g., relates_to, involves)
 */
const RELATIONSHIP_TYPE_TO_CYPHER: Record<string, string> = {
  thinks_about: 'thinks_about',
  has_relationship_with: 'has_relationship_with',
  relates_to_concept: 'relates_to',
  involves_person: 'involves',
  involves_entity: 'involves',
  produced: 'produced',
  relates_to_entity: 'relates_to',
  relates_to_entity_entity: 'relates_to',
  mentions: 'mentions',
  sourced_from: 'sourced_from',
};

/**
 * Validate and filter relationship properties based on relationship type
 * Returns only properties that are defined in the schema for that relationship type
 */
function validateAndFilterProperties(
  relationshipType: string,
  properties: Record<string, unknown>
): Record<string, unknown> {
  // Handle relationships without properties (mentions, sourced_from)
  // tech.md:111-117 - Source→Entity mentions and Artifact→Source sourced_from have no properties
  if (relationshipType === 'mentions' || relationshipType === 'sourced_from') {
    return {};
  }

  // Get the schema for this relationship type
  const schema = RELATIONSHIP_SCHEMAS[relationshipType as keyof typeof RELATIONSHIP_SCHEMAS];
  if (!schema) {
    throw new Error(`Unknown relationship type: ${relationshipType}`);
  }

  // Validate properties against schema (will throw if invalid)
  const validated = schema.parse(properties);

  // Filter out undefined values (only include defined properties)
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(validated)) {
    if (value !== undefined) {
      filtered[key] = value;
    }
  }

  return filtered;
}

/**
 * Input schema for relationship creation
 */
const CreateRelationshipInputSchema = z.object({
  from_entity_key: z.string().describe('Entity key of source node'),
  to_entity_key: z.string().describe('Entity key of target node'),
  relationship_type: z
    .enum([
      'thinks_about',
      'has_relationship_with',
      'relates_to_concept',
      'involves_person',
      'involves_entity',
      'produced',
      'relates_to_entity',
      'relates_to_entity_entity',
      'mentions',
      'sourced_from',
    ])
    .describe('Relationship type - must match allowed types'),
  properties: z
    .record(z.string(), z.unknown())
    .describe('Relationship properties - validated based on relationship_type'),
});

/**
 * Create a relationship between two nodes
 *
 * Validates relationship type and properties, then creates the relationship
 * with appropriate properties. Automatically sets created_at and updated_at.
 */
export const createRelationshipTool = tool(
  async (input: z.infer<typeof CreateRelationshipInputSchema>) => {
    const { from_entity_key, to_entity_key, relationship_type, properties } = input;
    try {
      // Validate and filter properties based on relationship type
      const validatedProps = validateAndFilterProperties(relationship_type, properties);

      // Get Cypher relationship name
      const cypherRelType =
        RELATIONSHIP_TYPE_TO_CYPHER[relationship_type] || relationship_type;

      // Build property SET clause
      const propEntries = Object.entries(validatedProps);
      const propSetters =
        propEntries.length > 0
          ? propEntries.map(([key]) => `r.${key} = $${key}`).join(', ') + ','
          : '';

      // Create relationship query
      const query = `
        MATCH (from {entity_key: $from_entity_key})
        MATCH (to {entity_key: $to_entity_key})
        CREATE (from)-[r:${cypherRelType}]->(to)
        SET ${propSetters}
            r.created_at = datetime(),
            r.updated_at = datetime()
        RETURN r
      `;

      const params = {
        from_entity_key,
        to_entity_key,
        ...validatedProps,
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
        message: `Created ${cypherRelType} relationship from ${from_entity_key} to ${to_entity_key}`,
        relationship_type: cypherRelType,
        properties: validatedProps,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        success: false,
        error: errorMessage,
      });
    }
  },
  {
    name: 'create_relationship',
    description:
      'Create a relationship between two nodes. Validates relationship type and properties. ' +
      'Supported types: ' +
      'thinks_about (Person→Concept with mood, frequency), ' +
      'has_relationship_with (Person→Person with attitude, closeness, relationship_type, notes), ' +
      'relates_to (Concept→Concept, Person→Entity, Entity→Entity with notes, relevance), ' +
      'involves (Concept→Person, Concept→Entity with notes, relevance), ' +
      'produced (Concept→Artifact with notes, relevance), ' +
      'mentions (Source→Person/Entity/Concept - no properties), ' +
      'sourced_from (Artifact→Source - no properties). ' +
      'Properties are validated and extra fields ignored based on relationship type.',
    schema: CreateRelationshipInputSchema,
  }
);

/**
 * Input schema for relationship update
 */
const UpdateRelationshipInputSchema = z.object({
  from_entity_key: z.string().describe('Entity key of source node'),
  to_entity_key: z.string().describe('Entity key of target node'),
  relationship_type: z
    .enum([
      'thinks_about',
      'has_relationship_with',
      'relates_to_concept',
      'involves_person',
      'involves_entity',
      'produced',
      'relates_to_entity',
      'relates_to_entity_entity',
      'mentions',
      'sourced_from',
    ])
    .describe('Relationship type - must match allowed types'),
  properties: z
    .record(z.string(), z.unknown())
    .describe('Relationship properties - validated based on relationship_type'),
});

/**
 * Update an existing relationship between two nodes
 *
 * Validates relationship type and properties, then updates the relationship.
 * Uses MERGE to create if not exists. Updates updated_at timestamp.
 */
export const updateRelationshipTool = tool(
  async (input: z.infer<typeof UpdateRelationshipInputSchema>) => {
    const { from_entity_key, to_entity_key, relationship_type, properties } = input;
    try {
      // Validate and filter properties based on relationship type
      const validatedProps = validateAndFilterProperties(relationship_type, properties);

      // Get Cypher relationship name
      const cypherRelType =
        RELATIONSHIP_TYPE_TO_CYPHER[relationship_type] || relationship_type;

      // Build property SET clause
      const propEntries = Object.entries(validatedProps);
      const propSetters =
        propEntries.length > 0
          ? propEntries.map(([key]) => `r.${key} = $${key}`).join(', ') + ','
          : '';

      // Update (or create if not exists) relationship query
      const query = `
        MATCH (from {entity_key: $from_entity_key})
        MATCH (to {entity_key: $to_entity_key})
        MERGE (from)-[r:${cypherRelType}]->(to)
        ON CREATE SET
          r.created_at = datetime(),
          r.updated_at = datetime()
          ${propSetters ? ',' + propEntries.map(([key]) => `r.${key} = $${key}`).join(', ') : ''}
        ON MATCH SET
          ${propSetters}
          r.updated_at = datetime()
        RETURN r
      `;

      const params = {
        from_entity_key,
        to_entity_key,
        ...validatedProps,
      };

      const result = await neo4jService.executeQuery<{ r: unknown }>(query, params);

      if (!result[0]) {
        return JSON.stringify({
          success: false,
          error: 'Failed to update relationship - nodes may not exist',
        });
      }

      return JSON.stringify({
        success: true,
        message: `Updated ${cypherRelType} relationship from ${from_entity_key} to ${to_entity_key}`,
        relationship_type: cypherRelType,
        properties: validatedProps,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        success: false,
        error: errorMessage,
      });
    }
  },
  {
    name: 'update_relationship',
    description:
      'Update (or create if not exists) a relationship between two nodes. Validates relationship type and properties. ' +
      'Supported types: ' +
      'thinks_about (Person→Concept with mood, frequency), ' +
      'has_relationship_with (Person→Person with attitude, closeness, relationship_type, notes), ' +
      'relates_to (Concept→Concept, Person→Entity, Entity→Entity with notes, relevance), ' +
      'involves (Concept→Person, Concept→Entity with notes, relevance), ' +
      'produced (Concept→Artifact with notes, relevance), ' +
      'mentions (Source→Person/Entity/Concept - no properties), ' +
      'sourced_from (Artifact→Source - no properties). ' +
      'Properties are validated and extra fields ignored based on relationship type.',
    schema: UpdateRelationshipInputSchema,
  }
);
