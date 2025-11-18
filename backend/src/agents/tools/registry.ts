/**
 * Tool registry for AI SDK agents.
 *
 * Centralizes all available tools for easy management and addition of new tools.
 * Exports a plain object mapping tool names to tool definitions.
 *
 * Note: Retrieval tools (explore, traverse) are not included here as they require
 * userId context and are used by the ingestion agent, not the conversation agent.
 * Import them directly from ./retrieval/ when needed.
 */

import { writeTool } from './actions/write.tool.js';
import { completeOnboardingTool } from './onboarding/completeOnboarding.tool.js';

// Artifact tools (still used)
import { createArtifactTool, updateArtifactTool } from './nodes/artifact.tool.js';

// Factory functions for context-bound tools (Tool Consolidation Plan)
import { createEdgeTool, updateEdgeTool, updateNodeTool } from './factories/index.js';

// Tracing utilities
import { TraceAttributes, withSpan } from '../../utils/tracing.js';

/**
 * Wrapper function to add tracing to tool executions
 *
 * Wraps tool execute functions with OpenTelemetry spans to track:
 * - Tool execution time and success/failure
 * - Input/output sizes (character counts)
 * - Tool-specific metadata (nodeCount, queryType, etc.)
 * - Input validation errors
 *
 * @param toolName - Name of the tool for span identification
 * @param toolFn - Tool execute function to wrap
 * @param extractMetadata - Function to extract custom metadata from args
 * @returns Wrapped execute function with tracing
 *
 * @example
 * const tracedExecute = wrapToolWithTracing(
 *   'write',
 *   writeTool.execute.bind(writeTool),
 *   (args) => ({ contentLength: args.content?.length || 0 })
 * );
 */
export function wrapToolWithTracing<TArgs extends Record<string, unknown>>(
  toolName: string,
  toolFn: (args: TArgs) => Promise<string>,
  extractMetadata?: (args: TArgs) => Record<string, string | number | boolean>
): (args: TArgs) => Promise<string> {
  return async (args: TArgs) => {
    // Extract userId and conversationId from args if available
    const userId = typeof args.userId === 'string' ? args.userId : 'unknown';
    const conversationId = typeof args.conversationId === 'string' ? args.conversationId : undefined;

    // Get tool-specific metadata
    const customMetadata = extractMetadata ? extractMetadata(args) : {};

    // Calculate input size
    const inputSize = JSON.stringify(args).length;

    const attributes = {
      [TraceAttributes.OPERATION_NAME]: `tool.${toolName}`,
      'toolName': toolName,
      [TraceAttributes.USER_ID]: userId,
      ...(conversationId && { [TraceAttributes.CONVERSATION_ID]: conversationId }),
      'inputSize': inputSize,
      ...customMetadata,
    };

    return withSpan(`tool.${toolName}`, attributes, async () => {
      try {
        const result = await toolFn(args);

        // Track output size
        const outputSize = result.length;
        const span = require('@opentelemetry/api').trace.getActiveSpan();
        if (span) {
          span.setAttributes({
            'outputSize': outputSize,
          });
        }

        return result;
      } catch (error) {
        // Log validation errors as span events
        if (error instanceof Error && error.message.includes('validation')) {
          const span = require('@opentelemetry/api').trace.getActiveSpan();
          if (span) {
            span.addEvent('validation_error', {
              'errorMessage': error.message,
            });
          }
        }
        throw error;
      }
    });
  };
}

/**
 * Plain object export of all available tools.
 * Tool names map to tool definitions for easy access and management.
 */
export const tools = {
  write: writeTool,
  complete_onboarding: completeOnboardingTool,
  create_artifact: createArtifactTool,
  update_artifact: updateArtifactTool,
};

/**
 * Tool factory functions for MERGE/CREATE agents
 * These factories create tools with auto-injected context (userId, sourceEntityKey, etc.)
 */
export { createEdgeTool, updateEdgeTool, updateNodeTool };

