/**
 * Concept Node Tools for LangGraph Ingestion Agent
 *
 * Provides tools for creating and updating Concept nodes in Neo4j graph.
 * Concepts represent important topics/projects that have gained significance to the user.
 *
 * Design principles:
 * - Only create Concepts when there's user-specific context (not casual mentions)
 * - Use notes field for information that doesn't fit structured fields
 * - Provenance tracking: last_update_source and confidence on all updates
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ConceptNodeSchema } from '../../schemas/ingestion.js';
import { conceptRepository } from '../../../repositories/ConceptRepository.js';

/**
 * Tool input schema for creating a Concept
 * Requires: name, description, user_id, provenance
 * Optional: notes
 */
const CreateConceptInputSchema = z.object({
  name: z.string().describe('Concept name'),
  description: z.string().describe('1 sentence overview of most important information'),
  notes: z.string().optional().describe('Other relevant information that does not fit structured fields'),
  user_id: z.string().describe('User ID who owns this concept'),
  last_update_source: z.string().describe('Source conversation ID for provenance tracking'),
  confidence: z.number().min(0).max(1).describe('Confidence in entity resolution (0-1)'),
});

/**
 * Tool input schema for updating a Concept
 * Requires: entity_key, provenance
 * Optional: name, description, notes (partial updates)
 */
const UpdateConceptInputSchema = z.object({
  entity_key: z.string().describe('Entity key of the concept to update'),
  name: z.string().optional().describe('Concept name'),
  description: z.string().optional().describe('1 sentence overview of most important information'),
  notes: z.string().optional().describe('Other relevant information that does not fit structured fields'),
  last_update_source: z.string().describe('Source conversation ID for provenance tracking'),
  confidence: z.number().min(0).max(1).describe('Confidence in entity resolution (0-1)'),
});

/**
 * Create Concept Tool
 *
 * Creates a new Concept node in Neo4j with provenance tracking.
 * Generates stable entity_key from name + user_id for idempotency.
 *
 * Returns: JSON string with entity_key of created concept
 */
export const createConceptTool = tool(
  async (input: z.infer<typeof CreateConceptInputSchema>) => {
    try {
      // Validate input against ConceptNodeSchema
      ConceptNodeSchema.parse({
        name: input.name,
        description: input.description,
        notes: input.notes,
      });

      // Create concept with provenance
      const result = await conceptRepository.create(
        {
          name: input.name,
          description: input.description,
          notes: input.notes,
          user_id: input.user_id,
        },
        {
          last_update_source: input.last_update_source,
          confidence: input.confidence,
        }
      );

      return JSON.stringify({
        success: true,
        entity_key: result.entity_key,
        message: `Concept '${input.name}' created successfully`,
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
    name: 'create_concept',
    description:
      'Create a new Concept node in the knowledge graph. Only use when the concept has user-specific context (not for casual mentions). Concepts represent important topics/projects that have gained significance to the user.',
    schema: CreateConceptInputSchema,
  }
);

/**
 * Update Concept Tool
 *
 * Updates an existing Concept node in Neo4j with partial updates.
 * Only updates fields that are provided in the input.
 *
 * Returns: JSON string with entity_key of updated concept
 */
export const updateConceptTool = tool(
  async (input: z.infer<typeof UpdateConceptInputSchema>) => {
    try {
      // Validate provided fields against ConceptNodeSchema (partial validation)
      const updates: { name?: string; description?: string; notes?: string } = {};

      if (input.name !== undefined) {
        updates.name = input.name;
      }
      if (input.description !== undefined) {
        updates.description = input.description;
      }
      if (input.notes !== undefined) {
        updates.notes = input.notes;
      }

      // Validate partial updates
      ConceptNodeSchema.partial().parse(updates);

      // Update concept with provenance
      const result = await conceptRepository.update(
        input.entity_key,
        updates,
        {
          last_update_source: input.last_update_source,
          confidence: input.confidence,
        }
      );

      return JSON.stringify({
        success: true,
        entity_key: result.entity_key,
        message: `Concept updated successfully`,
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
    name: 'update_concept',
    description:
      'Update an existing Concept node in the knowledge graph. Provide only the fields you want to update. All updates are tracked with provenance (source and confidence).',
    schema: UpdateConceptInputSchema,
  }
);
