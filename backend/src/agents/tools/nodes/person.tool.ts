/**
 * Person Node Tools for LangGraph Agent
 *
 * Provides tools for creating and updating Person nodes in Neo4j.
 * These tools are called by the LangGraph agent during conversation ingestion
 * to create/update Person entities mentioned in transcripts.
 *
 * Reference: /Users/silasrhyneer/Code/Cosmo/Saturn/backend/INGESTION_REFACTOR_PLAN.md (Phase 2.1)
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { PersonNodeSchema } from '../../schemas/ingestion.js';
import { personRepository } from '../../../repositories/PersonRepository.js';

/**
 * Input schema for createPersonTool
 *
 * Requires:
 * - user_id: User context for entity_key generation
 * - canonical_name: Required for entity creation
 * - last_update_source: Provenance tracking (conversation_id)
 * - confidence: Confidence in entity resolution (0-1)
 *
 * Optional fields from PersonNodeSchema:
 * - name, is_owner, appearance, situation, history, personality, expertise, interests
 *
 * Notes: Use add_note_to_person tool to add notes after creation
 */
const CreatePersonInputSchema = z.object({
  user_id: z.string().describe('User ID for entity_key generation'),
  canonical_name: z.string().describe('Normalized name for entity resolution (required)'),
  last_update_source: z.string().describe('Source conversation_id for provenance tracking'),
  confidence: z.number().min(0).max(1).describe('Confidence in entity resolution (0-1)'),
  name: PersonNodeSchema.shape.name,
  is_owner: PersonNodeSchema.shape.is_owner,
  appearance: PersonNodeSchema.shape.appearance,
  situation: PersonNodeSchema.shape.situation,
  history: PersonNodeSchema.shape.history,
  personality: PersonNodeSchema.shape.personality,
  expertise: PersonNodeSchema.shape.expertise,
  interests: PersonNodeSchema.shape.interests,
});

/**
 * Input schema for updatePersonTool
 *
 * Requires:
 * - entity_key: Identifies existing Person node
 * - last_update_source: Provenance tracking (conversation_id)
 * - confidence: Confidence in update (0-1)
 *
 * CANNOT update:
 * - canonical_name (immutable after creation)
 * - user_id (immutable after creation)
 *
 * Optional update fields:
 * - name, is_owner, appearance, situation, history, personality, expertise, interests
 *
 * Notes: Use add_note_to_person tool to add notes
 */
const UpdatePersonInputSchema = z.object({
  entity_key: z.string().describe('Entity key of Person to update'),
  last_update_source: z.string().describe('Source conversation_id for provenance tracking'),
  confidence: z.number().min(0).max(1).describe('Confidence in update (0-1)'),
  name: PersonNodeSchema.shape.name,
  is_owner: PersonNodeSchema.shape.is_owner,
  appearance: PersonNodeSchema.shape.appearance,
  situation: PersonNodeSchema.shape.situation,
  history: PersonNodeSchema.shape.history,
  personality: PersonNodeSchema.shape.personality,
  expertise: PersonNodeSchema.shape.expertise,
  interests: PersonNodeSchema.shape.interests,
});

/**
 * Creates a new Person node in Neo4j
 *
 * Uses PersonRepository.upsert() which generates stable entity_key
 * based on canonical_name + user_id hash.
 *
 * @returns JSON string containing entity_key of created Person
 */
export const createPersonTool = tool(
  async (input: z.infer<typeof CreatePersonInputSchema>) => {
    try {
      // Validate input against schema
      const validated = CreatePersonInputSchema.parse(input);

      // Call repository to create Person node
      const person = await personRepository.upsert({
        user_id: validated.user_id,
        canonical_name: validated.canonical_name,
        name: validated.name,
        is_owner: validated.is_owner,
        appearance: validated.appearance,
        situation: validated.situation,
        history: validated.history,
        personality: validated.personality,
        expertise: validated.expertise,
        interests: validated.interests,
        last_update_source: validated.last_update_source,
        confidence: validated.confidence,
      });

      return JSON.stringify({
        success: true,
        entity_key: person.entity_key,
        entity_type: 'Person' as const,
        message: `Created Person: ${person.name || person.canonical_name}`,
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
    name: 'create_person',
    description:
      'Create a new Person node in the knowledge graph. Use this when a new person is mentioned in conversation. Requires canonical_name (normalized name), user_id, last_update_source (conversation_id), and confidence (0-1). Optional fields: name, is_owner (set to true ONLY for Person node representing the user themselves), appearance, situation, history, personality, expertise, interests. Use add_note_to_person tool to add notes after creation.',
    schema: CreatePersonInputSchema,
  }
);

/**
 * Updates an existing Person node in Neo4j
 *
 * Uses PersonRepository.upsert() to update Person by entity_key.
 * CANNOT update canonical_name (immutable after creation).
 *
 * All fields are optional - only provided fields will be updated.
 * Uses coalesce() in Cypher to preserve existing values for unprovided fields.
 *
 * @returns JSON string containing entity_key of updated Person
 */
export const updatePersonTool = tool(
  async (input: z.infer<typeof UpdatePersonInputSchema>) => {
    try {
      // Validate input against schema
      const validated = UpdatePersonInputSchema.parse(input);

      // Find existing Person to get canonical_name and user_id (required for upsert)
      const existingPerson = await personRepository.findById(validated.entity_key);
      if (!existingPerson) {
        throw new Error(`Person with entity_key ${validated.entity_key} not found`);
      }

      // Validate that existingPerson has required fields (defense against malformed data)
      if (!existingPerson.user_id || !existingPerson.canonical_name) {
        throw new Error(
          `Person with entity_key ${validated.entity_key} is missing required fields (user_id: ${existingPerson.user_id}, canonical_name: ${existingPerson.canonical_name})`
        );
      }

      // Call repository to update Person node
      // upsert() with existing entity_key will match and update
      const person = await personRepository.upsert({
        entity_key: validated.entity_key,
        user_id: existingPerson.user_id,
        canonical_name: existingPerson.canonical_name,
        name: validated.name,
        is_owner: validated.is_owner,
        appearance: validated.appearance,
        situation: validated.situation,
        history: validated.history,
        personality: validated.personality,
        expertise: validated.expertise,
        interests: validated.interests,
        last_update_source: validated.last_update_source,
        confidence: validated.confidence,
      });

      return JSON.stringify({
        success: true,
        entity_key: person.entity_key,
        message: `Updated Person: ${person.name || person.canonical_name}`,
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
    name: 'update_person',
    description:
      'Update an existing Person node in the knowledge graph. Use this when new information about a person is learned. Requires entity_key (to identify Person), last_update_source (conversation_id), and confidence (0-1). Cannot update canonical_name. Optional update fields: name, is_owner (set to true ONLY for Person node representing the user themselves), appearance, situation, history, personality, expertise, interests. Use add_note_to_person tool to add notes.',
    schema: UpdatePersonInputSchema,
  }
);
