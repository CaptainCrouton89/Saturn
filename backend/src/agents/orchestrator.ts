/**
 * Main conversation orchestrator using AI SDK streamText().
 *
 * Handles:
 * - System prompt selection (default vs onboarding)
 * - Message format conversion (StoredMessage → CoreMessage)
 * - Multi-step execution with tool support
 * - Onboarding completion detection
 * - Response extraction and transcript building
 */

import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { CoreMessage, CoreToolMessage, CoreAssistantMessage } from 'ai';
import { DEFAULT_SYSTEM_PROMPT, ONBOARDING_SYSTEM_PROMPT } from './prompts/index.js';
import type { StoredMessage } from './types/messages.js';
import { tools } from './tools/registry.js';
import { withAgentTracing, withSpan } from '../utils/tracing.js';

// Maximum number of agent steps (tool calls + responses)
const MAX_STEPS = 10;

/**
 * Convert StoredMessage format to AI SDK CoreMessage format.
 * Handles conversion of stored transcript to CoreMessage array for AI SDK.
 */
function convertToCoreMessages(messages: StoredMessage[]): CoreMessage[] {
  const result: CoreMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    switch (msg.role) {
      case 'system':
        result.push({ role: 'system', content: msg.content });
        break;

      case 'human':
        result.push({ role: 'user', content: msg.content });
        break;

      case 'ai': {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // Assistant message with tool calls - use array content format
          result.push({
            role: 'assistant',
            content: [
              { type: 'text', text: msg.content },
              ...msg.tool_calls.map(tc => ({
                type: 'tool-call' as const,
                toolCallId: tc.id,
                toolName: tc.name,
                args: tc.args
              }))
            ]
          });
        } else {
          // Simple assistant message
          result.push({ role: 'assistant', content: msg.content });
        }
        break;
      }

      case 'tool': {
        // Tool result message
        if (!msg.tool_call_id || !msg.name) {
          throw new Error('Tool message missing required tool_call_id or name');
        }
        result.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: msg.tool_call_id,
              toolName: msg.name,
              result: msg.content
            }
          ]
        });
        break;
      }

      default:
        throw new Error(`Unknown message role: ${(msg as StoredMessage).role}`);
    }
  }

  return result;
}

/**
 * Convert AI SDK ResponseMessage to StoredMessage format.
 * Extracts messages from the AI SDK result and converts to database format.
 */
function convertResponseToStoredMessages(
  responseMessages: Array<CoreAssistantMessage | CoreToolMessage>
): StoredMessage[] {
  const stored: StoredMessage[] = [];
  const timestamp = new Date().toISOString();

  for (const msg of responseMessages) {
    if (msg.role === 'assistant') {
      // Extract text content and tool calls
      let textContent: string;
      if (Array.isArray(msg.content)) {
        const textPart = msg.content.find(c => c.type === 'text');
        if (!textPart || textPart.type !== 'text') {
          throw new Error('Assistant message missing required text content');
        }
        textContent = textPart.text;
      } else {
        textContent = msg.content;
      }

      const toolCalls = Array.isArray(msg.content)
        ? msg.content.filter(c => c.type === 'tool-call').map(tc => {
            if (tc.type !== 'tool-call') {
              throw new Error('Invalid tool call type');
            }
            if (typeof tc.args !== 'object' || tc.args === null || Array.isArray(tc.args)) {
              throw new Error('Tool call args must be a Record<string, unknown>');
            }
            return {
              id: tc.toolCallId,
              name: tc.toolName,
              args: tc.args as Record<string, unknown>
            };
          })
        : [];

      stored.push({
        role: 'ai',
        content: textContent,
        timestamp,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
      });
    } else if (msg.role === 'tool') {
      // Extract tool results
      const toolResults = Array.isArray(msg.content) ? msg.content : [msg.content];

      for (const result of toolResults) {
        if (result.type !== 'tool-result') {
          throw new Error('Invalid tool result type');
        }

        const resultContent = typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result);

        stored.push({
          role: 'tool',
          content: resultContent,
          timestamp,
          tool_call_id: result.toolCallId,
          name: result.toolName
        });
      }
    }
  }

  return stored;
}

/**
 * Run a conversation turn through the AI SDK agent.
 *
 * @param _conversationId - Conversation ID (currently unused, reserved for future context loading)
 * @param _userId - User ID (currently unused, reserved for future personalization)
 * @param userMessage - The user's message text
 * @param existingTranscript - Serialized conversation history from database
 * @param isOnboarding - Whether this is an onboarding conversation
 * @returns Object containing AI response, updated transcript, and onboarding completion flag
 */
async function runConversationImpl(
  _conversationId: string,
  _userId: string,
  userMessage: string,
  existingTranscript: StoredMessage[],
  isOnboarding: boolean = false
): Promise<{ response: string; fullMessages: StoredMessage[]; onboardingComplete?: boolean }> {
  // Build message array for AI SDK
  let messages: CoreMessage[];

  if (existingTranscript.length === 0) {
    // First message - add system prompt
    const systemPrompt = isOnboarding ? ONBOARDING_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT;
    messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ];
  } else {
    // Convert existing messages and add new user message
    const existingCoreMessages = convertToCoreMessages(existingTranscript);
    messages = [
      ...existingCoreMessages,
      { role: 'user', content: userMessage }
    ];
  }

  // Track onboarding completion
  let onboardingComplete = false;

  // Run streamText with multi-step execution - wrapped with custom span
  const result = await withSpan('orchestrator-agent', {
    userId: _userId,
    conversationId: _conversationId,
    toolCount: tools ? Object.keys(tools).length : 0,
    hasContext: messages.length > 2, // More than just system prompt + user message
  }, async () => {
    return streamText({
      model: openai('gpt-5-nano', {
        reasoningEffort: 'low', // Use low reasoning for faster execution
      }),
      messages,
      tools,
      maxSteps: MAX_STEPS,
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'orchestrator-agent',
        metadata: {
          userId: _userId,
          conversationId: _conversationId,
          toolCount: tools ? Object.keys(tools).length : 0,
          hasContext: messages.length > 2,
        },
      },
      onStepFinish: async ({ stepType, toolCalls, text, finishReason }) => {
        // Log step completion for monitoring
        console.log('[Orchestrator] Step finished:', {
          stepType,
          finishReason,
          toolCallCount: toolCalls?.length ?? 0,
          responseLength: text?.length ?? 0
        });

        // Check for onboarding completion
        if (toolCalls?.some(tc => tc.toolName === 'complete_onboarding')) {
          onboardingComplete = true;
        }
      }
    });
  });

  // Wait for completion and extract final text
  const responseText = await result.text;

  if (!responseText) {
    throw new Error('AI returned no response');
  }

  // Get the response messages (includes assistant and tool messages)
  const response = await result.response;
  const responseMessages = response.messages;

  // Convert response messages to StoredMessage format
  const newMessages = convertResponseToStoredMessages(responseMessages);

  // Build full transcript: existing + user message + AI responses
  const timestamp = new Date().toISOString();
  const userStoredMessage: StoredMessage = {
    role: 'human',
    content: userMessage,
    timestamp
  };

  // For first message, include system prompt in transcript
  const fullMessages: StoredMessage[] = existingTranscript.length === 0
    ? [
        {
          role: 'system',
          content: isOnboarding ? ONBOARDING_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT,
          timestamp
        },
        userStoredMessage,
        ...newMessages
      ]
    : [
        ...existingTranscript,
        userStoredMessage,
        ...newMessages
      ];

  return {
    response: responseText,
    fullMessages,
    onboardingComplete
  };
}

/**
 * Exported wrapped version with LangSmith tracing
 */
export const runConversation = withAgentTracing(
  runConversationImpl as (...args: unknown[]) => unknown,
  "conversation",
  { userId: "dynamic" }
) as unknown as typeof runConversationImpl;
