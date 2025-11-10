import { neo4jService } from '../db/neo4j.js';
import { Idea } from '../types/graph.js';

export class IdeaRepository {
  /**
   * Create or update an idea (intrinsic properties only)
   */
  async upsert(
    idea: Partial<Idea> & {
      id: string;
      entity_key: string;
      summary: string;
      last_update_source: string;
      confidence: number;
      excerpt_span: string;
    }
  ): Promise<Idea> {
    const query = `
      MERGE (i:Idea {entity_key: $entity_key})
      ON CREATE SET
        i.id = $id,
        i.summary = $summary,
        i.created_at = datetime(),
        i.refined_at = $refined_at,
        i.updated_at = datetime(),
        i.last_update_source = $last_update_source,
        i.confidence = $confidence,
        i.excerpt_span = $excerpt_span,
        i.original_inspiration = $original_inspiration,
        i.evolution_notes = $evolution_notes,
        i.obstacles = $obstacles,
        i.resources_needed = $resources_needed,
        i.experiments_tried = $experiments_tried,
        i.context_notes = $context_notes,
        i.embedding = $embedding
      ON MATCH SET
        i.summary = $summary,
        i.refined_at = coalesce($refined_at, i.refined_at),
        i.updated_at = datetime(),
        i.last_update_source = $last_update_source,
        i.confidence = $confidence,
        i.excerpt_span = $excerpt_span,
        i.original_inspiration = coalesce($original_inspiration, i.original_inspiration),
        i.evolution_notes = coalesce($evolution_notes, i.evolution_notes),
        i.obstacles = CASE
          WHEN $obstacles IS NOT NULL
          THEN (i.obstacles[0..7] + $obstacles)[0..7]
          ELSE i.obstacles
        END,
        i.resources_needed = CASE
          WHEN $resources_needed IS NOT NULL
          THEN (i.resources_needed[0..9] + $resources_needed)[0..9]
          ELSE i.resources_needed
        END,
        i.experiments_tried = CASE
          WHEN $experiments_tried IS NOT NULL
          THEN (i.experiments_tried[0..9] + $experiments_tried)[0..9]
          ELSE i.experiments_tried
        END,
        i.context_notes = coalesce($context_notes, i.context_notes),
        i.embedding = coalesce($embedding, i.embedding)
      RETURN i
    `;

    const params = {
      id: idea.id,
      entity_key: idea.entity_key,
      summary: idea.summary,
      last_update_source: idea.last_update_source,
      confidence: idea.confidence,
      excerpt_span: idea.excerpt_span,
      refined_at: idea.refined_at !== undefined ? idea.refined_at : null,
      original_inspiration: idea.original_inspiration !== undefined ? idea.original_inspiration : null,
      evolution_notes: idea.evolution_notes !== undefined ? idea.evolution_notes : null,
      obstacles: idea.obstacles !== undefined ? idea.obstacles : null,
      resources_needed: idea.resources_needed !== undefined ? idea.resources_needed : null,
      experiments_tried: idea.experiments_tried !== undefined ? idea.experiments_tried : null,
      context_notes: idea.context_notes !== undefined ? idea.context_notes : null,
      embedding: idea.embedding !== undefined ? idea.embedding : null,
    };

    const result = await neo4jService.executeQuery<{ i: Idea }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create/update idea');
    }

    return result[0].i;
  }

  /**
   * Establish or update EXPLORING relationship between User and Idea
   * This replaces the old user-specific properties that were on the Idea node
   */
  async setExploringRelationship(
    userId: string,
    ideaId: string,
    props: {
      status: 'raw' | 'refined' | 'abandoned' | 'implemented';
      confidence_level?: number;
      excitement_level?: number;
      potential_impact?: string;
      next_steps?: string[];
    }
  ): Promise<void> {
    const query = `
      MATCH (u:User {id: $userId})
      MATCH (i:Idea {id: $ideaId})
      MERGE (u)-[r:EXPLORING]->(i)
      ON CREATE SET
        r.status = $status,
        r.confidence_level = $confidence_level,
        r.excitement_level = $excitement_level,
        r.potential_impact = $potential_impact,
        r.next_steps = $next_steps,
        r.first_mentioned_at = datetime(),
        r.last_mentioned_at = datetime()
      ON MATCH SET
        r.status = $status,
        r.confidence_level = coalesce($confidence_level, r.confidence_level),
        r.excitement_level = coalesce($excitement_level, r.excitement_level),
        r.potential_impact = coalesce($potential_impact, r.potential_impact),
        r.next_steps = CASE
          WHEN $next_steps IS NOT NULL
          THEN (r.next_steps[0..7] + $next_steps)[0..7]
          ELSE r.next_steps
        END,
        r.last_mentioned_at = datetime()
    `;

    await neo4jService.executeQuery(query, {
      userId,
      ideaId,
      status: props.status,
      confidence_level: props.confidence_level !== undefined ? props.confidence_level : null,
      excitement_level: props.excitement_level !== undefined ? props.excitement_level : null,
      potential_impact: props.potential_impact !== undefined ? props.potential_impact : null,
      next_steps: props.next_steps !== undefined ? props.next_steps : null,
    });
  }

  /**
   * Get User's relationship with an Idea (EXPLORING relationship properties)
   */
  async getExploringRelationship(
    userId: string,
    ideaId: string
  ): Promise<{
    status: string;
    confidence_level?: number;
    excitement_level?: number;
    potential_impact?: string;
    next_steps?: string[];
    first_mentioned_at: Date;
    last_mentioned_at: Date;
  } | null> {
    const query = `
      MATCH (u:User {id: $userId})-[r:EXPLORING]->(i:Idea {id: $ideaId})
      RETURN r
    `;

    type ExploringRelationship = {
      status: string;
      confidence_level?: number;
      excitement_level?: number;
      potential_impact?: string;
      next_steps?: string[];
      first_mentioned_at: Date;
      last_mentioned_at: Date;
    };

    const result = await neo4jService.executeQuery<{ r: ExploringRelationship }>(query, { userId, ideaId });

    if (!result[0]) {
      return null;
    }

    return result[0].r;
  }

  /**
   * Find idea by ID
   */
  async findById(id: string): Promise<Idea | null> {
    const query = 'MATCH (i:Idea {id: $id}) RETURN i';
    const result = await neo4jService.executeQuery<{ i: Idea }>(query, { id });
    return result[0]?.i !== undefined ? result[0].i : null;
  }

  /**
   * Find idea by entity_key (for idempotent updates)
   */
  async findByEntityKey(entityKey: string): Promise<Idea | null> {
    const query = 'MATCH (i:Idea {entity_key: $entityKey}) RETURN i';
    const result = await neo4jService.executeQuery<{ i: Idea }>(query, { entityKey });
    return result[0]?.i !== undefined ? result[0].i : null;
  }

  /**
   * Find user's ideas by status (via EXPLORING relationship)
   */
  async findByStatusForUser(userId: string, status: string): Promise<Idea[]> {
    const query = `
      MATCH (u:User {id: $userId})-[r:EXPLORING {status: $status}]->(i:Idea)
      RETURN i
      ORDER BY r.last_mentioned_at DESC
    `;

    const result = await neo4jService.executeQuery<{ i: Idea }>(query, { userId, status });
    return result.map((r) => r.i);
  }

  /**
   * Get all ideas for a user (via EXPLORING relationship)
   */
  async findAllForUser(userId: string): Promise<Array<Idea & { exploring: {
    status: string;
    confidence_level?: number;
    excitement_level?: number;
    potential_impact?: string;
    next_steps?: string[];
    first_mentioned_at: Date;
    last_mentioned_at: Date;
  } }>> {
    const query = `
      MATCH (u:User {id: $userId})-[r:EXPLORING]->(i:Idea)
      RETURN i, r
      ORDER BY r.last_mentioned_at DESC
    `;

    type ExploringRelationship = {
      status: string;
      confidence_level?: number;
      excitement_level?: number;
      potential_impact?: string;
      next_steps?: string[];
      first_mentioned_at: Date;
      last_mentioned_at: Date;
    };

    const result = await neo4jService.executeQuery<{ i: Idea; r: ExploringRelationship }>(query, { userId });
    return result.map((row) => ({
      ...row.i,
      exploring: row.r,
    }));
  }

  /**
   * Update user's exploration status for an idea (updates EXPLORING relationship)
   */
  async updateStatusForUser(
    userId: string,
    ideaId: string,
    status: 'raw' | 'refined' | 'abandoned' | 'implemented'
  ): Promise<void> {
    const query = `
      MATCH (u:User {id: $userId})-[r:EXPLORING]->(i:Idea {id: $ideaId})
      SET r.status = $status,
          r.last_mentioned_at = datetime(),
          i.refined_at = CASE WHEN $status = 'refined' THEN datetime() ELSE i.refined_at END,
          i.updated_at = datetime()
      RETURN r
    `;

    const result = await neo4jService.executeQuery(query, { userId, ideaId, status });

    if (!result[0]) {
      throw new Error(`Idea with id ${ideaId} not found for user ${userId}`);
    }
  }

  /**
   * Link idea to conversation
   */
  async linkToConversation(
    ideaId: string,
    conversationId: string,
    outcome: 'refined' | 'abandoned' | 'implemented'
  ): Promise<void> {
    const query = `
      MATCH (i:Idea {id: $ideaId})
      MATCH (c:Conversation {id: $conversationId})
      MERGE (c)-[r:EXPLORED]->(i)
      SET r.outcome = $outcome
    `;

    await neo4jService.executeQuery(query, { ideaId, conversationId, outcome });
  }

  /**
   * Link idea to project or topic
   */
  async linkToEntity(ideaId: string, entityId: string, entityType: 'Project' | 'Topic'): Promise<void> {
    const query = `
      MATCH (i:Idea {id: $ideaId})
      MATCH (e:${entityType} {id: $entityId})
      MERGE (i)-[:RELATED_TO]->(e)
    `;

    await neo4jService.executeQuery(query, { ideaId, entityId });
  }

  /**
   * Link idea evolution (idea evolved into another idea)
   */
  async linkEvolution(fromIdeaId: string, toIdeaId: string, description: string): Promise<void> {
    const query = `
      MATCH (from:Idea {id: $fromIdeaId})
      MATCH (to:Idea {id: $toIdeaId})
      MERGE (from)-[r:EVOLVED_INTO]->(to)
      SET r.evolution_description = $description
    `;

    await neo4jService.executeQuery(query, { fromIdeaId, toIdeaId, description });
  }

  /**
   * Merge ideas
   */
  async mergeIdeas(ideaId1: string, ideaId2: string): Promise<void> {
    const query = `
      MATCH (i1:Idea {id: $ideaId1})
      MATCH (i2:Idea {id: $ideaId2})
      MERGE (i1)-[:MERGED_WITH]->(i2)
    `;

    await neo4jService.executeQuery(query, { ideaId1, ideaId2 });
  }
}

export const ideaRepository = new IdeaRepository();
