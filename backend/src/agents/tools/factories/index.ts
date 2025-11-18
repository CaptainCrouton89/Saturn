/**
 * Tool Factories Index
 *
 * Exports factory functions for creating context-bound tools.
 * These factories allow tools to be created with auto-injected context
 * (userId, sourceEntityKey, etc.) instead of requiring these parameters
 * in the LLM-visible schema.
 *
 * Part of Tool Consolidation Plan (TOOL_CONSOLIDATION_PLAN.md)
 */

export { updateNodeTool } from './node.factory.js';
export { createEdgeTool, updateEdgeTool } from './edge.factory.js';
