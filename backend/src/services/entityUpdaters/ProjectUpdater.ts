/**
 * Project Entity Updater
 *
 * Handles extraction and updates for Project entities.
 * Splits between intrinsic properties (node) and user-specific (WORKING_ON relationship).
 */

import { z } from 'zod';
import { BaseEntityUpdater, type UpdateContext } from './BaseEntityUpdater.js';
import type { EntityUpdate } from '../entityUpdateService.js';
import type { Project } from '../../types/graph.js';

// Project schemas: Split between intrinsic (node) and user-specific (WORKING_ON relationship)
const ProjectNodeUpdateSchema = z.object({
  // Intrinsic properties - written to Project node
  domain: z.string().default(''),
  vision: z.string().default(''),
  key_decisions: z.array(z.string()).max(10).default([]),
});

const ProjectRelationshipUpdateSchema = z.object({
  // User-specific properties - written to WORKING_ON relationship
  status: z.enum(['active', 'paused', 'completed', 'abandoned', '']).default(''),
  confidence_level: z.number().min(0).max(1).default(-1),
  excitement_level: z.number().min(0).max(1).default(-1),
  time_invested: z.string().default(''),
  money_invested: z.number().default(-1),
  blockers: z.array(z.string()).max(8).default([]),
});

export class ProjectUpdater extends BaseEntityUpdater {
  getEntityType(): 'Project' {
    return 'Project';
  }

  async update(context: UpdateContext): Promise<EntityUpdate> {
    const { transcript, candidate, resolvedId, existingData, confidence, conversationId } = context;
    const isNew = resolvedId === null;

    if (isNew) {
      return this.createNewProject(transcript, candidate, confidence, conversationId);
    } else {
      return this.updateExistingProject(
        transcript,
        candidate,
        resolvedId,
        existingData as Project | null,
        confidence,
        conversationId
      );
    }
  }

  /**
   * Create a new Project entity
   */
  private async createNewProject(
    transcript: string,
    candidate: { mentionedName?: string; contextClue?: string; entityKey: string },
    confidence: number,
    conversationId: string
  ): Promise<EntityUpdate> {
    const nodePrompt = `Extract INTRINSIC information about this project from the conversation (facts about the project itself):

Project: ${candidate.mentionedName}
Context: ${candidate.contextClue}

Conversation:
${transcript}

Extract:
- domain: startup, personal, creative, technical, or other
- vision: Core purpose/problem it solves
- key_decisions: Important choices made about the project (MAX 10 items)

Only include fields with information from the conversation.`;

    const relPrompt = `Extract USER-SPECIFIC information about this project from the conversation (the user's relationship with the project):

Project: ${candidate.mentionedName}
Context: ${candidate.contextClue}

Conversation:
${transcript}

Extract:
- status: active, paused, completed, or abandoned
- blockers: Current obstacles the user faces (MAX 8 items)
- confidence_level: 0-1, user's belief it will succeed
- excitement_level: 0-1, user's emotional investment
- time_invested: Freeform estimation of user's time invested
- money_invested: Numeric value if user mentioned money invested

Only include fields with information from the conversation.`;

    const [nodeUpdates, relationshipUpdates] = await this.invokeDualStructured(
      ProjectNodeUpdateSchema,
      ProjectRelationshipUpdateSchema,
      nodePrompt,
      relPrompt
    );

    // Defensive: handle missing mentionedName
    const entityName = candidate.mentionedName ? candidate.mentionedName : 'Unknown';
    const canonicalName = candidate.mentionedName ? candidate.mentionedName.toLowerCase().trim() : 'unknown';

    return this.buildNewEntityUpdate(
      'Project',
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
   * Update an existing Project entity
   */
  private async updateExistingProject(
    transcript: string,
    candidate: { mentionedName?: string; contextClue?: string; entityKey: string },
    resolvedId: string,
    existingData: Project | null,
    confidence: number,
    conversationId: string
  ): Promise<EntityUpdate> {
    // Format existing data for LLM prompt
    const vision = existingData?.vision ? existingData.vision : 'unknown';
    const keyDecisions = existingData?.key_decisions?.length
      ? existingData.key_decisions.join(', ')
      : 'none';

    const existingInfo = `
Current information:
- Name: ${existingData?.name}
- Vision: ${vision}
- Key decisions: ${keyDecisions}
`;

    const nodePrompt = `Update INTRINSIC information about this project (facts about the project itself):

Project: ${candidate.mentionedName}
${existingInfo}

Conversation:
${transcript}

IMPORTANT: Only include fields with NEW or UPDATED information.
- key_decisions: REPLACE existing list (provide complete new list, MAX 10 items)
- vision, domain: REPLACE if mentioned

If nothing new is mentioned, return empty object.`;

    const relPrompt = `Update USER-SPECIFIC information about the user's relationship with this project:

Project: ${candidate.mentionedName}

Conversation:
${transcript}

IMPORTANT: Only include fields with NEW or UPDATED information.
- blockers: REPLACE existing list (provide complete new list, MAX 8 items)
- status, confidence_level, excitement_level, time_invested, money_invested: REPLACE if mentioned

If nothing new is mentioned, return empty object.`;

    const [nodeUpdates, relationshipUpdates] = await this.invokeDualStructured(
      ProjectNodeUpdateSchema,
      ProjectRelationshipUpdateSchema,
      nodePrompt,
      relPrompt
    );

    return this.buildExistingEntityUpdate(
      'Project',
      resolvedId,
      candidate.entityKey,
      nodeUpdates as Record<string, unknown>,
      relationshipUpdates as Record<string, unknown>,
      conversationId,
      confidence
    );
  }
}
