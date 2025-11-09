/**
 * Message serialization utilities for converting between LangChain
 * BaseMessage objects and JSON-serializable formats for database storage.
 */

import { BaseMessage, HumanMessage, AIMessage, ToolMessage, SystemMessage } from '@langchain/core/messages';
import type {
  SerializedMessage,
  SerializedAIMessage,
  SerializedToolMessage,
  SerializedSystemMessage
} from '../types/messages.js';

/**
 * Convert LangChain BaseMessage objects to JSON-serializable format.
 *
 * @param messages - Array of LangChain BaseMessage objects
 * @returns Array of serialized messages suitable for database storage
 */
export function serializeMessages(messages: BaseMessage[]): SerializedMessage[] {
  return messages.map((msg) => {
    const base = {
      type: msg._getType() as 'human' | 'ai' | 'tool' | 'system',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      timestamp: new Date().toISOString()
    };

    if (msg instanceof AIMessage && msg.tool_calls && msg.tool_calls.length > 0) {
      return {
        ...base,
        type: 'ai' as const,
        tool_calls: msg.tool_calls.map((tc) => {
          if (!tc.id) {
            throw new Error('Tool call missing required id field');
          }
          return {
            id: tc.id,
            name: tc.name,
            args: tc.args
          };
        })
      } as SerializedAIMessage;
    }

    if (msg instanceof SystemMessage) {
      return {
        ...base,
        type: 'system' as const
      } as SerializedSystemMessage;
    }

    if (msg instanceof ToolMessage) {
      return {
        ...base,
        type: 'tool' as const,
        tool_call_id: msg.tool_call_id,
        name: msg.name
      } as SerializedToolMessage;
    }

    return base;
  });
}

/**
 * Reconstruct LangChain BaseMessage objects from serialized JSON.
 *
 * @param json - Array of serialized messages from database
 * @returns Array of LangChain BaseMessage objects
 * @throws Error if required fields are missing
 */
export function deserializeMessages(json: SerializedMessage[]): BaseMessage[] {
  return json.map((msg) => {
    if (!msg.type || msg.content === undefined) {
      throw new Error('Invalid serialized message: missing type or content');
    }

    switch (msg.type) {
      case 'human':
        return new HumanMessage(msg.content);

      case 'system':
        return new SystemMessage(msg.content);

      case 'ai': {
        const aiMsg = msg as SerializedAIMessage;
        if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
          return new AIMessage({
            content: msg.content,
            tool_calls: aiMsg.tool_calls.map((tc) => ({
              id: tc.id,
              name: tc.name,
              args: tc.args
            }))
          });
        }
        return new AIMessage(msg.content);
      }

      case 'tool': {
        const toolMsg = msg as SerializedToolMessage;
        if (!toolMsg.tool_call_id || !toolMsg.name) {
          throw new Error('Invalid tool message: missing tool_call_id or name');
        }
        return new ToolMessage({
          content: msg.content,
          tool_call_id: toolMsg.tool_call_id,
          name: toolMsg.name
        });
      }

      default: {
        // Exhaustive check - TypeScript will error if not all cases are handled
        const _exhaustive: never = msg;
        throw new Error(`Unknown message type: ${(_exhaustive as SerializedMessage).type}`);
      }
    }
  });
}
