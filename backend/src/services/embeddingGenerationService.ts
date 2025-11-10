/**
 * Phase 6: Embedding Generation Service
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

import { OpenAIEmbeddings } from '@langchain/openai';
import type { EntityUpdate } from './entityUpdateService.js';

export interface EmbeddingUpdate {
  entityId: string;
  entityType: 'Project' | 'Topic' | 'Idea';
  embedding: number[];
}

class EmbeddingGenerationService {
  private embeddings: OpenAIEmbeddings;

  constructor() {
    this.embeddings = new OpenAIEmbeddings({
      modelName: 'text-embedding-3-small',
    });
  }

  /**
   * Generate embeddings for all updated entities that support semantic search
   *
   * @param entities - Entity updates from Phase 3
   * @returns Array of embeddings with entity IDs
   */
  async generate(entities: EntityUpdate[]): Promise<EmbeddingUpdate[]> {
    // Filter entities that need embeddings (Projects, Topics, Ideas)
    const embeddableEntities = entities.filter((e) =>
      ['Project', 'Topic', 'Idea'].includes(e.entityType)
    );

    if (embeddableEntities.length === 0) {
      console.log('   No entities require embeddings');
      return [];
    }

    // Prepare text for embedding
    const embeddingInputs = embeddableEntities.map((entity) => ({
      entityId: entity.entityId || entity.entityKey,
      entityType: entity.entityType as 'Project' | 'Topic' | 'Idea',
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
      const embeddingVectors = await this.embeddings.embedDocuments(
        validInputs.map((input) => input.text)
      );

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
   * - Project: name + vision (both describe what the project is about)
   * - Topic: name + description
   * - Idea: summary + context_notes
   */
  private getEmbeddingText(entity: EntityUpdate): string {
    const nodeUpdates = entity.nodeUpdates || {};
    const newData = entity.newEntityData || {};

    switch (entity.entityType) {
      case 'Project':
        // Combine name and vision for rich semantic search
        const projectName = (nodeUpdates.name as string) || (newData.name as string) || '';
        const vision = nodeUpdates.vision as string || '';
        return `${projectName} ${vision}`.trim();

      case 'Topic':
        // Combine name and description
        const topicName = (nodeUpdates.name as string) || (newData.name as string) || '';
        const description = nodeUpdates.description as string || '';
        return `${topicName} ${description}`.trim();

      case 'Idea':
        // Combine summary and context notes
        const summary = (nodeUpdates.summary as string) || (newData.summary as string) || '';
        const contextNotes = nodeUpdates.context_notes as string || '';
        return `${summary} ${contextNotes}`.trim();

      case 'Person':
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
      const embeddings = await this.embeddings.embedDocuments(batch);
      allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
  }
}

export const embeddingGenerationService = new EmbeddingGenerationService();
