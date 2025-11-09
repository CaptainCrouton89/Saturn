/**
 * Main conversation orchestrator for running LangGraph agent workflows.
 *
 * Handles:
 * - System prompt selection (default vs onboarding)
 * - Message deserialization and reconstruction
 * - Graph invocation
 * - Onboarding completion detection
 * - Response extraction
 */

import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { graph } from './graph/index.js';
import { DEFAULT_SYSTEM_PROMPT, ONBOARDING_SYSTEM_PROMPT } from './prompts/index.js';
import type { SerializedMessage } from './types/messages.js';
import { deserializeMessages } from './utils/index.js';

/**
 * Run a conversation turn through the LangGraph agent.
 *
 * @param _conversationId - Conversation ID (currently unused, reserved for future context loading)
 * @param _userId - User ID (currently unused, reserved for future personalization)
 * @param userMessage - The user's message text
 * @param existingTranscript - Serialized conversation history from database
 * @param isOnboarding - Whether this is an onboarding conversation
 * @returns Object containing AI response, full message history, and onboarding completion flag
 */
export async function runConversation(
  _conversationId: string,
  _userId: string,
  userMessage: string,
  existingTranscript: SerializedMessage[],
  isOnboarding: boolean = false
): Promise<{ response: string; fullMessages: BaseMessage[]; onboardingComplete?: boolean }> {
  // Deserialize existing messages
  const existingMessages = deserializeMessages(existingTranscript);

  // Add system prompt if this is the first message
  let allMessages: BaseMessage[];
  if (existingMessages.length === 0) {
    const systemPrompt = isOnboarding ? ONBOARDING_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT;
    const systemMessage = new SystemMessage(systemPrompt);
    const newUserMessage = new HumanMessage(userMessage);
    allMessages = [systemMessage, newUserMessage];
  } else {
    const newUserMessage = new HumanMessage(userMessage);
    allMessages = [...existingMessages, newUserMessage];
  }

  // Run the graph
  const result = await graph.invoke(
    { messages: allMessages }
  );

  // Extract the final messages
  const finalMessages = result.messages as BaseMessage[];
  if (!finalMessages || finalMessages.length === 0) {
    throw new Error('Agent returned no messages');
  }

  // Check if onboarding was completed (look for complete_onboarding tool call)
  let onboardingComplete = false;
  for (const msg of finalMessages) {
    if (msg._getType() === 'ai') {
      const aiMsg = msg as AIMessage;
      if (aiMsg.tool_calls && aiMsg.tool_calls.some(tc => tc.name === 'complete_onboarding')) {
        onboardingComplete = true;
        break;
      }
    }
  }

  // Get the last AI message as the response
  const lastAIMessage = [...finalMessages]
    .reverse()
    .find(msg => msg.type === 'ai') as AIMessage | undefined;

  if (!lastAIMessage) {
    throw new Error('No AI message found in agent response');
  }

  const responseText = lastAIMessage.content?.toString();
  if (!responseText) {
    throw new Error('AI message has no content');
  }

  return {
    response: responseText,
    fullMessages: finalMessages,
    onboardingComplete
  };
}
