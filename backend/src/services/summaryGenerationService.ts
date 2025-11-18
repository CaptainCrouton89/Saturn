/**
 * Summary Generation Service
 *
 * Generates concise AI summaries for source content.
 * Used in ingestion pipeline to create human-readable descriptions for Source nodes.
 *
 * Design:
 * - Independent from content normalization (always runs)
 * - Uses generateText() for speed (no schema validation overhead)
 * - Accepts raw content (string or array)
 * - Returns 1-2 sentence summary suitable for UI display
 */

import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { withSpan, buildEntityAttributes } from '../utils/tracing.js';

/**
 * Generate AI summary for source content
 *
 * @param content - Raw content (string or array of turns/chunks)
 * @param modelId - AI SDK model ID (default: gpt-4o-mini)
 * @returns 1-2 sentence summary describing: who, what topics, key themes
 * @throws Error if AI call fails
 */
export async function generateSourceSummary(
  content: string | string[],
  modelId: string = 'gpt-4o-mini',
  userId?: string
): Promise<string> {
  const sourceCount = Array.isArray(content) ? content.length : 1;

  return withSpan(
    'service.summaryGeneration.generateSourceSummary',
    buildEntityAttributes('summary', 'create', {
      userId,
      entityCount: sourceCount,
    }),
    async () => {
      // Convert array to newline-separated text
      const text = Array.isArray(content) ? content.join('\n') : content;

      if (!text || text.trim().length === 0) {
        throw new Error('Cannot generate summary for empty content');
      }

      const { text: summary } = await generateText({
        model: openai(modelId),
        prompt: `Generate a concise 1-2 sentence summary of this conversation or content. Focus on:
- Who is involved (if mentioned)
- Main topics discussed
- Key themes or activities

Keep it natural and descriptive, suitable for displaying in a UI.

Content:
${text}

Summary:`,
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'ingestion-generate-summary',
          metadata: {
            phase: 'summary-generation',
            ...(userId ? { userId } : {}),
            contentCount: sourceCount,
          },
        },
      });

      const trimmed = summary.trim();

      if (!trimmed) {
        throw new Error('AI generated empty summary');
      }

      return trimmed;
    }
  );
}
