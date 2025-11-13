/**
 * Entity node tools for LangGraph agent
 *
 * Tools for creating and updating Entity nodes in Neo4j during conversation ingestion.
 * Entities represent named entities with user-specific context (companies, places, objects,
 * groups, institutions, products, technology, etc.)
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { EntityNodeSchema } from '../../schemas/ingestion.js';
import { entityRepository } from '../../../repositories/EntityRepository.js';

/**
 * Create a new Entity node in Neo4j
 *
 * Creates an Entity with user-specific context. Only create when there's actual
 * user-specific context, not for casual mentions.
 *
 * Entity types: company, place, object, group, institution, product, technology, etc.
 */
export const createEntityTool = tool(
  async ({
    user_id,
    name,
    type,
    description,
    notes,
    last_update_source,
    confidence,
  }: {
    user_id: string;
    name: string;
    type: string;
    description: string;
    notes?: string;
    last_update_source: string;
    confidence: number;
  }) => {
    try {
      // Validate inputs against EntityNodeSchema
      EntityNodeSchema.parse({ name, type, description, notes });

      // Create entity using repository
      const entity = await entityRepository.upsert({
        user_id,
        name,
        type,
        description,
        notes: notes || '',
        last_update_source,
        confidence,
      });

      return JSON.stringify({
        success: true,
        entity_key: entity.entity_key,
        message: `Entity '${name}' (type: ${type}) created successfully`,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error creating entity',
      });
    }
  },
  {
    name: 'create_entity',
    description:
      'Create a new Entity node in Neo4j. Only create entities that have user-specific context (not casual mentions). Entity types: company, place, object, group, institution, product, technology, etc.',
    schema: z.object({
      user_id: z.string().describe('User ID who owns this entity'),
      name: z.string().describe('Entity name'),
      type: z
        .string()
        .describe(
          'Entity type: company, place, object, group, institution, product, technology, etc.'
        ),
      description: z.string().describe('1 sentence overview of most important information'),
      notes: z
        .string()
        .optional()
        .describe('Other relevant information that does not fit structured fields'),
      last_update_source: z.string().describe('Conversation ID or source ID for provenance tracking'),
      confidence: z.number().min(0).max(1).describe('Confidence in entity resolution (0-1)'),
    }),
  }
);

/**
 * Update an existing Entity node in Neo4j
 *
 * Updates entity properties. All fields are optional except entity_key.
 * Provided fields will be updated, omitted fields will be preserved.
 */
export const updateEntityTool = tool(
  async ({
    entity_key,
    name,
    type,
    description,
    notes,
    last_update_source,
    confidence,
  }: {
    entity_key: string;
    name?: string;
    type?: string;
    description?: string;
    notes?: string;
    last_update_source?: string;
    confidence?: number;
  }) => {
    try {
      // Validate partial inputs against EntityNodeSchema
      EntityNodeSchema.partial().parse({ name, type, description, notes });

      // Find existing entity
      const existingEntity = await entityRepository.findById(entity_key);
      if (!existingEntity) {
        throw new Error(`Entity with entity_key '${entity_key}' not found`);
      }

      // Validate that existingEntity has required fields (defense against malformed data)
      if (!existingEntity.user_id || !existingEntity.name || !existingEntity.type) {
        throw new Error(
          `Entity with entity_key ${entity_key} is missing required fields (user_id: ${existingEntity.user_id}, name: ${existingEntity.name}, type: ${existingEntity.type})`
        );
      }

      // Update entity using repository (upsert with existing entity_key)
      // Use nullish coalescing to preserve existing values when undefined
      const updatedEntity = await entityRepository.upsert({
        entity_key,
        user_id: existingEntity.user_id,
        name: name ?? existingEntity.name,
        type: type ?? existingEntity.type,
        description: description ?? existingEntity.description,
        notes: notes !== undefined ? notes : existingEntity.notes,
        last_update_source: last_update_source ?? existingEntity.last_update_source,
        confidence: confidence !== undefined ? confidence : existingEntity.confidence,
      });

      return JSON.stringify({
        success: true,
        entity_key: updatedEntity.entity_key,
        message: `Entity '${updatedEntity.name}' updated successfully`,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error updating entity',
      });
    }
  },
  {
    name: 'update_entity',
    description:
      'Update an existing Entity node in Neo4j. All fields are optional except entity_key. Provided fields will be updated, omitted fields preserved.',
    schema: z.object({
      entity_key: z.string().describe('Entity key of the entity to update'),
      name: z.string().optional().describe('Entity name'),
      type: z
        .string()
        .optional()
        .describe(
          'Entity type: company, place, object, group, institution, product, technology, etc.'
        ),
      description: z.string().optional().describe('1 sentence overview of most important information'),
      notes: z
        .string()
        .optional()
        .describe('Other relevant information that does not fit structured fields'),
      last_update_source: z
        .string()
        .optional()
        .describe('Conversation ID or source ID for provenance tracking'),
      confidence: z.number().min(0).max(1).optional().describe('Confidence in entity resolution (0-1)'),
    }),
  }
);
