/**
 * Summary generation service for conversations.
 *
 * Uses GPT-4o-mini to generate brief, factual summaries of conversations
 * for display in the iOS archive view.
 */

import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { SerializedMessage } from '../agents/types/messages.js';
import { SUMMARY_SYSTEM_PROMPT, SUMMARY_USER_PROMPT } from '../agents/prompts/summary.js';

export class SummaryService {
  private model: ChatOpenAI;

  constructor() {
    // Use GPT-4.1-mini for cost-effective summarization
    this.model = new ChatOpenAI({
      modelName: 'gpt-4.1-mini',
    });
  }

  /**
   * Generate a brief summary of a conversation.
   *
   * @param transcript - Full conversation transcript as SerializedMessage[]
   * @returns Promise<string> - 1-2 sentence summary
   * @throws Error if transcript is empty or generation fails
   */
  async generateConversationSummary(transcript: SerializedMessage[]): Promise<string> {
    if (!transcript || transcript.length === 0) {
      throw new Error('Cannot generate summary: transcript is empty');
    }

    // Preprocess transcript to extract readable dialogue
    const readableTranscript = this.prepareTranscriptForSummary(transcript);

    if (!readableTranscript) {
      throw new Error('Cannot generate summary: no dialogue found in transcript');
    }

    // Call LLM with summary prompts
    const messages = [
      new SystemMessage(SUMMARY_SYSTEM_PROMPT),
      new HumanMessage(SUMMARY_USER_PROMPT(readableTranscript)),
    ];

    try {
      const response = await this.model.invoke(messages);

      // Extract text content from response
      const summary = typeof response.content === 'string' ? response.content : '';

      if (!summary || summary.trim().length === 0) {
        throw new Error('LLM returned empty summary');
      }

      return summary.trim();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to generate summary: ${errorMessage}`);
    }
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
  private prepareTranscriptForSummary(transcript: SerializedMessage[]): string {
    // Filter to only human (user) and AI (assistant) messages
    const dialogue = transcript.filter((msg) => msg.type === 'human' || msg.type === 'ai');

    if (dialogue.length === 0) {
      return '';
    }

    // Convert to readable format: "User: ...\nCosmo: ..."
    const formatted = dialogue
      .map((msg) => {
        const speaker = msg.type === 'human' ? 'User' : 'Cosmo';
        const content = msg.content || '';
        return `${speaker}: ${content}`;
      })
      .join('\n');

    return formatted;
  }
}

export const summaryService = new SummaryService();
