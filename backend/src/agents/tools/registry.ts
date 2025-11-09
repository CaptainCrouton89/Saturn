/**
 * Tool registry for LangChain/LangGraph agents.
 *
 * Centralizes all available tools for easy management and addition of new tools.
 */
    
import { completeOnboardingTool } from './completeOnboarding.tool.js';
import { writeTool } from './write.tool.js';

/**
 * All available tools for the LangGraph agent.
 * Add new tools here to make them available to the agent.
 */
export const allTools = [writeTool, completeOnboardingTool];
