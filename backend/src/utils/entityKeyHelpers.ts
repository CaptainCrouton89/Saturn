/**
 * Entity Key Helpers
 *
 * Utilities for working with entity keys in the resolution pipeline.
 * Maps human-readable normalized names to entity_keys for LLM tool usage.
 */

import type { EntityType, SemanticNeighbor } from "../types/graph.js";


/**
 * Neighbor with normalized name for LLM presentation
 */
export interface NamedNeighbor {
  entity_type: EntityType;
  normalized_name: string;  // Lowercase, spaces→underscores
  display_name: string;     // Original name for display
  description?: string | null;
  similarity_score: number;
}

/**
 * Result of preparing neighbors with name-based mapping
 */
export interface PreparedNeighbors {
  /** Neighbors with normalized names for LLM presentation */
  neighbors: NamedNeighbor[];
  /** Map from normalized name to full entity_key */
  nameToKeyMap: Map<string, string>;
}

/**
 * Normalize entity name for use as LLM tool parameter
 * Converts to lowercase, replaces spaces with underscores, removes special characters
 *
 * This is the canonical normalization function used by both:
 * - formatNeighborsAsXml() for XML tag names
 * - buildNameToKeyMap() for entity key mapping
 *
 * @param name - Display name (e.g., "Charlie's Chocolate Factory", "Self-acceptance")
 * @returns Normalized name (e.g., "charlies_chocolate_factory", "self_acceptance")
 *
 * @example
 * normalizeEntityName("Paul Peel") // "paul_peel"
 * normalizeEntityName("Charlie's Chocolate Factory") // "charlies_chocolate_factory"
 * normalizeEntityName("Self-acceptance") // "self_acceptance"
 * normalizeEntityName("Roy") // "roy"
 */
export function normalizeEntityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Build name-to-entity_key mapping for LLM tool resolution
 * Handles duplicate names by appending #2, #3, etc.
 *
 * @param neighbors - List of neighbor candidates with full entity_key (SemanticNeighbor)
 * @returns Named neighbors for LLM + map for resolving names to keys
 *
 * @example
 * const { neighbors, nameToKeyMap } = buildNameToKeyMap([
 *   { entity_key: 'uuid-1', name: 'Roy', entity_type: 'person', similarity_score: 0.85 },
 *   { entity_key: 'uuid-2', name: 'Roy', entity_type: 'person', similarity_score: 0.70 }
 * ]);
 * // neighbors[0].normalized_name === 'roy'
 * // neighbors[1].normalized_name === 'roy_2'
 * // nameToKeyMap.get('roy') === 'uuid-1'
 * // nameToKeyMap.get('roy_2') === 'uuid-2'
 */
export function buildNameToKeyMap(neighbors: SemanticNeighbor[]): PreparedNeighbors {
  const nameToKeyMap = new Map<string, string>();
  const namedNeighbors: NamedNeighbor[] = [];
  const nameCounts = new Map<string, number>();

  for (const neighbor of neighbors) {
    const normalized = normalizeEntityName(neighbor.name);

    // Handle duplicate names by appending _2, _3, etc.
    const count = nameCounts.get(normalized) || 0;
    nameCounts.set(normalized, count + 1);

    const uniqueName = count === 0 ? normalized : `${normalized}_${count + 1}`;

    // Check for collision (should not happen with our numbering scheme)
    if (nameToKeyMap.has(uniqueName)) {
      console.warn(`⚠️  Name collision detected (should not happen):`);
      console.warn(`   Name: ${uniqueName}`);
      console.warn(`   Existing entity_key: ${nameToKeyMap.get(uniqueName)}`);
      console.warn(`   New entity_key: ${neighbor.entity_key}`);
      console.warn(`   Keeping existing mapping`);
      continue;
    }

    nameToKeyMap.set(uniqueName, neighbor.entity_key);

    namedNeighbors.push({
      entity_type: neighbor.entity_type,
      normalized_name: uniqueName,
      display_name: neighbor.name,
      description: neighbor.description,
      similarity_score: neighbor.similarity_score,
    });
  }

  return {
    neighbors: namedNeighbors,
    nameToKeyMap,
  };
}

/**
 * Resolve normalized entity name to full entity_key using the name map
 *
 * @param normalizedName - Normalized entity name (from LLM tool parameter)
 * @param nameToKeyMap - Map from normalized names to full entity_keys
 * @returns Full entity_key if found, null if name not in map
 *
 * @example
 * const fullKey = resolveNameToKey('paul_peel', nameToKeyMap);
 * // Returns 'af7ef3e9-9356-4134-81a0-fd80fa50ab00' if name exists in map
 */
export function resolveNameToKey(
  normalizedName: string | null | undefined,
  nameToKeyMap: Map<string, string>
): string | null {
  if (!normalizedName) {
    return null;
  }

  return nameToKeyMap.get(normalizedName) ?? null;
}
