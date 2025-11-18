/**
 * Summary generation service for conversations.
 *
 * Uses GPT-4.1-mini to generate brief, factual summaries of conversations
 * for display in the iOS archive view.
 */

import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { StoredMessage } from '../agents/types/messages.js';
import { SUMMARY_SYSTEM_PROMPT, SUMMARY_USER_PROMPT } from '../agents/prompts/summary.js';
import { withSpan, buildEntityAttributes } from '../utils/tracing.js';

export class SummaryService {
  constructor() {
    // Service uses AI SDK directly, no model instance needed
  }

  /**
   * Generate a brief summary of a conversation.
   *
   * @param transcript - Full conversation transcript as StoredMessage[]
   * @returns Promise<string> - 1-2 sentence summary
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
        // Preprocess transcript to extract readable dialogue
        const readableTranscript = this.prepareTranscriptForSummary(transcript);

        if (!readableTranscript) {
          throw new Error('Cannot generate summary: no dialogue found in transcript');
        }

        try {
          // Use AI SDK generateText with system prompt and user prompt
          const { text } = await generateText({
            model: openai('gpt-4.1-mini'),
            system: SUMMARY_SYSTEM_PROMPT,
            prompt: SUMMARY_USER_PROMPT(readableTranscript),
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

          return text.trim();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          throw new Error(`Failed to generate summary: ${errorMessage}`);
        }
      }
    );
  }

  /**
   * Prepare transcript for summarization by extracting only user/assistant dialogue.
   *
   * Filters out:
   * - System messages (prompts, internal state)
   * - Tool call messages (function invocations)
   * - Tool result messages (function outputs)
   *
   * @param transcript - Full conversation transcript
   * @returns Formatted dialogue string
   * @private
   */
  private prepareTranscriptForSummary(transcript: StoredMessage[]): string {
    // Filter to only human (user) and AI (assistant) messages
    const dialogue = transcript.filter((msg) => msg.role === 'human' || msg.role === 'ai');

    if (dialogue.length === 0) {
      return '';
    }

    // Convert to readable format: "User: ...\nCosmo: ..."
    const formatted = dialogue
      .map((msg) => {
        const speaker = msg.role === 'human' ? 'User' : 'Cosmo';
        const content = msg.content;
        return `${speaker}: ${content}`;
      })
      .join('\n');

    return formatted;
  }
}

export const summaryService = new SummaryService();
