/**
 * Shared Node Utilities
 *
 * Helper functions for node operations across agents and tools.
 * Extracted from duplicated implementations to follow DRY principle.
 */

import { generateEmbedding } from '../services/embeddingGenerationService.js';
import { personRepository } from '../repositories/PersonRepository.js';
import { conceptRepository } from '../repositories/ConceptRepository.js';
import { entityRepository } from '../repositories/EntityRepository.js';
import { eventRepository } from '../repositories/EventRepository.js';
import { sourceRepository } from '../repositories/SourceRepository.js';
import { neo4jService } from '../db/neo4j.js';
import { parseNotes } from './notes.js';
import type { FormattableNode } from './contextFormatting.js';
import type { EntityType, NoteObject, Person, Concept, Entity, Event, Source } from '../types/graph.js';

/**
 * Calculate expires_at ISO timestamp based on lifetime
 *
 * Extracted from:
 * - src/agents/tools/factories/node.factory.ts
 * - src/agents/tools/factories/edge.factory.ts
 * - src/agents/createAgent.ts
 */
export function getExpiresAt(
  lifetime: 'week' | 'month' | 'year' | 'forever',
  baselineDate: string
): string | null {
  const baseline = new Date(baselineDate).getTime();
  switch (lifetime) {
    case 'forever':
      return null;
    case 'week':
      return new Date(baseline + 7 * 24 * 60 * 60 * 1000).toISOString();
    case 'month':
      return new Date(baseline + 30 * 24 * 60 * 60 * 1000).toISOString();
    case 'year':
      return new Date(baseline + 365 * 24 * 60 * 60 * 1000).toISOString();
  }
}

/**
 * Generate node embedding from name + description + notes
 *
 * Extracted from:
 * - src/agents/tools/factories/node.factory.ts
 * - src/agents/mergeAgent.ts
 */
export async function generateNodeEmbedding(
  name: string,
  description: string | undefined,
  notes: NoteObject[]
): Promise<number[]> {
  const parts: string[] = [name];

  if (description) {
    parts.push(description);
  }

  // Ensure notes is an array before mapping
  if (!Array.isArray(notes)) {
    console.warn(`[generateNodeEmbedding] Expected array but got ${typeof notes}:`, notes);
    notes = parseNotes(notes);
  }

  // Additional safety check: ensure map function exists
  if (!Array.isArray(notes) || typeof notes.map !== 'function') {
    console.error(`[generateNodeEmbedding] notes is not a proper array after parseNotes:`, notes);
    notes = [];
  }

  const notesText = notes
    .map((n) => n.content)
    .join(' ')
    .substring(0, 1000);
  if (notesText) {
    parts.push(notesText);
  }

  const embeddingText = parts.join(' ').trim();
  return generateEmbedding(embeddingText);
}

/**
 * Apply notes to an existing node (Person, Concept, or Entity)
 *
 * Extracted from src/agents/mergeAgent.ts applyNotesToTargetNode()
 * Can be called directly by agents or wrapped in tools.
 *
 * @param entityKey - Entity key of the node to update
 * @param nodeType - Type of node (Person, Concept, Entity)
 * @param notes - Array of notes with content and lifetime
 * @param userId - User ID for note metadata
 * @param sourceEntityKey - Source entity key for provenance
 */
export async function applyNotesToNode(
  entityKey: string,
  nodeType: EntityType,
  notes: Array<{ content: string; lifetime: 'week' | 'month' | 'year' | 'forever' }>,
  userId: string,
  sourceEntityKey: string
): Promise<void> {
  // Load existing node
  let existingNode: Person | Concept | Entity | Event | null = null;
  switch (nodeType) {
    case 'person':
      existingNode = await personRepository.findById(entityKey);
      break;
    case 'concept':
      existingNode = await conceptRepository.findById(entityKey);
      break;
    case 'entity':
      existingNode = await entityRepository.findById(entityKey);
      break;
    case 'event':
      existingNode = await eventRepository.findById(entityKey);
      break;
  }

  if (!existingNode) {
    throw new Error(`Node ${entityKey} not found`);
  }

  // Parse existing notes and append new ones (repository already returns parsed array)
  const existingNotes = Array.isArray(existingNode.notes)
    ? existingNode.notes
    : parseNotes(existingNode.notes);

  // Ensure notes is an array before mapping
  if (!Array.isArray(notes)) {
    console.warn(`[applyNotesToNode] Expected array but got ${typeof notes}:`, notes);
    throw new Error(`Invalid notes parameter: expected array, got ${typeof notes}`);
  }

  // Load source node to get started_at timestamp
  const sourceNode = await loadSourceByEntityKey(sourceEntityKey);
  if (!sourceNode) {
    throw new Error(`Failed to fetch Source node with key ${sourceEntityKey}`);
  }
  if (!sourceNode.started_at) {
    throw new Error(
      `Source node ${sourceEntityKey} missing required 'started_at' property`
    );
  }

  const newNotes: NoteObject[] = notes.map((note) => ({
    content: note.content,
    added_by: userId,
    source_entity_key: sourceEntityKey,
    date_added: sourceNode.started_at,
    expires_at: getExpiresAt(note.lifetime, sourceNode.started_at),
  }));

  const updatedNotes = [...existingNotes, ...newNotes];

  // Generate new embedding
  if (!('name' in existingNode)) {
    throw new Error(`Node ${entityKey} missing required 'name' property`);
  }
  const name = existingNode.name;
  const description = 'description' in existingNode ? existingNode.description : undefined;
  const embedding = await generateNodeEmbedding(name, description, updatedNotes);

  // Update node with new notes and embedding
  switch (nodeType) {
    case 'person':
      await personRepository.update({
        entity_key: entityKey,
        notes: updatedNotes,
        embedding,
        last_update_source: sourceEntityKey,
        confidence: 0.9,
      });
      break;
    case 'concept':
      await conceptRepository.update(
        entityKey,
        { notes: updatedNotes },
        { last_update_source: sourceEntityKey, confidence: 0.9 }
      );
      // Update embedding separately (ConceptRepository doesn't support embedding in update)
      await neo4jService.executeQuery(
        `MATCH (c:Concept {entity_key: $entity_key}) SET c.embedding = $embedding`,
        { entity_key: entityKey, embedding }
      );
      break;
    case 'entity':
      await entityRepository.update({
        entity_key: entityKey,
        notes: updatedNotes,
        embedding,
        last_update_source: sourceEntityKey,
        confidence: 0.9,
      });
      break;
    case 'event':
      await eventRepository.update(
        entityKey,
        { notes: updatedNotes },
        { last_update_source: sourceEntityKey, confidence: 0.9 }
      );
      // Update embedding separately (EventRepository handles embedding generation)
      await neo4jService.executeQuery(
        `MATCH (e:Event {entity_key: $entity_key}) SET e.embedding = $embedding`,
        { entity_key: entityKey, embedding }
      );
      break;
  }
}

/**
 * Load a semantic node (Person, Concept, or Entity) by entity key
 *
 * Detects node type and calls the correct repository.
 * Used by createAgent and mergeAgent for loading semantic nodes.
 * DOES NOT handle Source nodes - use loadSourceByEntityKey for that.
 *
 * Extracted from:
 * - src/agents/createAgent.ts:220-233
 * - src/agents/mergeAgent.ts:55-112
 *
 * @param entityKey - Entity key of the semantic node to load
 * @returns Node object or null if not found
 * @throws Error if node type is Source (use loadSourceByEntityKey instead)
 */
export async function loadNodeByEntityKey(
  entityKey: string
): Promise<FormattableNode | null> {
  // First check if ANY node exists with this key to determine type
  const checkResult = await neo4jService.executeQuery<{
    labels: string[];
  }>(
    `
    MATCH (n {entity_key: $entity_key})
    RETURN labels(n) AS labels
    `,
    { entity_key: entityKey }
  );

  if (checkResult.length === 0) {
    return null;
  }

  const labels = checkResult[0].labels;

  // Load from appropriate repository based on detected label
  if (labels.includes('Person')) {
    return await personRepository.findById(entityKey);
  }

  if (labels.includes('Concept')) {
    return await conceptRepository.findById(entityKey);
  }

  if (labels.includes('Entity')) {
    return await entityRepository.findById(entityKey);
  }

  if (labels.includes('Event')) {
    return await eventRepository.findById(entityKey);
  }

  // Error if Source node (caller should use loadSourceByEntityKey)
  if (labels.includes('Source')) {
    throw new Error(
      `loadNodeByEntityKey received Source node (${entityKey}). ` +
      `Use loadSourceByEntityKey for Source nodes instead.`
    );
  }

  // Unknown node type - this should never happen
  throw new Error(`Unknown node type for entity_key ${entityKey}. Labels: ${labels.join(', ')}`);
}

/**
 * Load a Source node by entity key
 *
 * Specifically for loading Source nodes (provenance tracking).
 * Separate from loadNodeByEntityKey to enforce type safety.
 *
 * @param entityKey - Entity key of the Source node to load
 * @returns Source node or null if not found
 */
export async function loadSourceByEntityKey(
  entityKey: string
): Promise<Source | null> {
  return await sourceRepository.findById(entityKey);
}
