/**
 * LangGraph node definitions for the conversation agent workflow.
 */

import { MessagesAnnotation } from '@langchain/langgraph';
import { END } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { AIMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { allTools } from '../tools/index.js';

/**
 * LLM model instance with tool binding.
 * Using GPT-4.1-nano for cost-effective conversational interactions.
 */
export const model = new ChatOpenAI({
  modelName: 'gpt-4.1-nano',
}).bindTools(allTools);

/**
 * Agent node - calls the LLM with current message state.
 *
 * @param state - Current conversation state with message history
 * @returns Updated state with LLM response
 */
export async function agentNode(state: typeof MessagesAnnotation.State) {
  const response = await model.invoke(state.messages);
  return { messages: [response] };
}

/**
 * Conditional edge function - routes to tools or end based on LLM response.
 *
 * @param state - Current conversation state
 * @returns 'tools' if LLM made tool calls, END otherwise
 */
export function shouldContinue(state: typeof MessagesAnnotation.State): 'tools' | typeof END {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

  // Check if the last message has tool calls
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return 'tools';
  }

  return END;
}

/**
 * Tool execution node - handles tool calls from the agent.
 * Pre-built LangGraph node for executing tools.
 */
export const toolNode = new ToolNode(allTools);
