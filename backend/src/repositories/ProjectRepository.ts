import { neo4jService } from '../db/neo4j.js';
import { Project, RelationshipProperties } from '../types/graph.js';

export class ProjectRepository {
  /**
   * Create or update a project (intrinsic properties only)
   */
  async upsert(
    project: Partial<Project> & {
      id: string;
      entity_key: string;
      name: string;
      canonical_name: string;
      last_update_source: string;
      confidence: number;
    }
  ): Promise<Project> {
    const query = `
      MERGE (p:Project {entity_key: $entity_key})
      ON CREATE SET
        p.id = $id,
        p.name = $name,
        p.canonical_name = $canonical_name,
        p.domain = $domain,
        p.last_update_source = $last_update_source,
        p.confidence = $confidence,
        p.vision = $vision,
        p.key_decisions = $key_decisions,
        p.embedding = $embedding
      ON MATCH SET
        p.name = $name,
        p.canonical_name = $canonical_name,
        p.domain = coalesce($domain, p.domain),
        p.last_update_source = $last_update_source,
        p.confidence = $confidence,
        p.vision = coalesce($vision, p.vision),
        p.key_decisions = CASE
          WHEN $key_decisions IS NOT NULL
          THEN (p.key_decisions[0..9] + $key_decisions)[0..9]
          ELSE p.key_decisions
        END,
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
      domain: project.domain !== undefined ? project.domain : null,
      vision: project.vision !== undefined ? project.vision : null,
      key_decisions: project.key_decisions !== undefined ? project.key_decisions : null,
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
   * Find project by entity_key (for idempotent updates)
   */
  async findByEntityKey(entityKey: string): Promise<Project | null> {
    const query = 'MATCH (p:Project {entity_key: $entityKey}) RETURN p';
    const result = await neo4jService.executeQuery<{ p: Project }>(query, { entityKey });
    return result[0]?.p || null;
  }

  /**
   * Find project by canonical name
   */
  async findByCanonicalName(canonicalName: string): Promise<Project | null> {
    const query = 'MATCH (p:Project {canonical_name: $canonicalName}) RETURN p';
    const result = await neo4jService.executeQuery<{ p: Project }>(query, { canonicalName });
    return result[0]?.p || null;
  }

  /**
   * Find projects by status for a specific user
   */
  async findByStatus(userId: string, status: string): Promise<Array<Project & { relationship: RelationshipProperties['WORKING_ON'] }>> {
    const query = `
      MATCH (u:User {id: $userId})-[r:WORKING_ON]->(p:Project)
      WHERE r.status = $status
      RETURN p, r
      ORDER BY r.last_mentioned_at DESC
    `;

    const result = await neo4jService.executeQuery<{ p: Project; r: RelationshipProperties['WORKING_ON'] }>(query, { userId, status });
    return result.map((row) => ({
      ...row.p,
      relationship: row.r,
    }));
  }

  /**
   * Get all active projects for a user
   */
  async getActiveProjects(userId: string): Promise<Array<Project & { relationship: RelationshipProperties['WORKING_ON'] }>> {
    const query = `
      MATCH (u:User {id: $userId})-[r:WORKING_ON]->(p:Project)
      WHERE r.status = 'active'
      RETURN p, r
      ORDER BY r.priority DESC, r.last_mentioned_at DESC
    `;

    const result = await neo4jService.executeQuery<{ p: Project; r: RelationshipProperties['WORKING_ON'] }>(query, { userId });
    return result.map((row) => ({
      ...row.p,
      relationship: row.r,
    }));
  }

  /**
   * Link user to project with relationship properties
   */
  async linkToUser(
    userId: string,
    projectId: string,
    metadata: Partial<NonNullable<RelationshipProperties['WORKING_ON']>> = {}
  ): Promise<void> {
    const query = `
      MATCH (u:User {id: $userId})
      MATCH (p:Project {id: $projectId})
      MERGE (u)-[r:WORKING_ON]->(p)
      ON CREATE SET
        r.status = coalesce($status, 'active'),
        r.priority = coalesce($priority, 1),
        r.first_mentioned_at = coalesce($first_mentioned_at, datetime()),
        r.last_mentioned_at = coalesce($last_mentioned_at, datetime()),
        r.last_discussed_at = coalesce($last_discussed_at, datetime()),
        r.confidence_level = $confidence_level,
        r.excitement_level = $excitement_level,
        r.time_invested = $time_invested,
        r.money_invested = $money_invested,
        r.blockers = $blockers
      ON MATCH SET
        r.status = coalesce($status, r.status),
        r.priority = coalesce($priority, r.priority),
        r.last_mentioned_at = coalesce($last_mentioned_at, datetime()),
        r.last_discussed_at = coalesce($last_discussed_at, r.last_discussed_at),
        r.confidence_level = coalesce($confidence_level, r.confidence_level),
        r.excitement_level = coalesce($excitement_level, r.excitement_level),
        r.time_invested = coalesce($time_invested, r.time_invested),
        r.money_invested = coalesce($money_invested, r.money_invested),
        r.blockers = CASE
          WHEN $blockers IS NOT NULL
          THEN (r.blockers[0..7] + $blockers)[0..7]
          ELSE r.blockers
        END
    `;

    const params = {
      userId,
      projectId,
      status: metadata.status,
      priority: metadata.priority,
      first_mentioned_at: metadata.first_mentioned_at,
      last_mentioned_at: metadata.last_mentioned_at,
      last_discussed_at: metadata.last_discussed_at,
      confidence_level: metadata.confidence_level,
      excitement_level: metadata.excitement_level,
      time_invested: metadata.time_invested,
      money_invested: metadata.money_invested,
      blockers: metadata.blockers,
    };

    await neo4jService.executeQuery(query, params);
  }

  /**
   * Update WORKING_ON relationship properties
   */
  async updateWorkingOnRelationship(
    userId: string,
    projectId: string,
    updates: Partial<NonNullable<RelationshipProperties['WORKING_ON']>>
  ): Promise<void> {
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { userId, projectId };

    if (updates.status !== undefined) {
      setClauses.push('r.status = $status');
      params.status = updates.status;
    }
    if (updates.priority !== undefined) {
      setClauses.push('r.priority = $priority');
      params.priority = updates.priority;
    }
    if (updates.confidence_level !== undefined) {
      setClauses.push('r.confidence_level = $confidence_level');
      params.confidence_level = updates.confidence_level;
    }
    if (updates.excitement_level !== undefined) {
      setClauses.push('r.excitement_level = $excitement_level');
      params.excitement_level = updates.excitement_level;
    }
    if (updates.time_invested !== undefined) {
      setClauses.push('r.time_invested = $time_invested');
      params.time_invested = updates.time_invested;
    }
    if (updates.money_invested !== undefined) {
      setClauses.push('r.money_invested = $money_invested');
      params.money_invested = updates.money_invested;
    }
    if (updates.last_discussed_at !== undefined) {
      setClauses.push('r.last_discussed_at = $last_discussed_at');
      params.last_discussed_at = updates.last_discussed_at;
    }
    if (updates.last_mentioned_at !== undefined) {
      setClauses.push('r.last_mentioned_at = $last_mentioned_at');
      params.last_mentioned_at = updates.last_mentioned_at;
    }
    if (updates.blockers !== undefined) {
      setClauses.push('r.blockers = CASE WHEN $blockers IS NOT NULL THEN (r.blockers[0..7] + $blockers)[0..7] ELSE r.blockers END');
      params.blockers = updates.blockers;
    }

    if (setClauses.length === 0) {
      return; // No updates to apply
    }

    const query = `
      MATCH (u:User {id: $userId})-[r:WORKING_ON]->(p:Project {id: $projectId})
      SET ${setClauses.join(', ')}
    `;

    await neo4jService.executeQuery(query, params);
  }

  /**
   * Get project with relationship properties for a specific user
   */
  async getProjectForUser(userId: string, projectId: string): Promise<(Project & { relationship: RelationshipProperties['WORKING_ON'] }) | null> {
    const query = `
      MATCH (u:User {id: $userId})-[r:WORKING_ON]->(p:Project {id: $projectId})
      RETURN p, r
    `;

    const result = await neo4jService.executeQuery<{ p: Project; r: RelationshipProperties['WORKING_ON'] }>(query, { userId, projectId });

    if (!result[0]) {
      return null;
    }

    return {
      ...result[0].p,
      relationship: result[0].r,
    };
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
