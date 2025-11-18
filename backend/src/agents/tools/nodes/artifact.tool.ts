/**
 * Artifact Node Tools for AI SDK Agent
 *
 * Provides tools for creating and updating Artifact nodes in Neo4j.
 * Artifacts represent user-generated outputs (actions, files, summaries, notes).
 * Always user-scoped, even if generated from shared team Sources.
 *
 * Note: Artifacts do NOT have notes arrays (no add_note_to_artifact tool exists).
 * See backend/scripts/ingestion/nodes/artifact.md for complete specification.
 *
 * Tracing: Both create and update tools are wrapped with withSpan to track
 * artifact creation/update events and content metadata.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { ArtifactNodeSchema } from '../../schemas/ingestion.js';
import { artifactRepository } from '../../../repositories/ArtifactRepository.js';
import { withSpan, TraceAttributes } from '../../../utils/tracing.js';

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
 * Wrapped execute function for artifact creation with tracing
 */
async function executeCreateArtifactWithTracing(input: z.infer<typeof CreateArtifactInputSchema>): Promise<string> {
  // Validate input against schema
  const validated = CreateArtifactInputSchema.parse(input);

  if (!validated.user_id) {
    throw new Error('user_id is required for artifact creation');
  }

  const contentSize = JSON.stringify(validated.content).length;

  return withSpan('tool.create_artifact', {
    [TraceAttributes.OPERATION_NAME]: 'tool.create_artifact',
    'toolName': 'create_artifact',
    [TraceAttributes.USER_ID]: validated.user_id,
    'operationType': 'create',
    'contentType': typeof validated.content.type === 'string' ? validated.content.type : 'unknown',
    'contentSize': contentSize,
    'sensitivity': validated.sensitivity,
    'ttlPolicy': validated.ttl_policy,
    'inputSize': JSON.stringify(input).length,
  }, async () => {
    try {
      // Call repository to create Artifact node
      const artifact = await artifactRepository.create({
        user_id: validated.user_id,
        name: validated.name,
        description: validated.description,
        content: validated.content,
        sensitivity: validated.sensitivity,
        ttl_policy: validated.ttl_policy,
      });

      // Track creation metadata
      const span = require('@opentelemetry/api').trace.getActiveSpan();
      if (span) {
        span.setAttributes({
          'outputSize': JSON.stringify(artifact).length,
          'artifactCreated': true,
          'entityKey': artifact.entity_key,
        });
        span.addEvent('artifact_created', {
          'entityKey': artifact.entity_key,
          'name': artifact.name,
        });
      }

      const result = JSON.stringify({
        success: true,
        entity_key: artifact.entity_key,
        message: `Created Artifact: ${artifact.name}`,
      });

      return result;
    } catch (error) {
      const span = require('@opentelemetry/api').trace.getActiveSpan();
      if (span) {
        span.addEvent('artifact_creation_error', {
          'errorMessage': error instanceof Error ? error.message : 'Unknown error',
        });
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const result = JSON.stringify({
        success: false,
        error: errorMessage,
      });

      return result;
    }
  });
}

/**
 * Creates a new Artifact node in Neo4j
 *
 * Uses ArtifactRepository to create artifact with stable entity_key.
 *
 * @returns JSON string containing entity_key of created Artifact
 */
export const createArtifactTool = tool({
  description:
    'Create a new Artifact node in the knowledge graph. Artifacts are user-generated outputs (actions, files, summaries, notes). Requires name, description, content (with type and output), and user_id. Optional: sensitivity (low/normal/high), ttl_policy (keep_forever/decay/ephemeral). Note: Artifacts do NOT support notes - use description field for context.',
  parameters: CreateArtifactInputSchema,
  execute: executeCreateArtifactWithTracing,
});

/**
 * Wrapped execute function for artifact update with tracing
 */
async function executeUpdateArtifactWithTracing(input: z.infer<typeof UpdateArtifactInputSchema>): Promise<string> {
  // Validate input against schema
  const validated = UpdateArtifactInputSchema.parse(input);

  if (!validated.entity_key) {
    throw new Error('entity_key is required for artifact update');
  }

  // Find existing Artifact to get userId
  const existingArtifact = await artifactRepository.findById(validated.entity_key);
  if (!existingArtifact) {
    throw new Error(`Artifact with entity_key ${validated.entity_key} not found`);
  }

  if (!existingArtifact.user_id) {
    throw new Error(`Artifact with entity_key ${validated.entity_key} is missing user_id`);
  }

  const contentSize = validated.content ? JSON.stringify(validated.content).length : 0;

  return withSpan('tool.update_artifact', {
    [TraceAttributes.OPERATION_NAME]: 'tool.update_artifact',
    'toolName': 'update_artifact',
    [TraceAttributes.USER_ID]: existingArtifact.user_id,
    'operationType': 'update',
    'entityKey': validated.entity_key,
    'contentSize': contentSize,
    'hasContentUpdate': validated.content ? true : false,
    'inputSize': JSON.stringify(input).length,
  }, async () => {
    try {
      // Call repository to update Artifact node
      const artifact = await artifactRepository.update(validated.entity_key, {
        name: validated.name,
        description: validated.description,
        content: validated.content,
        sensitivity: validated.sensitivity,
        ttl_policy: validated.ttl_policy,
      });

      // Track update metadata
      const span = require('@opentelemetry/api').trace.getActiveSpan();
      if (span) {
        span.setAttributes({
          'outputSize': JSON.stringify(artifact).length,
          'artifactUpdated': true,
        });
        span.addEvent('artifact_updated', {
          'entityKey': artifact.entity_key,
          'name': artifact.name,
        });
      }

      const result = JSON.stringify({
        success: true,
        entity_key: artifact.entity_key,
        message: `Updated Artifact: ${artifact.name}`,
      });

      return result;
    } catch (error) {
      const span = require('@opentelemetry/api').trace.getActiveSpan();
      if (span) {
        span.addEvent('artifact_update_error', {
          'errorMessage': error instanceof Error ? error.message : 'Unknown error',
        });
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const result = JSON.stringify({
        success: false,
        error: errorMessage,
      });

      return result;
    }
  });
}

/**
 * Updates an existing Artifact node in Neo4j
 *
 * Uses ArtifactRepository to update artifact by entity_key.
 *
 * All fields are optional - only provided fields will be updated.
 *
 * @returns JSON string containing entity_key of updated Artifact
 */
export const updateArtifactTool = tool({
  description:
    'Update an existing Artifact node in the knowledge graph. Requires entity_key (to identify Artifact). Optional update fields: name, description, content, sensitivity, ttl_policy. Note: Artifacts do NOT support notes.',
  parameters: UpdateArtifactInputSchema,
  execute: executeUpdateArtifactWithTracing,
});
