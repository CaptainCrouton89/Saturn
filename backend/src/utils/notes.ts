import type { NoteObject } from '../types/graph.js';

/**
 * Format notes as inline bullet list (single line per note)
 * Used for compact contexts like retrieval results
 *
 * @example
 * formatNotesInline([{content: "First"}, {content: "Second"}])
 * // Returns: "- First\n- Second"
 */
export function formatNotesInline(notes: unknown): string {
  if (!notes || !Array.isArray(notes)) return '';

  return notes
    .map((note) => {
      if (typeof note === 'string') return `- ${note}`;
      if (typeof note === 'object' && note !== null && 'content' in note) {
        return `- ${(note as NoteObject).content}`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Format notes with clear visual separation
 * Used for detailed contexts like graph traversal
 *
 * @example
 * formatNotesMultiline([{content: "First"}, {content: "Second"}])
 * // Returns: "  - First\n\n  - Second"
 */
export function formatNotesMultiline(notes: unknown): string {
  if (!notes || !Array.isArray(notes)) return '';

  return notes
    .map((note) => {
      if (typeof note === 'string') return `  - ${note}`;
      if (typeof note === 'object' && note !== null && 'content' in note) {
        return `  - ${(note as NoteObject).content}`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Format notes for LLM consumption with metadata
 * Used when providing existing notes as context to LLM
 *
 * @example
 * formatNotesForLLM([
 *   {content: "First", date_added: "2025-01-01", source_entity_key: "src-1"}
 * ])
 * // Returns: "- First [added 2025-01-01 from src-1]"
 */
export function formatNotesForLLM(notes: NoteObject[]): string {
  if (!notes || notes.length === 0) return '';

  return notes
    .map((note) => {
      let formatted = `- ${note.content}`;

      const metadata: string[] = [];
      if (note.date_added) {
        metadata.push(`added ${note.date_added.split('T')[0]}`);
      }
      if (note.source_entity_key) {
        metadata.push(`from ${note.source_entity_key}`);
      }

      if (metadata.length > 0) {
        formatted += ` [${metadata.join(', ')}]`;
      }

      return formatted;
    })
    .join('\n');
}

/**
 * Normalize raw note property (stringified JSON, array of strings, or NoteObject[]) into NoteObject[].
 * Handles edge cases:
 * - Already-parsed NoteObject arrays (returns as-is after validation)
 * - Stringified '[]' or nested arrays
 * - Mixed formats
 */
export function parseNotes(raw: unknown): NoteObject[] {
  if (!raw) return [];

  // Handle string inputs
  if (typeof raw === 'string') {
    // Handle literal '[]' string
    if (raw.trim() === '[]') return [];

    try {
      const parsed = JSON.parse(raw);
      return parseNotes(parsed);
    } catch {
      return [];
    }
  }

  // Handle array inputs
  if (Array.isArray(raw)) {
    // Fast path: if all entries are already valid NoteObjects, return as-is
    if (raw.length > 0 && raw.every(isValidNoteObject)) {
      return raw as NoteObject[];
    }

    // Otherwise, normalize each entry
    const notes: NoteObject[] = [];
    for (const entry of raw) {
      if (!entry) continue;

      if (typeof entry === 'string') {
        // Handle nested stringified entries
        try {
          const parsed = JSON.parse(entry);
          notes.push(...parseNotes(parsed));
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

  // Handle single object input
  if (typeof raw === 'object') {
    const normalized = normalizeNoteObject(raw as Record<string, unknown>);
    return normalized ? [normalized] : [];
  }

  return [];
}

/**
 * Fast validation check for NoteObject structure
 */
function isValidNoteObject(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const note = obj as Record<string, unknown>;
  return (
    typeof note.content === 'string' &&
    note.content.length > 0 &&
    typeof note.added_by === 'string' &&
    typeof note.date_added === 'string'
  );
}

export function stringifyNotes(raw: unknown): string {
  return JSON.stringify(parseNotes(raw));
}

function normalizeNoteObject(note: Record<string, unknown>): NoteObject | null {
  const content = typeof note.content === 'string' ? note.content : '';
  if (!content) return null;

  // Throw error if required fields are missing - no fallbacks
  if (typeof note.added_by !== 'string') {
    throw new Error(`Note missing required 'added_by' field: ${JSON.stringify(note)}`);
  }
  if (typeof note.date_added !== 'string') {
    throw new Error(`Note missing required 'date_added' field: ${JSON.stringify(note)}`);
  }

  return {
    content,
    added_by: note.added_by,
    date_added: note.date_added,
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
