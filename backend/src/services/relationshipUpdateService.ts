/**
 * Phase 5: Relationship Update Service
 *
 * Scores and creates/updates relationships between entities using LLM judgment.
 * Keeps scoring simple - trusts LLM over complex heuristics.
 *
 * Relationships:
 * - User → Entity (KNOWS, WORKING_ON, INTERESTED_IN, FEELS)
 * - Conversation → Entity (MENTIONED, DISCUSSED, EXPLORED)
 * - Entity → Entity (extracted in Phase 3, not handled here)
 */

import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import type { SerializedMessage } from '../agents/types/messages.js';
import type { EntityUpdate } from './entityUpdateService.js';

// Relationship scoring schema
const RelationshipScoreSchema = z.object({
  sentiment: z.number().min(-1).max(1).describe('Overall emotional tone (-1 negative, 0 neutral, 1 positive)'),
  importance_score: z.number().min(0).max(1).describe('How central was this to the conversation? (0 = passing mention, 1 = core focus)'),
  depth: z.enum(['surface', 'moderate', 'deep']).optional().describe('Depth of discussion (for Topics only)'),
  outcome: z.enum(['refined', 'abandoned', 'implemented']).optional().describe('Outcome (for Ideas only)'),
});

// Export types
export interface UserRelationship {
  type: 'KNOWS' | 'WORKING_ON' | 'INTERESTED_IN' | 'EXPLORING' | 'FEELS';
  targetEntityId: string;
  targetEntityType: string;
  properties: Record<string, unknown>;
}

export interface ConversationRelationship {
  type: 'MENTIONED' | 'DISCUSSED' | 'EXPLORED';
  targetEntityId: string;
  targetEntityType: string;
  properties: Record<string, unknown>;
}

export interface RelationshipUpdates {
  userRelationships: UserRelationship[];
  conversationRelationships: ConversationRelationship[];
}

class RelationshipUpdateService {
  private model: ChatOpenAI;

  constructor() {
    this.model = new ChatOpenAI({
      modelName: 'gpt-4.1-nano',
    });
  }

  /**
   * Prepare transcript excerpt
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
   * Score and create relationships for all entities
   */
  async scoreRelationships(
    transcript: SerializedMessage[],
    entityUpdates: EntityUpdate[],
    conversationId: string,
    userId: string
  ): Promise<RelationshipUpdates> {
    console.log('🔗 Scoring relationships...');

    const readableTranscript = this.prepareTranscript(transcript);

    // Score each entity in parallel
    const scores = await Promise.all(
      entityUpdates.map((entity) =>
        this.scoreEntity(readableTranscript, entity)
      )
    );

    // Collect all relationships
    const userRelationships: UserRelationship[] = [];
    const conversationRelationships: ConversationRelationship[] = [];

    for (const { user, conversation } of scores) {
      if (user) {
        userRelationships.push(user);
      }
      if (conversation) {
        conversationRelationships.push(conversation);
      }
    }

    console.log(`✅ Scored ${userRelationships.length} user relationships, ${conversationRelationships.length} conversation relationships`);

    return { userRelationships, conversationRelationships };
  }

  /**
   * Score a single entity's relationships
   */
  private async scoreEntity(
    transcript: string,
    entity: EntityUpdate
  ): Promise<{ user: UserRelationship | null; conversation: ConversationRelationship | null }> {
    // Skip if entity has no ID (shouldn't happen after Neo4j transaction, but defensive)
    if (!entity.entityId && !entity.isNew) {
      return { user: null, conversation: null };
    }

    // Generate entity ID for new entities (will be created in Phase 7)
    const entityId = entity.entityId || `temp_${entity.entityKey.substring(0, 12)}`;

    // Get entity name/summary for prompt
    const entityName = this.getEntityDisplayName(entity);

    const structuredLlm = this.model.withStructuredOutput(RelationshipScoreSchema);

    const prompt = `Analyze how this entity was discussed in the conversation:

Entity: ${entityName}
Type: ${entity.entityType}

Conversation:
${transcript}

Score:
- sentiment: Overall emotional tone (-1 negative, 0 neutral, 1 positive)
- importance_score: How central was this to the conversation? (0 = mentioned in passing, 1 = core focus)
${entity.entityType === 'Topic' ? '- depth: How deeply was this explored? (surface, moderate, deep)' : ''}
${entity.entityType === 'Idea' ? '- outcome: What happened with this idea? (refined, abandoned, implemented)' : ''}

Be realistic - not everything is deeply important.`;

    try {
      const score = await structuredLlm.invoke(prompt);

      // Create User → Entity relationship based on entity type
      const userRelationship = this.createUserRelationship(entity, entityId, score);

      // Create Conversation → Entity relationship
      const conversationRelationship = this.createConversationRelationship(
        entity,
        entityId,
        score
      );

      return { user: userRelationship, conversation: conversationRelationship };
    } catch (error) {
      console.warn(`⚠️ Failed to score entity ${entityName}:`, error);
      // Return default relationships on error
      return {
        user: this.createUserRelationship(entity, entityId, {
          sentiment: 0,
          importance_score: 0.5,
        }),
        conversation: this.createConversationRelationship(entity, entityId, {
          sentiment: 0,
          importance_score: 0.5,
        }),
      };
    }
  }

  /**
   * Get display name for entity
   */
  private getEntityDisplayName(entity: EntityUpdate): string {
    if (entity.entityType === 'Idea') {
      return entity.newEntityData?.summary || 'Unknown idea';
    }
    return entity.newEntityData?.name || 'Unknown entity';
  }

  /**
   * Create User → Entity relationship
   */
  private createUserRelationship(
    entity: EntityUpdate,
    entityId: string,
    score: { sentiment: number; importance_score: number }
  ): UserRelationship | null {
    const { entityType } = entity;
    const now = new Date().toISOString();

    if (entityType === 'Person') {
      const relationshipType = entity.relationshipUpdates.relationship_type as string | undefined;
      if (!relationshipType) {
        throw new Error(`Person entity missing required relationship_type: ${entityId}`);
      }

      return {
        type: 'KNOWS',
        targetEntityId: entityId,
        targetEntityType: 'Person',
        properties: {
          relationship_type: relationshipType,
          relationship_quality: (score.sentiment + 1) / 2, // Convert -1..1 to 0..1
          how_they_met: entity.relationshipUpdates.how_they_met as string | undefined,
          why_they_matter: entity.relationshipUpdates.why_they_matter as string | undefined,
          relationship_status: entity.relationshipUpdates.relationship_status as string | undefined,
          communication_cadence: entity.relationshipUpdates.communication_cadence as string | undefined,
          first_mentioned_at: now,
          last_mentioned_at: now,
        },
      };
    }

    if (entityType === 'Project') {
      // Only create WORKING_ON if status is active
      const status = entity.relationshipUpdates.status as string | undefined;
      if (!status || status === 'abandoned') {
        return null;
      }

      return {
        type: 'WORKING_ON',
        targetEntityId: entityId,
        targetEntityType: 'Project',
        properties: {
          status: status,
          priority: Math.round(score.importance_score * 10), // 0-10 scale
          last_discussed_at: now,
          confidence_level: entity.relationshipUpdates.confidence_level as number | undefined,
          excitement_level: entity.relationshipUpdates.excitement_level as number | undefined,
          time_invested: entity.relationshipUpdates.time_invested as string | undefined,
          money_invested: entity.relationshipUpdates.money_invested as number | undefined,
          blockers: entity.relationshipUpdates.blockers as string[] | undefined,
          first_mentioned_at: now,
          last_mentioned_at: now,
        },
      };
    }

    if (entityType === 'Topic') {
      return {
        type: 'INTERESTED_IN',
        targetEntityId: entityId,
        targetEntityType: 'Topic',
        properties: {
          engagement_level: score.importance_score,
          last_discussed_at: now,
          frequency: 1, // Will be incremented on subsequent mentions
          first_mentioned_at: now,
          last_mentioned_at: now,
        },
      };
    }

    if (entityType === 'Idea') {
      // Ideas now get EXPLORING relationship
      const status = entity.relationshipUpdates.status as string | undefined;
      if (!status) {
        throw new Error(`Idea entity missing required status: ${entityId}`);
      }

      return {
        type: 'EXPLORING',
        targetEntityId: entityId,
        targetEntityType: 'Idea',
        properties: {
          status: status,
          confidence_level: entity.relationshipUpdates.confidence_level as number | undefined,
          excitement_level: entity.relationshipUpdates.excitement_level as number | undefined,
          potential_impact: entity.relationshipUpdates.potential_impact as string | undefined,
          next_steps: entity.relationshipUpdates.next_steps as string[] | undefined,
          first_mentioned_at: now,
          last_mentioned_at: now,
        },
      };
    }

    return null;
  }

  /**
   * Create Conversation → Entity relationship
   */
  private createConversationRelationship(
    entity: EntityUpdate,
    entityId: string,
    score: { sentiment: number; importance_score: number; depth?: string; outcome?: string }
  ): ConversationRelationship {
    const { entityType } = entity;

    if (entityType === 'Topic') {
      return {
        type: 'DISCUSSED',
        targetEntityId: entityId,
        targetEntityType: 'Topic',
        properties: {
          depth: score.depth || 'moderate',
        },
      };
    }

    if (entityType === 'Idea') {
      return {
        type: 'EXPLORED',
        targetEntityId: entityId,
        targetEntityType: 'Idea',
        properties: {
          outcome: score.outcome || 'refined',
        },
      };
    }

    // Default: MENTIONED relationship for Person, Project
    return {
      type: 'MENTIONED',
      targetEntityId: entityId,
      targetEntityType: entity.entityType,
      properties: {
        count: 1,
        sentiment: score.sentiment,
        importance_score: score.importance_score,
      },
    };
  }
}

export const relationshipUpdateService = new RelationshipUpdateService();
