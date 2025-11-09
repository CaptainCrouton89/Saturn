/**
 * File writing tool for LangChain/LangGraph agents.
 *
 * Currently a dummy implementation that returns success messages
 * without actually writing files. Can be enhanced later to support
 * artifact generation or file creation.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const writeTool = tool(
  async ({ content, filename }: { content: string; filename: string }) => {
    // Dummy implementation - just return success message
    return JSON.stringify({
      success: true,
      message: `File '${filename}' created successfully`,
      content: content.substring(0, 50) + (content.length > 50 ? '...' : '')
    });
  },
  {
    name: 'write',
    description: 'Write content to a file. Use this when the user asks to create or write a file.',
    schema: z.object({
      content: z.string().describe('The content to write to the file'),
      filename: z.string().describe('The name of the file to create')
    })
  }
);
