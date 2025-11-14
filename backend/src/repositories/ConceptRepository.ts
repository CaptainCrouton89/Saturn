import crypto from 'crypto';
import { neo4jService, neo4jInt } from '../db/neo4j.js';
import { Concept, NoteObject } from '../types/graph.js';
import { parseNotes, stringifyNotes } from '../utils/notes.js';

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
   * Throws error if concept with same entity_key already exists
   *
   * @param concept - Concept data to create
   * @param provenance - Provenance tracking data
   * @param sourceEntityKey - Optional Source node entity_key to auto-create mention relationship
   */
  async create(
    concept: { name: string; user_id: string; description: string; notes?: NoteObject[] },
    provenance: { last_update_source: string; confidence: number },
    sourceEntityKey?: string
  ): Promise<{ entity_key: string }> {
    const entity_key = this.generateEntityKey(concept.name, concept.user_id);

    // Check if concept already exists
    const existing = await this.findById(entity_key);
    if (existing) {
      throw new Error(`Concept with entity_key ${entity_key} already exists`);
    }

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
      notes: concept.notes !== undefined ? stringifyNotes(concept.notes.slice(0, 100)) : stringifyNotes([]),
      last_update_source: provenance.last_update_source,
      confidence: provenance.confidence,
    };

    const result = await neo4jService.executeQuery<{ entity_key: string }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create concept');
    }

    // Auto-create mention relationship if source_entity_key provided
    if (sourceEntityKey) {
      await this.createMentionRelationship(sourceEntityKey, entity_key);
    }

    return { entity_key: result[0].entity_key };
  }

  /**
   * Update an existing concept
   * Updates only provided fields (partial update)
   * Throws error if concept doesn't exist
   *
   * @param entity_key - Entity key of concept to update
   * @param updates - Partial updates to apply
   * @param provenance - Provenance tracking data
   * @param sourceEntityKey - Optional Source node entity_key to auto-create mention relationship
   */
  async update(
    entity_key: string,
    updates: { name?: string; description?: string; notes?: NoteObject[] },
    provenance: { last_update_source: string; confidence: number },
    sourceEntityKey?: string
  ): Promise<{ entity_key: string }> {
    // Check if concept exists
    const existing = await this.findById(entity_key);
    if (!existing) {
      throw new Error(`Concept with entity_key ${entity_key} not found`);
    }

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
      params.notes = stringifyNotes(updates.notes.slice(0, 100));
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
      await this.createMentionRelationship(sourceEntityKey, entity_key);
    }

    return { entity_key: result[0].entity_key };
  }

  /**
   * Create mention relationship from Source to Concept
   * Throws error if relationship already exists
   *
   * @param sourceEntityKey - Source node entity_key
   * @param conceptEntityKey - Concept node entity_key
   */
  private async createMentionRelationship(sourceEntityKey: string, conceptEntityKey: string): Promise<void> {
    // Check if relationship already exists
    const checkQuery = `
      MATCH (s:Source {entity_key: $source_entity_key})-[r:mentions]->(c:Concept {entity_key: $concept_entity_key})
      RETURN r
      LIMIT 1
    `;
    const existing = await neo4jService.executeQuery<{ r: unknown }>(checkQuery, {
      source_entity_key: sourceEntityKey,
      concept_entity_key: conceptEntityKey,
    });

    if (existing.length > 0) {
      throw new Error(
        `Mention relationship from Source ${sourceEntityKey} to Concept ${conceptEntityKey} already exists`
      );
    }

    // Create relationship
    const createQuery = `
      MATCH (s:Source {entity_key: $source_entity_key})
      MATCH (c:Concept {entity_key: $concept_entity_key})
      CREATE (s)-[r:mentions]->(c)
      SET r.created_at = datetime()
    `;
    await neo4jService.executeQuery(createQuery, {
      source_entity_key: sourceEntityKey,
      concept_entity_key: conceptEntityKey,
    });
  }

  /**
   * Find concept by entity_key
   */
  async findById(entityKey: string): Promise<Concept | null> {
    const query = 'MATCH (c:Concept {entity_key: $entityKey}) RETURN c';
    const result = await neo4jService.executeQuery<{ c: Concept }>(query, { entityKey });
    if (!result[0]?.c) return null;
    const concept = result[0].c;
    return {
      ...concept,
      notes: concept.notes !== undefined ? parseNotes(concept.notes) : undefined,
    };
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
   * Find concept by exact name match
   * Used for entity resolution - exact matching tier
   *
   * @param userId - User ID to scope search
   * @param name - Name to match against c.name
   * @param canonicalName - Optional canonical name (unused for Concept, kept for interface consistency)
   * @param type - Entity type (unused for ConceptRepository, kept for interface consistency)
   * @returns First matching Concept or null
   */
  async findByExactMatch(
    userId: string,
    name: string,
    _canonicalName?: string,
    _type: string = 'Concept'
  ): Promise<Concept | null> {
    const query = `
      MATCH (c:Concept {user_id: $user_id, name: $name})
      RETURN c
      LIMIT 1
    `;

    const result = await neo4jService.executeQuery<{ c: Concept }>(query, {
      user_id: userId,
      name: name,
    });

    if (!result[0]?.c) return null;
    const concept = result[0].c;
    return {
      ...concept,
      notes: concept.notes !== undefined ? parseNotes(concept.notes) : undefined,
    };
  }

  /**
   * Find concepts by fuzzy name matching using Levenshtein distance
   * Used for entity resolution - fuzzy matching tier
   *
   * @param userId - User ID to scope search
   * @param name - Name to match against
   * @param type - Entity type (unused for ConceptRepository, kept for interface consistency)
   * @param distanceThreshold - Maximum Levenshtein distance (default: 3)
   * @returns Up to 5 matching Concept nodes ordered by distance
   */
  async findByFuzzyMatch(
    userId: string,
    name: string,
    _type: string = 'Concept',
    distanceThreshold: number = 3
  ): Promise<Concept[]> {
    const query = `
      MATCH (c:Concept {user_id: $user_id})
      WITH c, apoc.text.distance(c.name, $name) AS distance
      WHERE distance <= $threshold
      RETURN c, distance
      ORDER BY distance ASC
      LIMIT 5
    `;

    const result = await neo4jService.executeQuery<{ c: Concept; distance: number }>(query, {
      user_id: userId,
      name: name,
      threshold: distanceThreshold,
    });

    return result.map((r) => ({
      ...r.c,
      notes: r.c.notes !== undefined ? parseNotes(r.c.notes) : undefined,
    }));
  }

  /**
   * Find concepts by embedding similarity using cosine similarity
   * Used for entity resolution - embedding-based matching tier
   *
   * @param userId - User ID to scope search
   * @param embedding - Vector embedding to compare against
   * @param type - Entity type (unused for ConceptRepository, kept for interface consistency)
   * @param similarityThreshold - Minimum cosine similarity score (default: 0.75)
   * @param limit - Maximum number of results (default: 20)
   * @returns Array of Concept nodes with similarity_score, ordered by score DESC
   */
  async findByEmbeddingSimilarity(
    userId: string,
    embedding: number[],
    _type: string = 'Concept',
    similarityThreshold: number = 0.75,
    limit: number = 20
  ): Promise<Array<Concept & { similarity_score: number }>> {
    const query = `
      MATCH (c:Concept {user_id: $user_id})
      WHERE c.embedding IS NOT NULL
      WITH c, gds.similarity.cosine(c.embedding, $embedding) AS score
      WHERE score > $threshold
      RETURN c, score AS similarity_score
      ORDER BY score DESC
      LIMIT $limit
    `;

    const result = await neo4jService.executeQuery<{ c: Concept; similarity_score: number }>(query, {
      user_id: userId,
      embedding: embedding,
      threshold: similarityThreshold,
      limit: neo4jInt(limit),
    });

    return result.map((r) => ({
      ...r.c,
      notes: r.c.notes !== undefined ? parseNotes(r.c.notes) : undefined,
      similarity_score: r.similarity_score,
    }));
  }

  /**
   * Deduplicate and aggregate candidates from multiple search tiers
   * Helper method for entity resolution
   *
   * @param exact - Results from exact match search
   * @param fuzzy - Results from fuzzy match search
   * @param similar - Results from embedding similarity search (with similarity_score)
   * @param maxCandidates - Maximum number of unique candidates to return (default: 20)
   * @returns Deduplicated array of Concept nodes (up to maxCandidates)
   */
  deduplicateCandidates(
    exact: Concept[],
    fuzzy: Concept[],
    similar: Array<Concept & { similarity_score: number }>,
    maxCandidates: number = 20
  ): Concept[] {
    const candidateMap = new Map<string, Concept>();

    // Add exact matches first (highest priority)
    for (const concept of exact) {
      if (!candidateMap.has(concept.entity_key)) {
        candidateMap.set(concept.entity_key, concept);
      }
    }

    // Add fuzzy matches (medium priority)
    for (const concept of fuzzy) {
      if (!candidateMap.has(concept.entity_key)) {
        candidateMap.set(concept.entity_key, concept);
      }
    }

    // Add embedding similarity matches (lower priority, but may have better semantic matches)
    // Sort by similarity_score DESC to prioritize higher scores
    const sortedSimilar = [...similar].sort((a, b) => b.similarity_score - a.similarity_score);
    for (const concept of sortedSimilar) {
      if (!candidateMap.has(concept.entity_key)) {
        candidateMap.set(concept.entity_key, concept);
      }
    }

    // Return up to maxCandidates
    return Array.from(candidateMap.values()).slice(0, maxCandidates);
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
    return result.map((r) => ({
      ...r.c,
      notes: r.c.notes !== undefined ? parseNotes(r.c.notes) : undefined,
    }));
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
    return result.map((r) => ({
      ...r.c,
      notes: r.c.notes !== undefined ? parseNotes(r.c.notes) : undefined,
    }));
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
      notes: NoteObject[];
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

    return result.map((r) => ({
      concept: {
        ...r.concept,
        notes: r.concept.notes !== undefined ? parseNotes(r.concept.notes) : undefined,
      },
      notes: parseNotes(r.notes),
      relevance: r.relevance,
    }));
  }

  /**
   * Get people involved in a concept
   * Via (Concept)-[:involves]->(Person) relationships
   */
  async getInvolvedPeople(entityKey: string, limit: number = 10): Promise<
    Array<{
      person: { entity_key: string; name: string; canonical_name: string };
      notes: NoteObject[];
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

    return result.map((r) => ({
      person: r.person,
      notes: parseNotes(r.notes),
      relevance: r.relevance,
    }));
  }

  /**
   * Get entities involved in a concept
   * Via (Concept)-[:involves]->(Entity) relationships
   */
  async getInvolvedEntities(entityKey: string, limit: number = 10): Promise<
    Array<{
      entity: { entity_key: string; name: string; description: string };
      notes: NoteObject[];
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

    return result.map((r) => ({
      entity: r.entity,
      notes: parseNotes(r.notes),
      relevance: r.relevance,
    }));
  }

  /**
   * Create relationship between two concepts
   * Throws error if relationship already exists
   */
  async relateConcepts(
    fromEntityKey: string,
    toEntityKey: string,
    notes: NoteObject[],
    relevance: number
  ): Promise<void> {
    // Check if relationship already exists
    const checkQuery = `
      MATCH (c1:Concept {entity_key: $fromEntityKey})-[r:relates_to]->(c2:Concept {entity_key: $toEntityKey})
      RETURN r
      LIMIT 1
    `;
    const existing = await neo4jService.executeQuery<{ r: unknown }>(checkQuery, {
      fromEntityKey,
      toEntityKey,
    });

    if (existing.length > 0) {
      throw new Error(
        `Relationship from Concept ${fromEntityKey} to Concept ${toEntityKey} already exists`
      );
    }

    // Create relationship
    const createQuery = `
      MATCH (c1:Concept {entity_key: $fromEntityKey})
      MATCH (c2:Concept {entity_key: $toEntityKey})
      CREATE (c1)-[r:relates_to]->(c2)
      SET r.notes = $notes,
          r.relevance = $relevance,
          r.created_at = datetime(),
          r.updated_at = datetime()
    `;

    await neo4jService.executeQuery(createQuery, {
      fromEntityKey,
      toEntityKey,
      notes: stringifyNotes(notes),
      relevance,
    });
  }

  /**
   * Link concept to person via involves relationship
   * Throws error if relationship already exists
   */
  async linkToPerson(
    conceptEntityKey: string,
    personEntityKey: string,
    notes: NoteObject[],
    relevance: number
  ): Promise<void> {
    // Check if relationship already exists
    const checkQuery = `
      MATCH (c:Concept {entity_key: $conceptEntityKey})-[r:involves]->(p:Person {entity_key: $personEntityKey})
      RETURN r
      LIMIT 1
    `;
    const existing = await neo4jService.executeQuery<{ r: unknown }>(checkQuery, {
      conceptEntityKey,
      personEntityKey,
    });

    if (existing.length > 0) {
      throw new Error(
        `Relationship from Concept ${conceptEntityKey} to Person ${personEntityKey} already exists`
      );
    }

    // Create relationship
    const createQuery = `
      MATCH (c:Concept {entity_key: $conceptEntityKey})
      MATCH (p:Person {entity_key: $personEntityKey})
      CREATE (c)-[r:involves]->(p)
      SET r.notes = $notes,
          r.relevance = $relevance,
          r.created_at = datetime(),
          r.updated_at = datetime()
    `;

    await neo4jService.executeQuery(createQuery, {
      conceptEntityKey,
      personEntityKey,
      notes: stringifyNotes(notes),
      relevance,
    });
  }

  /**
   * Link concept to entity via involves relationship
   * Throws error if relationship already exists
   */
  async linkToEntity(
    conceptEntityKey: string,
    entityKey: string,
    notes: NoteObject[],
    relevance: number
  ): Promise<void> {
    // Check if relationship already exists
    const checkQuery = `
      MATCH (c:Concept {entity_key: $conceptEntityKey})-[r:involves]->(e:Entity {entity_key: $entityKey})
      RETURN r
      LIMIT 1
    `;
    const existing = await neo4jService.executeQuery<{ r: unknown }>(checkQuery, {
      conceptEntityKey,
      entityKey,
    });

    if (existing.length > 0) {
      throw new Error(
        `Relationship from Concept ${conceptEntityKey} to Entity ${entityKey} already exists`
      );
    }

    // Create relationship
    const createQuery = `
      MATCH (c:Concept {entity_key: $conceptEntityKey})
      MATCH (e:Entity {entity_key: $entityKey})
      CREATE (c)-[r:involves]->(e)
      SET r.notes = $notes,
          r.relevance = $relevance,
          r.created_at = datetime(),
          r.updated_at = datetime()
    `;

    await neo4jService.executeQuery(createQuery, {
      conceptEntityKey,
      entityKey,
      notes: stringifyNotes(notes),
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
