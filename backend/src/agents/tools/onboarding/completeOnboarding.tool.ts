/**
 * Onboarding completion tool for AI SDK agents.
 *
 * Called by the agent when it has successfully:
 * 1. Gathered the user's name
 * 2. Explained privacy/data handling
 * 3. Gathered the user's age
 * 4. Explained how the app works
 *
 * Signals to the orchestrator that onboarding is complete.
 * The actual database update happens in the controller layer.
 *
 * Tracing: Wrapped with withSpan to track onboarding flow completion events.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { TraceAttributes, withSpan } from '../../../utils/tracing.js';

const CompleteOnboardingInputSchema = z.object({
  userId: z.string().optional().describe('User ID for tracing context'),
  conversationId: z.string().optional().describe('Conversation ID for tracing context'),
});

type CompleteOnboardingInput = z.infer<typeof CompleteOnboardingInputSchema>;

/**
 * Core onboarding completion logic
 */
async function executeCompleteOnboarding(): Promise<string> {
  return JSON.stringify({
    success: true,
    onboarding_complete: true,
    message: 'Onboarding completed successfully'
  });
}

/**
 * Wrapped execute function with tracing
 */
async function executeCompleteOnboardingWithTracing(input: CompleteOnboardingInput): Promise<string> {
  const userId = input.userId;
  const conversationId = input.conversationId;

  if (!userId) {
    throw new Error('userId is required for onboarding completion tracking');
  }

  return withSpan('tool.complete_onboarding', {
    [TraceAttributes.OPERATION_NAME]: 'tool.complete_onboarding',
    'toolName': 'complete_onboarding',
    [TraceAttributes.USER_ID]: userId,
    ...(conversationId && { [TraceAttributes.CONVERSATION_ID]: conversationId }),
    'inputSize': JSON.stringify(input).length,
  }, async () => {
    try {
      const result = await executeCompleteOnboarding();

      // Track onboarding completion event
      const span = require('@opentelemetry/api').trace.getActiveSpan();
      if (span) {
        span.setAttributes({
          'outputSize': result.length,
          'onboardingComplete': true,
        });
        span.addEvent('onboarding_completed', {
          'userId': userId,
          'timestamp': new Date().toISOString(),
        });
      }

      return result;
    } catch (error) {
      const span = require('@opentelemetry/api').trace.getActiveSpan();
      if (span) {
        span.addEvent('onboarding_error', {
          'errorMessage': error instanceof Error ? error.message : 'Unknown error',
        });
      }
      throw error;
    }
  });
}

export const completeOnboardingTool = tool({
  description: `Call this tool when you have successfully gathered the user's name, age, and explained how the app works during the onboarding conversation. This marks the user as onboarded and completes the introduction flow.`,
  parameters: CompleteOnboardingInputSchema,
  execute: executeCompleteOnboardingWithTracing,
});
