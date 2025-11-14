/**
 * Entity Node Tools for LangGraph Agent
 *
 * Provides tools for creating and updating Entity nodes in Neo4j.
 * Entities represent named entities with user-specific context.
 * Examples: companies, places, objects, groups, institutions, products, technology.
 *
 * Only create entities when there's user-specific context (not casual mentions).
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { EntityNodeSchema } from '../../schemas/ingestion.js';
import { entityRepository } from '../../../repositories/EntityRepository.js';
import { embeddingGenerationService } from '../../../services/embeddingGenerationService.js';
import type { EntityUpdate } from '../../../services/embeddingGenerationService.js';

/**
 * Input schema for createEntityTool
 *
 * Requires:
 * - user_id: User context for entity_key generation
 * - name: Entity name (normalized, unique per user)
 * - description: 1 sentence overview
 * - last_update_source: Provenance tracking (conversation_id)
 * - confidence: Confidence in entity resolution (0-1)
 *
 * Notes: Use add_note_to_entity tool to add notes after creation
 */
const CreateEntityInputSchema = z.object({
  user_id: z.string().describe('User ID for entity_key generation'),
  name: z.string().describe('Entity name (normalized, unique per user)'),
  description: z.string().describe('1 sentence overview of most important information'),
  last_update_source: z.string().describe('Source conversation_id for provenance tracking'),
  confidence: z.number().min(0).max(1).describe('Confidence in entity resolution (0-1)'),
  source_entity_key: z.string().optional().describe('Source node entity_key to auto-create mention relationship'),
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
 * - name, description
 *
 * Notes: Use add_note_to_entity tool to add notes
 */
const UpdateEntityInputSchema = z.object({
  entity_key: z.string().describe('Entity key of Entity to update'),
  last_update_source: z.string().describe('Source conversation_id for provenance tracking'),
  confidence: z.number().min(0).max(1).describe('Confidence in update (0-1)'),
  source_entity_key: z.string().optional().describe('Source node entity_key to auto-create mention relationship'),
  name: EntityNodeSchema.shape.name,
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
      const entity = await entityRepository.upsert(
        {
          user_id: validated.user_id,
          name: validated.name,
          description: validated.description,
          last_update_source: validated.last_update_source,
          confidence: validated.confidence,
        },
        validated.source_entity_key
      );

      return JSON.stringify({
        success: true,
        entity_key: entity.entity_key,
        entity_type: 'Entity' as const,
        message: `Created Entity: ${entity.name}`,
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
      'Create a new Entity node in the knowledge graph. Only create entities that have user-specific context (not casual mentions). Examples: companies, places, objects, groups, institutions, products, technology. Requires name, description, user_id, last_update_source (conversation_id), and confidence (0-1). Use add_note_to_entity tool to add notes after creation.',
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
      if (!existingEntity.user_id || !existingEntity.name) {
        throw new Error(
          `Entity with entity_key ${validated.entity_key} is missing required fields`
        );
      }

      // Call repository to update Entity node
      const entity = await entityRepository.upsert(
        {
          entity_key: validated.entity_key,
          user_id: existingEntity.user_id,
          name: validated.name ?? existingEntity.name,
          description: validated.description ?? existingEntity.description,
          last_update_source: validated.last_update_source,
          confidence: validated.confidence,
        },
        validated.source_entity_key
      );

      // Regenerate embedding if name/description were updated
      if (validated.name !== undefined || validated.description !== undefined) {
        try {
          // Fetch the updated entity to get all fields for embedding generation
          const updatedEntity = await entityRepository.findById(validated.entity_key);
          if (updatedEntity) {
            // Construct EntityUpdate for embedding generation
            const entityUpdate: EntityUpdate = {
              entityId: updatedEntity.entity_key,
              entityType: 'Entity',
              entityKey: updatedEntity.entity_key,
              isNew: false,
              nodeUpdates: {
                name: updatedEntity.name,
                description: updatedEntity.description || '',
                notes: Array.isArray(updatedEntity.notes)
                  ? updatedEntity.notes.map((n: { content: string }) => n.content).join(' ')
                  : '',
              },
              relationshipUpdates: {},
              last_update_source: validated.last_update_source,
              confidence: validated.confidence,
            };

            // Generate embedding
            const embeddingResults = await embeddingGenerationService.generate([entityUpdate]);
            if (embeddingResults.length > 0 && embeddingResults[0].embedding) {
              await entityRepository.updateEmbedding(validated.entity_key, embeddingResults[0].embedding);
            }
          }
        } catch (embeddingError) {
          // Log error but don't fail the update
          console.error(`Failed to regenerate embedding for entity ${validated.entity_key}:`, embeddingError);
        }
      }

      return JSON.stringify({
        success: true,
        entity_key: entity.entity_key,
        message: `Updated Entity: ${entity.name}`,
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
      'Update an existing Entity node in the knowledge graph. Use this when new information about an entity is learned. Requires entity_key (to identify Entity), last_update_source (conversation_id), and confidence (0-1). Optional update fields: name, description. Use add_note_to_entity tool to add notes.',
    schema: UpdateEntityInputSchema,
  }
);
