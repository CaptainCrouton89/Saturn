import crypto from 'crypto';
import { neo4jService, neo4jInt } from '../db/neo4j.js';
import { Macro } from '../types/graph.js';

/**
 * Generate stable macro_id
 * Formula: hash(anchor_entity_key + user_id)
 */
function generateMacroId(anchorEntityKey: string, userId: string): string {
  return crypto
    .createHash('sha256')
    .update(anchorEntityKey + userId)
    .digest('hex');
}

export class MacroRepository {
  /**
   * Validate Macro node invariants
   * - macro_id must be globally unique
   * - (anchor_entity_key, user_id) must be unique (one macro per anchor per user)
   * - user_id is required
   * - anchor_entity_key is required
   * - name and description are required
   */
  private validateMacroInvariants(
    macro: Partial<Macro> & { anchor_entity_key: string; user_id: string; name: string; description: string }
  ): void {
    if (!macro.user_id) {
      throw new Error('Macro node must have user_id set');
    }

    if (!macro.anchor_entity_key) {
      throw new Error('Macro node must have anchor_entity_key set');
    }

    if (!macro.name) {
      throw new Error('Macro node must have name set');
    }

    if (!macro.description) {
      throw new Error('Macro node must have description set');
    }
  }

  /**
   * Create a new macro
   * Enforces uniqueness: one macro per anchor per user
   *
   * @param macro - Macro data to create
   * @returns Created Macro node
   */
  async create(
    macro: Partial<Macro> & { anchor_entity_key: string; user_id: string; name: string; description: string }
  ): Promise<Macro> {
    this.validateMacroInvariants(macro);

    const macroId = macro.macro_id || generateMacroId(macro.anchor_entity_key, macro.user_id);

    // Check for existing macro with same anchor_entity_key and user_id
    const existingMacro = await this.findByAnchor(macro.anchor_entity_key, macro.user_id);
    if (existingMacro) {
      throw new Error(
        `Macro already exists for anchor_entity_key=${macro.anchor_entity_key} and user_id=${macro.user_id}`
      );
    }

    const query = `
      CREATE (m:Macro {
        macro_id: $macro_id,
        user_id: $user_id,
        team_id: $team_id,
        anchor_entity_key: $anchor_entity_key,
        name: $name,
        description: $description,
        embedding: $embedding,
        is_dirty: $is_dirty,
        storyline_count: $storyline_count,
        total_source_count: $total_source_count,
        started_at: $started_at,
        last_event_at: $last_event_at,
        salience: $salience,
        state: $state,
        ttl_policy: $ttl_policy,
        access_count: $access_count,
        recall_frequency: $recall_frequency,
        created_at: datetime(),
        updated_at: datetime(),
        last_accessed_at: null
      })
      RETURN m
    `;

    const params = {
      macro_id: macroId,
      user_id: macro.user_id,
      team_id: macro.team_id !== undefined ? macro.team_id : null,
      anchor_entity_key: macro.anchor_entity_key,
      name: macro.name,
      description: macro.description,
      embedding: macro.embedding !== undefined ? macro.embedding : null,
      is_dirty: macro.is_dirty !== undefined ? macro.is_dirty : false,
      storyline_count: macro.storyline_count !== undefined ? neo4jInt(macro.storyline_count) : 0,
      total_source_count: macro.total_source_count !== undefined ? neo4jInt(macro.total_source_count) : 0,
      started_at: macro.started_at !== undefined ? macro.started_at : null,
      last_event_at: macro.last_event_at !== undefined ? macro.last_event_at : null,
      salience: macro.salience !== undefined ? macro.salience : 0.5,
      state: macro.state !== undefined ? macro.state : 'candidate',
      ttl_policy: macro.ttl_policy !== undefined ? macro.ttl_policy : null,
      access_count: macro.access_count !== undefined ? neo4jInt(macro.access_count) : 0,
      recall_frequency: macro.recall_frequency !== undefined ? macro.recall_frequency : 0,
    };

    const result = await neo4jService.executeQuery<{ m: Macro }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create macro');
    }

    return result[0].m;
  }

  /**
   * Find macro by macro_id
   */
  async findById(macroId: string): Promise<Macro | null> {
    const query = 'MATCH (m:Macro {macro_id: $macro_id}) RETURN m';
    const result = await neo4jService.executeQuery<{ m: Macro }>(query, { macro_id: macroId });
    return result[0]?.m !== undefined ? result[0].m : null;
  }

  /**
   * Find macro by anchor_entity_key and user_id
   * Enforces uniqueness: one macro per anchor per user
   */
  async findByAnchor(anchorEntityKey: string, userId: string): Promise<Macro | null> {
    const query = `
      MATCH (m:Macro {anchor_entity_key: $anchor_entity_key, user_id: $user_id})
      RETURN m
    `;
    const result = await neo4jService.executeQuery<{ m: Macro }>(query, {
      anchor_entity_key: anchorEntityKey,
      user_id: userId,
    });
    return result[0]?.m !== undefined ? result[0].m : null;
  }

  /**
   * Update an existing macro
   * Supports partial updates for description, embedding, is_dirty, counters, and memory management fields
   */
  async update(macroId: string, updates: Partial<Omit<Macro, 'macro_id' | 'user_id' | 'created_at'>>): Promise<Macro> {
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { macro_id: macroId };

    // Build dynamic SET clauses for provided fields
    if (updates.team_id !== undefined) {
      setClauses.push('m.team_id = $team_id');
      params.team_id = updates.team_id;
    }
    if (updates.anchor_entity_key !== undefined) {
      setClauses.push('m.anchor_entity_key = $anchor_entity_key');
      params.anchor_entity_key = updates.anchor_entity_key;
    }
    if (updates.name !== undefined) {
      setClauses.push('m.name = $name');
      params.name = updates.name;
    }
    if (updates.description !== undefined) {
      setClauses.push('m.description = $description');
      params.description = updates.description;
    }
    if (updates.embedding !== undefined) {
      setClauses.push('m.embedding = $embedding');
      params.embedding = updates.embedding;
    }
    if (updates.is_dirty !== undefined) {
      setClauses.push('m.is_dirty = $is_dirty');
      params.is_dirty = updates.is_dirty;
    }
    if (updates.storyline_count !== undefined) {
      setClauses.push('m.storyline_count = $storyline_count');
      params.storyline_count = neo4jInt(updates.storyline_count);
    }
    if (updates.total_source_count !== undefined) {
      setClauses.push('m.total_source_count = $total_source_count');
      params.total_source_count = neo4jInt(updates.total_source_count);
    }
    if (updates.started_at !== undefined) {
      setClauses.push('m.started_at = $started_at');
      params.started_at = updates.started_at;
    }
    if (updates.last_event_at !== undefined) {
      setClauses.push('m.last_event_at = $last_event_at');
      params.last_event_at = updates.last_event_at;
    }
    if (updates.salience !== undefined) {
      setClauses.push('m.salience = $salience');
      params.salience = updates.salience;
    }
    if (updates.state !== undefined) {
      setClauses.push('m.state = $state');
      params.state = updates.state;
    }
    if (updates.ttl_policy !== undefined) {
      setClauses.push('m.ttl_policy = $ttl_policy');
      params.ttl_policy = updates.ttl_policy;
    }
    if (updates.access_count !== undefined) {
      setClauses.push('m.access_count = $access_count');
      params.access_count = neo4jInt(updates.access_count);
    }
    if (updates.recall_frequency !== undefined) {
      setClauses.push('m.recall_frequency = $recall_frequency');
      params.recall_frequency = updates.recall_frequency;
    }
    if (updates.last_accessed_at !== undefined) {
      setClauses.push('m.last_accessed_at = $last_accessed_at');
      params.last_accessed_at = updates.last_accessed_at;
    }

    // Always update updated_at
    setClauses.push('m.updated_at = datetime()');

    if (setClauses.length === 1) {
      // Only updated_at would be set, nothing to update
      const existing = await this.findById(macroId);
      if (!existing) {
        throw new Error(`Macro not found: ${macroId}`);
      }
      return existing;
    }

    const query = `
      MATCH (m:Macro {macro_id: $macro_id})
      SET ${setClauses.join(', ')}
      RETURN m
    `;

    const result = await neo4jService.executeQuery<{ m: Macro }>(query, params);

    if (!result[0]) {
      throw new Error(`Failed to update macro: ${macroId}`);
    }

    return result[0].m;
  }

  /**
   * Link macro to its anchor entity (Person, Concept, or Entity)
   * Creates (Macro)-[:rooted_in]->(Person|Concept|Entity) relationship
   *
   * @param macroId - macro_id of the Macro node
   * @param anchorEntityKey - entity_key of the anchor (Person/Concept/Entity)
   */
  async linkToAnchor(macroId: string, anchorEntityKey: string): Promise<void> {
    const query = `
      MATCH (m:Macro {macro_id: $macro_id})
      MATCH (anchor {entity_key: $anchor_entity_key})
      WHERE anchor:Person OR anchor:Concept OR anchor:Entity
      MERGE (m)-[r:rooted_in]->(anchor)
      ON CREATE SET r.created_at = datetime()
    `;

    await neo4jService.executeQuery(query, {
      macro_id: macroId,
      anchor_entity_key: anchorEntityKey,
    });
  }

  /**
   * Add a Storyline to a Macro
   * Creates (Macro)-[:groups]->(Storyline) relationship
   *
   * @param macroId - macro_id of the Macro node
   * @param storylineId - storyline_id of the Storyline node
   */
  async addStoryline(macroId: string, storylineId: string): Promise<void> {
    const query = `
      MATCH (m:Macro {macro_id: $macro_id})
      MATCH (s:Storyline {storyline_id: $storyline_id})
      MERGE (m)-[r:groups]->(s)
      ON CREATE SET r.created_at = datetime()
    `;

    await neo4jService.executeQuery(query, {
      macro_id: macroId,
      storyline_id: storylineId,
    });
  }

  /**
   * Get all Storylines grouped by a Macro
   * Returns Storyline nodes connected via (Macro)-[:groups]->(Storyline)
   */
  async getStorylines(macroId: string): Promise<
    Array<{
      storyline_id: string;
      user_id: string;
      team_id?: string | null;
      anchor_entity_key: string;
      name: string;
      description: string;
      [key: string]: unknown;
    }>
  > {
    const query = `
      MATCH (m:Macro {macro_id: $macro_id})-[:groups]->(s:Storyline)
      RETURN s
      ORDER BY s.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{
      s: {
        storyline_id: string;
        user_id: string;
        team_id?: string | null;
        anchor_entity_key: string;
        name: string;
        description: string;
        [key: string]: unknown;
      };
    }>(query, { macro_id: macroId });

    return result.map((r) => r.s);
  }

  /**
   * Get the anchor entity (Person, Concept, or Entity) for a Macro
   * Returns the entity connected via (Macro)-[:rooted_in]->(Person|Concept|Entity)
   */
  async getAnchor(macroId: string): Promise<{
    entity_key: string;
    name: string;
    type: string;
    [key: string]: unknown;
  } | null> {
    const query = `
      MATCH (m:Macro {macro_id: $macro_id})-[:rooted_in]->(anchor)
      WHERE anchor:Person OR anchor:Concept OR anchor:Entity
      RETURN anchor, labels(anchor) as labels
    `;

    const result = await neo4jService.executeQuery<{
      anchor: {
        entity_key: string;
        name: string;
        [key: string]: unknown;
      };
      labels: string[];
    }>(query, { macro_id: macroId });

    if (!result[0]) {
      return null;
    }

    const anchor = result[0].anchor;
    const labels = result[0].labels;

    // Determine the type from labels (Person, Concept, or Entity)
    const type = labels.find((label) => label === 'Person' || label === 'Concept' || label === 'Entity');

    if (!type) {
      throw new Error(`Macro anchor node has invalid labels: ${labels.join(', ')}. Expected Person, Concept, or Entity.`);
    }

    return {
      ...anchor,
      type,
    };
  }

  /**
   * Increment access tracking for a macro when it's retrieved
   *
   * Updates (per decay.md):
   * - access_count += 1
   * - recall_frequency += 1
   * - last_accessed_at = now
   * - salience = min(1.0, salience + α) where α ∈ [0.05, 0.1]
   * - state: candidate → active (first access), active → core (10+ accesses)
   */
  async incrementAccess(macroId: string): Promise<void> {
    const salienceBoost = 0.075; // Mid-point of [0.05, 0.1] range

    const query = `
      MATCH (m:Macro {macro_id: $macroId})
      SET
        m.access_count = coalesce(m.access_count, 0) + 1,
        m.recall_frequency = coalesce(m.recall_frequency, 0) + 1,
        m.last_accessed_at = datetime(),
        m.salience = CASE
          WHEN coalesce(m.salience, 0.5) + $salienceBoost > 1.0 THEN 1.0
          ELSE coalesce(m.salience, 0.5) + $salienceBoost
        END,
        m.state = CASE
          WHEN coalesce(m.access_count, 0) + 1 >= 10 THEN 'core'
          WHEN coalesce(m.access_count, 0) + 1 >= 1 THEN 'active'
          ELSE coalesce(m.state, 'active')
        END
    `;

    await neo4jService.executeQuery(query, { macroId, salienceBoost });
  }

  /**
   * Delete a macro and all its relationships
   *
   * @param macroId - macro_id of the Macro node to delete
   */
  async delete(macroId: string): Promise<void> {
    const query = `
      MATCH (m:Macro {macro_id: $macro_id})
      DETACH DELETE m
    `;

    await neo4jService.executeQuery(query, { macro_id: macroId });
  }

  /**
   * Get all macros for a specific user
   * Ordered by most recently updated
   */
  async findByUserId(userId: string, limit: number = 100): Promise<Macro[]> {
    const query = `
      MATCH (m:Macro {user_id: $user_id})
      RETURN m
      ORDER BY m.updated_at DESC
      LIMIT $limit
    `;
    const result = await neo4jService.executeQuery<{ m: Macro }>(query, { user_id: userId, limit: neo4jInt(limit) });
    return result.map((r) => r.m);
  }

  /**
   * Find macros by state (active, dormant, archived, etc.)
   */
  async findByState(userId: string, state: string, limit: number = 100): Promise<Macro[]> {
    const query = `
      MATCH (m:Macro {user_id: $user_id, state: $state})
      RETURN m
      ORDER BY m.updated_at DESC
      LIMIT $limit
    `;
    const result = await neo4jService.executeQuery<{ m: Macro }>(query, {
      user_id: userId,
      state,
      limit: neo4jInt(limit),
    });
    return result.map((r) => r.m);
  }

  /**
   * Get macros that need refresh (is_dirty = true)
   * Used by weekly job to refresh macro summaries
   */
  async findDirtyMacros(userId: string, limit: number = 100): Promise<Macro[]> {
    const query = `
      MATCH (m:Macro {user_id: $user_id, is_dirty: true})
      RETURN m
      ORDER BY m.updated_at DESC
      LIMIT $limit
    `;
    const result = await neo4jService.executeQuery<{ m: Macro }>(query, { user_id: userId, limit: neo4jInt(limit) });
    return result.map((r) => r.m);
  }
}

export const macroRepository = new MacroRepository();
