/**
 * Phase 3: Entity Update Service
 *
 * Generates structured update commands for each entity using parallel LLM agents.
 * Uses GPT-4.1-nano for cost-effective entity-specific updates.
 *
 * Update Strategy (MVP): REPLACE
 * - All fields replace existing values
 * - Arrays are bounded (MAX 8-15 items depending on field)
 * - Provenance tracking on all updates
 */

import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { SerializedMessage } from '../agents/types/messages.js';
import type { ResolvedEntity } from './entityResolutionService.js';
import type { Person, Project, Topic, Idea } from '../types/graph.js';

// Update schemas for each entity type (REPLACE strategy)
const PersonUpdateSchema = z.object({
  // Fields that REPLACE existing value
  relationship_type: z.string().optional(),
  current_life_situation: z.string().optional(),
  relationship_status: z.enum(['growing', 'stable', 'fading', 'complicated']).optional(),
  communication_cadence: z.string().optional(),
  how_they_met: z.string().optional(),
  why_they_matter: z.string().optional(),

  // Arrays - REPLACE with bounded arrays
  personality_traits: z.array(z.string()).max(10).optional(),
});

const ProjectUpdateSchema = z.object({
  status: z.enum(['active', 'paused', 'completed', 'abandoned']).optional(),
  domain: z.string().optional(),
  vision: z.string().optional(),
  confidence_level: z.number().min(0).max(1).optional(),
  excitement_level: z.number().min(0).max(1).optional(),
  time_invested: z.string().optional(),
  money_invested: z.number().optional(),

  // Arrays - REPLACE with bounded arrays
  blockers: z.array(z.string()).max(8).optional(),
  key_decisions: z.array(z.string()).max(10).optional(),
});

const TopicUpdateSchema = z.object({
  description: z.string().optional(),
  category: z.enum(['technical', 'personal', 'philosophical', 'professional']).optional(),
});

const IdeaUpdateSchema = z.object({
  status: z.enum(['raw', 'refined', 'abandoned', 'implemented']).optional(),
  original_inspiration: z.string().optional(),
  evolution_notes: z.string().optional(),
  confidence_level: z.number().min(0).max(1).optional(),
  excitement_level: z.number().min(0).max(1).optional(),
  potential_impact: z.string().optional(),
  context_notes: z.string().optional(),

  // Arrays - REPLACE with bounded arrays
  obstacles: z.array(z.string()).max(8).optional(),
  resources_needed: z.array(z.string()).max(10).optional(),
  experiments_tried: z.array(z.string()).max(10).optional(),
  next_steps: z.array(z.string()).max(8).optional(),
});

// Export types
export interface EntityUpdate {
  entityId: string | null; // null = new entity to create
  entityType: 'Person' | 'Project' | 'Topic' | 'Idea';
  entityKey: string;
  isNew: boolean;

  // For new entities, provide the full data
  newEntityData?: {
    name?: string;
    canonical_name?: string;
    summary?: string; // For Ideas
  };

  // Update fields (only changed fields)
  updates: Record<string, unknown>;

  // Provenance
  last_update_source: string; // conversation_id
  confidence: number;
  excerpt_span: string;
}

class EntityUpdateService {
  private model: ChatOpenAI;

  constructor() {
    this.model = new ChatOpenAI({
      modelName: 'gpt-4.1-nano',
    });
  }

  /**
   * Prepare transcript excerpt for entity update
   */
  private prepareTranscript(transcript: SerializedMessage[]): string {
    const dialogue = transcript.filter((msg) => msg.type === 'human' || msg.type === 'ai');

    const formatted = dialogue
      .map((msg, idx) => {
        const speaker = msg.type === 'human' ? 'User' : 'Cosmo';
        const content = msg.content || '';
        return `[Turn ${idx + 1}] ${speaker}: ${content}`;
      })
      .join('\n\n');

    return formatted;
  }

  /**
   * Generate updates for all resolved entities in parallel
   */
  async generateUpdates(
    transcript: SerializedMessage[],
    resolvedEntities: ResolvedEntity[],
    conversationId: string
  ): Promise<EntityUpdate[]> {
    console.log('📝 Generating entity updates...');

    const readableTranscript = this.prepareTranscript(transcript);

    // Process all entities in parallel
    const updates = await Promise.all(
      resolvedEntities.map((resolved) =>
        this.generateSingleUpdate(readableTranscript, resolved, conversationId)
      )
    );

    console.log(`✅ Generated ${updates.length} entity updates`);

    return updates;
  }

  /**
   * Generate update for a single entity
   */
  private async generateSingleUpdate(
    transcript: string,
    resolved: ResolvedEntity,
    conversationId: string
  ): Promise<EntityUpdate> {
    const { candidate, resolvedId, existingData, confidence } = resolved;

    // Dispatch to type-specific update generator
    switch (candidate.type) {
      case 'Person':
        return this.updatePerson(transcript, candidate, resolvedId, existingData as Person | null, confidence, conversationId);
      case 'Project':
        return this.updateProject(transcript, candidate, resolvedId, existingData as Project | null, confidence, conversationId);
      case 'Topic':
        return this.updateTopic(transcript, candidate, resolvedId, existingData as Topic | null, confidence, conversationId);
      case 'Idea':
        return this.updateIdea(transcript, candidate, resolvedId, existingData as Idea | null, confidence, conversationId);
      default:
        throw new Error(`Unknown entity type: ${candidate.type}`);
    }
  }

  /**
   * Update Person entity
   */
  private async updatePerson(
    transcript: string,
    candidate: { mentionedName?: string; contextClue?: string; excerptSpan: string; entityKey: string },
    resolvedId: string | null,
    existingData: Person | null,
    confidence: number,
    conversationId: string
  ): Promise<EntityUpdate> {
    const isNew = resolvedId === null;

    if (isNew) {
      // New person - extract all fields
      const structuredLlm = this.model.withStructuredOutput(PersonUpdateSchema);

      const prompt = `Extract information about this person from the conversation:

Person: ${candidate.mentionedName}
Context: ${candidate.contextClue}

Conversation:
${transcript}

Extract:
- relationship_type: friend, colleague, romantic_interest, family, or other relationship
- how_they_met: Brief description of how they met (if mentioned)
- why_they_matter: Why this person is important to the user
- personality_traits: Array of personality traits (MAX 10, most salient)
- current_life_situation: What's currently happening in their life
- relationship_status: growing, stable, fading, or complicated
- communication_cadence: How often they communicate (e.g., "daily texts", "monthly calls")

Only include fields with NEW information from the conversation.`;

      const updates = await structuredLlm.invoke(prompt);

      return {
        entityId: null,
        entityType: 'Person',
        entityKey: candidate.entityKey,
        isNew: true,
        newEntityData: {
          name: candidate.mentionedName,
          canonical_name: candidate.mentionedName.toLowerCase().trim(),
        },
        updates,
        last_update_source: conversationId,
        confidence,
        excerpt_span: candidate.excerptSpan,
      };
    } else {
      // Existing person - update with REPLACE strategy
      const structuredLlm = this.model.withStructuredOutput(PersonUpdateSchema);

      const existingInfo = `
Current information:
- Name: ${existingData?.name}
- Relationship: ${existingData?.relationship_type || 'unknown'}
- Current situation: ${existingData?.current_life_situation || 'unknown'}
- Why they matter: ${existingData?.why_they_matter || 'unknown'}
- Personality traits: ${existingData?.personality_traits?.join(', ') || 'none'}
- Relationship status: ${existingData?.relationship_status || 'unknown'}
`;

      const prompt = `Update information about this person based on the conversation:

Person: ${candidate.mentionedName}
${existingInfo}

Conversation:
${transcript}

IMPORTANT: Only include fields that have NEW or UPDATED information from this conversation.
- personality_traits: REPLACE existing list (provide complete new list, MAX 10 items)
- Other fields: REPLACE if mentioned

If nothing new is mentioned, return empty object.`;

      const updates = await structuredLlm.invoke(prompt);

      return {
        entityId: resolvedId,
        entityType: 'Person',
        entityKey: candidate.entityKey,
        isNew: false,
        updates,
        last_update_source: conversationId,
        confidence,
        excerpt_span: candidate.excerptSpan,
      };
    }
  }

  /**
   * Update Project entity
   */
  private async updateProject(
    transcript: string,
    candidate: { mentionedName?: string; contextClue?: string; excerptSpan: string; entityKey: string },
    resolvedId: string | null,
    existingData: Project | null,
    confidence: number,
    conversationId: string
  ): Promise<EntityUpdate> {
    const isNew = resolvedId === null;

    const structuredLlm = this.model.withStructuredOutput(ProjectUpdateSchema);

    if (isNew) {
      const prompt = `Extract information about this project from the conversation:

Project: ${candidate.mentionedName}
Context: ${candidate.contextClue}

Conversation:
${transcript}

Extract:
- status: active, paused, completed, or abandoned
- domain: startup, personal, creative, technical, or other
- vision: Core purpose/problem it solves
- blockers: Current obstacles (MAX 8 items)
- key_decisions: Important choices made (MAX 10 items)
- confidence_level: 0-1, belief it will succeed
- excitement_level: 0-1, emotional investment
- time_invested: Freeform estimation
- money_invested: Numeric value if mentioned

Only include fields with information from the conversation.`;

      const updates = await structuredLlm.invoke(prompt);

      return {
        entityId: null,
        entityType: 'Project',
        entityKey: candidate.entityKey,
        isNew: true,
        newEntityData: {
          name: candidate.mentionedName,
          canonical_name: candidate.mentionedName.toLowerCase().trim(),
        },
        updates,
        last_update_source: conversationId,
        confidence,
        excerpt_span: candidate.excerptSpan,
      };
    } else {
      const existingInfo = `
Current information:
- Name: ${existingData?.name}
- Status: ${existingData?.status}
- Vision: ${existingData?.vision || 'unknown'}
- Blockers: ${existingData?.blockers?.join(', ') || 'none'}
- Confidence: ${existingData?.confidence_level || 'unknown'}
- Excitement: ${existingData?.excitement_level || 'unknown'}
`;

      const prompt = `Update information about this project:

Project: ${candidate.mentionedName}
${existingInfo}

Conversation:
${transcript}

IMPORTANT: Only include fields with NEW or UPDATED information.
- blockers, key_decisions: REPLACE existing lists (provide complete new lists)
- Other fields: REPLACE if mentioned`;

      const updates = await structuredLlm.invoke(prompt);

      return {
        entityId: resolvedId,
        entityType: 'Project',
        entityKey: candidate.entityKey,
        isNew: false,
        updates,
        last_update_source: conversationId,
        confidence,
        excerpt_span: candidate.excerptSpan,
      };
    }
  }

  /**
   * Update Topic entity
   */
  private async updateTopic(
    transcript: string,
    candidate: { mentionedName?: string; category?: string; excerptSpan: string; entityKey: string },
    resolvedId: string | null,
    existingData: Topic | null,
    confidence: number,
    conversationId: string
  ): Promise<EntityUpdate> {
    const isNew = resolvedId === null;

    const structuredLlm = this.model.withStructuredOutput(TopicUpdateSchema);

    if (isNew) {
      const prompt = `Extract information about this topic from the conversation:

Topic: ${candidate.mentionedName}
Category: ${candidate.category}

Conversation:
${transcript}

Extract:
- description: Brief description of the topic
- category: technical, personal, philosophical, or professional

Only include fields with information from the conversation.`;

      const updates = await structuredLlm.invoke(prompt);

      return {
        entityId: null,
        entityType: 'Topic',
        entityKey: candidate.entityKey,
        isNew: true,
        newEntityData: {
          name: candidate.mentionedName,
          canonical_name: candidate.mentionedName.toLowerCase().trim(),
        },
        updates,
        last_update_source: conversationId,
        confidence,
        excerpt_span: candidate.excerptSpan,
      };
    } else {
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

      const updates = await structuredLlm.invoke(prompt);

      return {
        entityId: resolvedId,
        entityType: 'Topic',
        entityKey: candidate.entityKey,
        isNew: false,
        updates,
        last_update_source: conversationId,
        confidence,
        excerpt_span: candidate.excerptSpan,
      };
    }
  }

  /**
   * Update Idea entity
   */
  private async updateIdea(
    transcript: string,
    candidate: { summary?: string; excerptSpan: string; entityKey: string },
    resolvedId: string | null,
    existingData: Idea | null,
    confidence: number,
    conversationId: string
  ): Promise<EntityUpdate> {
    const isNew = resolvedId === null;

    const structuredLlm = this.model.withStructuredOutput(IdeaUpdateSchema);

    if (isNew) {
      const prompt = `Extract information about this idea from the conversation:

Idea: ${candidate.summary}

Conversation:
${transcript}

Extract:
- status: raw, refined, abandoned, or implemented
- original_inspiration: What sparked this idea
- evolution_notes: How it's changed over time
- obstacles: Current obstacles (MAX 8 items)
- resources_needed: What's needed to pursue (MAX 10 items)
- experiments_tried: What's been tried so far (MAX 10 items)
- confidence_level: 0-1, belief it will work
- excitement_level: 0-1, emotional pull
- potential_impact: Description of potential impact
- next_steps: Actionable next steps (MAX 8 items)
- context_notes: Additional context

Only include fields with information from the conversation.`;

      const updates = await structuredLlm.invoke(prompt);

      return {
        entityId: null,
        entityType: 'Idea',
        entityKey: candidate.entityKey,
        isNew: true,
        newEntityData: {
          summary: candidate.summary,
        },
        updates,
        last_update_source: conversationId,
        confidence,
        excerpt_span: candidate.excerptSpan,
      };
    } else {
      const existingInfo = `
Current information:
- Summary: ${existingData?.summary}
- Status: ${existingData?.status}
- Obstacles: ${existingData?.obstacles?.join(', ') || 'none'}
- Next steps: ${existingData?.next_steps?.join(', ') || 'none'}
`;

      const prompt = `Update information about this idea:

Idea: ${candidate.summary}
${existingInfo}

Conversation:
${transcript}

IMPORTANT: Only include fields with NEW or UPDATED information.
- Arrays: REPLACE existing lists (provide complete new lists)
- Other fields: REPLACE if mentioned`;

      const updates = await structuredLlm.invoke(prompt);

      return {
        entityId: resolvedId,
        entityType: 'Idea',
        entityKey: candidate.entityKey,
        isNew: false,
        updates,
        last_update_source: conversationId,
        confidence,
        excerpt_span: candidate.excerptSpan,
      };
    }
  }
}

export const entityUpdateService = new EntityUpdateService();
