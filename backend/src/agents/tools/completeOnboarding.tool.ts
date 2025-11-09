/**
 * Onboarding completion tool for LangChain/LangGraph agents.
 *
 * Called by the agent when it has successfully:
 * 1. Gathered the user's name
 * 2. Explained privacy/data handling
 * 3. Gathered the user's age
 * 4. Explained how the app works
 *
 * Signals to the orchestrator that onboarding is complete.
 * The actual database update happens in the controller layer.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const completeOnboardingTool = tool(
  async () => {
    // Signal that onboarding is complete
    // The actual database update happens in the controller
    return JSON.stringify({
      success: true,
      onboarding_complete: true,
      message: 'Onboarding completed successfully'
    });
  },
  {
    name: 'complete_onboarding',
    description: `Call this tool when you have successfully gathered the user's name, age, and explained how the app works during the onboarding conversation. This marks the user as onboarded and completes the introduction flow.`,
    schema: z.object({})
  }
);
