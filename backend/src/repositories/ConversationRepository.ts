import { neo4jService } from '../db/neo4j';
import { Conversation, ConversationContext } from '../types/graph';

export class ConversationRepository {
  /**
   * Create a new conversation node
   */
  async create(conversation: Omit<Conversation, 'date'> & { date?: Date }): Promise<Conversation> {
    const query = `
      CREATE (c:Conversation {
        id: $id,
        summary: $summary,
        date: coalesce($date, datetime()),
        duration: $duration,
        trigger_method: $trigger_method,
        status: $status,
        topic_tags: $topic_tags
      })
      RETURN c
    `;

    const result = await neo4jService.executeQuery<{ c: Conversation }>(query, {
      id: conversation.id,
      summary: conversation.summary,
      date: conversation.date || new Date(),
      duration: conversation.duration,
      trigger_method: conversation.trigger_method,
      status: conversation.status,
      topic_tags: conversation.topic_tags,
    });

    if (!result[0]) {
      throw new Error('Failed to create conversation');
    }

    return result[0].c;
  }

  /**
   * Link conversation to user
   */
  async linkToUser(conversationId: string, userId: string): Promise<void> {
    const query = `
      MATCH (u:User {id: $userId})
      MATCH (c:Conversation {id: $conversationId})
      MERGE (u)-[r:HAD_CONVERSATION {timestamp: datetime()}]->(c)
    `;

    await neo4jService.executeQuery(query, { conversationId, userId });
  }

  /**
   * Create a follow-up relationship between conversations
   */
  async linkFollowUp(
    previousConversationId: string,
    currentConversationId: string,
    timeGapHours: number,
    continuationType: string
  ): Promise<void> {
    const query = `
      MATCH (prev:Conversation {id: $previousConversationId})
      MATCH (curr:Conversation {id: $currentConversationId})
      MERGE (prev)-[r:FOLLOWED_UP]->(curr)
      SET r.time_gap_hours = $timeGapHours,
          r.continuation_type = $continuationType
    `;

    await neo4jService.executeQuery(query, {
      previousConversationId,
      currentConversationId,
      timeGapHours,
      continuationType,
    });
  }

  /**
   * Get conversation context for a user
   * Returns active topics, recent people, and unresolved ideas
   */
  async getContext(userId: string, daysBack: number = 14): Promise<ConversationContext> {
    const query = `
      MATCH (u:User {id: $userId})-[:HAD_CONVERSATION]->(recent:Conversation)
      WHERE recent.date > datetime() - duration({days: $daysBack})
      WITH u, collect(recent) as recent_convos

      // Active topics
      OPTIONAL MATCH (u)-[:INTERESTED_IN]->(t:Topic)
      WHERE EXISTS {
        MATCH (t)<-[:DISCUSSED]-(c:Conversation)
        WHERE c IN recent_convos
      }
      WITH u, recent_convos, collect(DISTINCT t.name) as active_topics

      // Recent people
      OPTIONAL MATCH (u)-[:KNOWS]->(p:Person)
      WHERE EXISTS {
        MATCH (p)<-[:MENTIONED]-(c:Conversation)
        WHERE c IN recent_convos
      }
      WITH u, active_topics, collect(DISTINCT p.name) as recent_people

      // Unresolved ideas
      OPTIONAL MATCH (u)-[:HAD_CONVERSATION]->(:Conversation)-[:EXPLORED]->(idea:Idea)
      WHERE idea.status = 'raw'

      RETURN {
        active_topics: active_topics,
        recent_people: recent_people,
        unresolved_ideas: collect(idea.summary)
      } as context
    `;

    const result = await neo4jService.executeQuery<{ context: ConversationContext }>(query, {
      userId,
      daysBack,
    });

    return result[0]?.context || { active_topics: [], recent_people: [], unresolved_ideas: [] };
  }

  /**
   * Get conversation thread (all follow-ups from a starting conversation)
   */
  async getThread(conversationId: string): Promise<Conversation[]> {
    const query = `
      MATCH path=(start:Conversation {id: $conversationId})-[:FOLLOWED_UP*0..]->(end:Conversation)
      WITH path, end
      ORDER BY end.date DESC
      RETURN collect(DISTINCT end) as conversations
    `;

    const result = await neo4jService.executeQuery<{ conversations: Conversation[] }>(query, {
      conversationId,
    });

    return result[0]?.conversations || [];
  }
}

export const conversationRepository = new ConversationRepository();
