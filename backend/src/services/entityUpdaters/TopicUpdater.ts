/**
 * Topic Entity Updater
 *
 * Handles extraction and updates for Topic entities.
 * Topics have minimal user-specific properties (only temporal tracking on INTERESTED_IN relationship).
 */

import { z } from 'zod';
import { BaseEntityUpdater, type UpdateContext } from './BaseEntityUpdater.js';
import type { EntityUpdate } from '../entityUpdateService.js';
import type { Topic } from '../../types/graph.js';

const TopicUpdateSchema = z.object({
  description: z.string().default(''),
  category: z.enum(['technical', 'personal', 'philosophical', 'professional', '']).default(''),
});

export class TopicUpdater extends BaseEntityUpdater {
  getEntityType(): 'Topic' {
    return 'Topic';
  }

  async update(context: UpdateContext): Promise<EntityUpdate> {
    const { transcript, candidate, resolvedId, existingData, confidence, conversationId } = context;
    const isNew = resolvedId === null;

    if (isNew) {
      return this.createNewTopic(transcript, candidate, confidence, conversationId);
    } else {
      return this.updateExistingTopic(
        transcript,
        candidate,
        resolvedId,
        existingData as Topic | null,
        confidence,
        conversationId
      );
    }
  }

  /**
   * Create a new Topic entity
   */
  private async createNewTopic(
    transcript: string,
    candidate: { mentionedName?: string; category?: string; entityKey: string },
    confidence: number,
    conversationId: string
  ): Promise<EntityUpdate> {
    const prompt = `Extract information about this topic from the conversation:

Topic: ${candidate.mentionedName}
Category: ${candidate.category}

Conversation:
${transcript}

Extract:
- description: Brief description of the topic
- category: technical, personal, philosophical, or professional

Only include fields with information from the conversation.`;

    const nodeUpdates = await this.invokeStructured(TopicUpdateSchema, prompt);

    // Defensive: handle missing mentionedName
    const entityName = candidate.mentionedName ? candidate.mentionedName : 'Unknown';
    const canonicalName = candidate.mentionedName ? candidate.mentionedName.toLowerCase().trim() : 'unknown';

    return this.buildNewEntityUpdate(
      'Topic',
      candidate.entityKey,
      {
        name: entityName,
        canonical_name: canonicalName,
      },
      nodeUpdates as Record<string, unknown>,
      {}, // No relationship properties - temporal tracking handled by repository
      conversationId,
      confidence
    );
  }

  /**
   * Update an existing Topic entity
   */
  private async updateExistingTopic(
    transcript: string,
    candidate: { mentionedName?: string; category?: string; entityKey: string },
    resolvedId: string,
    existingData: Topic | null,
    confidence: number,
    conversationId: string
  ): Promise<EntityUpdate> {
    const existingInfo = `
Current information:
- Name: ${existingData?.name}
- Description: ${existingData?.description}
- Category: ${existingData?.category}
`;

    const prompt = `Update information about this topic:

Topic: ${candidate.mentionedName}
${existingInfo}

Conversation:
${transcript}

IMPORTANT: Only include fields with NEW or UPDATED information.`;

    const nodeUpdates = await this.invokeStructured(TopicUpdateSchema, prompt);

    return this.buildExistingEntityUpdate(
      'Topic',
      resolvedId,
      candidate.entityKey,
      nodeUpdates as Record<string, unknown>,
      {}, // No relationship properties - temporal tracking handled by repository
      conversationId,
      confidence
    );
  }
}
