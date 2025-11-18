/**
 * File writing tool for AI SDK agents.
 *
 * Currently a dummy implementation that returns success messages
 * without actually writing files. Can be enhanced later to support
 * artifact generation or file creation.
 *
 * Tracing: Wrapped with withSpan to track tool execution, input/output sizes,
 * and file creation metadata.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { TraceAttributes, withSpan } from '../../../utils/tracing.js';

const WriteToolInputSchema = z.object({
  content: z.string().describe('The content to write to the file'),
  filename: z.string().describe('The name of the file to create'),
  userId: z.string().optional().describe('User ID for tracing context'),
  conversationId: z.string().optional().describe('Conversation ID for tracing context'),
});

type WriteToolInput = z.infer<typeof WriteToolInputSchema>;

/**
 * Core write logic - can be called directly or wrapped in a tool
 */
async function executeWrite(input: WriteToolInput): Promise<string> {
  return JSON.stringify({
    success: true,
    message: `File '${input.filename}' created successfully`,
    content: input.content.substring(0, 50) + (input.content.length > 50 ? '...' : '')
  });
}

/**
 * Wrapped execute function with tracing
 */
async function executeWriteWithTracing(input: WriteToolInput): Promise<string> {
  if (!input.userId) {
    throw new Error('userId is required for tracing context');
  }

  const userId = input.userId;
  const conversationId = input.conversationId;

  return withSpan('tool.write', {
    [TraceAttributes.OPERATION_NAME]: 'tool.write',
    'toolName': 'write',
    [TraceAttributes.USER_ID]: userId,
    ...(conversationId && { [TraceAttributes.CONVERSATION_ID]: conversationId }),
    'inputSize': JSON.stringify(input).length,
    'contentLength': input.content.length,
    'filename': input.filename,
  }, async () => {
    try {
      const result = await executeWrite(input);

      // Track output metadata
      const span = require('@opentelemetry/api').trace.getActiveSpan();
      if (span) {
        span.setAttributes({
          'outputSize': result.length,
          'success': true,
        });
      }

      return result;
    } catch (error) {
      const span = require('@opentelemetry/api').trace.getActiveSpan();
      if (span) {
        span.addEvent('write_error', {
          'errorMessage': error instanceof Error ? error.message : 'Unknown error',
        });
      }
      throw error;
    }
  });
}

export const writeTool = tool({
  description: 'Write content to a file. Use this when the user asks to create or write a file.',
  parameters: WriteToolInputSchema,
  execute: executeWriteWithTracing,
});
