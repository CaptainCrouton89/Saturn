import { neo4jService } from '../db/neo4j';
import { Project } from '../types/graph';

export class ProjectRepository {
  /**
   * Create or update a project
   */
  async upsert(
    project: Partial<Project> & {
      id: string;
      entity_key: string;
      name: string;
      canonical_name: string;
      last_update_source: string;
      confidence: number;
      excerpt_span: string;
    }
  ): Promise<Project> {
    const query = `
      MERGE (p:Project {entity_key: $entity_key})
      ON CREATE SET
        p.id = $id,
        p.name = $name,
        p.canonical_name = $canonical_name,
        p.status = $status,
        p.domain = $domain,
        p.first_mentioned_at = datetime(),
        p.last_mentioned_at = datetime(),
        p.last_update_source = $last_update_source,
        p.confidence = $confidence,
        p.excerpt_span = $excerpt_span,
        p.vision = $vision,
        p.blockers = $blockers,
        p.key_decisions = $key_decisions,
        p.confidence_level = $confidence_level,
        p.excitement_level = $excitement_level,
        p.time_invested = $time_invested,
        p.money_invested = $money_invested,
        p.embedding = $embedding
      ON MATCH SET
        p.name = $name,
        p.canonical_name = $canonical_name,
        p.status = coalesce($status, p.status),
        p.domain = coalesce($domain, p.domain),
        p.last_mentioned_at = datetime(),
        p.last_update_source = $last_update_source,
        p.confidence = $confidence,
        p.excerpt_span = $excerpt_span,
        p.vision = coalesce($vision, p.vision),
        p.blockers = CASE
          WHEN $blockers IS NOT NULL
          THEN (p.blockers[0..7] + $blockers)[0..7]
          ELSE p.blockers
        END,
        p.key_decisions = CASE
          WHEN $key_decisions IS NOT NULL
          THEN (p.key_decisions[0..9] + $key_decisions)[0..9]
          ELSE p.key_decisions
        END,
        p.confidence_level = coalesce($confidence_level, p.confidence_level),
        p.excitement_level = coalesce($excitement_level, p.excitement_level),
        p.time_invested = coalesce($time_invested, p.time_invested),
        p.money_invested = coalesce($money_invested, p.money_invested),
        p.embedding = coalesce($embedding, p.embedding)
      RETURN p
    `;

    const params = {
      id: project.id,
      entity_key: project.entity_key,
      name: project.name,
      canonical_name: project.canonical_name,
      last_update_source: project.last_update_source,
      confidence: project.confidence,
      excerpt_span: project.excerpt_span,
      status: project.status !== undefined ? project.status : 'active',
      domain: project.domain !== undefined ? project.domain : null,
      vision: project.vision !== undefined ? project.vision : null,
      blockers: project.blockers !== undefined ? project.blockers : null,
      key_decisions: project.key_decisions !== undefined ? project.key_decisions : null,
      confidence_level: project.confidence_level !== undefined ? project.confidence_level : null,
      excitement_level: project.excitement_level !== undefined ? project.excitement_level : null,
      time_invested: project.time_invested !== undefined ? project.time_invested : null,
      money_invested: project.money_invested !== undefined ? project.money_invested : null,
      embedding: project.embedding !== undefined ? project.embedding : null,
    };

    const result = await neo4jService.executeQuery<{ p: Project }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create/update project');
    }

    return result[0].p;
  }

  /**
   * Find project by ID
   */
  async findById(id: string): Promise<Project | null> {
    const query = 'MATCH (p:Project {id: $id}) RETURN p';
    const result = await neo4jService.executeQuery<{ p: Project }>(query, { id });
    return result[0]?.p || null;
  }

  /**
   * Find projects by status
   */
  async findByStatus(status: string): Promise<Project[]> {
    const query = `
      MATCH (p:Project {status: $status})
      RETURN p
      ORDER BY p.last_mentioned_at DESC
    `;

    const result = await neo4jService.executeQuery<{ p: Project }>(query, { status });
    return result.map((r) => r.p);
  }

  /**
   * Get all active projects for a user
   */
  async getActiveProjects(userId: string): Promise<Project[]> {
    const query = `
      MATCH (u:User {id: $userId})-[r:WORKING_ON]->(p:Project)
      WHERE p.status = 'active'
      RETURN p
      ORDER BY r.priority DESC, p.last_mentioned_at DESC
    `;

    const result = await neo4jService.executeQuery<{ p: Project }>(query, { userId });
    return result.map((r) => r.p);
  }

  /**
   * Link user to project
   */
  async linkToUser(
    userId: string,
    projectId: string,
    metadata: { status?: string; priority?: number; last_discussed_at?: Date } = {}
  ): Promise<void> {
    const query = `
      MATCH (u:User {id: $userId})
      MATCH (p:Project {id: $projectId})
      MERGE (u)-[r:WORKING_ON]->(p)
      SET r.status = coalesce($status, 'active'),
          r.priority = coalesce($priority, 1),
          r.last_discussed_at = coalesce($last_discussed_at, datetime())
    `;

    const params = {
      userId,
      projectId,
      status: metadata.status !== undefined ? metadata.status : 'active',
      priority: metadata.priority !== undefined ? metadata.priority : 1,
      last_discussed_at: metadata.last_discussed_at !== undefined ? metadata.last_discussed_at : null,
    };

    await neo4jService.executeQuery(query, params);
  }

  /**
   * Link project to conversation
   */
  async linkToConversation(
    projectId: string,
    conversationId: string,
    metadata: { count?: number; sentiment?: number; importance_score?: number } = {}
  ): Promise<void> {
    const query = `
      MATCH (p:Project {id: $projectId})
      MATCH (c:Conversation {id: $conversationId})
      MERGE (c)-[r:MENTIONED]->(p)
      SET r.count = coalesce($count, 1),
          r.sentiment = coalesce($sentiment, 0),
          r.importance_score = coalesce($importance_score, 0.5)
    `;

    const params = {
      projectId,
      conversationId,
      count: metadata.count !== undefined ? metadata.count : 1,
      sentiment: metadata.sentiment !== undefined ? metadata.sentiment : 0,
      importance_score: metadata.importance_score !== undefined ? metadata.importance_score : 0.5,
    };

    await neo4jService.executeQuery(query, params);
  }

  /**
   * Link project to topic
   */
  async linkToTopic(projectId: string, topicId: string): Promise<void> {
    const query = `
      MATCH (p:Project {id: $projectId})
      MATCH (t:Topic {id: $topicId})
      MERGE (p)-[:RELATED_TO]->(t)
    `;

    await neo4jService.executeQuery(query, { projectId, topicId });
  }
}

export const projectRepository = new ProjectRepository();
