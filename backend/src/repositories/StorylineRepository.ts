import crypto from 'crypto';
import { neo4jService, neo4jInt } from '../db/neo4j.js';
import { Storyline } from '../types/graph.js';

/**
 * Generate stable storyline_id
 * Formula: hash(anchor_entity_key + user_id + timestamp)
 */
function generateStorylineId(anchorEntityKey: string, userId: string): string {
  return crypto
    .createHash('sha256')
    .update(anchorEntityKey + userId + Date.now().toString())
    .digest('hex');
}

export class StorylineRepository {
  /**
   * Create a new Storyline node
   * Enforces uniqueness constraint: (anchor_entity_key, user_id)
   *
   * @param storyline - Storyline data to create
   */
  async create(
    storyline: Partial<Storyline> & {
      user_id: string;
      anchor_entity_key: string;
      name: string;
      description: string;
    }
  ): Promise<Storyline> {
    // Check for existing storyline with same anchor_entity_key and user_id
    const existingStoryline = await this.findByAnchor(storyline.anchor_entity_key, storyline.user_id);
    if (existingStoryline) {
      throw new Error(
        `Storyline already exists for anchor_entity_key=${storyline.anchor_entity_key} and user_id=${storyline.user_id}`
      );
    }

    const storylineId = storyline.storyline_id || generateStorylineId(storyline.anchor_entity_key, storyline.user_id);

    const query = `
      CREATE (st:Storyline {
        storyline_id: $storyline_id,
        user_id: $user_id,
        team_id: $team_id,
        anchor_entity_key: $anchor_entity_key,
        name: $name,
        description: $description,
        embedding: $embedding,
        is_dirty: $is_dirty,
        source_count: $source_count,
        started_at: $started_at,
        last_source_at: $last_source_at,
        salience: $salience,
        state: $state,
        ttl_policy: $ttl_policy,
        access_count: $access_count,
        recall_frequency: $recall_frequency,
        created_at: datetime(),
        updated_at: datetime()
      })
      RETURN st
    `;

    const params = {
      storyline_id: storylineId,
      user_id: storyline.user_id,
      team_id: storyline.team_id !== undefined ? storyline.team_id : null,
      anchor_entity_key: storyline.anchor_entity_key,
      name: storyline.name,
      description: storyline.description,
      embedding: storyline.embedding !== undefined ? storyline.embedding : null,
      is_dirty: storyline.is_dirty !== undefined ? storyline.is_dirty : false,
      source_count: storyline.source_count !== undefined ? neo4jInt(storyline.source_count) : neo4jInt(0),
      started_at: storyline.started_at !== undefined ? storyline.started_at : null,
      last_source_at: storyline.last_source_at !== undefined ? storyline.last_source_at : null,
      salience: storyline.salience !== undefined ? storyline.salience : 0.5,
      state: storyline.state !== undefined ? storyline.state : 'candidate',
      ttl_policy: storyline.ttl_policy !== undefined ? storyline.ttl_policy : null,
      access_count: storyline.access_count !== undefined ? neo4jInt(storyline.access_count) : neo4jInt(0),
      recall_frequency: storyline.recall_frequency !== undefined ? neo4jInt(storyline.recall_frequency) : neo4jInt(0),
    };

    const result = await neo4jService.executeQuery<{ st: Storyline }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create storyline');
    }

    return result[0].st;
  }

  /**
   * Find storyline by storyline_id
   */
  async findById(storylineId: string): Promise<Storyline | null> {
    const query = 'MATCH (st:Storyline {storyline_id: $storyline_id}) RETURN st';
    const result = await neo4jService.executeQuery<{ st: Storyline }>(query, { storyline_id: storylineId });
    return result[0]?.st !== undefined ? result[0].st : null;
  }

  /**
   * Find storyline by anchor entity and user
   * Enforces uniqueness: only one storyline per anchor per user
   */
  async findByAnchor(anchorEntityKey: string, userId: string): Promise<Storyline | null> {
    const query = `
      MATCH (st:Storyline {anchor_entity_key: $anchor_entity_key, user_id: $user_id})
      RETURN st
    `;
    const result = await neo4jService.executeQuery<{ st: Storyline }>(query, {
      anchor_entity_key: anchorEntityKey,
      user_id: userId,
    });
    return result[0]?.st !== undefined ? result[0].st : null;
  }

  /**
   * Update storyline properties
   * Supports partial updates via MERGE pattern
   */
  async update(
    storylineId: string,
    updates: Partial<{
      name: string;
      description: string;
      embedding: number[];
      is_dirty: boolean;
      source_count: number;
      started_at: string;
      last_source_at: string;
      salience: number;
      state: string;
      ttl_policy: string;
      access_count: number;
      recall_frequency: number;
    }>
  ): Promise<Storyline> {
    const query = `
      MATCH (st:Storyline {storyline_id: $storyline_id})
      SET
        st.name = coalesce($name, st.name),
        st.description = coalesce($description, st.description),
        st.embedding = coalesce($embedding, st.embedding),
        st.is_dirty = coalesce($is_dirty, st.is_dirty),
        st.source_count = coalesce($source_count, st.source_count),
        st.started_at = coalesce($started_at, st.started_at),
        st.last_source_at = coalesce($last_source_at, st.last_source_at),
        st.salience = coalesce($salience, st.salience),
        st.state = coalesce($state, st.state),
        st.ttl_policy = coalesce($ttl_policy, st.ttl_policy),
        st.access_count = coalesce($access_count, st.access_count),
        st.recall_frequency = coalesce($recall_frequency, st.recall_frequency),
        st.updated_at = datetime()
      RETURN st
    `;

    const params = {
      storyline_id: storylineId,
      name: updates.name !== undefined ? updates.name : null,
      description: updates.description !== undefined ? updates.description : null,
      embedding: updates.embedding !== undefined ? updates.embedding : null,
      is_dirty: updates.is_dirty !== undefined ? updates.is_dirty : null,
      source_count: updates.source_count !== undefined ? neo4jInt(updates.source_count) : null,
      started_at: updates.started_at !== undefined ? updates.started_at : null,
      last_source_at: updates.last_source_at !== undefined ? updates.last_source_at : null,
      salience: updates.salience !== undefined ? updates.salience : null,
      state: updates.state !== undefined ? updates.state : null,
      ttl_policy: updates.ttl_policy !== undefined ? updates.ttl_policy : null,
      access_count: updates.access_count !== undefined ? neo4jInt(updates.access_count) : null,
      recall_frequency: updates.recall_frequency !== undefined ? neo4jInt(updates.recall_frequency) : null,
    };

    const result = await neo4jService.executeQuery<{ st: Storyline }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to update storyline');
    }

    return result[0].st;
  }

  /**
   * Create relationship: (Storyline)-[:about]->(Person|Concept|Entity)
   * Links storyline to its anchoring entity
   */
  async linkToAnchor(storylineId: string, anchorEntityKey: string): Promise<void> {
    const query = `
      MATCH (st:Storyline {storyline_id: $storyline_id})
      MATCH (anchor) WHERE anchor.entity_key = $anchor_entity_key
        AND (anchor:Person OR anchor:Concept OR anchor:Entity)
      MERGE (st)-[r:about]->(anchor)
      ON CREATE SET r.created_at = datetime()
    `;

    await neo4jService.executeQuery(query, {
      storyline_id: storylineId,
      anchor_entity_key: anchorEntityKey,
    });
  }

  /**
   * Create relationship: (Storyline)-[:includes]->(Source)
   * Adds a source to this storyline
   */
  async addSource(storylineId: string, sourceEntityKey: string): Promise<void> {
    const query = `
      MATCH (st:Storyline {storyline_id: $storyline_id})
      MATCH (s:Source {entity_key: $source_entity_key})
      MERGE (st)-[r:includes]->(s)
      ON CREATE SET r.created_at = datetime()
    `;

    await neo4jService.executeQuery(query, {
      storyline_id: storylineId,
      source_entity_key: sourceEntityKey,
    });
  }

  /**
   * Get all Source nodes included in this storyline
   * Returns array of Source nodes ordered by created_at
   */
  async getSources(storylineId: string): Promise<
    Array<{
      entity_key: string;
      source_id: string;
      user_id: string;
      team_id?: string;
      title?: string;
      started_at?: string;
      ended_at?: string;
    }>
  > {
    const query = `
      MATCH (st:Storyline {storyline_id: $storyline_id})-[:includes]->(s:Source)
      RETURN s
      ORDER BY s.created_at ASC
    `;

    const result = await neo4jService.executeQuery<{
      s: {
        entity_key: string;
        source_id: string;
        user_id: string;
        team_id?: string;
        title?: string;
        started_at?: string;
        ended_at?: string;
      };
    }>(query, { storyline_id: storylineId });

    return result.map((r) => r.s);
  }

  /**
   * Get the anchor entity (Person, Concept, or Entity) for this storyline
   */
  async getAnchor(storylineId: string): Promise<{
    entity_key: string;
    name: string;
    type: 'Person' | 'Concept' | 'Entity';
  } | null> {
    const query = `
      MATCH (st:Storyline {storyline_id: $storyline_id})-[:about]->(anchor)
      WHERE anchor:Person OR anchor:Concept OR anchor:Entity
      RETURN anchor.entity_key as entity_key,
             coalesce(anchor.name, anchor.canonical_name) as name,
             labels(anchor)[0] as type
    `;

    const result = await neo4jService.executeQuery<{
      entity_key: string;
      name: string;
      type: 'Person' | 'Concept' | 'Entity';
    }>(query, { storyline_id: storylineId });

    return result[0] !== undefined ? result[0] : null;
  }

  /**
   * Increment access tracking for a storyline when it's retrieved
   *
   * Updates (per decay.md):
   * - access_count += 1
   * - recall_frequency += 1
   * - salience = min(1.0, salience + α) where α ∈ [0.05, 0.1]
   * - state: candidate → active (first access), active → core (10+ accesses)
   */
  async incrementAccess(storylineId: string): Promise<void> {
    const salienceBoost = 0.075; // Mid-point of [0.05, 0.1] range

    const query = `
      MATCH (st:Storyline {storyline_id: $storylineId})
      SET
        st.access_count = coalesce(st.access_count, 0) + 1,
        st.recall_frequency = coalesce(st.recall_frequency, 0) + 1,
        st.salience = CASE
          WHEN coalesce(st.salience, 0.5) + $salienceBoost > 1.0 THEN 1.0
          ELSE coalesce(st.salience, 0.5) + $salienceBoost
        END,
        st.state = CASE
          WHEN coalesce(st.access_count, 0) + 1 >= 10 THEN 'core'
          WHEN coalesce(st.access_count, 0) + 1 >= 1 THEN 'active'
          ELSE coalesce(st.state, 'candidate')
        END
    `;

    await neo4jService.executeQuery(query, { storylineId, salienceBoost });
  }

  /**
   * Delete storyline and all its relationships
   */
  async delete(storylineId: string): Promise<void> {
    const query = `
      MATCH (st:Storyline {storyline_id: $storyline_id})
      DETACH DELETE st
    `;

    await neo4jService.executeQuery(query, { storyline_id: storylineId });
  }

  /**
   * Get all storylines for a specific user
   * Ordered by most recently updated
   */
  async findByUserId(userId: string, limit: number = 100): Promise<Storyline[]> {
    const query = `
      MATCH (st:Storyline {user_id: $user_id})
      RETURN st
      ORDER BY st.updated_at DESC
      LIMIT $limit
    `;
    const result = await neo4jService.executeQuery<{ st: Storyline }>(query, {
      user_id: userId,
      limit: neo4jInt(limit),
    });
    return result.map((r) => r.st);
  }

  /**
   * Find storylines marked as dirty (needing refresh)
   * Used by nightly job to identify storylines that need re-summarization
   */
  async findDirty(userId?: string, limit: number = 50): Promise<Storyline[]> {
    const query = userId
      ? `
        MATCH (st:Storyline {user_id: $user_id, is_dirty: true})
        RETURN st
        ORDER BY st.updated_at ASC
        LIMIT $limit
      `
      : `
        MATCH (st:Storyline {is_dirty: true})
        RETURN st
        ORDER BY st.updated_at ASC
        LIMIT $limit
      `;

    const result = await neo4jService.executeQuery<{ st: Storyline }>(query, {
      user_id: userId,
      limit: neo4jInt(limit),
    });
    return result.map((r) => r.st);
  }

  /**
   * Mark storyline as dirty (needs refresh)
   * Used when new sources are added that should trigger re-summarization
   */
  async markDirty(storylineId: string): Promise<void> {
    const query = `
      MATCH (st:Storyline {storyline_id: $storyline_id})
      SET st.is_dirty = true, st.updated_at = datetime()
    `;

    await neo4jService.executeQuery(query, { storyline_id: storylineId });
  }
}

export const storylineRepository = new StorylineRepository();
