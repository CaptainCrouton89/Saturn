/**
 * Neighbor Helpers
 *
 * Utilities for merging embedding-based neighbors with source-sibling nodes
 * to ensure entities from the same source can form relationships.
 */

import type { EntityType, SemanticNeighbor } from '../types/graph.js';

export interface SourceSibling {
  entity_key: string;
  name: string;
  type: EntityType;
}

/**
 * Similarity score assigned to source-siblings when they're not already in embedding neighbors
 *
 * Rationale:
 * - Must be >= 0.6 (embedding similarity threshold) to be considered
 * - Should be < 1.0 (perfect match) since they're contextually related, not semantically identical
 * - 0.75 represents "strong contextual relevance from same source"
 */
const SOURCE_SIBLING_SIMILARITY = 0.75;

/**
 * Merge embedding-based neighbors with source-sibling nodes
 *
 * Source-siblings are entities extracted from the same source/chunk that should
 * be considered as potential relationship targets even if they're not semantically
 * similar by embedding distance.
 *
 * Deduplication strategy:
 * - If entity appears in both lists, keep the HIGHER similarity score
 * - This preserves high embedding similarity while ensuring source siblings are included
 *
 * @param embeddingNeighbors - Neighbors found via embedding similarity search
 * @param sourceSiblings - Entities resolved from the same source (already created/merged)
 * @param selfEntityKey - The entity key of the node being processed (to exclude self)
 * @param maxNeighbors - Maximum number of neighbors to return (default: 10)
 * @returns Merged and sorted neighbor list (by similarity DESC)
 */
export function mergeNeighborsWithSourceSiblings(
  embeddingNeighbors: SemanticNeighbor[],
  sourceSiblings: SourceSibling[],
  selfEntityKey: string,
  maxNeighbors: number = 10
): SemanticNeighbor[] {
  // Create map of embedding neighbors by entity_key for O(1) lookup
  const neighborMap = new Map<string, SemanticNeighbor>();

  // Add all embedding neighbors to map
  for (const neighbor of embeddingNeighbors) {
    neighborMap.set(neighbor.entity_key, neighbor);
  }

  // Add source-siblings to map (if not already present or if their similarity would be higher)
  for (const sibling of sourceSiblings) {
    // Skip self-references
    if (sibling.entity_key === selfEntityKey) continue;

    const existing = neighborMap.get(sibling.entity_key);

    if (!existing) {
      // Sibling not in embedding neighbors - add it with source sibling similarity
      neighborMap.set(sibling.entity_key, {
        entity_key: sibling.entity_key,
        name: sibling.name,
        entity_type: sibling.type,
        similarity_score: SOURCE_SIBLING_SIMILARITY,
        description: undefined, // Will be fetched by agent if needed
        notes: undefined,
      });
    } else if (existing.similarity_score < SOURCE_SIBLING_SIMILARITY) {
      // Sibling exists but with lower similarity - upgrade to source sibling similarity
      // This can happen if embedding similarity is between 0.6-0.75
      existing.similarity_score = SOURCE_SIBLING_SIMILARITY;
    }
    // else: Sibling already in neighbors with higher similarity - keep existing
  }

  // Convert map to array, sort by similarity DESC, and take top N
  return Array.from(neighborMap.values())
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, maxNeighbors);
}
