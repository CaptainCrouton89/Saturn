import { neo4jService } from '../db/neo4j.js';
import { parseNotes, stringifyNotes } from '../utils/notes.js';

const NODE_LABELS = ['Person', 'Concept', 'Entity', 'Event'] as const;
const RELATIONSHIP_TYPES = [
  'HAS_RELATIONSHIP_WITH',
  'ENGAGES_WITH',
  'ASSOCIATED_WITH',
  'RELATES_TO',
  'INVOLVES',
  'CONNECTED_TO',
] as const;

export async function runNightlyNoteCleanup(): Promise<void> {
  const startTime = Date.now();
  console.log('[NoteCleanupService] Starting nightly note cleanup');

  const now = new Date();
  let totalExpired = 0;

  // Clean nodes
  for (const label of NODE_LABELS) {
    const query = `MATCH (n:${label}) WHERE n.notes IS NOT NULL AND n.notes <> '[]' RETURN n.entity_key AS entity_key, n.notes AS notes`;
    const results = await neo4jService.executeQuery<{ entity_key: string; notes: string }>(query);

    let labelExpired = 0;
    for (const row of results) {
      const original = parseNotes(row.notes);
      const filtered = original.filter(
        (note) => note.expires_at === null || new Date(note.expires_at) > now
      );

      if (filtered.length < original.length) {
        const removed = original.length - filtered.length;
        labelExpired += removed;

        await neo4jService.executeQuery(
          `MATCH (n:${label} {entity_key: $entityKey}) SET n.notes = $notes, n.updated_at = $updatedAt`,
          {
            entityKey: row.entity_key,
            notes: stringifyNotes(filtered),
            updatedAt: now.toISOString(),
          }
        );
      }
    }

    console.log(`[NoteCleanupService] ${label}: removed ${labelExpired} expired notes from ${results.length} nodes`);
    totalExpired += labelExpired;
  }

  // Clean relationships
  for (const relType of RELATIONSHIP_TYPES) {
    const query = `MATCH ()-[r:${relType}]->() WHERE r.notes IS NOT NULL AND r.notes <> '[]' RETURN elementId(r) AS elementId, r.notes AS notes`;
    const results = await neo4jService.executeQuery<{ elementId: string; notes: string }>(query);

    let relExpired = 0;
    for (const row of results) {
      const original = parseNotes(row.notes);
      const filtered = original.filter(
        (note) => note.expires_at === null || new Date(note.expires_at) > now
      );

      if (filtered.length < original.length) {
        const removed = original.length - filtered.length;
        relExpired += removed;

        await neo4jService.executeQuery(
          `MATCH ()-[r:${relType}]->() WHERE elementId(r) = $elementId SET r.notes = $notes, r.updated_at = $updatedAt`,
          {
            elementId: row.elementId,
            notes: stringifyNotes(filtered),
            updatedAt: now.toISOString(),
          }
        );
      }
    }

    console.log(`[NoteCleanupService] ${relType}: removed ${relExpired} expired notes from ${results.length} relationships`);
    totalExpired += relExpired;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[NoteCleanupService] Cleanup complete: removed ${totalExpired} expired notes in ${duration}s`);
}
