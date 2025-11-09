import { neo4jService } from '../db/neo4j.js';
import { Topic } from '../types/graph.js';

export class TopicRepository {
  /**
   * Create or update a topic
   */
  async upsert(
    topic: Partial<Topic> & {
      id: string;
      entity_key: string;
      name: string;
      canonical_name: string;
      last_update_source: string;
      confidence: number;
      excerpt_span: string;
    }
  ): Promise<Topic> {
    const query = `
      MERGE (t:Topic {entity_key: $entity_key})
      ON CREATE SET
        t.id = $id,
        t.name = $name,
        t.canonical_name = $canonical_name,
        t.description = $description,
        t.category = $category,
        t.first_mentioned_at = datetime(),
        t.last_mentioned_at = datetime(),
        t.last_update_source = $last_update_source,
        t.confidence = $confidence,
        t.excerpt_span = $excerpt_span,
        t.embedding = $embedding
      ON MATCH SET
        t.name = $name,
        t.canonical_name = $canonical_name,
        t.description = coalesce($description, t.description),
        t.category = coalesce($category, t.category),
        t.last_mentioned_at = datetime(),
        t.last_update_source = $last_update_source,
        t.confidence = $confidence,
        t.excerpt_span = $excerpt_span,
        t.embedding = coalesce($embedding, t.embedding)
      RETURN t
    `;

    const params = {
      id: topic.id,
      entity_key: topic.entity_key,
      name: topic.name,
      canonical_name: topic.canonical_name,
      last_update_source: topic.last_update_source,
      confidence: topic.confidence,
      excerpt_span: topic.excerpt_span,
      description: topic.description !== undefined ? topic.description : '',
      category: topic.category !== undefined ? topic.category : null,
      embedding: topic.embedding !== undefined ? topic.embedding : null,
    };

    const result = await neo4jService.executeQuery<{ t: Topic }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create/update topic');
    }

    return result[0].t;
  }

  /**
   * Find topic by ID
   */
  async findById(id: string): Promise<Topic | null> {
    const query = 'MATCH (t:Topic {id: $id}) RETURN t';
    const result = await neo4jService.executeQuery<{ t: Topic }>(query, { id });
    return result[0]?.t !== undefined ? result[0].t : null;
  }

  /**
   * Search topics by name or canonical name
   */
  async searchByName(name: string): Promise<Topic[]> {
    const query = `
      MATCH (t:Topic)
      WHERE t.name CONTAINS $name OR t.canonical_name CONTAINS toLower($name)
      RETURN t
      ORDER BY t.last_mentioned_at DESC
    `;

    const result = await neo4jService.executeQuery<{ t: Topic }>(query, { name });
    return result.map((r) => r.t);
  }

  /**
   * Find topic by entity_key (for idempotent updates)
   */
  async findByEntityKey(entityKey: string): Promise<Topic | null> {
    const query = 'MATCH (t:Topic {entity_key: $entityKey}) RETURN t';
    const result = await neo4jService.executeQuery<{ t: Topic }>(query, { entityKey });
    return result[0]?.t !== undefined ? result[0].t : null;
  }

  /**
   * Find topic by canonical name
   */
  async findByCanonicalName(canonicalName: string): Promise<Topic | null> {
    const query = 'MATCH (t:Topic {canonical_name: $canonicalName}) RETURN t';
    const result = await neo4jService.executeQuery<{ t: Topic }>(query, { canonicalName });
    return result[0]?.t !== undefined ? result[0].t : null;
  }

  /**
   * Find topics by category
   */
  async findByCategory(category: string): Promise<Topic[]> {
    const query = `
      MATCH (t:Topic {category: $category})
      RETURN t
      ORDER BY t.last_mentioned_at DESC
    `;

    const result = await neo4jService.executeQuery<{ t: Topic }>(query, { category });
    return result.map((r) => r.t);
  }

  /**
   * Get topics a user is interested in
   */
  async getUserTopics(userId: string, minEngagement: number = 0.5): Promise<Topic[]> {
    const query = `
      MATCH (u:User {id: $userId})-[r:INTERESTED_IN]->(t:Topic)
      WHERE r.engagement_level >= $minEngagement
      RETURN t
      ORDER BY r.engagement_level DESC, t.last_mentioned_at DESC
    `;

    const result = await neo4jService.executeQuery<{ t: Topic }>(query, {
      userId,
      minEngagement,
    });
    return result.map((r) => r.t);
  }

  /**
   * Link user to topic
   */
  async linkToUser(
    userId: string,
    topicId: string,
    metadata: { engagement_level?: number; last_discussed_at?: Date; frequency?: number } = {}
  ): Promise<void> {
    const query = `
      MATCH (u:User {id: $userId})
      MATCH (t:Topic {id: $topicId})
      MERGE (u)-[r:INTERESTED_IN]->(t)
      SET r.engagement_level = coalesce($engagement_level, r.engagement_level, 0.5),
          r.last_discussed_at = coalesce($last_discussed_at, datetime()),
          r.frequency = coalesce($frequency, r.frequency, 0) + 1
    `;

    const params = {
      userId,
      topicId,
      engagement_level: metadata.engagement_level !== undefined ? metadata.engagement_level : null,
      last_discussed_at: metadata.last_discussed_at !== undefined ? metadata.last_discussed_at : null,
      frequency: metadata.frequency !== undefined ? metadata.frequency : null,
    };

    await neo4jService.executeQuery(query, params);
  }

  /**
   * Link topic to conversation
   */
  async linkToConversation(
    topicId: string,
    conversationId: string,
    depth: 'surface' | 'moderate' | 'deep' = 'moderate'
  ): Promise<void> {
    const query = `
      MATCH (t:Topic {id: $topicId})
      MATCH (c:Conversation {id: $conversationId})
      MERGE (c)-[r:DISCUSSED]->(t)
      SET r.depth = $depth
    `;

    await neo4jService.executeQuery(query, { topicId, conversationId, depth });
  }
}

export const topicRepository = new TopicRepository();
