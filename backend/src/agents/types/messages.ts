/**
 * Type definitions for serialized conversation messages.
 * Used for storing and reconstructing LangChain message objects in the database.
 */

export interface SerializedBaseMessage {
  type: 'human' | 'ai' | 'tool' | 'system';
  content: string;
  timestamp: string;
}

export interface SerializedAIMessage extends SerializedBaseMessage {
  type: 'ai';
  tool_calls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
}

export interface SerializedToolMessage extends SerializedBaseMessage {
  type: 'tool';
  tool_call_id: string;
  name: string;
}

export interface SerializedSystemMessage extends SerializedBaseMessage {
  type: 'system';
}

export type SerializedMessage =
  | SerializedBaseMessage
  | SerializedAIMessage
  | SerializedToolMessage
  | SerializedSystemMessage;
