/**
 * Phase 3: Entity Update Service
 *
 * Orchestrates entity update generation by delegating to specialized updaters.
 * Each entity type (Person, Project, Topic, Idea) has its own updater implementation.
 *
 * Update Strategy (MVP): REPLACE
 * - All fields replace existing values
 * - Arrays are bounded (MAX 8-15 items depending on field)
 * - Provenance tracking on all updates
 */

import type { SerializedMessage } from '../agents/types/messages.js';
import type { ResolvedEntity } from './entityResolutionService.js';
import { PersonUpdater, ProjectUpdater, TopicUpdater, IdeaUpdater } from './entityUpdaters/index.js';
import type { UpdateContext } from './entityUpdaters/BaseEntityUpdater.js';

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
  // Split into node updates (intrinsic properties) and relationship updates (user-specific)
  nodeUpdates: Record<string, unknown>; // Properties written to the entity node
  relationshipUpdates: Record<string, unknown>; // Properties written to User->Entity relationship

  // Provenance
  last_update_source: string; // conversation_id
  confidence: number;
}

class EntityUpdateService {
  private model: ChatOpenAI;

  constructor() {
    this.model = new ChatOpenAI({
      modelName: 'gpt-4.1-nano',
    });
  }

  /**
   * Filter out empty values from LLM structured output
   * Remove: empty strings, empty arrays, -1 numbers (sentinel values)
   */
  private filterEmptyValues(obj: Record<string, unknown>): Record<string, unknown> {
    const filtered: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Skip empty strings
      if (value === '' || value === null || value === undefined) {
        continue;
      }

      // Skip empty arrays
      if (Array.isArray(value) && value.length === 0) {
        continue;
      }

      // Skip -1 sentinel values for numbers
      if (typeof value === 'number' && value === -1) {
        continue;
      }

      filtered[key] = value;
    }

    return filtered;
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
   * Split between intrinsic properties (node) and user-specific (KNOWS relationship)
   */
  private async updatePerson(
    transcript: string,
    candidate: { mentionedName?: string; contextClue?: string; entityKey: string },
    resolvedId: string | null,
    existingData: Person | null,
    confidence: number,
    conversationId: string
  ): Promise<EntityUpdate> {
    const isNew = resolvedId === null;

    if (isNew) {
      // New person - extract both intrinsic and user-specific fields
      const nodeStructuredLlm = this.model.withStructuredOutput(PersonNodeUpdateSchema);
      const relStructuredLlm = this.model.withStructuredOutput(PersonRelationshipUpdateSchema);

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

      const [nodeUpdates, relationshipUpdates] = await Promise.all([
        nodeStructuredLlm.invoke(nodePrompt),
        relStructuredLlm.invoke(relPrompt),
      ]);

      return {
        entityId: null,
        entityType: 'Person',
        entityKey: candidate.entityKey,
        isNew: true,
        newEntityData: {
          name: candidate.mentionedName ?? 'Unknown',
          canonical_name: (candidate.mentionedName ?? 'unknown').toLowerCase().trim(),
        },
        nodeUpdates: this.filterEmptyValues(nodeUpdates as Record<string, unknown>),
        relationshipUpdates: this.filterEmptyValues(relationshipUpdates as Record<string, unknown>),
        last_update_source: conversationId,
        confidence,
      };
    } else {
      // Existing person - update with REPLACE strategy
      const nodeStructuredLlm = this.model.withStructuredOutput(PersonNodeUpdateSchema);
      const relStructuredLlm = this.model.withStructuredOutput(PersonRelationshipUpdateSchema);

      const existingInfo = `
Current information:
- Name: ${existingData?.name}
- Personality traits: ${existingData?.personality_traits?.join(', ') || 'none'}
- Current situation: ${existingData?.current_life_situation || 'unknown'}
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

      const [nodeUpdates, relationshipUpdates] = await Promise.all([
        nodeStructuredLlm.invoke(nodePrompt),
        relStructuredLlm.invoke(relPrompt),
      ]);

      return {
        entityId: resolvedId,
        entityType: 'Person',
        entityKey: candidate.entityKey,
        isNew: false,
        nodeUpdates: this.filterEmptyValues(nodeUpdates as Record<string, unknown>),
        relationshipUpdates: this.filterEmptyValues(relationshipUpdates as Record<string, unknown>),
        last_update_source: conversationId,
        confidence,
      };
    }
  }

  /**
   * Update Project entity
   * Split between intrinsic properties (node) and user-specific (WORKING_ON relationship)
   */
  private async updateProject(
    transcript: string,
    candidate: { mentionedName?: string; contextClue?: string; entityKey: string },
    resolvedId: string | null,
    existingData: Project | null,
    confidence: number,
    conversationId: string
  ): Promise<EntityUpdate> {
    const isNew = resolvedId === null;

    if (isNew) {
      const nodeStructuredLlm = this.model.withStructuredOutput(ProjectNodeUpdateSchema);
      const relStructuredLlm = this.model.withStructuredOutput(ProjectRelationshipUpdateSchema);

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

      const [nodeUpdates, relationshipUpdates] = await Promise.all([
        nodeStructuredLlm.invoke(nodePrompt),
        relStructuredLlm.invoke(relPrompt),
      ]);

      return {
        entityId: null,
        entityType: 'Project',
        entityKey: candidate.entityKey,
        isNew: true,
        newEntityData: {
          name: candidate.mentionedName ?? 'Unknown',
          canonical_name: (candidate.mentionedName ?? 'unknown').toLowerCase().trim(),
        },
        nodeUpdates: this.filterEmptyValues(nodeUpdates as Record<string, unknown>),
        relationshipUpdates: this.filterEmptyValues(relationshipUpdates as Record<string, unknown>),
        last_update_source: conversationId,
        confidence,
      };
    } else {
      const nodeStructuredLlm = this.model.withStructuredOutput(ProjectNodeUpdateSchema);
      const relStructuredLlm = this.model.withStructuredOutput(ProjectRelationshipUpdateSchema);

      const existingInfo = `
Current information:
- Name: ${existingData?.name}
- Vision: ${existingData?.vision ?? 'unknown'}
- Key decisions: ${existingData?.key_decisions?.join(', ') ?? 'none'}
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

      const [nodeUpdates, relationshipUpdates] = await Promise.all([
        nodeStructuredLlm.invoke(nodePrompt),
        relStructuredLlm.invoke(relPrompt),
      ]);

      return {
        entityId: resolvedId,
        entityType: 'Project',
        entityKey: candidate.entityKey,
        isNew: false,
        nodeUpdates: this.filterEmptyValues(nodeUpdates as Record<string, unknown>),
        relationshipUpdates: this.filterEmptyValues(relationshipUpdates as Record<string, unknown>),
        last_update_source: conversationId,
        confidence,
      };
    }
  }

  /**
   * Update Topic entity
   * Topics have minimal user-specific properties (only temporal tracking on INTERESTED_IN relationship)
   */
  private async updateTopic(
    transcript: string,
    candidate: { mentionedName?: string; category?: string; entityKey: string },
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

      const nodeUpdates = await structuredLlm.invoke(prompt);

      return {
        entityId: null,
        entityType: 'Topic',
        entityKey: candidate.entityKey,
        isNew: true,
        newEntityData: {
          name: candidate.mentionedName ?? 'Unknown',
          canonical_name: (candidate.mentionedName ?? 'unknown').toLowerCase().trim(),
        },
        nodeUpdates: this.filterEmptyValues(nodeUpdates as Record<string, unknown>),
        relationshipUpdates: {}, // Temporal tracking handled by repository
        last_update_source: conversationId,
        confidence,
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

      const nodeUpdates = await structuredLlm.invoke(prompt);

      return {
        entityId: resolvedId,
        entityType: 'Topic',
        entityKey: candidate.entityKey,
        isNew: false,
        nodeUpdates: this.filterEmptyValues(nodeUpdates as Record<string, unknown>),
        relationshipUpdates: {}, // Temporal tracking handled by repository
        last_update_source: conversationId,
        confidence,
      };
    }
  }

  /**
   * Update Idea entity
   * Split between intrinsic properties (node) and user-specific (EXPLORING relationship)
   */
  private async updateIdea(
    transcript: string,
    candidate: { summary?: string; entityKey: string },
    resolvedId: string | null,
    existingData: Idea | null,
    confidence: number,
    conversationId: string
  ): Promise<EntityUpdate> {
    const isNew = resolvedId === null;

    if (isNew) {
      const nodeStructuredLlm = this.model.withStructuredOutput(IdeaNodeUpdateSchema);
      const relStructuredLlm = this.model.withStructuredOutput(IdeaRelationshipUpdateSchema);

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

      const [nodeUpdates, relationshipUpdates] = await Promise.all([
        nodeStructuredLlm.invoke(nodePrompt),
        relStructuredLlm.invoke(relPrompt),
      ]);

      return {
        entityId: null,
        entityType: 'Idea',
        entityKey: candidate.entityKey,
        isNew: true,
        newEntityData: {
          summary: candidate.summary,
        },
        nodeUpdates: this.filterEmptyValues(nodeUpdates as Record<string, unknown>),
        relationshipUpdates: this.filterEmptyValues(relationshipUpdates as Record<string, unknown>),
        last_update_source: conversationId,
        confidence,
      };
    } else {
      const nodeStructuredLlm = this.model.withStructuredOutput(IdeaNodeUpdateSchema);
      const relStructuredLlm = this.model.withStructuredOutput(IdeaRelationshipUpdateSchema);

      const obstaclesStr = (existingData?.obstacles && existingData.obstacles.length > 0)
        ? existingData.obstacles.join(', ')
        : 'none';
      const resourcesStr = (existingData?.resources_needed && existingData.resources_needed.length > 0)
        ? existingData.resources_needed.join(', ')
        : 'none';
      const experimentsStr = (existingData?.experiments_tried && existingData.experiments_tried.length > 0)
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

      const [nodeUpdates, relationshipUpdates] = await Promise.all([
        nodeStructuredLlm.invoke(nodePrompt),
        relStructuredLlm.invoke(relPrompt),
      ]);

      return {
        entityId: resolvedId,
        entityType: 'Idea',
        entityKey: candidate.entityKey,
        isNew: false,
        nodeUpdates: this.filterEmptyValues(nodeUpdates as Record<string, unknown>),
        relationshipUpdates: this.filterEmptyValues(relationshipUpdates as Record<string, unknown>),
        last_update_source: conversationId,
        confidence,
      };
    }
  }
}

export const entityUpdateService = new EntityUpdateService();
