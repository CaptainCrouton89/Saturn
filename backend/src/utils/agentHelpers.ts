/**
 * Agent Helpers
 *
 * Utility functions for agent configuration and behavior.
 * Extracted from duplicated implementations in agents.
 */

/**
 * Calculate dynamic maxSteps for agent based on neighbor count
 *
 * Dynamically adjusts the maximum number of steps the agent can take
 * based on the number of neighbors to process. More neighbors = more steps.
 *
 * Formula: min(30, max(10, neighborCount * 2 + 5))
 * - Minimum: 10 steps (for small graphs)
 * - Maximum: 30 steps (safety limit)
 * - Scale: 2 steps per neighbor + 5 base steps
 *
 * Extracted from:
 * - src/agents/createAgent.ts:309
 * - src/agents/mergeAgent.ts:315
 *
 * @param neighborCount - Number of neighbors the agent will process
 * @returns Maximum steps the agent should be allowed to take
 */
export function calculateDynamicMaxSteps(neighborCount: number): number {
  return Math.min(30, Math.max(10, neighborCount * 2 + 5));
}
