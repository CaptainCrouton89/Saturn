import type { NoteObject } from '../types/graph.js';

/**
 * Normalize raw note property (stringified JSON, array of strings, or NoteObject[]) into NoteObject[].
 */
export function parseNotes(raw: unknown): NoteObject[] {
  if (!raw) return [];

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parseNotes(parsed);
    } catch {
      return [];
    }
  }

  if (Array.isArray(raw)) {
    const notes: NoteObject[] = [];
    for (const entry of raw) {
      if (!entry) continue;
      if (typeof entry === 'string') {
        try {
          notes.push(...parseNotes(JSON.parse(entry)));
        } catch {
          // ignore malformed entry
        }
        continue;
      }
      if (typeof entry === 'object') {
        const normalized = normalizeNoteObject(entry as Record<string, unknown>);
        if (normalized) {
          notes.push(normalized);
        }
      }
    }
    return notes;
  }

  if (typeof raw === 'object') {
    const normalized = normalizeNoteObject(raw as Record<string, unknown>);
    return normalized ? [normalized] : [];
  }

  return [];
}

export function stringifyNotes(raw: unknown): string {
  return JSON.stringify(parseNotes(raw));
}

function normalizeNoteObject(note: Record<string, unknown>): NoteObject | null {
  const content = typeof note.content === 'string' ? note.content : '';
  if (!content) return null;

  return {
    content,
    added_by: typeof note.added_by === 'string' ? note.added_by : '',
    date_added: typeof note.date_added === 'string' ? note.date_added : new Date().toISOString(),
    source_entity_key:
      note.source_entity_key === null || typeof note.source_entity_key === 'string'
        ? (note.source_entity_key as string | null)
        : null,
    expires_at:
      note.expires_at === null || typeof note.expires_at === 'string'
        ? (note.expires_at as string | null)
        : null,
  };
}
