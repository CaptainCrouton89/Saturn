/**
 * Entity Node Tools for LangGraph Agent
 *
 * Provides tools for creating and updating Entity nodes in Neo4j.
 * Entities represent named entities with user-specific context (companies, places,
 * objects, groups, institutions, products, technology, etc.)
 *
 * Only create entities when there's user-specific context (not casual mentions).
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { EntityNodeSchema } from '../../schemas/ingestion.js';
import { entityRepository } from '../../../repositories/EntityRepository.js';

/**
 * Input schema for createEntityTool
 *
 * Requires:
 * - user_id: User context for entity_key generation
 * - name: Entity name (normalized, unique per user + type)
 * - type: Entity type (company, place, object, etc.)
 * - description: 1 sentence overview
 * - last_update_source: Provenance tracking (conversation_id)
 * - confidence: Confidence in entity resolution (0-1)
 *
 * Notes: Use add_note_to_entity tool to add notes after creation
 */
const CreateEntityInputSchema = z.object({
  user_id: z.string().describe('User ID for entity_key generation'),
  name: z.string().describe('Entity name (normalized, unique per user + type)'),
  type: z
    .string()
    .describe('Entity type: company, place, object, group, institution, product, technology, etc.'),
  description: z.string().describe('1 sentence overview of most important information'),
  last_update_source: z.string().describe('Source conversation_id for provenance tracking'),
  confidence: z.number().min(0).max(1).describe('Confidence in entity resolution (0-1)'),
});

/**
 * Input schema for updateEntityTool
 *
 * Requires:
 * - entity_key: Identifies existing Entity node
 * - last_update_source: Provenance tracking (conversation_id)
 * - confidence: Confidence in update (0-1)
 *
 * Optional update fields:
 * - name, type, description
 *
 * Notes: Use add_note_to_entity tool to add notes
 */
const UpdateEntityInputSchema = z.object({
  entity_key: z.string().describe('Entity key of Entity to update'),
  last_update_source: z.string().describe('Source conversation_id for provenance tracking'),
  confidence: z.number().min(0).max(1).describe('Confidence in update (0-1)'),
  name: EntityNodeSchema.shape.name,
  type: EntityNodeSchema.shape.type,
  description: EntityNodeSchema.shape.description,
});

/**
 * Creates a new Entity node in Neo4j
 *
 * Uses EntityRepository.upsert() which generates stable entity_key
 * based on name + type + user_id hash.
 *
 * @returns JSON string containing entity_key of created Entity
 */
export const createEntityTool = tool(
  async (input: z.infer<typeof CreateEntityInputSchema>) => {
    try {
      // Validate input against schema
      const validated = CreateEntityInputSchema.parse(input);

      // Call repository to create Entity node
      const entity = await entityRepository.upsert({
        user_id: validated.user_id,
        name: validated.name,
        type: validated.type,
        description: validated.description,
        last_update_source: validated.last_update_source,
        confidence: validated.confidence,
      });

      return JSON.stringify({
        success: true,
        entity_key: entity.entity_key,
        entity_type: 'Entity' as const,
        message: `Created Entity: ${entity.name} (${entity.type})`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return JSON.stringify({
        success: false,
        error: errorMessage,
      });
    }
  },
  {
    name: 'create_entity',
    description:
      'Create a new Entity node in the knowledge graph. Only create entities that have user-specific context (not casual mentions). Entity types: company, place, object, group, institution, product, technology, etc. Requires name, type, description, user_id, last_update_source (conversation_id), and confidence (0-1). Use add_note_to_entity tool to add notes after creation.',
    schema: CreateEntityInputSchema,
  }
);

/**
 * Updates an existing Entity node in Neo4j
 *
 * Uses EntityRepository.upsert() to update Entity by entity_key.
 *
 * All fields are optional - only provided fields will be updated.
 * Uses coalesce() in Cypher to preserve existing values for unprovided fields.
 *
 * @returns JSON string containing entity_key of updated Entity
 */
export const updateEntityTool = tool(
  async (input: z.infer<typeof UpdateEntityInputSchema>) => {
    try {
      // Validate input against schema
      const validated = UpdateEntityInputSchema.parse(input);

      // Find existing Entity to get required fields for upsert
      const existingEntity = await entityRepository.findById(validated.entity_key);
      if (!existingEntity) {
        throw new Error(`Entity with entity_key ${validated.entity_key} not found`);
      }

      // Validate that existingEntity has required fields
      if (!existingEntity.user_id || !existingEntity.name || !existingEntity.type) {
        throw new Error(
          `Entity with entity_key ${validated.entity_key} is missing required fields`
        );
      }

      // Call repository to update Entity node
      const entity = await entityRepository.upsert({
        entity_key: validated.entity_key,
        user_id: existingEntity.user_id,
        name: validated.name ?? existingEntity.name,
        type: validated.type ?? existingEntity.type,
        description: validated.description ?? existingEntity.description,
        last_update_source: validated.last_update_source,
        confidence: validated.confidence,
      });

      return JSON.stringify({
        success: true,
        entity_key: entity.entity_key,
        message: `Updated Entity: ${entity.name} (${entity.type})`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return JSON.stringify({
        success: false,
        error: errorMessage,
      });
    }
  },
  {
    name: 'update_entity',
    description:
      'Update an existing Entity node in the knowledge graph. Use this when new information about an entity is learned. Requires entity_key (to identify Entity), last_update_source (conversation_id), and confidence (0-1). Optional update fields: name, type, description. Use add_note_to_entity tool to add notes.',
    schema: UpdateEntityInputSchema,
  }
);
