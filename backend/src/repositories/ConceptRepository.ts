import crypto from 'crypto';
import { neo4jService, neo4jInt } from '../db/neo4j.js';
import { Concept } from '../types/graph.js';

/**
 * Repository for Concept entities in Neo4j
 * Handles CRUD operations, relationship management, and semantic search
 */
export class ConceptRepository {
  /**
   * Generate stable entity_key for a concept
   */
  private generateEntityKey(name: string, userId: string): string {
    const normalized = name.toLowerCase();
    return crypto.createHash('sha256').update(normalized + 'concept' + userId).digest('hex');
  }

  /**
   * Create a new concept
   * Generates entity_key from name + user_id
   *
   * @param concept - Concept data to create
   * @param provenance - Provenance tracking data
   * @param sourceEntityKey - Optional Source node entity_key to auto-create mention relationship
   */
  async create(
    concept: { name: string; user_id: string; description: string; notes?: Array<{content: string; added_by: string; date_added: string; source_entity_key: string | null; expires_at: string | null}> },
    provenance: { last_update_source: string; confidence: number },
    sourceEntityKey?: string
  ): Promise<{ entity_key: string }> {
    const entity_key = this.generateEntityKey(concept.name, concept.user_id);

    const query = `
      CREATE (c:Concept {
        entity_key: $entity_key,
        user_id: $user_id,
        created_by: $user_id,
        name: $name,
        description: $description,
        notes: $notes,
        last_update_source: $last_update_source,
        confidence: $confidence,
        created_at: datetime(),
        updated_at: datetime(),
        salience: 0.5,
        state: 'candidate',
        access_count: 0,
        recall_frequency: 0,
        last_recall_interval: 0,
        decay_gradient: 1.0,
        last_accessed_at: null,
        is_dirty: false,
        source_count: 0,
        first_mentioned_at: null,
        distinct_source_days: 0,
        distinct_days: [],
        has_meso: false,
        has_macro: false
      })
      RETURN c.entity_key as entity_key
    `;

    const params = {
      entity_key,
      user_id: concept.user_id,
      name: concept.name,
      description: concept.description,
      notes: concept.notes !== undefined ? concept.notes.slice(0, 100) : [],
      last_update_source: provenance.last_update_source,
      confidence: provenance.confidence,
    };

    const result = await neo4jService.executeQuery<{ entity_key: string }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create concept');
    }

    // Auto-create mention relationship if source_entity_key provided
    if (sourceEntityKey) {
      const mentionQuery = `
        MATCH (s:Source {entity_key: $source_entity_key})
        MATCH (c:Concept {entity_key: $entity_key})
        MERGE (s)-[r:mentions]->(c)
        ON CREATE SET r.created_at = datetime()
      `;
      await neo4jService.executeQuery(mentionQuery, {
        source_entity_key: sourceEntityKey,
        entity_key: entity_key,
      });
    }

    return { entity_key: result[0].entity_key };
  }

  /**
   * Update an existing concept
   * Updates only provided fields (partial update)
   *
   * @param entity_key - Entity key of concept to update
   * @param updates - Partial updates to apply
   * @param provenance - Provenance tracking data
   * @param sourceEntityKey - Optional Source node entity_key to auto-create mention relationship
   */
  async update(
    entity_key: string,
    updates: { name?: string; description?: string; notes?: Array<{content: string; added_by: string; date_added: string; source_entity_key: string | null; expires_at: string | null}> },
    provenance: { last_update_source: string; confidence: number },
    sourceEntityKey?: string
  ): Promise<{ entity_key: string }> {
    // Build dynamic SET clause based on provided fields
    const setFields: string[] = [
      'c.updated_at = datetime()',
      'c.last_update_source = $last_update_source',
      'c.confidence = $confidence',
    ];
    const params: Record<string, unknown> = {
      entity_key,
      last_update_source: provenance.last_update_source,
      confidence: provenance.confidence,
    };

    if (updates.name !== undefined) {
      setFields.push('c.name = $name');
      params.name = updates.name;
    }
    if (updates.description !== undefined) {
      setFields.push('c.description = $description');
      params.description = updates.description;
    }
    if (updates.notes !== undefined) {
      setFields.push('c.notes = $notes');
      params.notes = updates.notes.slice(0, 100);
    }

    const query = `
      MATCH (c:Concept {entity_key: $entity_key})
      SET ${setFields.join(', ')}
      RETURN c.entity_key as entity_key
    `;

    const result = await neo4jService.executeQuery<{ entity_key: string }>(query, params);

    if (!result[0]) {
      throw new Error(`Concept with entity_key ${entity_key} not found`);
    }

    // Auto-create mention relationship if source_entity_key provided
    if (sourceEntityKey) {
      const mentionQuery = `
        MATCH (s:Source {entity_key: $source_entity_key})
        MATCH (c:Concept {entity_key: $entity_key})
        MERGE (s)-[r:mentions]->(c)
        ON CREATE SET r.created_at = datetime()
      `;
      await neo4jService.executeQuery(mentionQuery, {
        source_entity_key: sourceEntityKey,
        entity_key: entity_key,
      });
    }

    return { entity_key: result[0].entity_key };
  }

  /**
   * Create or update a concept
   * MERGE by entity_key for idempotency
   *
   * @param concept - Concept data to create/update
   * @param sourceEntityKey - Optional Source node entity_key to auto-create mention relationship
   */
  async upsert(
    concept: Partial<Concept> & { name: string; user_id: string; description: string },
    sourceEntityKey?: string
  ): Promise<Concept> {
    const entity_key = this.generateEntityKey(concept.name, concept.user_id);

    const query = `
      MERGE (c:Concept {entity_key: $entity_key})
      ON CREATE SET
        c.user_id = $user_id,
        c.created_by = $user_id,
        c.name = $name,
        c.description = $description,
        c.notes = $notes,
        c.embedding = $embedding,
        c.created_at = datetime(),
        c.updated_at = datetime(),
        c.last_update_source = $last_update_source,
        c.confidence = $confidence,
        c.salience = 0.5,
        c.state = 'candidate',
        c.access_count = 0,
        c.recall_frequency = 0,
        c.last_recall_interval = 0,
        c.decay_gradient = 1.0,
        c.last_accessed_at = null,
        c.is_dirty = false,
        c.source_count = 0,
        c.first_mentioned_at = null,
        c.distinct_source_days = 0,
        c.distinct_days = [],
        c.has_meso = false,
        c.has_macro = false
      ON MATCH SET
        c.name = $name,
        c.description = $description,
        c.notes = coalesce($notes, c.notes),
        c.embedding = coalesce($embedding, c.embedding),
        c.last_update_source = $last_update_source,
        c.confidence = CASE WHEN $confidence IS NOT NULL THEN $confidence ELSE c.confidence END,
        c.updated_at = datetime()
      RETURN c
    `;

    // Ensure required provenance fields are set
    const last_update_source = concept.last_update_source ?? sourceEntityKey;
    if (!last_update_source) {
      throw new Error('last_update_source is required - must be provided via concept.last_update_source or sourceEntityKey parameter');
    }

    const params = {
      entity_key,
      user_id: concept.user_id,
      name: concept.name,
      description: concept.description,
      notes: concept.notes !== undefined ? (Array.isArray(concept.notes) ? concept.notes.slice(0, 100) : []) : [],
      embedding: concept.embedding !== undefined ? concept.embedding : null,
      last_update_source,
      confidence: concept.confidence !== undefined ? concept.confidence : 0.8,
    };

    const result = await neo4jService.executeQuery<{ c: Concept }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create/update concept');
    }

    // Auto-create mention relationship if source_entity_key provided
    if (sourceEntityKey) {
      const mentionQuery = `
        MATCH (s:Source {entity_key: $source_entity_key})
        MATCH (c:Concept {entity_key: $entity_key})
        MERGE (s)-[r:mentions]->(c)
        ON CREATE SET r.created_at = datetime()
        ON MATCH SET r.updated_at = datetime()
      `;
      await neo4jService.executeQuery(mentionQuery, {
        source_entity_key: sourceEntityKey,
        entity_key,
      });
    }

    return result[0].c;
  }

  /**
   * Find concept by entity_key
   */
  async findById(entityKey: string): Promise<Concept | null> {
    const query = 'MATCH (c:Concept {entity_key: $entityKey}) RETURN c';
    const result = await neo4jService.executeQuery<{ c: Concept }>(query, { entityKey });
    return result[0]?.c !== undefined ? result[0].c : null;
  }

  /**
   * Find concept by name and user_id
   * Generates entity_key from name to perform lookup
   */
  async findByName(name: string, userId: string): Promise<Concept | null> {
    const entity_key = this.generateEntityKey(name, userId);
    return this.findById(entity_key);
  }

  /**
   * Update concept embedding
   */
  async updateEmbedding(entityKey: string, embedding: number[]): Promise<void> {
    const query = `
      MATCH (c:Concept {entity_key: $entityKey})
      SET c.embedding = $embedding
    `;

    await neo4jService.executeQuery(query, { entityKey, embedding });
  }

  /**
   * Search concepts by semantic similarity using embedding
   * Uses cosine similarity for vector search
   *
   * Note: Requires vector index to be created:
   * CREATE VECTOR INDEX concept_embedding IF NOT EXISTS
   * FOR (c:Concept) ON (c.embedding)
   * OPTIONS { indexConfig: {
   *   `vector.dimensions`: 1536,
   *   `vector.similarity_function`: 'cosine'
   * }}
   */
  async searchByEmbedding(
    embedding: number[],
    threshold: number,
    userId: string,
    limit: number = 10
  ): Promise<Array<Concept & { similarity: number }>> {
    const query = `
      MATCH (c:Concept {user_id: $userId})
      WHERE c.embedding IS NOT NULL
      WITH c,
        reduce(dot = 0.0, i IN range(0, size(c.embedding)-1) |
          dot + c.embedding[i] * $embedding[i]
        ) AS dotProduct,
        sqrt(reduce(sum = 0.0, x IN c.embedding | sum + x * x)) AS normA,
        sqrt(reduce(sum = 0.0, x IN $embedding | sum + x * x)) AS normB
      WITH c, dotProduct / (normA * normB) AS similarity
      WHERE similarity >= $threshold
      RETURN c, similarity
      ORDER BY similarity DESC
      LIMIT $limit
    `;

    const params = {
      embedding,
      threshold,
      userId,
      limit: neo4jInt(limit),
    };

    const result = await neo4jService.executeQuery<{ c: Concept; similarity: number }>(
      query,
      params
    );

    return result.map((r) => ({
      ...r.c,
      similarity: r.similarity,
    }));
  }

  /**
   * Get recently active concepts for a user
   * Ordered by updated_at descending
   */
  async getRecentlyActive(
    userId: string,
    daysBack: number = 30,
    limit: number = 20
  ): Promise<Concept[]> {
    const query = `
      MATCH (c:Concept {user_id: $userId})
      WHERE c.updated_at >= datetime() - duration({days: $daysBack})
      RETURN c
      ORDER BY c.updated_at DESC
      LIMIT $limit
    `;

    const params = {
      userId,
      daysBack,
      limit: neo4jInt(limit),
    };

    const result = await neo4jService.executeQuery<{ c: Concept }>(query, params);
    return result.map((r) => r.c);
  }

  /**
   * Get all concepts for a user
   */
  async findByUserId(userId: string, limit: number = 100): Promise<Concept[]> {
    const query = `
      MATCH (c:Concept {user_id: $userId})
      RETURN c
      ORDER BY c.updated_at DESC
      LIMIT $limit
    `;

    const result = await neo4jService.executeQuery<{ c: Concept }>(query, { userId, limit: neo4jInt(limit) });
    return result.map((r) => r.c);
  }

  /**
   * Delete a concept by entity_key
   * Also removes all relationships
   */
  async delete(entityKey: string): Promise<void> {
    const query = `
      MATCH (c:Concept {entity_key: $entityKey})
      DETACH DELETE c
    `;

    await neo4jService.executeQuery(query, { entityKey });
  }

  /**
   * Get concepts related to a specific concept
   * Via (Concept)-[:relates_to]->(Concept) relationships
   */
  async getRelatedConcepts(entityKey: string, limit: number = 10): Promise<
    Array<{
      concept: Concept;
      notes: string;
      relevance: number;
    }>
  > {
    const query = `
      MATCH (c1:Concept {entity_key: $entityKey})-[r:relates_to]->(c2:Concept)
      RETURN c2 as concept, r.notes as notes, r.relevance as relevance
      ORDER BY r.relevance DESC, r.updated_at DESC
      LIMIT $limit
    `;

    const result = await neo4jService.executeQuery<{
      concept: Concept;
      notes: string;
      relevance: number;
    }>(query, { entityKey, limit: neo4jInt(limit) });

    return result;
  }

  /**
   * Get people involved in a concept
   * Via (Concept)-[:involves]->(Person) relationships
   */
  async getInvolvedPeople(entityKey: string, limit: number = 10): Promise<
    Array<{
      person: { entity_key: string; name: string; canonical_name: string };
      notes: string;
      relevance: number;
    }>
  > {
    const query = `
      MATCH (c:Concept {entity_key: $entityKey})-[r:involves]->(p:Person)
      RETURN {
        entity_key: p.entity_key,
        name: p.name,
        canonical_name: p.canonical_name
      } as person, r.notes as notes, r.relevance as relevance
      ORDER BY r.relevance DESC, r.updated_at DESC
      LIMIT $limit
    `;

    const result = await neo4jService.executeQuery<{
      person: { entity_key: string; name: string; canonical_name: string };
      notes: string;
      relevance: number;
    }>(query, { entityKey, limit: neo4jInt(limit) });

    return result;
  }

  /**
   * Get entities involved in a concept
   * Via (Concept)-[:involves]->(Entity) relationships
   */
  async getInvolvedEntities(entityKey: string, limit: number = 10): Promise<
    Array<{
      entity: { entity_key: string; name: string; description: string };
      notes: string;
      relevance: number;
    }>
  > {
    const query = `
      MATCH (c:Concept {entity_key: $entityKey})-[r:involves]->(e:Entity)
      RETURN {
        entity_key: e.entity_key,
        name: e.name,
        description: e.description
      } as entity, r.notes as notes, r.relevance as relevance
      ORDER BY r.relevance DESC, r.updated_at DESC
      LIMIT $limit
    `;

    const result = await neo4jService.executeQuery<{
      entity: { entity_key: string; name: string; description: string };
      notes: string;
      relevance: number;
    }>(query, { entityKey, limit: neo4jInt(limit) });

    return result;
  }

  /**
   * Create or update relationship between two concepts
   */
  async relateConcepts(
    fromEntityKey: string,
    toEntityKey: string,
    notes: string,
    relevance: number
  ): Promise<void> {
    const query = `
      MATCH (c1:Concept {entity_key: $fromEntityKey})
      MATCH (c2:Concept {entity_key: $toEntityKey})
      MERGE (c1)-[r:relates_to]->(c2)
      SET r.notes = $notes,
          r.relevance = $relevance,
          r.updated_at = datetime()
      ON CREATE SET r.created_at = datetime()
    `;

    await neo4jService.executeQuery(query, {
      fromEntityKey,
      toEntityKey,
      notes,
      relevance,
    });
  }

  /**
   * Link concept to person via involves relationship
   */
  async linkToPerson(
    conceptEntityKey: string,
    personEntityKey: string,
    notes: string,
    relevance: number
  ): Promise<void> {
    const query = `
      MATCH (c:Concept {entity_key: $conceptEntityKey})
      MATCH (p:Person {entity_key: $personEntityKey})
      MERGE (c)-[r:involves]->(p)
      SET r.notes = $notes,
          r.relevance = $relevance,
          r.updated_at = datetime()
      ON CREATE SET r.created_at = datetime()
    `;

    await neo4jService.executeQuery(query, {
      conceptEntityKey,
      personEntityKey,
      notes,
      relevance,
    });
  }

  /**
   * Link concept to entity via involves relationship
   */
  async linkToEntity(
    conceptEntityKey: string,
    entityKey: string,
    notes: string,
    relevance: number
  ): Promise<void> {
    const query = `
      MATCH (c:Concept {entity_key: $conceptEntityKey})
      MATCH (e:Entity {entity_key: $entityKey})
      MERGE (c)-[r:involves]->(e)
      SET r.notes = $notes,
          r.relevance = $relevance,
          r.updated_at = datetime()
      ON CREATE SET r.created_at = datetime()
    `;

    await neo4jService.executeQuery(query, {
      conceptEntityKey,
      entityKey,
      notes,
      relevance,
    });
  }

  /**
   * Get sources that mention this concept
   */
  async getMentioningSources(entityKey: string, limit: number = 10): Promise<
    Array<{
      source_entity_key: string;
      description: string;
    }>
  > {
    const query = `
      MATCH (s:Source)-[:mentions]->(c:Concept {entity_key: $entityKey})
      RETURN s.entity_key as source_entity_key, s.description as description
      ORDER BY s.updated_at DESC
      LIMIT $limit
    `;

    const result = await neo4jService.executeQuery<{
      source_entity_key: string;
      description: string;
    }>(query, { entityKey, limit: neo4jInt(limit) });

    return result;
  }

  /**
   * Increment access tracking for a concept when it's retrieved
   *
   * Updates (per decay.md):
   * - access_count += 1
   * - recall_frequency += 1
   * - last_accessed_at = now
   * - salience = min(1.0, salience + α) where α ∈ [0.05, 0.1]
   * - state: candidate → active (first access), active → core (10+ accesses)
   */
  async incrementAccess(entityKey: string): Promise<void> {
    const salienceBoost = 0.075; // Mid-point of [0.05, 0.1] range

    const query = `
      MATCH (c:Concept {entity_key: $entityKey})
      SET
        c.access_count = coalesce(c.access_count, 0) + 1,
        c.recall_frequency = coalesce(c.recall_frequency, 0) + 1,
        c.last_accessed_at = datetime(),
        c.salience = CASE
          WHEN coalesce(c.salience, 0.5) + $salienceBoost > 1.0 THEN 1.0
          ELSE coalesce(c.salience, 0.5) + $salienceBoost
        END,
        c.state = CASE
          WHEN coalesce(c.access_count, 0) + 1 >= 10 THEN 'core'
          WHEN coalesce(c.access_count, 0) + 1 >= 1 THEN 'active'
          ELSE coalesce(c.state, 'candidate')
        END
    `;

    await neo4jService.executeQuery(query, { entityKey, salienceBoost });
  }

  /**
   * Batch increment access for multiple concepts
   * More efficient than calling incrementAccess multiple times
   */
  async batchIncrementAccess(entityKeys: string[]): Promise<void> {
    if (entityKeys.length === 0) return;

    const salienceBoost = 0.075;

    const query = `
      UNWIND $entityKeys AS entityKey
      MATCH (c:Concept {entity_key: entityKey})
      SET
        c.access_count = coalesce(c.access_count, 0) + 1,
        c.recall_frequency = coalesce(c.recall_frequency, 0) + 1,
        c.last_accessed_at = datetime(),
        c.salience = CASE
          WHEN coalesce(c.salience, 0.5) + $salienceBoost > 1.0 THEN 1.0
          ELSE coalesce(c.salience, 0.5) + $salienceBoost
        END,
        c.state = CASE
          WHEN coalesce(c.access_count, 0) + 1 >= 10 THEN 'core'
          WHEN coalesce(c.access_count, 0) + 1 >= 1 THEN 'active'
          ELSE coalesce(c.state, 'candidate')
        END
    `;

    await neo4jService.executeQuery(query, { entityKeys, salienceBoost });
  }
}

export const conceptRepository = new ConceptRepository();
