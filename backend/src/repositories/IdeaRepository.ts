import { neo4jService } from '../db/neo4j.js';
import { Idea } from '../types/graph.js';

export class IdeaRepository {
  /**
   * Create or update an idea
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
        i.status = $status,
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
        i.confidence_level = $confidence_level,
        i.excitement_level = $excitement_level,
        i.potential_impact = $potential_impact,
        i.next_steps = $next_steps,
        i.context_notes = $context_notes,
        i.embedding = $embedding
      ON MATCH SET
        i.summary = $summary,
        i.status = coalesce($status, i.status),
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
        i.confidence_level = coalesce($confidence_level, i.confidence_level),
        i.excitement_level = coalesce($excitement_level, i.excitement_level),
        i.potential_impact = coalesce($potential_impact, i.potential_impact),
        i.next_steps = CASE
          WHEN $next_steps IS NOT NULL
          THEN (i.next_steps[0..7] + $next_steps)[0..7]
          ELSE i.next_steps
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
      status: idea.status !== undefined ? idea.status : 'raw',
      refined_at: idea.refined_at !== undefined ? idea.refined_at : null,
      original_inspiration: idea.original_inspiration !== undefined ? idea.original_inspiration : null,
      evolution_notes: idea.evolution_notes !== undefined ? idea.evolution_notes : null,
      obstacles: idea.obstacles !== undefined ? idea.obstacles : null,
      resources_needed: idea.resources_needed !== undefined ? idea.resources_needed : null,
      experiments_tried: idea.experiments_tried !== undefined ? idea.experiments_tried : null,
      confidence_level: idea.confidence_level !== undefined ? idea.confidence_level : null,
      excitement_level: idea.excitement_level !== undefined ? idea.excitement_level : null,
      potential_impact: idea.potential_impact !== undefined ? idea.potential_impact : null,
      next_steps: idea.next_steps !== undefined ? idea.next_steps : null,
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
   * Find ideas by status
   */
  async findByStatus(status: string): Promise<Idea[]> {
    const query = `
      MATCH (i:Idea {status: $status})
      RETURN i
      ORDER BY i.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{ i: Idea }>(query, { status });
    return result.map((r) => r.i);
  }

  /**
   * Update idea status
   */
  async updateStatus(id: string, status: 'raw' | 'refined' | 'abandoned' | 'implemented'): Promise<void> {
    const query = `
      MATCH (i:Idea {id: $id})
      SET i.status = $status,
          i.updated_at = datetime(),
          i.refined_at = CASE WHEN $status = 'refined' THEN datetime() ELSE i.refined_at END
      RETURN i
    `;

    const result = await neo4jService.executeQuery<{ i: Idea }>(query, { id, status });

    if (!result[0]) {
      throw new Error(`Idea with id ${id} not found`);
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
