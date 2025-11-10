/**
 * Idea Entity Updater
 *
 * Handles extraction and updates for Idea entities.
 * Splits between intrinsic properties (node) and user-specific (EXPLORING relationship).
 */

import { z } from 'zod';
import { BaseEntityUpdater, type UpdateContext } from './BaseEntityUpdater.js';
import type { EntityUpdate } from '../entityUpdateService.js';
import type { Idea } from '../../types/graph.js';

// Idea schemas: Split between intrinsic (node) and user-specific (EXPLORING relationship)
const IdeaNodeUpdateSchema = z.object({
  // Intrinsic properties - written to Idea node
  original_inspiration: z.string().default(''),
  evolution_notes: z.string().default(''),
  context_notes: z.string().default(''),
  obstacles: z.array(z.string()).max(8).default([]),
  resources_needed: z.array(z.string()).max(10).default([]),
  experiments_tried: z.array(z.string()).max(10).default([]),
});

const IdeaRelationshipUpdateSchema = z.object({
  // User-specific properties - written to EXPLORING relationship
  status: z.enum(['raw', 'refined', 'abandoned', 'implemented', '']).default(''),
  confidence_level: z.number().min(0).max(1).default(-1),
  excitement_level: z.number().min(0).max(1).default(-1),
  potential_impact: z.string().default(''),
  next_steps: z.array(z.string()).max(8).default([]),
});

export class IdeaUpdater extends BaseEntityUpdater {
  getEntityType(): 'Idea' {
    return 'Idea';
  }

  async update(context: UpdateContext): Promise<EntityUpdate> {
    const { transcript, candidate, resolvedId, existingData, confidence, conversationId } = context;
    const isNew = resolvedId === null;

    if (isNew) {
      return this.createNewIdea(transcript, candidate, confidence, conversationId);
    } else {
      return this.updateExistingIdea(
        transcript,
        candidate,
        resolvedId,
        existingData as Idea | null,
        confidence,
        conversationId
      );
    }
  }

  /**
   * Create a new Idea entity
   */
  private async createNewIdea(
    transcript: string,
    candidate: { summary?: string; entityKey: string },
    confidence: number,
    conversationId: string
  ): Promise<EntityUpdate> {
    const nodePrompt = `Extract INTRINSIC information about this idea from the conversation (facts about the idea itself):

Idea: ${candidate.summary}

Conversation:
${transcript}

Extract:
- original_inspiration: What sparked this idea
- evolution_notes: How it's changed over time
- obstacles: Challenges to the idea itself (MAX 8 items)
- resources_needed: What the idea requires to pursue (MAX 10 items)
- experiments_tried: What's been tested so far (MAX 10 items)
- context_notes: Additional context and connections

Only include fields with information from the conversation.`;

    const relPrompt = `Extract USER-SPECIFIC information about this idea from the conversation (the user's relationship with the idea):

Idea: ${candidate.summary}

Conversation:
${transcript}

Extract:
- status: raw, refined, abandoned, or implemented
- confidence_level: 0-1, user's belief it will work
- excitement_level: 0-1, user's emotional pull
- potential_impact: Description of potential impact on the user
- next_steps: User's actionable next steps (MAX 8 items)

Only include fields with information from the conversation.`;

    const [nodeUpdates, relationshipUpdates] = await this.invokeDualStructured(
      IdeaNodeUpdateSchema,
      IdeaRelationshipUpdateSchema,
      nodePrompt,
      relPrompt
    );

    return this.buildNewEntityUpdate(
      'Idea',
      candidate.entityKey,
      {
        summary: candidate.summary,
      },
      nodeUpdates as Record<string, unknown>,
      relationshipUpdates as Record<string, unknown>,
      conversationId,
      confidence
    );
  }

  /**
   * Update an existing Idea entity
   */
  private async updateExistingIdea(
    transcript: string,
    candidate: { summary?: string; entityKey: string },
    resolvedId: string,
    existingData: Idea | null,
    confidence: number,
    conversationId: string
  ): Promise<EntityUpdate> {
    // Format existing data for LLM prompt
    const obstaclesStr =
      existingData?.obstacles && existingData.obstacles.length > 0
        ? existingData.obstacles.join(', ')
        : 'none';
    const resourcesStr =
      existingData?.resources_needed && existingData.resources_needed.length > 0
        ? existingData.resources_needed.join(', ')
        : 'none';
    const experimentsStr =
      existingData?.experiments_tried && existingData.experiments_tried.length > 0
        ? existingData.experiments_tried.join(', ')
        : 'none';

    const existingNodeInfo = `
Current intrinsic information:
- Summary: ${existingData?.summary}
- Obstacles: ${obstaclesStr}
- Resources needed: ${resourcesStr}
- Experiments tried: ${experimentsStr}
`;

    const nodePrompt = `Update INTRINSIC information about this idea (facts about the idea itself):

Idea: ${candidate.summary}
${existingNodeInfo}

Conversation:
${transcript}

IMPORTANT: Only include fields with NEW or UPDATED information.
- Arrays (obstacles, resources_needed, experiments_tried): REPLACE existing lists (provide complete new lists)
- Other fields: REPLACE if mentioned

If nothing new is mentioned, return empty object.`;

    const relPrompt = `Update USER-SPECIFIC information about the user's relationship with this idea:

Idea: ${candidate.summary}

Conversation:
${transcript}

IMPORTANT: Only include fields with NEW or UPDATED information.
- next_steps: REPLACE existing list (provide complete new list, MAX 8 items)
- status, confidence_level, excitement_level, potential_impact: REPLACE if mentioned

If nothing new is mentioned, return empty object.`;

    const [nodeUpdates, relationshipUpdates] = await this.invokeDualStructured(
      IdeaNodeUpdateSchema,
      IdeaRelationshipUpdateSchema,
      nodePrompt,
      relPrompt
    );

    return this.buildExistingEntityUpdate(
      'Idea',
      resolvedId,
      candidate.entityKey,
      nodeUpdates as Record<string, unknown>,
      relationshipUpdates as Record<string, unknown>,
      conversationId,
      confidence
    );
  }
}
