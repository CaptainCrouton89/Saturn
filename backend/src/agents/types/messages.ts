/**
 * Type definitions for database message storage.
 *
 * StoredMessage: Simple JSON format for PostgreSQL storage of conversation messages.
 * Maps to AI SDK CoreMessage format via conversion utilities in orchestrator.ts.
 */

/**
 * Simplified message format for database storage.
 * Supports all message types (human, ai, tool, system).
 */
export interface StoredMessage {
  role: 'human' | 'ai' | 'tool' | 'system';
  content: string;
  timestamp: string;

  // Optional: AI messages with tool calls
  tool_calls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;

  // Optional: Tool messages (responses to tool calls)
  tool_call_id?: string;
  name?: string;
}
