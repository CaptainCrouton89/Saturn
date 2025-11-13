/**
 * Artifact Node Tools for LangGraph Agent
 *
 * Provides tools for creating and updating Artifact nodes in Neo4j.
 * Artifacts represent user-generated outputs (actions, files, summaries, notes).
 * Always user-scoped, even if generated from shared team Sources.
 *
 * Note: Artifacts do NOT have notes arrays (no add_note_to_artifact tool exists).
 * See backend/scripts/ingestion/nodes/artifact.md for complete specification.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ArtifactNodeSchema } from '../../schemas/ingestion.js';
import { artifactRepository } from '../../../repositories/ArtifactRepository.js';

/**
 * Input schema for createArtifactTool
 *
 * Requires:
 * - user_id: User who created this artifact
 * - name: Short human label
 * - description: 1 sentence summary
 * - content: {type: action | md_file | etc, output: text | json}
 *
 * Optional:
 * - sensitivity: Governance flag (low | normal | high, default: normal)
 * - ttl_policy: Retention policy (keep_forever | decay | ephemeral)
 */
const CreateArtifactInputSchema = z.object({
  user_id: z.string().describe('User ID who created this artifact'),
  name: z.string().describe('Short human label for the artifact'),
  description: z.string().describe('1 sentence summary of the artifact'),
  content: z
    .object({
      type: z.string().describe('Type: action, md_file, image, etc.'),
      output: z.union([z.string(), z.record(z.string(), z.unknown())]),
    })
    .describe('Artifact content: type and output (text or JSON)'),
  sensitivity: z
    .enum(['low', 'normal', 'high'])
    .optional()
    .describe('Governance flag for permissions/access control (default: normal)'),
  ttl_policy: z
    .enum(['keep_forever', 'decay', 'ephemeral'])
    .optional()
    .describe('Retention policy (keep_forever > ephemeral > decay)'),
});

/**
 * Input schema for updateArtifactTool
 *
 * Requires:
 * - entity_key: Identifies existing Artifact node
 *
 * Optional update fields:
 * - name, description, content, sensitivity, ttl_policy
 */
const UpdateArtifactInputSchema = z.object({
  entity_key: z.string().describe('Entity key of Artifact to update'),
  name: ArtifactNodeSchema.shape.name,
  description: ArtifactNodeSchema.shape.description,
  content: ArtifactNodeSchema.shape.content,
  sensitivity: ArtifactNodeSchema.shape.sensitivity,
  ttl_policy: ArtifactNodeSchema.shape.ttl_policy,
});

/**
 * Creates a new Artifact node in Neo4j
 *
 * Uses ArtifactRepository to create artifact with stable entity_key.
 *
 * @returns JSON string containing entity_key of created Artifact
 */
export const createArtifactTool = tool(
  async (input: z.infer<typeof CreateArtifactInputSchema>) => {
    try {
      // Validate input against schema
      const validated = CreateArtifactInputSchema.parse(input);

      // Call repository to create Artifact node
      const artifact = await artifactRepository.create({
        user_id: validated.user_id,
        name: validated.name,
        description: validated.description,
        content: validated.content,
        sensitivity: validated.sensitivity,
        ttl_policy: validated.ttl_policy,
      });

      return JSON.stringify({
        success: true,
        entity_key: artifact.entity_key,
        message: `Created Artifact: ${artifact.name}`,
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
      'Create a new Artifact node in the knowledge graph. Artifacts are user-generated outputs (actions, files, summaries, notes). Requires name, description, content (with type and output), and user_id. Optional: sensitivity (low/normal/high), ttl_policy (keep_forever/decay/ephemeral). Note: Artifacts do NOT support notes - use description field for context.',
    schema: CreateArtifactInputSchema,
  }
);

/**
 * Updates an existing Artifact node in Neo4j
 *
 * Uses ArtifactRepository to update artifact by entity_key.
 *
 * All fields are optional - only provided fields will be updated.
 *
 * @returns JSON string containing entity_key of updated Artifact
 */
export const updateArtifactTool = tool(
  async (input: z.infer<typeof UpdateArtifactInputSchema>) => {
    try {
      // Validate input against schema
      const validated = UpdateArtifactInputSchema.parse(input);

      // Find existing Artifact to get required fields
      const existingArtifact = await artifactRepository.findById(validated.entity_key);
      if (!existingArtifact) {
        throw new Error(`Artifact with entity_key ${validated.entity_key} not found`);
      }

      // Validate that existingArtifact has required fields
      if (!existingArtifact.user_id) {
        throw new Error(`Artifact with entity_key ${validated.entity_key} is missing user_id`);
      }

      // Call repository to update Artifact node
      const artifact = await artifactRepository.update(validated.entity_key, {
        name: validated.name,
        description: validated.description,
        content: validated.content,
        sensitivity: validated.sensitivity,
        ttl_policy: validated.ttl_policy,
      });

      return JSON.stringify({
        success: true,
        entity_key: artifact.entity_key,
        message: `Updated Artifact: ${artifact.name}`,
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
      'Update an existing Artifact node in the knowledge graph. Requires entity_key (to identify Artifact). Optional update fields: name, description, content, sensitivity, ttl_policy. Note: Artifacts do NOT support notes.',
    schema: UpdateArtifactInputSchema,
  }
);
