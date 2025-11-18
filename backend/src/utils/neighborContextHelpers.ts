/**
 * Neighbor Context Helpers
 *
 * Utilities for loading and formatting neighbor context for agents.
 * Extracted from duplicated implementations in createAgent and mergeAgent.
 */

import { personRepository } from '../repositories/PersonRepository.js';
import { conceptRepository } from '../repositories/ConceptRepository.js';
import { entityRepository } from '../repositories/EntityRepository.js';
import { neo4jService } from '../db/neo4j.js';
import { parseNotes } from './notes.js';
import { normalizeEntityName, buildNameToKeyMap, type NamedNeighbor } from './entityKeyHelpers.js';
import { formatNeighborsAsMarkdown, NEIGHBOR_FORMAT_PRESETS, getNodeType, type FormattableNode } from './contextFormatting.js';
import type { SemanticNeighbor, Person, Concept, Entity, NoteObject } from '../types/graph.js';

/**
 * Load neighbors for a given entity using graph relationships
 *
 * Uses Neo4j graph traversal to find connected nodes.
 * Returns up to 20 neighbors with basic context.
 *
 * @param userId - User ID for scoping
 * @param entityKey - Entity key to find neighbors for
 * @returns Array of semantic neighbors with relationship context
 */
export async function loadNeighbors(
  userId: string,
  entityKey: string
): Promise<SemanticNeighbor[]> {
  const result = await neo4jService.executeQuery<{
    neighbor: Person | Concept | Entity;
    relationship_type: string;
  }>(
    `
    MATCH (n {entity_key: $entity_key})-[r]-(m)
    WHERE m.user_id = $user_id OR m.user_id IS NULL
    RETURN DISTINCT m AS neighbor, type(r) AS relationship_type
    LIMIT 20
    `,
    { entity_key: entityKey, user_id: userId }
  );

  return result.map((row) => {
    const node = row.neighbor as FormattableNode;
    return {
      entity_key: node.entity_key,
      name: 'name' in node ? node.name : 'Unknown',
      description: 'description' in node ? node.description : undefined,
      notes: 'notes' in node ? parseNotes(node.notes) : undefined,
      entity_type: getNodeType(node),
      similarity_score: 0.5, // Default for graph-connected neighbors (below source sibling threshold of 0.75)
    };
  });
}

/**
 * Load full neighbor nodes with details from repositories
 *
 * Takes semantic neighbors and loads full node details from appropriate repositories.
 * Handles missing nodes gracefully.
 *
 * @param neighbors - Array of semantic neighbors with entity keys
 * @returns Array of fully loaded neighbor nodes with all properties
 */
export async function loadNeighborNodes(
  neighbors: SemanticNeighbor[]
): Promise<SemanticNeighbor[]> {
  return Promise.all(
    neighbors.map(async (neighbor) => {
      let node: { name: string; description?: string; notes?: NoteObject[] } | null = null;

      if (neighbor.entity_type === 'person') {
        node = await personRepository.findById(neighbor.entity_key);
      } else if (neighbor.entity_type === 'concept') {
        node = await conceptRepository.findById(neighbor.entity_key);
      } else {
        node = await entityRepository.findById(neighbor.entity_key);
      }

      if (!node) {
        return {
          entity_key: neighbor.entity_key,
          name: neighbor.name,
          description: neighbor.description || undefined,
          similarity_score: neighbor.similarity_score,
          entity_type: neighbor.entity_type,
        };
      }

      return {
        entity_key: neighbor.entity_key,
        name: node.name,
        description: node.description,
        notes: node.notes,
        similarity_score: neighbor.similarity_score,
        entity_type: neighbor.entity_type,
      };
    })
  );
}

/**
 * Build name-to-key map and add target node
 *
 * Creates normalized name mapping for tool parameter resolution
 * and includes the target node so LLM can reference it.
 *
 * @param neighbors - Array of neighbors to map
 * @param targetNode - Target node to include in mapping
 * @param targetEntityKey - Entity key of target node
 * @returns Object with named neighbors array and name-to-key map
 */
export function buildNameMapWithTarget(
  neighbors: SemanticNeighbor[],
  targetNode: { name: string },
  targetEntityKey: string
): {
  namedNeighbors: NamedNeighbor[];
  nameToKeyMap: Map<string, string>;
} {
  // Build initial name map from neighbors
  const { neighbors: namedNeighbors, nameToKeyMap } = buildNameToKeyMap(neighbors);

  // Add target node to map so LLM can reference it
  const targetNodeNormalizedName = normalizeEntityName(targetNode.name);
  nameToKeyMap.set(targetNodeNormalizedName, targetEntityKey);
  console.log(`   🔑 Added target node to nameToKeyMap: ${targetNodeNormalizedName} → ${targetEntityKey}`);

  return { namedNeighbors, nameToKeyMap };
}

/**
 * Build complete neighbor context for agent
 *
 * Comprehensive utility that:
 * 1. Loads full neighbor nodes from repositories
 * 2. Builds name-to-key mapping
 * 3. Adds target node to mapping
 * 4. Formats neighbors as XML/markdown
 *
 * This encapsulates the common multi-step process used in both
 * createAgent and mergeAgent.
 *
 * @param neighbors - Array of semantic neighbors
 * @param targetNode - Target node to include in context
 * @param targetEntityKey - Entity key of target node
 * @returns Context object with neighbors, mapping, and formatted XML
 */
export async function buildNeighborContext(
  neighbors: SemanticNeighbor[],
  targetNode: { name: string; description?: string; notes?: NoteObject[] },
  targetEntityKey: string
): Promise<{
  neighborNodes: SemanticNeighbor[];
  namedNeighbors: NamedNeighbor[];
  nameToKeyMap: Map<string, string>;
  formattedXml: string;
}> {
  // Load full neighbor nodes from repositories
  const neighborNodes = await loadNeighborNodes(neighbors);

  // Build name-to-key map and add target node
  const { namedNeighbors, nameToKeyMap } = buildNameMapWithTarget(
    neighborNodes,
    targetNode,
    targetEntityKey
  );

  // Format neighbors as XML/markdown
  // Cast to satisfy BaseNeighbor interface requirement (has index signature)
  const formattedXml = formatNeighborsAsMarkdown(
    neighborNodes as Array<SemanticNeighbor & { [key: string]: unknown }>,
    NEIGHBOR_FORMAT_PRESETS.simplified
  );

  return {
    neighborNodes,
    namedNeighbors,
    nameToKeyMap,
    formattedXml,
  };
}
