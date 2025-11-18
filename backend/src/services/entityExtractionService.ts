/**
 * Entity Extraction Service
 *
 * Phase 1: Extracts memories from conversation transcripts and generates embeddings
 * immediately after extraction (before resolution begins).
 *
 * Reference: INGESTION_REFACTOR_PLAN_V2.md Section 2.2 and Section 7
 */

import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import { EXTRACTION_SYSTEM_PROMPT } from '../agents/prompts/ingestion/phase1-extraction.js';
import type { EntityType } from '../types/graph.js';
import type { ExtractedEntity } from '../types/ingestion.js';
import { generateEmbedding } from './embeddingGenerationService.js';
import { withSpan, buildEntityAttributes } from '../utils/tracing.js';

/**
 * Schema for extracted entity (matches ExtractedEntity type)
 *
 * Note: confidence is stored as integer 1-10 in extraction, but converted to 0-1 float in ExtractedEntity
 */
// Import EntityType values for Zod enum
const ENTITY_TYPES: [EntityType, EntityType, EntityType] = ['person', 'concept', 'entity'];

const ExtractedEntitySchema = z.object({
  name: z.string().min(1).describe('Entity name as it appears in the conversation'),
  entity_type: z.enum(ENTITY_TYPES).describe('Type of entity'),
  description: z.string().min(10).max(500).describe('Brief description (1-3 sentences, 10-500 chars)'),
  confidence: z.number().int().min(1).max(10).describe('Extraction confidence (integer 1-10)'),
  subpoints: z.array(z.string()).describe('Elaboration points about the entity'),
});

/**
 * Schema for extraction output (array of entities)
 */
const ExtractionOutputSchema = z.object({
  entities: z.array(ExtractedEntitySchema).describe('Array of extracted entities'),
});

/**
 * Extract memories from conversation transcript and generate embeddings
 *
 * Phase 1 implementation:
 * 1. Extract memories using LLM structured output
 * 2. Generate embeddings immediately after extraction (name + description)
 * 3. Return ExtractedEntity[] with embeddings populated
 *
 * @param transcript - Conversation transcript (can be string, array of turns, etc.)
 * @param modelId - AI SDK model identifier (e.g., 'gpt-5-nano')
 * @param userId - Optional user ID for tracing context
 * @returns Array of extracted memories with embeddings
 */
export async function extractEntitiesWithEmbeddings(
  transcript: string | unknown[],
  modelId: string = "gpt-5-nano",
  userId?: string
): Promise<ExtractedEntity[]> {
  // Count utterances for telemetry
  const utteranceCount = Array.isArray(transcript) ? transcript.length : 1;

  return withSpan(
    'service.entityExtraction.extractWithEmbeddings',
    buildEntityAttributes('entity_extraction', 'create', {
      userId,
      entityCount: utteranceCount,
    }),
    async () => {
      console.log(`\n📝 Phase 1: Memory Extraction...`);

      // Convert transcript to string if needed
      const transcriptText =
        typeof transcript === "string"
          ? transcript
          : JSON.stringify(transcript, null, 2);

      // Create OpenAI provider instance
      const openai = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

      // Extract memories using generateObject
      const { object: extractionResult } = await generateObject({
        model: openai(modelId),
        schema: ExtractionOutputSchema,
        system: EXTRACTION_SYSTEM_PROMPT,
        prompt: `Extract all persons, concepts, and entities from this conversation transcript:\n\n${transcriptText}`,
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'ingestion-extract-entities',
          metadata: {
            phase: 'extraction',
            schemaName: 'ExtractionOutputSchema',
            utteranceCount,
            userId: userId || 'unknown',
          },
        },
      });

      const extractedEntities =
        (extractionResult as z.infer<typeof ExtractionOutputSchema>).entities || [];
      console.log(`   ✅ Extracted ${extractedEntities.length} memories`);

      // Generate embeddings immediately after extraction (Phase 1 requirement)
      console.log(
        `\n🔢 Generating embeddings for ${extractedEntities.length} extracted memories...`
      );

      const entitiesWithEmbeddings = await Promise.all(
        extractedEntities.map(async (entity: z.infer<typeof ExtractedEntitySchema>) => {
          // Generate embedding using name + description (as specified in plan Section 7.2)
          const embeddingText = `${entity.name}\n${entity.description}`;
          const embedding = await generateEmbedding(embeddingText);

          console.log(
            `   ✅ Generated embedding for ${entity.name} (${entity.entity_type})`
          );

          // Convert to ExtractedEntity format (confidence: 1-10 integer → 0-1 float)
          const extractedEntity: ExtractedEntity = {
            name: entity.name,
            entity_type: entity.entity_type as EntityType,
            description: entity.description,
            subpoints: entity.subpoints,
            confidence: entity.confidence / 10, // Convert 1-10 to 0-1
            embedding, // Embedding generated during extraction phase
          };

          return extractedEntity;
        })
      );

      console.log(
        `✅ Phase 1 Complete: ${entitiesWithEmbeddings.length} memories extracted with embeddings\n`
      );

      return entitiesWithEmbeddings;
    }
  );
}
