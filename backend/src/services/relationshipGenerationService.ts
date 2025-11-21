/**
 * Relationship Generation Service
 *
 * Handles parallel relationship creation for nodes after they've been created/updated.
 * Separated from entity resolution to enable parallel processing while maintaining
 * sibling context for intra-source relationships.
 */

import type { ExtractedEntity } from '../types/ingestion.js';
import type { SourceSibling } from '../utils/neighborHelpers.js';

/**
 * Node ready for relationship generation
 */
export interface NodeForRelationships {
  entity_key: string;
  entity: ExtractedEntity;
  is_new: boolean; // true for CREATE, false for MERGE
}

/**
 * Result of relationship generation for a single node
 */
export interface RelationshipGenerationResult {
  entity_key: string;
  relationshipsCreated: number;
  success: boolean;
  error?: string;
}

/**
 * Relationship Generation Service
 *
 * Creates relationships in parallel batches after all nodes have been created/updated.
 */
export class RelationshipGenerationService {
  private modelId: string;

  constructor(modelId: string = 'gpt-5-nano') {
    this.modelId = modelId;
  }

  /**
   * Generate relationships for all nodes in parallel batches
   *
   * @param userId - User ID for context
   * @param sourceEntityKey - Source entity key for provenance
   * @param sourceContent - Full conversation transcript
   * @param nodes - Nodes that need relationships
   * @param sourceSiblings - All entities from this source (for sibling relationships)
   * @param concurrencyLimit - Maximum parallel operations (default: 5)
   * @returns Results for each node
   */
  async generateRelationships(
    userId: string,
    sourceEntityKey: string,
    sourceContent: string,
    nodes: NodeForRelationships[],
    sourceSiblings: SourceSibling[],
    concurrencyLimit: number = 5
  ): Promise<{
    results: RelationshipGenerationResult[];
    totalRelationshipsCreated: number;
  }> {
    console.log(
      `\n🔗 Relationship Generation: Processing ${nodes.length} nodes in parallel (concurrency: ${concurrencyLimit})...`
    );

    if (nodes.length === 0) {
      return { results: [], totalRelationshipsCreated: 0 };
    }

    const results: RelationshipGenerationResult[] = [];
    let totalRelationshipsCreated = 0;

    // Process in batches to respect concurrency limit
    for (let i = 0; i < nodes.length; i += concurrencyLimit) {
      const batch = nodes.slice(i, i + concurrencyLimit);

      const batchResults = await Promise.allSettled(
        batch.map(async (node) => {
          const startTime = Date.now();

          try {
            let relationshipsCreated = 0;

            if (node.is_new) {
              // Use CREATE agent Phase 2
              const { runCreateAgentPhase2Only } = await import(
                '../agents/createAgent.js'
              );

              relationshipsCreated = await runCreateAgentPhase2Only(
                node.entity_key,
                node.entity,
                sourceContent,
                userId,
                sourceEntityKey,
                sourceSiblings,
                this.modelId
              );
            } else {
              // Use MERGE agent Phase 2
              const { runMergeAgentPhase2Only } = await import(
                '../agents/mergeAgent.js'
              );

              relationshipsCreated = await runMergeAgentPhase2Only(
                node.entity_key,
                sourceContent,
                userId,
                sourceEntityKey,
                sourceSiblings
              );
            }

            const timeMs = Date.now() - startTime;
            console.log(
              `   ✅ ${node.entity.name}: ${relationshipsCreated} relationships [${timeMs}ms]`
            );

            return {
              entity_key: node.entity_key,
              relationshipsCreated,
              success: true,
            } as RelationshipGenerationResult;
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            console.error(
              `   ❌ Failed to generate relationships for ${node.entity.name}: ${errorMessage}`
            );

            return {
              entity_key: node.entity_key,
              relationshipsCreated: 0,
              success: false,
              error: errorMessage,
            } as RelationshipGenerationResult;
          }
        })
      );

      // Collect results
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        const node = batch[j];

        if (result.status === 'fulfilled') {
          results.push(result.value);
          totalRelationshipsCreated += result.value.relationshipsCreated;
        } else {
          // Failure
          const errorMessage =
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason);
          console.error(
            `   ❌ Relationship generation failed for ${node.entity.name}: ${errorMessage}`
          );
          results.push({
            entity_key: node.entity_key,
            relationshipsCreated: 0,
            success: false,
            error: errorMessage,
          });
        }
      }
    }

    console.log(
      `✅ Relationship Generation Complete: ${totalRelationshipsCreated} relationships created across ${nodes.length} nodes`
    );

    return {
      results,
      totalRelationshipsCreated,
    };
  }
}
