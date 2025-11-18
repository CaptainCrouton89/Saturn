import { NoteObject } from '../types/graph.js';

/**
 * Converts an array of NoteObject to readable markdown format.
 * Used by LLM context builder and potentially for UI later.
 *
 * @param notes - Array of NoteObject to format
 * @returns Markdown string with list items, or '_No notes yet._' if empty
 */
export function formatNotesAsMarkdown(notes: NoteObject[]): string {
  if (notes.length === 0) {
    return '_No notes yet._';
  }

  const markdownItems = notes
    .map((note) => note.content.trim())
    .filter((content) => content.length > 0)
    .map((content) => `- ${content}`);

  return markdownItems.join('\n');
}
