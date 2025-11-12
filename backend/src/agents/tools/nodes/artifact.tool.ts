/**
 * Artifact Node Tools for LangGraph Ingestion Agent
 *
 * Provides tools for creating and updating Artifact nodes in Neo4j graph.
 * Artifacts represent generated outputs (actions, files, etc.) produced from concepts.
 *
 * Design principles:
 * - Only create Artifacts when a concept produces a tangible output/action
 * - Use notes field for information that doesn't fit structured fields
 * - Content is structured as {type, output} for flexibility
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ArtifactNodeSchema } from '../../schemas/ingestion.js';
import { artifactRepository } from '../../../repositories/ArtifactRepository.js';

/**
 * Tool input schema for creating an Artifact
 * Requires: description, content, user_id, provenance
 * Optional: notes
 */
const CreateArtifactInputSchema = z.object({
  description: z.string().describe('1 sentence summary of the artifact'),
  content: z.object({
    type: z.string().describe('Type: action, md_file, image, etc.'),
    output: z.union([z.string(), z.record(z.string(), z.unknown())]),
  }).describe('Artifact content: type and output (text or JSON)'),
  notes: z.string().optional().describe('Other relevant information that does not fit structured fields'),
  user_id: z.string().describe('User ID who owns this artifact'),
  last_update_source: z.string().describe('Source conversation ID for provenance tracking'),
  confidence: z.number().min(0).max(1).describe('Confidence in artifact creation (0-1)'),
});

/**
 * Tool input schema for updating an Artifact
 * Requires: entity_key, provenance
 * Optional: description, content, notes (partial updates)
 */
const UpdateArtifactInputSchema = z.object({
  entity_key: z.string().describe('Entity key of the artifact to update'),
  description: z.string().optional().describe('1 sentence summary of the artifact'),
  content: z
    .object({
      type: z.string().describe('Type: action, md_file, image, etc.'),
      output: z.union([z.string(), z.record(z.string(), z.unknown())]),
    })
    .describe('Artifact content: type and output (text or JSON)')
    .optional(),
  notes: z.string().optional().describe('Other relevant information that does not fit structured fields'),
  last_update_source: z.string().describe('Source conversation ID for provenance tracking'),
  confidence: z.number().min(0).max(1).describe('Confidence in update (0-1)'),
});

/**
 * Create Artifact Tool
 *
 * Creates a new Artifact node in Neo4j with provenance tracking.
 * Generates stable entity_key from description + user_id + created_at for uniqueness.
 *
 * Returns: JSON string with entity_key of created artifact
 */
export const createArtifactTool = tool(
  async (input: z.infer<typeof CreateArtifactInputSchema>) => {
    try {
      // Validate input against ArtifactNodeSchema
      ArtifactNodeSchema.parse({
        description: input.description,
        content: input.content,
        notes: input.notes,
      });

      // Create artifact with provenance
      const result = await artifactRepository.create(
        {
          description: input.description,
          content: input.content,
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
        message: `Artifact '${input.description}' created successfully`,
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
    name: 'create_artifact',
    description:
      'Create a new Artifact node in the knowledge graph. Only use when a concept produces a tangible output (action, file, etc.). Artifacts represent generated outputs from conversations.',
    schema: CreateArtifactInputSchema,
  }
);

/**
 * Update Artifact Tool
 *
 * Updates an existing Artifact node in Neo4j with partial updates.
 * Only updates fields that are provided in the input.
 *
 * Returns: JSON string with entity_key of updated artifact
 */
export const updateArtifactTool = tool(
  async (input: z.infer<typeof UpdateArtifactInputSchema>) => {
    try {
      // Validate provided fields against ArtifactNodeSchema (partial validation)
      const updates: {
        description?: string;
        content?: { type: string; output: string | Record<string, unknown> };
        notes?: string;
      } = {};

      if (input.description !== undefined) {
        updates.description = input.description;
      }
      if (input.content !== undefined) {
        updates.content = input.content;
      }
      if (input.notes !== undefined) {
        updates.notes = input.notes;
      }

      // Validate partial updates
      ArtifactNodeSchema.partial().parse(updates);

      // Update artifact with provenance
      const result = await artifactRepository.update(input.entity_key, updates, {
        last_update_source: input.last_update_source,
        confidence: input.confidence,
      });

      return JSON.stringify({
        success: true,
        entity_key: result.entity_key,
        message: `Artifact updated successfully`,
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
    name: 'update_artifact',
    description:
      'Update an existing Artifact node in the knowledge graph. Provide only the fields you want to update. All updates are tracked with provenance (source and confidence).',
    schema: UpdateArtifactInputSchema,
  }
);
