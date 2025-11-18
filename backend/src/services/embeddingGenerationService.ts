/**
 * Embedding Generation Service
 *
 * Generates vector embeddings for entities that support semantic search:
 * - Projects: name + vision
 * - Topics: name + description
 * - Ideas: summary + context_notes
 * - Notes: content
 *
 * Uses OpenAI text-embedding-3-small (1536 dimensions)
 * Batches embeddings for efficiency (up to 2048 inputs per call)
 */

import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { EntityType } from '../types/graph.js';

/**
 * EntityUpdate type for embedding generation service
 *
 * This type represents entities that need embeddings generated.
 * Used as an adapter between Neo4j query results and the embedding service.
 */
export interface EntityUpdate {
  entityId: string | null;
  entityType: EntityType; // Lowercase EntityType
  entityKey: string;
  isNew: boolean;
  newEntityData?: {
    name?: string;
    summary?: string;
  };
  nodeUpdates: Record<string, unknown>;
  relationshipUpdates: Record<string, unknown>;
  last_update_source: string;
  confidence: number;
}

export interface EmbeddingUpdate {
  entityId: string;
  entityType: 'concept' | 'entity'; // Lowercase EntityType (only Concepts and Entities have embeddings)
  embedding: number[];
}

class EmbeddingGenerationService {
  constructor() {
    // No initialization needed - AI SDK embedMany() is a standalone function
  }

  /**
   * Generate embeddings for all updated entities that support semantic search
   *
   * @param entities - Entity updates from node creation/updates
   * @returns Array of embeddings with entity IDs
   */
  async generate(entities: EntityUpdate[]): Promise<EmbeddingUpdate[]> {
    // Filter entities that need embeddings (Concepts, Entities)
    const embeddableEntities = entities.filter((e) =>
      ['concept', 'entity'].includes(e.entityType)
    );

    if (embeddableEntities.length === 0) {
      console.log('   No entities require embeddings');
      return [];
    }

    // Prepare text for embedding
    const embeddingInputs = embeddableEntities.map((entity) => ({
      entityId: entity.entityId || entity.entityKey,
      entityType: entity.entityType as 'concept' | 'entity',
      text: this.getEmbeddingText(entity),
    }));

    // Filter out entities with no text to embed
    const validInputs = embeddingInputs.filter((input) => input.text && input.text.length > 0);

    if (validInputs.length === 0) {
      console.log('   No valid text to embed');
      return [];
    }

    console.log(`   Generating embeddings for ${validInputs.length} entities...`);

    try {
      // Batch embed all entities (OpenAI supports up to 2048 inputs)
      const { embeddings: embeddingVectors } = await embedMany({
        model: openai.embedding('text-embedding-3-small'),
        values: validInputs.map((input) => input.text),
      });

      // Map embeddings back to entity IDs
      const results: EmbeddingUpdate[] = validInputs.map((input, idx) => ({
        entityId: input.entityId,
        entityType: input.entityType,
        embedding: embeddingVectors[idx],
      }));

      console.log(`   ✅ Generated ${results.length} embeddings`);
      return results;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`   ❌ Failed to generate embeddings: ${errorMessage}`);
      throw new Error(`Embedding generation failed: ${errorMessage}`);
    }
  }

  /**
   * Extract text to embed based on entity type
   *
   * Each entity type has different fields that should be embedded:
   * - Concept: name + description + notes
   * - Entity: name + description + notes
   */
  private getEmbeddingText(entity: EntityUpdate): string {
    const nodeUpdates = entity.nodeUpdates || {};
    const newData = entity.newEntityData || {};

    switch (entity.entityType) {
      case 'concept':
        // Combine name, description, and notes for rich semantic search
        const conceptName = (nodeUpdates.name as string) || (newData.name as string) || '';
        const conceptDescription = nodeUpdates.description as string || '';
        const conceptNotes = nodeUpdates.notes as string || '';
        return `${conceptName} ${conceptDescription} ${conceptNotes}`.trim();

      case 'entity':
        // Combine name, description, and notes
        const entityName = (nodeUpdates.name as string) || (newData.name as string) || '';
        const entityDescription = nodeUpdates.description as string || '';
        const entityNotes = nodeUpdates.notes as string || '';
        return `${entityName} ${entityDescription} ${entityNotes}`.trim();

      case 'person':
        // Person entities don't get embeddings (relationship-based matching is sufficient)
        return '';

      default:
        return '';
    }
  }

  /**
   * Batch embed multiple text inputs (for efficiency)
   *
   * OpenAI allows up to 2048 inputs per embedding call.
   * This method handles batching automatically.
   */
  async batchEmbed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const BATCH_SIZE = 2048;
    const batches: string[][] = [];

    // Split into batches
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      batches.push(texts.slice(i, i + BATCH_SIZE));
    }

    // Embed each batch
    const allEmbeddings: number[][] = [];
    for (const batch of batches) {
      const { embeddings } = await embedMany({
        model: openai.embedding('text-embedding-3-small'),
        values: batch,
      });
      allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
  }

  /**
   * Generate a single embedding for text
   * Used by relationship tools for relation_embedding and notes_embedding
   */
  async embedSingle(text: string): Promise<number[]> {
    if (!text || text.length === 0) {
      return [];
    }
    const { embeddings } = await embedMany({
      model: openai.embedding('text-embedding-3-small'),
      values: [text],
    });
    return embeddings[0];
  }
}

export const embeddingGenerationService = new EmbeddingGenerationService();

/**
 * Helper function for generating a single embedding
 * Used by relationship tools
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  return embeddingGenerationService.embedSingle(text);
}
