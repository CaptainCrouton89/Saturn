/**
 * Person Entity Updater
 *
 * Handles extraction and updates for Person entities.
 * Splits between intrinsic properties (node) and user-specific (KNOWS relationship).
 */

import { z } from 'zod';
import { BaseEntityUpdater, type UpdateContext } from './BaseEntityUpdater.js';
import type { EntityUpdate } from '../entityUpdateService.js';
import type { Person } from '../../types/graph.js';

// Person schemas: Split between intrinsic (node) and user-specific (KNOWS relationship)
const PersonNodeUpdateSchema = z.object({
  // Intrinsic properties - written to Person node
  personality_traits: z.array(z.string()).max(10).default([]),
  current_life_situation: z.string().default(''),
});

const PersonRelationshipUpdateSchema = z.object({
  // User-specific properties - written to KNOWS relationship
  relationship_type: z.string().default(''),
  how_they_met: z.string().default(''),
  why_they_matter: z.string().default(''),
  relationship_status: z.enum(['growing', 'stable', 'fading', 'complicated', '']).default(''),
  communication_cadence: z.string().default(''),
});

export class PersonUpdater extends BaseEntityUpdater {
  getEntityType(): 'Person' {
    return 'Person';
  }

  async update(context: UpdateContext): Promise<EntityUpdate> {
    const { transcript, candidate, resolvedId, existingData, confidence, conversationId } = context;
    const isNew = resolvedId === null;

    if (isNew) {
      return this.createNewPerson(transcript, candidate, confidence, conversationId);
    } else {
      return this.updateExistingPerson(
        transcript,
        candidate,
        resolvedId,
        existingData as Person | null,
        confidence,
        conversationId
      );
    }
  }

  /**
   * Create a new Person entity
   */
  private async createNewPerson(
    transcript: string,
    candidate: { mentionedName?: string; contextClue?: string; entityKey: string },
    confidence: number,
    conversationId: string
  ): Promise<EntityUpdate> {
    const nodePrompt = `Extract INTRINSIC information about this person from the conversation (facts about the person themselves):

Person: ${candidate.mentionedName}
Context: ${candidate.contextClue}

Conversation:
${transcript}

Extract:
- personality_traits: Array of personality traits (MAX 10, most salient)
- current_life_situation: What's currently happening in their life

Only include fields with information from the conversation.`;

    const relPrompt = `Extract USER-SPECIFIC information about this person from the conversation (the user's relationship with them):

Person: ${candidate.mentionedName}
Context: ${candidate.contextClue}

Conversation:
${transcript}

Extract:
- relationship_type: friend, colleague, romantic_interest, family, or other relationship
- how_they_met: Brief description of how they met (if mentioned)
- why_they_matter: Why this person is important to the user
- relationship_status: growing, stable, fading, or complicated
- communication_cadence: How often they communicate (e.g., "daily texts", "monthly calls")

Only include fields with NEW information from the conversation.`;

    const [nodeUpdates, relationshipUpdates] = await this.invokeDualStructured(
      PersonNodeUpdateSchema,
      PersonRelationshipUpdateSchema,
      nodePrompt,
      relPrompt
    );

    // Defensive: handle missing mentionedName (shouldn't happen but safeguard)
    const entityName = candidate.mentionedName ? candidate.mentionedName : 'Unknown';
    const canonicalName = candidate.mentionedName ? candidate.mentionedName.toLowerCase().trim() : 'unknown';

    return this.buildNewEntityUpdate(
      'Person',
      candidate.entityKey,
      {
        name: entityName,
        canonical_name: canonicalName,
      },
      nodeUpdates as Record<string, unknown>,
      relationshipUpdates as Record<string, unknown>,
      conversationId,
      confidence
    );
  }

  /**
   * Update an existing Person entity
   */
  private async updateExistingPerson(
    transcript: string,
    candidate: { mentionedName?: string; contextClue?: string; entityKey: string },
    resolvedId: string,
    existingData: Person | null,
    confidence: number,
    conversationId: string
  ): Promise<EntityUpdate> {
    // Format existing data for LLM prompt (explicit handling for missing data)
    const personalityTraits = existingData?.personality_traits?.length
      ? existingData.personality_traits.join(', ')
      : 'none';
    const currentSituation = existingData?.current_life_situation ? existingData.current_life_situation : 'unknown';

    const existingInfo = `
Current information:
- Name: ${existingData?.name}
- Personality traits: ${personalityTraits}
- Current situation: ${currentSituation}
`;

    const nodePrompt = `Update INTRINSIC information about this person (facts about the person themselves):

Person: ${candidate.mentionedName}
${existingInfo}

Conversation:
${transcript}

IMPORTANT: Only include fields that have NEW or UPDATED information from this conversation.
- personality_traits: REPLACE existing list (provide complete new list, MAX 10 items)
- current_life_situation: REPLACE if mentioned

If nothing new is mentioned, return empty object.`;

    const relPrompt = `Update USER-SPECIFIC information about the user's relationship with this person:

Person: ${candidate.mentionedName}

Conversation:
${transcript}

IMPORTANT: Only include fields that have NEW or UPDATED information from this conversation.
- relationship_type, relationship_status, communication_cadence, how_they_met, why_they_matter

If nothing new is mentioned, return empty object.`;

    const [nodeUpdates, relationshipUpdates] = await this.invokeDualStructured(
      PersonNodeUpdateSchema,
      PersonRelationshipUpdateSchema,
      nodePrompt,
      relPrompt
    );

    return this.buildExistingEntityUpdate(
      'Person',
      resolvedId,
      candidate.entityKey,
      nodeUpdates as Record<string, unknown>,
      relationshipUpdates as Record<string, unknown>,
      conversationId,
      confidence
    );
  }
}
