import crypto from 'crypto';
import { neo4jService } from '../db/neo4j.js';
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
   */
  async create(
    concept: { name: string; user_id: string; description: string; notes?: string },
    provenance: { last_update_source: string; confidence: number }
  ): Promise<{ entity_key: string }> {
    const entity_key = this.generateEntityKey(concept.name, concept.user_id);

    const query = `
      CREATE (c:Concept {
        entity_key: $entity_key,
        user_id: $user_id,
        name: $name,
        description: $description,
        notes: $notes,
        last_update_source: $last_update_source,
        confidence: $confidence,
        created_at: datetime(),
        updated_at: datetime()
      })
      RETURN c.entity_key as entity_key
    `;

    const params = {
      entity_key,
      user_id: concept.user_id,
      name: concept.name,
      description: concept.description,
      notes: concept.notes !== undefined ? concept.notes : '',
      last_update_source: provenance.last_update_source,
      confidence: provenance.confidence,
    };

    const result = await neo4jService.executeQuery<{ entity_key: string }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create concept');
    }

    return { entity_key: result[0].entity_key };
  }

  /**
   * Update an existing concept
   * Updates only provided fields (partial update)
   */
  async update(
    entity_key: string,
    updates: { name?: string; description?: string; notes?: string },
    provenance: { last_update_source: string; confidence: number }
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
      params.notes = updates.notes;
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

    return { entity_key: result[0].entity_key };
  }

  /**
   * Create or update a concept
   * MERGE by entity_key for idempotency
   */
  async upsert(
    concept: Partial<Concept> & { name: string; user_id: string; description: string }
  ): Promise<Concept> {
    const entity_key = this.generateEntityKey(concept.name, concept.user_id);

    const query = `
      MERGE (c:Concept {entity_key: $entity_key})
      ON CREATE SET
        c.user_id = $user_id,
        c.name = $name,
        c.description = $description,
        c.notes = $notes,
        c.embedding = $embedding,
        c.created_at = datetime(),
        c.updated_at = datetime()
      ON MATCH SET
        c.name = $name,
        c.description = $description,
        c.notes = coalesce($notes, c.notes),
        c.embedding = coalesce($embedding, c.embedding),
        c.updated_at = datetime()
      RETURN c
    `;

    const params = {
      entity_key,
      user_id: concept.user_id,
      name: concept.name,
      description: concept.description,
      notes: concept.notes !== undefined ? concept.notes : '',
      embedding: concept.embedding !== undefined ? concept.embedding : null,
    };

    const result = await neo4jService.executeQuery<{ c: Concept }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create/update concept');
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
      limit,
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
      limit,
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

    const result = await neo4jService.executeQuery<{ c: Concept }>(query, { userId, limit });
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
    }>(query, { entityKey, limit });

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
    }>(query, { entityKey, limit });

    return result;
  }

  /**
   * Get entities involved in a concept
   * Via (Concept)-[:involves]->(Entity) relationships
   */
  async getInvolvedEntities(entityKey: string, limit: number = 10): Promise<
    Array<{
      entity: { entity_key: string; name: string; type: string; description: string };
      notes: string;
      relevance: number;
    }>
  > {
    const query = `
      MATCH (c:Concept {entity_key: $entityKey})-[r:involves]->(e:Entity)
      RETURN {
        entity_key: e.entity_key,
        name: e.name,
        type: e.type,
        description: e.description
      } as entity, r.notes as notes, r.relevance as relevance
      ORDER BY r.relevance DESC, r.updated_at DESC
      LIMIT $limit
    `;

    const result = await neo4jService.executeQuery<{
      entity: { entity_key: string; name: string; type: string; description: string };
      notes: string;
      relevance: number;
    }>(query, { entityKey, limit });

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
    }>(query, { entityKey, limit });

    return result;
  }
}

export const conceptRepository = new ConceptRepository();
