/**
 * Summary Service
 *
 * Consolidated summary generation for:
 * - Conversation display summaries (generateConversationSummary): takes StoredMessage[]
 * - Ingestion pipeline source summaries (generateSourceSummary): takes string | string[]
 */

import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { StoredMessage } from '../agents/types/messages.js';
import { SUMMARY_SYSTEM_PROMPT, SUMMARY_USER_PROMPT } from '../agents/prompts/summary.js';
import { withSpan, buildEntityAttributes } from '../utils/tracing.js';
import { logCachePerformance } from '../utils/cacheLogging.js';

const INGESTION_SUMMARY_SYSTEM_PROMPT = `Generate a concise 1-2 sentence summary of the provided conversation or content.

Focus on:
- Who is involved (if mentioned)
- Main topics discussed
- Key themes or activities

Keep it natural and descriptive, suitable for displaying in a UI.`;

export class SummaryService {
  /**
   * Generate a brief summary of a conversation for display in the iOS archive view.
   *
   * @param transcript - Full conversation transcript as StoredMessage[]
   * @returns 1-2 sentence summary
   * @throws Error if transcript is empty or generation fails
   */
  async generateConversationSummary(transcript: StoredMessage[]): Promise<string> {
    if (!transcript || transcript.length === 0) {
      throw new Error('Cannot generate summary: transcript is empty');
    }

    return withSpan(
      'service.summary.generateConversationSummary',
      buildEntityAttributes('summary', 'create', {
        entityCount: transcript.length,
      }),
      async () => {
        const readableTranscript = this.prepareTranscriptForSummary(transcript);

        if (!readableTranscript) {
          throw new Error('Cannot generate summary: no dialogue found in transcript');
        }

        try {
          const summaryCacheKey = 'summary-conversation:gpt-5.4-mini';

          const { text, usage: summaryUsage } = await generateText({
            model: openai('gpt-5.4-mini'),
            system: SUMMARY_SYSTEM_PROMPT,
            prompt: SUMMARY_USER_PROMPT(readableTranscript),
            providerOptions: { openai: { promptCacheKey: summaryCacheKey } },
            experimental_telemetry: {
              isEnabled: true,
              functionId: 'summary-generate',
              metadata: {
                sourceCount: transcript.length,
              },
            },
          });

          if (!text || text.trim().length === 0) {
            throw new Error('LLM returned empty summary');
          }

          logCachePerformance('conversation-summary', summaryUsage);
          return text.trim();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          throw new Error(`Failed to generate summary: ${errorMessage}`);
        }
      }
    );
  }

  private prepareTranscriptForSummary(transcript: StoredMessage[]): string {
    const dialogue = transcript.filter((msg) => msg.role === 'human' || msg.role === 'ai');

    if (dialogue.length === 0) {
      return '';
    }

    return dialogue
      .map((msg) => {
        const speaker = msg.role === 'human' ? 'User' : 'Cosmo';
        return `${speaker}: ${msg.content}`;
      })
      .join('\n');
  }
}

export const summaryService = new SummaryService();

/**
 * Generate AI summary for source content (used in ingestion pipeline).
 *
 * @param content - Raw content (string or array of turns/chunks)
 * @param modelId - AI SDK model ID (default: gpt-5.4-mini)
 * @param userId - Optional user ID for tracing
 * @returns 1-2 sentence summary describing: who, what topics, key themes
 * @throws Error if AI call fails
 */
export async function generateSourceSummary(
  content: string | string[],
  modelId: string = 'gpt-5.4-mini',
  userId?: string
): Promise<string> {
  const sourceCount = Array.isArray(content) ? content.length : 1;

  return withSpan(
    'service.summary.generateSourceSummary',
    buildEntityAttributes('summary', 'create', {
      userId,
      entityCount: sourceCount,
    }),
    async () => {
      const text = Array.isArray(content) ? content.join('\n') : content;

      if (!text || text.trim().length === 0) {
        throw new Error('Cannot generate summary for empty content');
      }

      const summaryCacheKey = `ingestion-summary:${modelId}`;

      const { text: summary, usage: sourceSummaryUsage } = await generateText({
        model: openai(modelId),
        system: INGESTION_SUMMARY_SYSTEM_PROMPT,
        prompt: `Content:
${text}

Summary:`,
        providerOptions: { openai: { promptCacheKey: summaryCacheKey } },
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

      logCachePerformance('source-summary', sourceSummaryUsage);
      const trimmed = summary.trim();

      if (!trimmed) {
        throw new Error('AI generated empty summary');
      }

      return trimmed;
    }
  );
}
