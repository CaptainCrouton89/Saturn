import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { BaseMessage, HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// Type definitions for serialized messages
export interface SerializedBaseMessage {
  type: 'human' | 'ai' | 'tool';
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

export type SerializedMessage = SerializedBaseMessage | SerializedAIMessage | SerializedToolMessage;

// Define the "write" tool
const writeTool = tool(
  async ({ content, filename }: { content: string; filename: string }) => {
    // Dummy implementation - just return success message
    return JSON.stringify({
      success: true,
      message: `File '${filename}' created successfully`,
      content: content.substring(0, 50) + (content.length > 50 ? '...' : '')
    });
  },
  {
    name: 'write',
    description: 'Write content to a file. Use this when the user asks to create or write a file.',
    schema: z.object({
      content: z.string().describe('The content to write to the file'),
      filename: z.string().describe('The name of the file to create')
    })
  }
);

// Initialize the model with tool binding
const model = new ChatOpenAI({
  modelName: 'gpt-4.1-nano',
}).bindTools([writeTool]);

// Define the agent node - calls the LLM
async function agentNode(state: typeof MessagesAnnotation.State) {
  const response = await model.invoke(state.messages);
  return { messages: [response] };
}

// Conditional edge function - route to tools or end
function shouldContinue(state: typeof MessagesAnnotation.State): 'tools' | typeof END {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

  // Check if the last message has tool calls
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return 'tools';
  }

  return END;
}

// Create the tool node
const toolNode = new ToolNode([writeTool]);

// Build the graph
const workflow = new StateGraph(MessagesAnnotation)
  .addNode('agent', agentNode)
  .addNode('tools', toolNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', shouldContinue, {
    tools: 'tools',
    [END]: END
  })
  .addEdge('tools', 'agent'); // After tools, go back to agent

// Compile the graph
const graph = workflow.compile();

// Message serialization utilities
export function serializeMessages(messages: BaseMessage[]): SerializedMessage[] {
  return messages.map(msg => {
    const base = {
      type: msg._getType() as 'human' | 'ai' | 'tool',
      content: msg.content as string,
      timestamp: new Date().toISOString()
    };

    if (msg._getType() === 'ai') {
      const aiMsg = msg as AIMessage;
      return {
        ...base,
        type: 'ai' as const,
        tool_calls: aiMsg.tool_calls ?? []
      };
    }

    if (msg._getType() === 'tool') {
      const toolMsg = msg as ToolMessage;
      if (!toolMsg.tool_call_id) {
        throw new Error('ToolMessage missing required tool_call_id');
      }
      if (!toolMsg.name) {
        throw new Error('ToolMessage missing required name');
      }
      return {
        ...base,
        type: 'tool' as const,
        tool_call_id: toolMsg.tool_call_id,
        name: toolMsg.name
      };
    }

    return base;
  });
}

export function deserializeMessages(json: SerializedMessage[]): BaseMessage[] {
  if (!Array.isArray(json)) {
    throw new Error('deserializeMessages expects an array');
  }

  return json.map(msg => {
    if (!msg.type) {
      throw new Error('Message missing required "type" field');
    }
    if (msg.content === undefined || msg.content === null) {
      throw new Error('Message missing required "content" field');
    }

    switch (msg.type) {
      case 'human':
        return new HumanMessage(msg.content);

      case 'ai': {
        const aiMsg = msg as SerializedAIMessage;
        return new AIMessage({
          content: aiMsg.content,
          tool_calls: aiMsg.tool_calls ?? []
        });
      }

      case 'tool': {
        const toolMsg = msg as SerializedToolMessage;
        if (!toolMsg.tool_call_id) {
          throw new Error('Tool message missing required tool_call_id');
        }
        if (!toolMsg.name) {
          throw new Error('Tool message missing required name');
        }
        return new ToolMessage({
          content: toolMsg.content,
          tool_call_id: toolMsg.tool_call_id,
          name: toolMsg.name
        });
      }

      default: {
        const exhaustive: never = msg;
        throw new Error(`Unknown message type: ${(exhaustive as SerializedMessage).type}`);
      }
    }
  });
}

// Main conversation runner
export async function runConversation(
  _conversationId: string,
  _userId: string,
  userMessage: string,
  existingTranscript: SerializedMessage[]
): Promise<{ response: string; fullMessages: BaseMessage[] }> {
  // Deserialize existing messages
  const existingMessages = deserializeMessages(existingTranscript);

  // Add the new user message
  const newUserMessage = new HumanMessage(userMessage);
  const allMessages = [...existingMessages, newUserMessage];

  // Run the graph
  const result = await graph.invoke(
    { messages: allMessages }
  );

  // Extract the final messages
  const finalMessages = result.messages as BaseMessage[];
  if (!finalMessages || finalMessages.length === 0) {
    throw new Error('Agent returned no messages');
  }

  // Get the last AI message as the response
  const lastAIMessage = [...finalMessages]
    .reverse()
    .find(msg => msg._getType() === 'ai') as AIMessage | undefined;

  if (!lastAIMessage) {
    throw new Error('No AI message found in agent response');
  }

  const responseText = lastAIMessage.content?.toString();
  if (!responseText) {
    throw new Error('AI message has no content');
  }

  return {
    response: responseText,
    fullMessages: finalMessages
  };
}
