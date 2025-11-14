import { createHash } from 'crypto';
import { neo4jService, neo4jInt } from '../db/neo4j.js';
import { Entity, Person, Concept, RelationshipProperties, NoteObject } from '../types/graph.js';
import { parseNotes, stringifyNotes } from '../utils/notes.js';

export class EntityRepository {
  /**
   * Generate stable entity_key for idempotent operations
   */
  static generateEntityKey(name: string, userId: string): string {
    return createHash('sha256')
      .update(name.toLowerCase() + userId)
      .digest('hex');
  }

  /**
   * Create a new Entity (throws error if already exists)
   *
   * Uses CREATE (not MERGE) for fail-fast behavior.
   * Will throw Neo4j error if Entity with same entity_key already exists.
   *
   * @param entity - Entity data to create
   * @param sourceEntityKey - Optional Source node entity_key to auto-create mention relationship
   */
  async create(
    entity: Partial<Entity> & {
      name: string;
      user_id: string;
      description: string;
      last_update_source?: string;
      confidence?: number;
    },
    sourceEntityKey?: string
  ): Promise<{ entity_key: string }> {
    const entity_key = EntityRepository.generateEntityKey(entity.name, entity.user_id);

    const query = `
      CREATE (e:Entity {
        entity_key: $entity_key,
        user_id: $user_id,
        created_by: $user_id,
        name: $name,
        description: $description,
        notes: $notes,
        embedding: $embedding,
        created_at: datetime(),
        updated_at: datetime(),
        last_update_source: $last_update_source,
        confidence: $confidence,
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
      RETURN e.entity_key as entity_key
    `;

    // Validate required provenance fields
    const last_update_source = entity.last_update_source ?? sourceEntityKey;
    if (!last_update_source) {
      throw new Error('last_update_source is required for Entity creation - must be provided via entity.last_update_source or sourceEntityKey parameter');
    }

    const params = {
      entity_key,
      user_id: entity.user_id,
      name: entity.name,
      description: entity.description,
      notes: stringifyNotes(entity.notes !== undefined ? (Array.isArray(entity.notes) ? entity.notes.slice(0, 100) : []) : []),
      embedding: entity.embedding !== undefined ? entity.embedding : null,
      last_update_source,
      confidence: entity.confidence !== undefined ? entity.confidence : 0.8,
    };

    const result = await neo4jService.executeQuery<{ entity_key: string }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create Entity');
    }

    // Auto-create mention relationship if source_entity_key provided
    if (sourceEntityKey) {
      const mentionQuery = `
        MATCH (s:Source {entity_key: $source_entity_key})
        MATCH (e:Entity {entity_key: $entity_key})
        MERGE (s)-[r:mentions]->(e)
        ON CREATE SET r.created_at = datetime()
        ON MATCH SET r.updated_at = datetime()
      `;
      await neo4jService.executeQuery(mentionQuery, {
        source_entity_key: sourceEntityKey,
        entity_key: entity_key,
      });
    }

    return result[0];
  }

  /**
   * Update an existing Entity (throws error if doesn't exist)
   *
   * Uses MATCH + SET (not MERGE) for fail-fast behavior.
   * Will throw error if Entity with entity_key doesn't exist.
   *
   * @param entity - Entity data to update (must include entity_key)
   * @param sourceEntityKey - Optional Source node entity_key to auto-create mention relationship
   */
  async update(
    entity: Partial<Entity> & {
      entity_key: string;
      last_update_source?: string;
      confidence?: number;
    },
    sourceEntityKey?: string
  ): Promise<Entity> {
    const query = `
      MATCH (e:Entity {entity_key: $entity_key})
      SET
        e.name = coalesce($name, e.name),
        e.description = coalesce($description, e.description),
        e.notes = CASE
          WHEN $notes IS NOT NULL THEN $notes
          ELSE e.notes
        END,
        e.embedding = coalesce($embedding, e.embedding),
        e.last_update_source = $last_update_source,
        e.confidence = CASE WHEN $confidence IS NOT NULL THEN $confidence ELSE e.confidence END,
        e.updated_at = datetime()
      RETURN e
    `;

    // Ensure required provenance fields are set
    const last_update_source = entity.last_update_source ?? sourceEntityKey;
    if (!last_update_source) {
      throw new Error('last_update_source is required for Entity update - must be provided via entity.last_update_source or sourceEntityKey parameter');
    }

    const result = await neo4jService.executeQuery<{ e: Entity }>(query, {
      entity_key: entity.entity_key,
      name: entity.name,
      description: entity.description,
      notes: entity.notes !== undefined ? stringifyNotes(Array.isArray(entity.notes) ? entity.notes.slice(0, 100) : []) : null,
      embedding: entity.embedding !== undefined ? entity.embedding : null,
      last_update_source,
      confidence: entity.confidence !== undefined ? entity.confidence : null,
    });

    if (!result[0]) {
      throw new Error(`Entity with entity_key ${entity.entity_key} not found`);
    }

    // Auto-create mention relationship if source_entity_key provided
    if (sourceEntityKey) {
      const mentionQuery = `
        MATCH (s:Source {entity_key: $source_entity_key})
        MATCH (e:Entity {entity_key: $entity_key})
        MERGE (s)-[r:mentions]->(e)
        ON CREATE SET r.created_at = datetime()
      `;
      await neo4jService.executeQuery(mentionQuery, {
        source_entity_key: sourceEntityKey,
        entity_key: entity.entity_key,
      });
    }

    const resultEntity = result[0].e;
    resultEntity.notes = parseNotes(resultEntity.notes);
    return resultEntity;
  }

  /**
   * Create relates_to relationship between two entities (throws if relationship exists)
   *
   * Uses CREATE (not MERGE) for fail-fast behavior.
   * Will throw Neo4j error if relationship already exists.
   *
   * @param fromEntityKey - Source Entity entity_key
   * @param toEntityKey - Target Entity entity_key
   * @param properties - Relationship properties
   */
  async createEntityRelationship(
    fromEntityKey: string,
    toEntityKey: string,
    properties: Partial<NonNullable<RelationshipProperties['RELATES_TO_ENTITY']>> & {
      relationship_type: string;
    }
  ): Promise<NonNullable<RelationshipProperties['RELATES_TO_ENTITY']>> {
    const query = `
      MATCH (e1:Entity {entity_key: $fromEntityKey})
      MATCH (e2:Entity {entity_key: $toEntityKey})
      CREATE (e1)-[r:relates_to {
        relationship_type: $relationship_type,
        notes: $notes,
        relevance: $relevance,
        created_at: datetime(),
        updated_at: datetime()
      }]->(e2)
      RETURN r
    `;

    const result = await neo4jService.executeQuery<{
      r: NonNullable<RelationshipProperties['RELATES_TO_ENTITY']>;
    }>(query, {
      fromEntityKey,
      toEntityKey,
      relationship_type: properties.relationship_type,
      notes: stringifyNotes(properties.notes || []),
      relevance: properties.relevance || 5,
    });

    if (!result[0]) {
      throw new Error(`Failed to create entity-entity relationship: Entity ${fromEntityKey} or ${toEntityKey} not found`);
    }

    const relationship = result[0].r;
    ((relationship as unknown) as { notes: NoteObject[] }).notes = parseNotes(relationship.notes);
    return relationship as unknown as NonNullable<RelationshipProperties['RELATES_TO_ENTITY']>;
  }

  /**
   * Update relates_to relationship between two entities (throws if relationship doesn't exist)
   *
   * Uses MATCH + SET (not MERGE) for fail-fast behavior.
   * Will throw error if relationship doesn't exist.
   *
   * @param fromEntityKey - Source Entity entity_key
   * @param toEntityKey - Target Entity entity_key
   * @param properties - Relationship properties to update
   */
  async updateEntityRelationship(
    fromEntityKey: string,
    toEntityKey: string,
    properties: Partial<NonNullable<RelationshipProperties['RELATES_TO_ENTITY']>> & {
      relationship_type?: string;
    }
  ): Promise<NonNullable<RelationshipProperties['RELATES_TO_ENTITY']>> {
    const query = `
      MATCH (e1:Entity {entity_key: $fromEntityKey})-[r:relates_to]->(e2:Entity {entity_key: $toEntityKey})
      SET
        r.relationship_type = coalesce($relationship_type, r.relationship_type),
        r.notes = CASE
          WHEN $notes IS NOT NULL THEN $notes
          ELSE r.notes
        END,
        r.relevance = coalesce($relevance, r.relevance),
        r.updated_at = datetime()
      RETURN r
    `;

    const result = await neo4jService.executeQuery<{
      r: NonNullable<RelationshipProperties['RELATES_TO_ENTITY']>;
    }>(query, {
      fromEntityKey,
      toEntityKey,
      relationship_type: properties.relationship_type,
      notes: properties.notes !== undefined ? stringifyNotes(Array.isArray(properties.notes) ? properties.notes : []) : null,
      relevance: properties.relevance,
    });

    if (!result[0]) {
      throw new Error(`Entity-entity relationship from ${fromEntityKey} to ${toEntityKey} not found`);
    }

    const relationship = result[0].r;
    ((relationship as unknown) as { notes: NoteObject[] }).notes = parseNotes(relationship.notes);
    return relationship as unknown as NonNullable<RelationshipProperties['RELATES_TO_ENTITY']>;
  }

  /**
   * Create associated_with relationship between Person and Entity (throws if relationship exists)
   *
   * Uses CREATE (not MERGE) for fail-fast behavior.
   * Will throw Neo4j error if relationship already exists.
   *
   * @param personEntityKey - Person entity_key
   * @param entityKey - Entity entity_key
   * @param properties - Relationship properties
   */
  async createPersonEntityRelationship(
    personEntityKey: string,
    entityKey: string,
    properties: Partial<NonNullable<RelationshipProperties['RELATES_TO_PERSON']>> & {
      relationship_type: string;
    }
  ): Promise<NonNullable<RelationshipProperties['RELATES_TO_PERSON']>> {
    const query = `
      MATCH (p:Person {entity_key: $personEntityKey})
      MATCH (e:Entity {entity_key: $entityKey})
      CREATE (p)-[r:associated_with {
        relationship_type: $relationship_type,
        notes: $notes,
        relevance: $relevance,
        created_at: datetime(),
        updated_at: datetime()
      }]->(e)
      RETURN r
    `;

    const result = await neo4jService.executeQuery<{
      r: NonNullable<RelationshipProperties['RELATES_TO_PERSON']>;
    }>(query, {
      personEntityKey,
      entityKey,
      relationship_type: properties.relationship_type,
      notes: stringifyNotes(properties.notes || []),
      relevance: properties.relevance || 5,
    });

    if (!result[0]) {
      throw new Error(`Failed to create person-entity relationship: Person ${personEntityKey} or Entity ${entityKey} not found`);
    }

    const relationship = result[0].r;
    ((relationship as unknown) as { notes: NoteObject[] }).notes = parseNotes(relationship.notes);
    return relationship as unknown as NonNullable<RelationshipProperties['RELATES_TO_PERSON']>;
  }

  /**
   * Update associated_with relationship between Person and Entity (throws if relationship doesn't exist)
   *
   * Uses MATCH + SET (not MERGE) for fail-fast behavior.
   * Will throw error if relationship doesn't exist.
   *
   * @param personEntityKey - Person entity_key
   * @param entityKey - Entity entity_key
   * @param properties - Relationship properties to update
   */
  async updatePersonEntityRelationship(
    personEntityKey: string,
    entityKey: string,
    properties: Partial<NonNullable<RelationshipProperties['RELATES_TO_PERSON']>> & {
      relationship_type?: string;
    }
  ): Promise<NonNullable<RelationshipProperties['RELATES_TO_PERSON']>> {
    const query = `
      MATCH (p:Person {entity_key: $personEntityKey})-[r:associated_with]->(e:Entity {entity_key: $entityKey})
      SET
        r.relationship_type = coalesce($relationship_type, r.relationship_type),
        r.notes = CASE
          WHEN $notes IS NOT NULL THEN $notes
          ELSE r.notes
        END,
        r.relevance = coalesce($relevance, r.relevance),
        r.updated_at = datetime()
      RETURN r
    `;

    const result = await neo4jService.executeQuery<{
      r: NonNullable<RelationshipProperties['RELATES_TO_PERSON']>;
    }>(query, {
      personEntityKey,
      entityKey,
      relationship_type: properties.relationship_type,
      notes: properties.notes !== undefined ? stringifyNotes(Array.isArray(properties.notes) ? properties.notes : []) : null,
      relevance: properties.relevance,
    });

    if (!result[0]) {
      throw new Error(`Person-entity relationship from ${personEntityKey} to ${entityKey} not found`);
    }

    const relationship = result[0].r;
    ((relationship as unknown) as { notes: NoteObject[] }).notes = parseNotes(relationship.notes);
    return relationship as unknown as NonNullable<RelationshipProperties['RELATES_TO_PERSON']>;
  }

  /**
   * Find entity by entity_key
   */
  async findById(entityKey: string): Promise<Entity | null> {
    const query = 'MATCH (e:Entity {entity_key: $entity_key}) RETURN e';
    const result = await neo4jService.executeQuery<{ e: Entity }>(query, { entity_key: entityKey });
    if (!result[0]?.e) return null;
    const entity = result[0].e;
    entity.notes = parseNotes(entity.notes);
    return entity;
  }

  /**
   * Search entities by name for a specific user
   */
  async searchByName(name: string, userId: string): Promise<Entity[]> {
    const query = `
      MATCH (e:Entity {user_id: $userId})
      WHERE e.name CONTAINS $name
      RETURN e
      ORDER BY e.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{ e: Entity }>(query, { name, userId });
    return result.map((r) => {
      const entity = r.e;
      entity.notes = parseNotes(entity.notes);
      return entity;
    });
  }

  /**
   * Search entities by embedding similarity (vector search)
   * @param embedding - Query embedding vector
   * @param threshold - Minimum similarity threshold (0-1)
   * @param userId - User ID to filter by
   * @param limit - Maximum number of results
   */
  async searchByEmbedding(
    embedding: number[],
    threshold: number,
    userId: string,
    limit: number = 10
  ): Promise<Array<{ entity: Entity; similarity: number }>> {
    const query = `
      MATCH (e:Entity {user_id: $userId})
      WHERE e.embedding IS NOT NULL
      WITH e, gds.similarity.cosine(e.embedding, $embedding) AS similarity
      WHERE similarity >= $threshold
      RETURN e, similarity
      ORDER BY similarity DESC
      LIMIT $limit
    `;

    const result = await neo4jService.executeQuery<{ e: Entity; similarity: number }>(query, {
      embedding,
      threshold,
      userId,
      limit: neo4jInt(limit),
    });

    return result.map((r) => {
      const entity = r.e;
      entity.notes = parseNotes(entity.notes);
      return {
        entity,
        similarity: r.similarity,
      };
    });
  }

  /**
   * Get recently active entities for a user (ordered by updated_at)
   */
  async getRecentlyActive(userId: string, daysBack: number = 14, limit: number = 20): Promise<Entity[]> {
    const query = `
      MATCH (e:Entity {user_id: $userId})
      WHERE e.updated_at > datetime() - duration({days: $daysBack})
      RETURN e
      ORDER BY e.updated_at DESC
      LIMIT $limit
    `;

    const result = await neo4jService.executeQuery<{ e: Entity }>(query, {
      userId,
      daysBack,
      limit: neo4jInt(limit),
    });

    return result.map((r) => {
      const entity = r.e;
      entity.notes = parseNotes(entity.notes);
      return entity;
    });
  }

  /**
   * Get all entities for a specific user
   */
  async getAllByUserId(userId: string): Promise<Entity[]> {
    const query = `
      MATCH (e:Entity {user_id: $userId})
      RETURN e
      ORDER BY e.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{ e: Entity }>(query, { userId });
    return result.map((r) => {
      const entity = r.e;
      entity.notes = parseNotes(entity.notes);
      return entity;
    });
  }

  /**
   * Find entity by exact name match
   * Used for entity resolution - exact matching tier
   *
   * @param userId - User ID to scope search
   * @param name - Name to match against e.name
   * @param canonicalName - Optional canonical name (unused for Entity, kept for interface consistency)
   * @param type - Entity type (unused for EntityRepository, kept for interface consistency)
   * @returns First matching Entity or null
   */
  async findByExactMatch(
    userId: string,
    name: string,
    _canonicalName?: string,
    _type: string = 'Entity'
  ): Promise<Entity | null> {
    const query = `
      MATCH (e:Entity {user_id: $user_id, name: $name})
      RETURN e
      LIMIT 1
    `;

    const result = await neo4jService.executeQuery<{ e: Entity }>(query, {
      user_id: userId,
      name: name,
    });
    if (!result[0]?.e) return null;
    const entity = result[0].e;
    entity.notes = parseNotes(entity.notes);
    return entity;
  }

  /**
   * Find entities by fuzzy name matching using Levenshtein distance
   * Used for entity resolution - fuzzy matching tier
   *
   * @param userId - User ID to scope search
   * @param name - Name to match against
   * @param type - Entity type (unused for EntityRepository, kept for interface consistency)
   * @param distanceThreshold - Maximum Levenshtein distance (default: 3)
   * @returns Up to 5 matching Entity nodes ordered by distance
   */
  async findByFuzzyMatch(
    userId: string,
    name: string,
    _type: string = 'Entity',
    distanceThreshold: number = 3
  ): Promise<Entity[]> {
    const query = `
      MATCH (e:Entity {user_id: $user_id})
      WITH e, apoc.text.distance(e.name, $name) AS distance
      WHERE distance <= $threshold
      RETURN e, distance
      ORDER BY distance ASC
      LIMIT 5
    `;

    const result = await neo4jService.executeQuery<{ e: Entity; distance: number }>(query, {
      user_id: userId,
      name: name,
      threshold: distanceThreshold,
    });

    return result.map((r) => {
      const entity = r.e;
      entity.notes = parseNotes(entity.notes);
      return entity;
    });
  }

  /**
   * Find entities by embedding similarity using cosine similarity
   * Used for entity resolution - embedding-based matching tier
   *
   * @param userId - User ID to scope search
   * @param embedding - Vector embedding to compare against
   * @param type - Entity type (unused for EntityRepository, kept for interface consistency)
   * @param similarityThreshold - Minimum cosine similarity score (default: 0.75)
   * @param limit - Maximum number of results (default: 20)
   * @returns Array of Entity nodes with similarity_score, ordered by score DESC
   */
  async findByEmbeddingSimilarity(
    userId: string,
    embedding: number[],
    _type: string = 'Entity',
    similarityThreshold: number = 0.75,
    limit: number = 20
  ): Promise<Array<Entity & { similarity_score: number }>> {
    const query = `
      MATCH (e:Entity {user_id: $user_id})
      WHERE e.embedding IS NOT NULL
      WITH e, gds.similarity.cosine(e.embedding, $embedding) AS score
      WHERE score > $threshold
      RETURN e, score AS similarity_score
      ORDER BY score DESC
      LIMIT $limit
    `;

    const result = await neo4jService.executeQuery<{ e: Entity; similarity_score: number }>(query, {
      user_id: userId,
      embedding: embedding,
      threshold: similarityThreshold,
      limit: neo4jInt(limit),
    });

    return result.map((r) => {
      const entity = r.e;
      entity.notes = parseNotes(entity.notes);
      return {
        ...entity,
        similarity_score: r.similarity_score,
      };
    });
  }

  /**
   * Deduplicate and aggregate candidates from multiple search tiers
   * Helper method for entity resolution
   *
   * @param exact - Results from exact match search
   * @param fuzzy - Results from fuzzy match search
   * @param similar - Results from embedding similarity search (with similarity_score)
   * @param maxCandidates - Maximum number of unique candidates to return (default: 20)
   * @returns Deduplicated array of Entity nodes (up to maxCandidates)
   */
  deduplicateCandidates(
    exact: Entity[],
    fuzzy: Entity[],
    similar: Array<Entity & { similarity_score: number }>,
    maxCandidates: number = 20
  ): Entity[] {
    const candidateMap = new Map<string, Entity>();

    // Add exact matches first (highest priority)
    for (const entity of exact) {
      if (!candidateMap.has(entity.entity_key)) {
        candidateMap.set(entity.entity_key, entity);
      }
    }

    // Add fuzzy matches (medium priority)
    for (const entity of fuzzy) {
      if (!candidateMap.has(entity.entity_key)) {
        candidateMap.set(entity.entity_key, entity);
      }
    }

    // Add embedding similarity matches (lower priority, but may have better semantic matches)
    // Sort by similarity_score DESC to prioritize higher scores
    const sortedSimilar = [...similar].sort((a, b) => b.similarity_score - a.similarity_score);
    for (const entity of sortedSimilar) {
      if (!candidateMap.has(entity.entity_key)) {
        candidateMap.set(entity.entity_key, entity);
      }
    }

    // Return up to maxCandidates
    return Array.from(candidateMap.values()).slice(0, maxCandidates);
  }

  /**
   * Link entity to source (conversation transcript) with mentions relationship
   */
  async linkToSource(entityKey: string, sourceEntityKey: string): Promise<void> {
    const query = `
      MATCH (s:Source {entity_key: $sourceEntityKey})
      MATCH (e:Entity {entity_key: $entityKey})
      MERGE (s)-[:mentions]->(e)
    `;

    await neo4jService.executeQuery(query, { sourceEntityKey, entityKey });
  }

  /**
   * Update entity embedding
   */
  async updateEmbedding(entityKey: string, embedding: number[]): Promise<void> {
    const query = `
      MATCH (e:Entity {entity_key: $entityKey})
      SET e.embedding = $embedding
    `;

    await neo4jService.executeQuery(query, { entityKey, embedding });
  }

  /**
   * Get entities related to a specific entity
   */
  async getRelatedEntities(
    entityKey: string
  ): Promise<Array<{ entity: Entity; relationship: NonNullable<RelationshipProperties['RELATES_TO_ENTITY']> }>> {
    const query = `
      MATCH (e1:Entity {entity_key: $entityKey})-[r:relates_to]->(e2:Entity)
      RETURN e2 as entity, r as relationship
      ORDER BY r.relevance DESC, r.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{
      entity: Entity;
      relationship: NonNullable<RelationshipProperties['RELATES_TO_ENTITY']>;
    }>(query, { entityKey });

    return result.map((r) => {
      const entity = r.entity;
      entity.notes = parseNotes(entity.notes);
      const relationship = r.relationship;
      ((relationship as unknown) as { notes: NoteObject[] }).notes = parseNotes(relationship.notes);
      return {
        entity,
        relationship: relationship as unknown as NonNullable<RelationshipProperties['RELATES_TO_ENTITY']>,
      };
    });
  }

  /**
   * Get people related to a specific entity
   */
  async getRelatedPeople(
    entityKey: string
  ): Promise<Array<{ person: Person; relationship: NonNullable<RelationshipProperties['RELATES_TO_PERSON']> }>> {
    const query = `
      MATCH (p:Person)-[r:associated_with]->(e:Entity {entity_key: $entityKey})
      RETURN p as person, r as relationship
      ORDER BY r.relevance DESC, r.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{
      person: Person;
      relationship: NonNullable<RelationshipProperties['RELATES_TO_PERSON']>;
    }>(query, { entityKey });

    return result.map((r) => {
      const relationship = r.relationship;
      ((relationship as unknown) as { notes: NoteObject[] }).notes = parseNotes(relationship.notes);
      return {
        person: r.person,
        relationship: relationship as unknown as NonNullable<RelationshipProperties['RELATES_TO_PERSON']>,
      };
    });
  }

  /**
   * Get concepts that involve this entity
   */
  async getInvolvingConcepts(
    entityKey: string
  ): Promise<Array<{ concept: Concept; relationship: NonNullable<RelationshipProperties['INVOLVES_ENTITY']> }>> {
    const query = `
      MATCH (c:Concept)-[r:involves]->(e:Entity {entity_key: $entityKey})
      RETURN c as concept, r as relationship
      ORDER BY r.relevance DESC, r.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{
      concept: Concept;
      relationship: NonNullable<RelationshipProperties['INVOLVES_ENTITY']>;
    }>(query, { entityKey });

    return result.map((r) => {
      const relationship = r.relationship;
      ((relationship as unknown) as { notes: NoteObject[] }).notes = parseNotes(relationship.notes);
      return {
        concept: r.concept,
        relationship: relationship as unknown as NonNullable<RelationshipProperties['INVOLVES_ENTITY']>,
      };
    });
  }

  /**
   * Increment access tracking for an entity when it's retrieved
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
      MATCH (e:Entity {entity_key: $entityKey})
      SET
        e.access_count = coalesce(e.access_count, 0) + 1,
        e.recall_frequency = coalesce(e.recall_frequency, 0) + 1,
        e.last_accessed_at = datetime(),
        e.salience = CASE
          WHEN coalesce(e.salience, 0.5) + $salienceBoost > 1.0 THEN 1.0
          ELSE coalesce(e.salience, 0.5) + $salienceBoost
        END,
        e.state = CASE
          WHEN coalesce(e.access_count, 0) + 1 >= 10 THEN 'core'
          WHEN coalesce(e.access_count, 0) + 1 >= 1 THEN 'active'
          ELSE coalesce(e.state, 'candidate')
        END
    `;

    await neo4jService.executeQuery(query, { entityKey, salienceBoost });
  }

  /**
   * Batch increment access for multiple entities
   * More efficient than calling incrementAccess multiple times
   */
  async batchIncrementAccess(entityKeys: string[]): Promise<void> {
    if (entityKeys.length === 0) return;

    const salienceBoost = 0.075;

    const query = `
      UNWIND $entityKeys AS entityKey
      MATCH (e:Entity {entity_key: entityKey})
      SET
        e.access_count = coalesce(e.access_count, 0) + 1,
        e.recall_frequency = coalesce(e.recall_frequency, 0) + 1,
        e.last_accessed_at = datetime(),
        e.salience = CASE
          WHEN coalesce(e.salience, 0.5) + $salienceBoost > 1.0 THEN 1.0
          ELSE coalesce(e.salience, 0.5) + $salienceBoost
        END,
        e.state = CASE
          WHEN coalesce(e.access_count, 0) + 1 >= 10 THEN 'core'
          WHEN coalesce(e.access_count, 0) + 1 >= 1 THEN 'active'
          ELSE coalesce(e.state, 'candidate')
        END
    `;

    await neo4jService.executeQuery(query, { entityKeys, salienceBoost });
  }
}

export const entityRepository = new EntityRepository();
