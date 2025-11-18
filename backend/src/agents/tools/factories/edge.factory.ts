/**
 * Edge Tool Factories
 *
 * Creates tools for creating and updating relationships between nodes.
 * - createEdgeTool: Creates new relationships with auto-detected Cypher types
 * - updateEdgeTool: Updates existing relationships with type-specific semantic mappings
 *
 * Both tools generate relationship_embedding from description + type + attitude/proximity words + notes.
 *
 * Part of Tool Consolidation Plan (TOOL_CONSOLIDATION_PLAN.md)
 */

import { tool } from 'ai';
import { z } from 'zod';
import { neo4jService } from '../../../db/neo4j.js';
import { generateEmbedding } from '../../../services/embeddingGenerationService.js';
import type { NoteObject } from '../../../types/graph.js';
import { resolveNameToKey } from '../../../utils/entityKeyHelpers.js';
import { getExpiresAt } from '../../../utils/nodeHelpers.js';
import { parseNotes, stringifyNotes } from '../../../utils/notes.js';
import {
  getAttitudeProximityWords,
  type CypherRelationshipType,
} from '../../../utils/relationshipSemantics.js';

/**
 * Canonical relationship directions
 * Maps relationship types to their canonical (from, to) node label pairs
 * Relationships can only be created in the canonical direction
 * 
 * This map defines the allowed directions for each relationship type.
 * Tools automatically reverse relationships to match these canonical directions.
 */
export const CANONICAL_RELATIONSHIP_DIRECTIONS: Record<
  CypherRelationshipType,
  { from: string; to: string }
> = {
  has_relationship_with: { from: 'person', to: 'person' },
  engages_with: { from: 'person', to: 'concept' },
  associated_with: { from: 'person', to: 'entity' },
  relates_to: { from: 'concept', to: 'concept' },
  involves: { from: 'concept', to: 'entity' },
  connected_to: { from: 'entity', to: 'entity' },
} as const;

/**
 * Determine Cypher relationship type based on node labels
 * Returns the canonical relationship type and whether the nodes need to be swapped
 * 
 * @param fromLabel - Label of the source node
 * @param toLabel - Label of the target node
 * @returns Object with relationshipType and needsSwap flag
 */
function getCypherRelationshipTypeWithDirection(
  fromLabel: string,
  toLabel: string
): { relationshipType: CypherRelationshipType; needsSwap: boolean } {
  // Try forward direction first
  for (const [relType, direction] of Object.entries(CANONICAL_RELATIONSHIP_DIRECTIONS)) {
    if (fromLabel === direction.from && toLabel === direction.to) {
      return {
        relationshipType: relType as CypherRelationshipType,
        needsSwap: false,
      };
    }
  }

  // Try reverse direction
  for (const [relType, direction] of Object.entries(CANONICAL_RELATIONSHIP_DIRECTIONS)) {
    if (fromLabel === direction.to && toLabel === direction.from) {
      return {
        relationshipType: relType as CypherRelationshipType,
        needsSwap: true,
      };
    }
  }

  throw new Error(`Unsupported node type combination: ${fromLabel} → ${toLabel}`);
}

/**
 * Generate relationship embedding from components
 */
async function generateRelationshipEmbedding(
  description: string,
  relationshipType: string,
  attitudeWord: string,
  proximityWord: string,
  notes: NoteObject[]
): Promise<number[]> {
  const notesText = notes.map((n) => n.content).join(' ').substring(0, 1000);
  const embeddingText = `${description} ${relationshipType} ${attitudeWord} ${proximityWord} ${notesText}`.trim();
  return generateEmbedding(embeddingText);
}

/**
 * Get type-specific description for updateEdgeTool
 */
function getEdgeUpdateDescription(relationshipType: CypherRelationshipType): string {
  let relationshipDesc = '';
  switch (relationshipType) {
    case 'has_relationship_with':
      relationshipDesc = 'Update relationship between two people.';
      break;
    case 'engages_with':
      relationshipDesc = 'Update Person-Concept engagement.';
      break;
    case 'associated_with':
      relationshipDesc = 'Update Person-Entity association.';
      break;
    case 'relates_to':
      relationshipDesc = 'Update Concept-Concept relation.';
      break;
    case 'involves':
      relationshipDesc = 'Update Concept-Entity involvement.';
      break;
    case 'connected_to':
      relationshipDesc = 'Update Entity-Entity connection.';
      break;
  }

  return `${relationshipDesc} Strictly additive - appends notes only. Does not modify attitude or proximity scores.`;
}

/**
 * Factory function to create edge creation tool with bound context
 *
 * Creates relationships between nodes with auto-detected Cypher types.
 * The from_entity_key is bound by the factory.
 *
 * @param userId - User ID for provenance tracking
 * @param sourceEntityKey - Source entity key for provenance tracking
 * @param fromEntityKey - Entity key of the source node (bound to tool)
 * @returns Configured tool for creating edges from the specified node
 */
export function createEdgeTool(
  userId: string,
  sourceEntityKey: string,
  fromEntityKey: string,
  nameToKeyMap?: Map<string, string>
) {
  const schema = z.object({
    to_entity_name: z
      .string()
      .describe('Name of target entity that new node connects to (use normalized name from neighbor list: lowercase, spaces→underscores, e.g., "paul_peel", "roy")'),
    direction: z
      .enum(['outgoing', 'incoming'])
      .describe('Direction of relationship: "outgoing" = from new node to neighbor (default), "incoming" = from neighbor to new node'),
    reasoning: z
      .string()
      .describe('Single sentence explaining WHY these two specific entities are related based on evidence in the source content'),
    relationship_type: z
      .string()
      .describe('One-word descriptor (e.g., "friend", "colleague", "studies", "works-at", "part-of")'),
    description: z.string().describe('1 sentence overview of the relationship'),
    attitude: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe('Sentiment/valence (1=negative, 3=neutral, 5=positive)'),
    proximity: z
      .number()
      .int()
      .min(1)
      .max(5)
      .describe('Depth of connection (1=distant/unfamiliar, 5=close/intimate)'),
    confidence: z.number().min(0).max(1).describe('Confidence in this relationship (0-1)'),
    notes: z
      .array(
        z.object({
          content: z
            .string()
            .describe(
              'Information-dense incomplete sentence. Pack maximum information, drop articles ("a", "the"), include specific details (dates, numbers, examples). Use compact phrasing.'
            ),
          lifetime: z
            .enum(['week', 'month', 'year', 'forever'])
            .describe('How long this note should be retained'),
        })
      )
      .min(1)
      .describe('Array of notes to add to the relationship. Each note can have a different lifetime.'),
  });

  return tool({
    description:
      'Create relationship between the newly created node and another node. ' +
      'Specify to_entity_name (normalized entity name like "roy" or "paul_peel"), direction ("outgoing" = new→neighbor, "incoming" = neighbor→new), ' +
      'reasoning (why these two entities are related), relationship_type (one-word descriptor), description (1 sentence), ' +
      'attitude (1-5), proximity (1-5), confidence (0-1), and notes array (required, min 1 note). ' +
      'Each note can have a different lifetime. Automatically determines Cypher relationship type based on node labels.',
    parameters: schema,
    execute: async (input) => {
      try {
        const validated = schema.parse(input);
        let { to_entity_name, direction, reasoning, relationship_type, description, attitude, proximity, confidence, notes: inputNotes } =
          validated;

        // Resolve entity name to entity_key
        if (!nameToKeyMap) {
          throw new Error('nameToKeyMap is required for create_edge tool');
        }

        const to_entity_key = resolveNameToKey(to_entity_name, nameToKeyMap);
        if (!to_entity_key) {
          const validNames = Array.from(nameToKeyMap.keys()).join(', ');
          console.error(`   ❌ create_edge failed: Invalid entity name ${to_entity_name}`);
          console.error(`   📋 Valid entity names in nameToKeyMap: ${validNames}`);
          console.error(`   💡 Hint: This usually means the LLM hallucinated a name or referenced a name not in the neighbor list`);
          return JSON.stringify({
            success: false,
            error: `Invalid entity_name: ${to_entity_name}. Valid names: ${validNames}`,
          });
        }

        // Apply semantic direction: swap entity keys if direction is "incoming"
        const semanticFromKey = direction === 'incoming' ? to_entity_key : fromEntityKey;
        const semanticToKey = direction === 'incoming' ? fromEntityKey : to_entity_key;
        const directionSwapped = direction === 'incoming';

        console.log(`   🔧 create_edge tool invoked: ${semanticFromKey} → ${semanticToKey} (${relationship_type})${directionSwapped ? ' [direction: incoming]' : ''}`);
        console.log(`   💭 Reasoning: ${reasoning}`);

        // Step 1: Get node labels to determine Cypher relationship type
        const nodesQuery = `
          MATCH (from {entity_key: $from_entity_key})
          MATCH (to {entity_key: $to_entity_key})
          RETURN labels(from)[0] as fromLabel, labels(to)[0] as toLabel
        `;
        const nodesResult = await neo4jService.executeQuery<{ fromLabel: string; toLabel: string }>(nodesQuery, {
          from_entity_key: semanticFromKey,
          to_entity_key: semanticToKey,
        });

        if (!nodesResult[0]) {
          return JSON.stringify({
            success: false,
            error: 'One or both nodes do not exist',
          });
        }

        const { fromLabel, toLabel } = nodesResult[0];
        // Normalize labels to lowercase for matching canonical directions
        const { relationshipType: cypherRelType, needsSwap } = getCypherRelationshipTypeWithDirection(
          fromLabel.toLowerCase(),
          toLabel.toLowerCase()
        );

        // Step 2: Swap entity keys if needed to match canonical direction
        const canonicalFromEntityKey = needsSwap ? semanticToKey : semanticFromKey;
        const canonicalToEntityKey = needsSwap ? semanticFromKey : semanticToKey;

        // Step 3: Get attitude/proximity words for embedding
        const { attitudeWord, proximityWord } = getAttitudeProximityWords(cypherRelType, attitude, proximity);

        // Step 4: Prepare notes array
        const notes: NoteObject[] = inputNotes.map((note) => ({
          content: note.content,
          added_by: userId,
          source_entity_key: sourceEntityKey,
          date_added: new Date().toISOString(),
          expires_at: getExpiresAt(note.lifetime),
        }));

        // Step 5: Generate relationship_embedding
        const relationshipEmbedding = await generateRelationshipEmbedding(
          description,
          relationship_type,
          attitudeWord,
          proximityWord,
          notes
        );

        // Step 6: MERGE relationship in canonical direction (idempotent - safe for parallel execution)
        const createQuery = `
          MATCH (from {entity_key: $from_entity_key})
          MATCH (to {entity_key: $to_entity_key})
          MERGE (from)-[r:${cypherRelType}]->(to)
          ON CREATE SET
            r.relationship_type = $relationship_type,
            r.description = $description,
            r.reasoning = $reasoning,
            r.attitude = $attitude,
            r.proximity = $proximity,
            r.confidence = $confidence,
            r.relationship_embedding = $relationship_embedding,
            r.state = 'candidate',
            r.salience = 0.5,
            r.recorded_by = $user_id,
            r.source_entity_key = $source_entity_key,
            r.last_update_source = $last_update_source,
            r.valid_from = datetime(),
            r.valid_to = null,
            r.created_at = datetime(),
            r.updated_at = datetime(),
            r.recall_frequency = 0,
            r.last_recall_interval = 0,
            r.decay_gradient = 1.0,
            r.access_count = 0,
            r.last_accessed_at = null,
            r.is_dirty = false,
            r.notes = $notes
          ON MATCH SET
            r.relationship_type = $relationship_type,
            r.description = $description,
            r.reasoning = $reasoning,
            r.attitude = $attitude,
            r.proximity = $proximity,
            r.confidence = $confidence,
            r.relationship_embedding = $relationship_embedding,
            r.last_update_source = $last_update_source,
            r.updated_at = datetime(),
            r.notes = $notes
          RETURN r, (CASE WHEN r.created_at = r.updated_at THEN true ELSE false END) as was_created
        `;

        const result = await neo4jService.executeQuery<{ r: unknown; was_created: boolean }>(createQuery, {
          from_entity_key: canonicalFromEntityKey,
          to_entity_key: canonicalToEntityKey,
          relationship_type,
          description,
          reasoning,
          attitude,
          proximity,
          confidence,
          relationship_embedding: relationshipEmbedding,
          user_id: userId,
          source_entity_key: sourceEntityKey,
          last_update_source: sourceEntityKey,
          notes: stringifyNotes(notes),
        });

        if (!result[0]) {
          throw new Error('Failed to create/update relationship');
        }

        const wasCreated = result[0].was_created;
        const action = wasCreated ? 'Created' : 'Updated existing';

        // Build direction note explaining any transformations
        let directionNote = '';
        if (directionSwapped && needsSwap) {
          directionNote = ` (semantic: ${direction}, then auto-reversed to match canonical direction)`;
        } else if (directionSwapped) {
          directionNote = ` (semantic direction: ${direction})`;
        } else if (needsSwap) {
          directionNote = ` (auto-reversed from ${semanticFromKey}→${semanticToKey} to match canonical direction)`;
        }

        const successMessage = `${action} ${cypherRelType} relationship: ${relationship_type} from ${canonicalFromEntityKey} to ${canonicalToEntityKey}${directionNote}`;
        console.log(`   ✅ create_edge success: ${successMessage}`);

        return JSON.stringify({
          success: true,
          message: successMessage,
          cypher_relationship_type: cypherRelType,
          was_created: wasCreated,
          semantic_direction: direction,
          direction_swapped: directionSwapped,
          canonical_direction_reversed: needsSwap,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`   ❌ create_edge failed: ${errorMessage}`);
        return JSON.stringify({
          success: false,
          error: errorMessage,
        });
      }
    },
  });
}

/**
 * Factory function to create edge update tool with bound context
 *
 * Updates existing relationships with type-specific semantic mappings.
 * Strictly additive - appends notes to existing notes array.
 *
 * @param userId - User ID for provenance tracking
 * @param sourceEntityKey - Source entity key for provenance tracking
 * @param relationshipType - Cypher relationship type (e.g., 'has_relationship_with')
 * @returns Configured tool for updating edges of the specified type
 */
export function updateEdgeTool(
  userId: string,
  sourceEntityKey: string,
  relationshipType: CypherRelationshipType,
  nameToKeyMap?: Map<string, string>
) {
  // Note: attitude and proximity are intentionally omitted from the schema.
  // The merge agent should only add notes, not modify attitude/proximity scores.
  const schema = z.object({
    from_entity_name: z
      .string()
      .describe('Name of source entity (use normalized name from neighbor list: lowercase, spaces→underscores, e.g., "paul_peel")'),
    to_entity_name: z
      .string()
      .describe('Name of target entity (use normalized name from neighbor list: lowercase, spaces→underscores, e.g., "roy")'),
    notes: z
      .array(
        z.object({
          content: z
            .string()
            .describe(
              'Information-dense incomplete sentence. Pack maximum information, drop articles ("a", "the"), include specific details (dates, numbers, examples). Use compact phrasing.'
            ),
          lifetime: z
            .enum(['week', 'month', 'year', 'forever'])
            .describe('How long this note should be retained'),
        })
      )
      .min(1)
      .describe('Array of notes to add to the relationship. Each note can have a different lifetime.'),
  });

  return tool({
    description: getEdgeUpdateDescription(relationshipType),
    parameters: schema,
    execute: async (input) => {
      try {
        const validated = schema.parse(input);
        const { from_entity_name, to_entity_name, notes: inputNotes } = validated;
        // Note: attitude and proximity are NOT in the schema.
        // The merge agent only appends notes and does not modify attitude/proximity scores.

        // Resolve entity names to entity_keys
        if (!nameToKeyMap) {
          throw new Error('nameToKeyMap is required for update_edge tool');
        }

        const from_entity_key = resolveNameToKey(from_entity_name, nameToKeyMap);
        if (!from_entity_key) {
          const validNames = Array.from(nameToKeyMap.keys()).join(', ');
          console.error(`   ❌ update_edge failed: Invalid from_entity_name ${from_entity_name}`);
          console.error(`   📋 Valid entity names in nameToKeyMap: ${validNames}`);
          return JSON.stringify({
            success: false,
            error: `Invalid from_entity_name: ${from_entity_name}. Valid names: ${validNames}`,
          });
        }

        const to_entity_key = resolveNameToKey(to_entity_name, nameToKeyMap);
        if (!to_entity_key) {
          const validNames = Array.from(nameToKeyMap.keys()).join(', ');
          console.error(`   ❌ update_edge failed: Invalid to_entity_name ${to_entity_name}`);
          console.error(`   📋 Valid entity names in nameToKeyMap: ${validNames}`);
          return JSON.stringify({
            success: false,
            error: `Invalid to_entity_name: ${to_entity_name}. Valid names: ${validNames}`,
          });
        }

        // Step 1: Get node labels to determine canonical direction
        const nodesQuery = `
          MATCH (from {entity_key: $from_entity_key})
          MATCH (to {entity_key: $to_entity_key})
          RETURN labels(from)[0] as fromLabel, labels(to)[0] as toLabel
        `;
        const nodesResult = await neo4jService.executeQuery<{ fromLabel: string; toLabel: string }>(nodesQuery, {
          from_entity_key,
          to_entity_key,
        });

        if (!nodesResult[0]) {
          return JSON.stringify({
            success: false,
            error: 'One or both nodes do not exist',
          });
        }

        const { fromLabel, toLabel } = nodesResult[0];
        const canonicalDirection = CANONICAL_RELATIONSHIP_DIRECTIONS[relationshipType];

        // Determine if we need to swap to match canonical direction (normalize to lowercase)
        const needsSwap = fromLabel.toLowerCase() === canonicalDirection.to && toLabel.toLowerCase() === canonicalDirection.from;
        const canonicalFromEntityKey = needsSwap ? to_entity_key : from_entity_key;
        const canonicalToEntityKey = needsSwap ? from_entity_key : to_entity_key;

        // Step 2: Fetch existing relationship (check canonical direction first, then reverse)
        let fetchQuery = `
          MATCH (from {entity_key: $from_entity_key})-[r:${relationshipType}]->(to {entity_key: $to_entity_key})
          RETURN r, false as was_reversed
        `;
        let fetchResult = await neo4jService.executeQuery<{ r: Record<string, unknown>; was_reversed: boolean }>(
          fetchQuery,
          {
            from_entity_key: canonicalFromEntityKey,
            to_entity_key: canonicalToEntityKey,
          }
        );

        // If not found in canonical direction, try reverse direction
        if (!fetchResult[0]) {
          fetchQuery = `
            MATCH (from {entity_key: $from_entity_key})-[r:${relationshipType}]->(to {entity_key: $to_entity_key})
            RETURN r, true as was_reversed
          `;
          fetchResult = await neo4jService.executeQuery<{ r: Record<string, unknown>; was_reversed: boolean }>(
            fetchQuery,
            {
              from_entity_key: canonicalToEntityKey,
              to_entity_key: canonicalFromEntityKey,
            }
          );
        }

        if (!fetchResult[0]) {
          return JSON.stringify({
            success: false,
            error: `Relationship ${relationshipType} between ${from_entity_key} and ${to_entity_key} not found`,
          });
        }

        const wasReversed = fetchResult[0].was_reversed;
        // If relationship exists in reverse direction, use those entity keys for update
        const updateFromEntityKey = wasReversed ? canonicalToEntityKey : canonicalFromEntityKey;
        const updateToEntityKey = wasReversed ? canonicalFromEntityKey : canonicalToEntityKey;

        const existingRel = fetchResult[0].r;

        // Step 3: Parse existing notes and append new notes
        const existingNotes = parseNotes(existingRel.notes);
        const newNotes: NoteObject[] = inputNotes.map((note) => ({
          content: note.content,
          added_by: userId,
          source_entity_key: sourceEntityKey,
          date_added: new Date().toISOString(),
          expires_at: getExpiresAt(note.lifetime),
        }));
        const updatedNotes = [...existingNotes, ...newNotes];

        // Step 4: Regenerate embedding only if notes changed (attitude/proximity not part of update)
        const notesChanged = inputNotes.length > 0;

        let relationshipEmbedding: number[] | undefined;

        if (notesChanged) {
          // Regenerate embedding with existing attitude/proximity and new notes
          const finalAttitude = (existingRel.attitude as number | undefined) ?? 3;
          const finalProximity = (existingRel.proximity as number | undefined) ?? 3;
          const { attitudeWord, proximityWord } = getAttitudeProximityWords(
            relationshipType,
            finalAttitude,
            finalProximity
          );

          const description = (existingRel.description as string | undefined) ?? '';
          const relType = (existingRel.relationship_type as string | undefined) ?? '';

          relationshipEmbedding = await generateRelationshipEmbedding(
            description,
            relType,
            attitudeWord,
            proximityWord,
            updatedNotes
          );
        }

        // Step 5: Update relationship (use the direction where it actually exists)
        const updateQuery = `
          MATCH (from {entity_key: $from_entity_key})-[r:${relationshipType}]->(to {entity_key: $to_entity_key})
          SET
            r.notes = $notes,
            r.last_update_source = $last_update_source,
            r.updated_at = datetime()
            ${relationshipEmbedding ? ', r.relationship_embedding = $relationship_embedding' : ''}
          RETURN r
        `;

        const updateParams: Record<string, unknown> = {
          from_entity_key: updateFromEntityKey,
          to_entity_key: updateToEntityKey,
          notes: stringifyNotes(updatedNotes),
          last_update_source: sourceEntityKey,
        };
        if (relationshipEmbedding) {
          updateParams.relationship_embedding = relationshipEmbedding;
        }

        const updateResult = await neo4jService.executeQuery<{ r: unknown }>(updateQuery, updateParams);

        if (!updateResult[0]) {
          throw new Error('Failed to update relationship');
        }

        const changes: string[] = [];
        if (inputNotes.length > 0) changes.push(`added ${inputNotes.length} note(s)`);

        const directionNote = wasReversed
          ? ` (found in reverse direction ${updateFromEntityKey}→${updateToEntityKey}, updated there)`
          : needsSwap
            ? ` (auto-reversed from ${from_entity_key}→${to_entity_key} to match canonical direction)`
            : '';

        return JSON.stringify({
          success: true,
          message: `Updated ${relationshipType} relationship from ${updateFromEntityKey} to ${updateToEntityKey}${directionNote}`,
          changes,
          notes_added: inputNotes.length,
          regenerated_embedding: notesChanged,
          direction_reversed: needsSwap || wasReversed,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return JSON.stringify({
          success: false,
          error: errorMessage,
        });
      }
    },
  });
}

/**
 * Factory function to create combined edge and node update tool
 *
 * Updates both a relationship and its connected node in a single operation.
 * Auto-detects relationship type based on node labels.
 * Strictly additive - appends notes to both edge and node.
 *
 * @param userId - User ID for provenance tracking
 * @param sourceEntityKey - Source entity key for provenance tracking
 * @param fromEntityKey - Entity key of the source node (bound to tool)
 * @param nameToKeyMap - Map from normalized names to entity keys
 * @returns Configured tool for updating edges and nodes
 */
export function addEdgeAndNodeNotesTool(
  userId: string,
  sourceEntityKey: string,
  fromEntityKey: string,
  nameToKeyMap: Map<string, string>
) {
  const schema = z.object({
    to_entity_name: z
      .string()
      .describe('Name of target entity (use normalized name from neighbor list: lowercase, spaces→underscores, e.g., "paul_peel", "roy")'),
    edge_notes: z
      .array(
        z.object({
          content: z
            .string()
            .describe(
              'Information-dense incomplete sentence about the RELATIONSHIP. Pack maximum information, drop articles ("a", "the"), include specific details (dates, numbers, examples). Use compact phrasing.'
            ),
          lifetime: z
            .enum(['week', 'month', 'year', 'forever'])
            .describe('How long this note should be retained'),
        })
      )
      .min(1)
      .describe('Array of notes to add to the relationship. Each note can have a different lifetime.'),
    node_notes: z
      .array(
        z.object({
          content: z
            .string()
            .describe(
              'Information-dense incomplete sentence about the CONNECTED NODE itself. Pack maximum information, drop articles ("a", "the"), include specific details (dates, numbers, examples). Use compact phrasing.'
            ),
          lifetime: z
            .enum(['week', 'month', 'year', 'forever'])
            .describe('How long this note should be retained'),
        })
      )
      .min(1)
      .describe('Array of notes to add to the connected node. Each note can have a different lifetime.'),
  });

  return tool({
    description:
      `Update both a relationship and its connected node in one action.
Specify to_entity_name (normalized entity name like "roy" or "paul_peel"),
edge_notes (array, min 1) for the relationship, and node_notes (array, min 1) for the connected node.
Automatically determines the correct relationship type based on node labels.
Strictly additive - appends notes to both edge and node.`,
    parameters: schema,
    execute: async (input) => {
      try {
        const validated = schema.parse(input);
        const { to_entity_name, edge_notes: edgeNotesInput, node_notes: nodeNotesInput } = validated;

        // Import applyNotesToNode here to avoid circular dependencies
        const { applyNotesToNode } = await import('../../../utils/nodeHelpers.js');

        // Resolve entity name to entity_key
        const to_entity_key = resolveNameToKey(to_entity_name, nameToKeyMap);
        if (!to_entity_key) {
          const validNames = Array.from(nameToKeyMap.keys()).join(', ');
          console.error(`   ❌ add_edge_and_node_notes failed: Invalid to_entity_name ${to_entity_name}`);
          console.error(`   📋 Valid entity names in nameToKeyMap: ${validNames}`);
          return JSON.stringify({
            success: false,
            error: `Invalid to_entity_name: ${to_entity_name}. Valid names: ${validNames}`,
          });
        }

        console.log(`   🔧 add_edge_and_node_notes tool invoked for: ${to_entity_name} (${to_entity_key})`);

        // Step 1: Get node labels and types to determine relationship type and node type
        const nodesQuery = `
          MATCH (from {entity_key: $from_entity_key})
          MATCH (to {entity_key: $to_entity_key})
          RETURN labels(from)[0] as fromLabel, labels(to)[0] as toLabel
        `;
        const nodesResult = await neo4jService.executeQuery<{ fromLabel: string; toLabel: string }>(nodesQuery, {
          from_entity_key: fromEntityKey,
          to_entity_key: to_entity_key,
        });

        if (!nodesResult[0]) {
          return JSON.stringify({
            success: false,
            error: 'One or both nodes do not exist',
          });
        }

        const { fromLabel, toLabel } = nodesResult[0];
        const { relationshipType: cypherRelType, needsSwap } = getCypherRelationshipTypeWithDirection(
          fromLabel.toLowerCase(),
          toLabel.toLowerCase()
        );

        // Determine canonical direction for edge update
        const canonicalFromEntityKey = needsSwap ? to_entity_key : fromEntityKey;
        const canonicalToEntityKey = needsSwap ? fromEntityKey : to_entity_key;

        // Step 2: Fetch existing relationship (check canonical direction first, then reverse)
        let fetchQuery = `
          MATCH (from {entity_key: $from_entity_key})-[r:${cypherRelType}]->(to {entity_key: $to_entity_key})
          RETURN r, false as was_reversed
        `;
        let fetchResult = await neo4jService.executeQuery<{ r: Record<string, unknown>; was_reversed: boolean }>(
          fetchQuery,
          {
            from_entity_key: canonicalFromEntityKey,
            to_entity_key: canonicalToEntityKey,
          }
        );

        // If not found in canonical direction, try reverse direction
        if (!fetchResult[0]) {
          fetchQuery = `
            MATCH (from {entity_key: $from_entity_key})-[r:${cypherRelType}]->(to {entity_key: $to_entity_key})
            RETURN r, true as was_reversed
          `;
          fetchResult = await neo4jService.executeQuery<{ r: Record<string, unknown>; was_reversed: boolean }>(
            fetchQuery,
            {
              from_entity_key: canonicalToEntityKey,
              to_entity_key: canonicalFromEntityKey,
            }
          );
        }

        if (!fetchResult[0]) {
          return JSON.stringify({
            success: false,
            error: `Relationship ${cypherRelType} between ${fromEntityKey} and ${to_entity_key} not found`,
          });
        }

        const wasReversed = fetchResult[0].was_reversed;
        const updateFromEntityKey = wasReversed ? canonicalToEntityKey : canonicalFromEntityKey;
        const updateToEntityKey = wasReversed ? canonicalFromEntityKey : canonicalToEntityKey;
        const existingRel = fetchResult[0].r;

        // Step 3: Update edge with edge_notes
        const existingEdgeNotes = parseNotes(existingRel.notes);
        const newEdgeNotes: NoteObject[] = edgeNotesInput.map((note) => ({
          content: note.content,
          added_by: userId,
          source_entity_key: sourceEntityKey,
          date_added: new Date().toISOString(),
          expires_at: getExpiresAt(note.lifetime),
        }));
        const updatedEdgeNotes = [...existingEdgeNotes, ...newEdgeNotes];

        // Regenerate relationship embedding with new notes
        const finalAttitude = (existingRel.attitude as number | undefined) ?? 3;
        const finalProximity = (existingRel.proximity as number | undefined) ?? 3;
        const { attitudeWord, proximityWord } = getAttitudeProximityWords(
          cypherRelType,
          finalAttitude,
          finalProximity
        );

        const description = (existingRel.description as string | undefined) ?? '';
        const relType = (existingRel.relationship_type as string | undefined) ?? '';

        const relationshipEmbedding = await generateRelationshipEmbedding(
          description,
          relType,
          attitudeWord,
          proximityWord,
          updatedEdgeNotes
        );

        // Update relationship
        const updateEdgeQuery = `
          MATCH (from {entity_key: $from_entity_key})-[r:${cypherRelType}]->(to {entity_key: $to_entity_key})
          SET
            r.notes = $notes,
            r.last_update_source = $last_update_source,
            r.updated_at = datetime(),
            r.relationship_embedding = $relationship_embedding
          RETURN r
        `;

        await neo4jService.executeQuery<{ r: unknown }>(updateEdgeQuery, {
          from_entity_key: updateFromEntityKey,
          to_entity_key: updateToEntityKey,
          notes: stringifyNotes(updatedEdgeNotes),
          last_update_source: sourceEntityKey,
          relationship_embedding: relationshipEmbedding,
        });

        console.log(`   ✅ Updated ${cypherRelType} relationship with ${edgeNotesInput.length} edge note(s)`);

        // Step 4: Update connected node with node_notes
        // Determine node type from label
        const nodeType = toLabel.toLowerCase() as 'person' | 'concept' | 'entity';
        await applyNotesToNode(to_entity_key, nodeType, nodeNotesInput, userId, sourceEntityKey);

        console.log(`   ✅ Updated ${nodeType} node ${to_entity_name} with ${nodeNotesInput.length} node note(s)`);

        const directionNote = wasReversed
          ? ` (found in reverse direction ${updateFromEntityKey}→${updateToEntityKey}, updated there)`
          : needsSwap
            ? ` (auto-reversed from ${fromEntityKey}→${to_entity_key} to match canonical direction)`
            : '';

        return JSON.stringify({
          success: true,
          message: `Updated ${cypherRelType} relationship and ${nodeType} node ${to_entity_name}${directionNote}`,
          edge_notes_added: edgeNotesInput.length,
          node_notes_added: nodeNotesInput.length,
          relationship_type: cypherRelType,
          node_type: nodeType,
          direction_reversed: needsSwap || wasReversed,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`   ❌ add_edge_and_node_notes failed: ${errorMessage}`);
        return JSON.stringify({
          success: false,
          error: errorMessage,
        });
      }
    },
  });
}
