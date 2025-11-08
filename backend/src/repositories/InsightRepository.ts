import { neo4jService } from '../db/neo4j';
import { Contradiction, ConversationSuggestion, EntityActivity } from '../types/graph';

/**
 * Repository for querying insights and patterns from the graph
 * Based on powerful queries from neo4j.md
 */
export class InsightRepository {
  /**
   * Spot contradictions between patterns and values
   * "You keep saying you want someone independent, but every person you're
   * excited about is super available. What's that about?"
   */
  async findContradictions(userId: string, minConfidence: number = 0.6): Promise<Contradiction[]> {
    const query = `
      MATCH (u:User {id: $userId})-[:HAS_PATTERN]->(p:Pattern)-[c:CONTRADICTS]->(v:Value)
      WHERE p.confidence_score > $minConfidence
      RETURN p.description as behavior,
             v.description as stated_value,
             c.contradiction_description,
             c.severity
      ORDER BY c.severity DESC
    `;

    const result = await neo4jService.executeQuery<Contradiction>(query, {
      userId,
      minConfidence,
    });

    return result;
  }

  /**
   * Get conversation suggestions (Conversation DJ)
   * Find topics that:
   * - User is highly engaged with
   * - Haven't been discussed recently
   * - Have unresolved threads
   */
  async getConversationSuggestions(
    userId: string,
    minEngagement: number = 0.7,
    daysSinceLastDiscussion: number = 7,
    maxRecentMentions: number = 3
  ): Promise<ConversationSuggestion[]> {
    const query = `
      MATCH (u:User {id: $userId})-[r:INTERESTED_IN]->(t:Topic)
      WHERE r.last_discussed_at < datetime() - duration({days: $daysSinceLastDiscussion})
        AND r.engagement_level > $minEngagement
      OPTIONAL MATCH (t)<-[:DISCUSSED]-(recent:Conversation)
      WHERE recent.date > datetime() - duration({days: 30})
      WITH t, r, count(recent) as recent_mentions
      WHERE recent_mentions < $maxRecentMentions
      RETURN t.name as topic_name,
             r.engagement_level as engagement_level,
             r.last_discussed_at as last_discussed_at
      ORDER BY r.engagement_level DESC
      LIMIT 5
    `;

    const result = await neo4jService.executeQuery<ConversationSuggestion>(query, {
      userId,
      minEngagement,
      daysSinceLastDiscussion,
      maxRecentMentions,
    });

    return result;
  }

  /**
   * What's currently active?
   * Get recent mentions across conversations
   */
  async getCurrentlyActive(userId: string, daysBack: number = 7): Promise<EntityActivity[]> {
    const query = `
      MATCH (u:User {id: $userId})-[:HAD_CONVERSATION]->(c:Conversation)-[m:MENTIONED]->(entity)
      WHERE c.date > datetime() - duration({days: $daysBack})
      WITH entity, count(m) as mentions, sum(m.importance_score) as total_importance
      RETURN labels(entity)[0] as entity_type,
             entity.name as name,
             mentions,
             total_importance
      ORDER BY total_importance DESC
      LIMIT 10
    `;

    const result = await neo4jService.executeQuery<EntityActivity>(query, {
      userId,
      daysBack,
    });

    return result;
  }

  /**
   * Find patterns that manifest in specific entities
   */
  async findPatternsInEntity(
    userId: string,
    entityType: 'Person' | 'Project' | 'Topic',
    entityId: string
  ): Promise<Array<{ pattern_description: string; pattern_type: string; confidence: number }>> {
    const query = `
      MATCH (u:User {id: $userId})-[:HAS_PATTERN]->(p:Pattern)-[:MANIFESTS_IN]->(entity:${entityType} {id: $entityId})
      RETURN p.description as pattern_description,
             p.type as pattern_type,
             p.confidence_score as confidence
      ORDER BY p.confidence_score DESC
    `;

    const result = await neo4jService.executeQuery<{
      pattern_description: string;
      pattern_type: string;
      confidence: number;
    }>(query, {
      userId,
      entityId,
    });

    return result;
  }

  /**
   * Get emotional patterns around an entity
   */
  async getEmotionalPatterns(
    userId: string,
    entityType: 'Person' | 'Project' | 'Idea',
    entityId: string
  ): Promise<Array<{ emotion: string; intensity: number; noted_at: Date }>> {
    const query = `
      MATCH (u:User {id: $userId})-[f:FEELS]->(entity:${entityType} {id: $entityId})
      RETURN f.emotion as emotion,
             f.intensity as intensity,
             f.noted_at as noted_at
      ORDER BY f.noted_at DESC
    `;

    const result = await neo4jService.executeQuery<{
      emotion: string;
      intensity: number;
      noted_at: Date;
    }>(query, {
      userId,
      entityId,
    });

    return result;
  }
}

export const insightRepository = new InsightRepository();
