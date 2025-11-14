import crypto from 'crypto';
import { neo4jService, neo4jInt } from '../db/neo4j.js';
import { Person, NoteObject } from '../types/graph.js';
import { parseNotes, stringifyNotes } from '../utils/notes.js';

/**
 * Generate stable entity_key for Person nodes
 * Formula: hash(canonical_name + user_id)
 */
function generateEntityKey(canonicalName: string, userId: string): string {
  return crypto
    .createHash('sha256')
    .update(canonicalName.toLowerCase() + userId)
    .digest('hex');
}

export class PersonRepository {
  /**
   * Validate Person node invariants
   * - Owner node: is_owner=true, user_id set, team_id=null
   * - Regular person: is_owner=false (or not set), user_id set, team_id=null
   */
  private validatePersonInvariants(person: Partial<Person> & { canonical_name: string; user_id: string }): void {
    // All Person nodes must have user_id set
    if (!person.user_id) {
      throw new Error('Person node must have user_id set (Person nodes are always user-scoped)');
    }

    // Note: Person nodes are always user-scoped (not team-scoped)
    // team_id property was removed from Person interface
  }

  /**
   * Create a new Person (throws error if already exists)
   *
   * Uses CREATE (not MERGE) for fail-fast behavior.
   * Will throw Neo4j error if Person with same entity_key already exists.
   *
   * @param person - Person data to create
   * @param sourceEntityKey - Optional Source node entity_key to auto-create mention relationship
   */
  async create(
    person: Partial<Person> & { canonical_name: string; user_id: string },
    sourceEntityKey?: string
  ): Promise<{ entity_key: string }> {
    this.validatePersonInvariants(person);

    const entityKey = generateEntityKey(person.canonical_name, person.user_id);

    const query = `
      CREATE (p:Person {
        entity_key: $entity_key,
        user_id: $user_id,
        created_by: $user_id,
        team_id: null,
        canonical_name: $canonical_name,
        name: $name,
        is_owner: $is_owner,
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
        is_dirty: false
      })
      RETURN p.entity_key as entity_key
    `;

    // Validate required provenance fields
    const last_update_source = person.last_update_source ?? sourceEntityKey;
    if (!last_update_source) {
      throw new Error('last_update_source is required for Person creation - must be provided via person.last_update_source or sourceEntityKey parameter');
    }

    const params = {
      entity_key: entityKey,
      user_id: person.user_id,
      canonical_name: person.canonical_name,
      name: person.name || person.canonical_name,
      is_owner: person.is_owner || false,
      notes: stringifyNotes(person.notes !== undefined ? person.notes : []),
      embedding: person.embedding !== undefined ? person.embedding : null,
      last_update_source,
      confidence: person.confidence !== undefined ? person.confidence : 0.8,
    };

    const result = await neo4jService.executeQuery<{ entity_key: string }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create Person');
    }

    // Auto-create mention relationship if source_entity_key provided
    if (sourceEntityKey) {
      const mentionQuery = `
        MATCH (s:Source {entity_key: $source_entity_key})
        MATCH (p:Person {entity_key: $entity_key})
        CREATE (s)-[r:mentions]->(p)
        SET r.created_at = datetime()
      `;
      await neo4jService.executeQuery(mentionQuery, {
        source_entity_key: sourceEntityKey,
        entity_key: entityKey,
      });
    }

    return result[0];
  }

  /**
   * Update an existing Person node (throws error if doesn't exist)
   *
   * Uses MATCH + SET for fail-fast behavior.
   * Will throw error if Person with entity_key doesn't exist.
   *
   * @param person - Person data to update (must include entity_key)
   * @param sourceEntityKey - Optional Source node entity_key to auto-create mention relationship
   */
  async update(
    person: Partial<Person> & { entity_key: string },
    sourceEntityKey?: string
  ): Promise<Person> {
    // Validate that entity_key is provided
    if (!person.entity_key) {
      throw new Error('entity_key is required for Person update');
    }

    // Find existing person to validate it exists and get required fields
    const existingPerson = await this.findById(person.entity_key);
    if (!existingPerson) {
      throw new Error(`Person with entity_key ${person.entity_key} not found`);
    }

    // Validate invariants
    if (person.user_id && person.user_id !== existingPerson.user_id) {
      throw new Error('Cannot change user_id on Person node');
    }
    if (person.canonical_name && person.canonical_name !== existingPerson.canonical_name) {
      throw new Error('Cannot change canonical_name on Person node');
    }

    // Ensure required provenance fields are set
    const last_update_source = person.last_update_source ?? sourceEntityKey;
    if (!last_update_source) {
      throw new Error('last_update_source is required for Person update - must be provided via person.last_update_source or sourceEntityKey parameter');
    }

    const query = `
      MATCH (p:Person {entity_key: $entity_key})
      SET
        p.team_id = null,
        p.name = coalesce($name, p.name),
        p.is_owner = coalesce($is_owner, p.is_owner),
        p.description = coalesce($description, p.description),
        p.notes = CASE WHEN $notes IS NOT NULL THEN $notes ELSE p.notes END,
        p.embedding = coalesce($embedding, p.embedding),
        p.last_update_source = $last_update_source,
        p.confidence = CASE WHEN $confidence IS NOT NULL THEN $confidence ELSE p.confidence END,
        p.updated_at = datetime()
      RETURN p
    `;

    const params = {
      entity_key: person.entity_key,
      name: person.name !== undefined ? person.name : null,
      is_owner: person.is_owner !== undefined ? person.is_owner : null,
      description: person.description !== undefined ? person.description : null,
      notes: person.notes !== undefined ? stringifyNotes(person.notes) : null,
      embedding: person.embedding !== undefined ? person.embedding : null,
      last_update_source,
      confidence: person.confidence !== undefined ? person.confidence : null,
    };

    const result = await neo4jService.executeQuery<{ p: Person }>(query, params);

    if (!result[0]) {
      throw new Error(`Failed to update Person with entity_key ${person.entity_key}`);
    }

    // Auto-create mention relationship if source_entity_key provided
    if (sourceEntityKey) {
      const mentionQuery = `
        MATCH (s:Source {entity_key: $source_entity_key})
        MATCH (p:Person {entity_key: $entity_key})
        CREATE (s)-[r:mentions]->(p)
        SET r.created_at = datetime()
      `;
      await neo4jService.executeQuery(mentionQuery, {
        source_entity_key: sourceEntityKey,
        entity_key: person.entity_key,
      });
    }

    const personNode = result[0].p;
    return {
      ...personNode,
      notes: parseNotes(personNode.notes),
    } as Person;
  }


  /**
   * Find person by entity_key
   */
  async findById(entityKey: string): Promise<Person | null> {
    const query = 'MATCH (p:Person {entity_key: $entity_key}) RETURN p';
    const result = await neo4jService.executeQuery<{ p: Person }>(query, { entity_key: entityKey });
    if (!result[0]?.p) return null;
    const person = result[0].p;
    return {
      ...person,
      notes: parseNotes(person.notes),
    } as Person;
  }

  /**
   * Find person by canonical_name and user_id
   */
  async findByCanonicalName(name: string, userId: string): Promise<Person | null> {
    const query = `
      MATCH (p:Person {canonical_name: $canonical_name, user_id: $user_id})
      RETURN p
    `;
    const result = await neo4jService.executeQuery<{ p: Person }>(query, {
      canonical_name: name.toLowerCase(),
      user_id: userId,
    });
    if (!result[0]?.p) return null;
    const person = result[0].p;
    return {
      ...person,
      notes: parseNotes(person.notes),
    } as Person;
  }

  /**
   * Search people by name (fuzzy search on name/canonical_name)
   */
  async searchByName(query: string, userId: string): Promise<Person[]> {
    const cypherQuery = `
      MATCH (p:Person {user_id: $user_id})
      WHERE p.name CONTAINS $query OR p.canonical_name CONTAINS $query
      RETURN p
      ORDER BY p.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{ p: Person }>(cypherQuery, {
      query: query.toLowerCase(),
      user_id: userId,
    });
    return result.map((r) => ({
      ...r.p,
      notes: parseNotes(r.p.notes),
    })) as Person[];
  }

  /**
   * Get recently mentioned people (ordered by updated_at)
   */
  async getRecentlyMentioned(userId: string, daysBack: number): Promise<Person[]> {
    const query = `
      MATCH (p:Person {user_id: $user_id})
      WHERE p.updated_at >= datetime() - duration({days: $days_back})
      RETURN p
      ORDER BY p.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{ p: Person }>(query, {
      user_id: userId,
      days_back: daysBack,
    });
    return result.map((r) => ({
      ...r.p,
      notes: parseNotes(r.p.notes),
    })) as Person[];
  }

  /**
   * Find person by exact name or canonical name match
   * Used for entity resolution - exact matching tier
   *
   * @param userId - User ID to scope search
   * @param name - Name to match against p.name
   * @param canonicalName - Optional canonical name to match against p.canonical_name
   * @param type - Entity type (unused for PersonRepository, kept for interface consistency)
   * @returns First matching Person or null
   */
  async findByExactMatch(
    userId: string,
    name: string,
    canonicalName?: string,
    _type: string = 'Person'
  ): Promise<Person | null> {
    let query: string;
    const params: { user_id: string; name: string; canonical_name?: string } = {
      user_id: userId,
      name: name,
    };

    if (canonicalName) {
      query = `
        MATCH (p:Person {user_id: $user_id})
        WHERE p.name = $name OR p.canonical_name = $canonical_name
        RETURN p
        LIMIT 1
      `;
      params.canonical_name = canonicalName.toLowerCase();
    } else {
      query = `
        MATCH (p:Person {user_id: $user_id})
        WHERE p.name = $name
        RETURN p
        LIMIT 1
      `;
    }

    const result = await neo4jService.executeQuery<{ p: Person }>(query, params);
    if (!result[0]?.p) return null;
    const person = result[0].p;
    return {
      ...person,
      notes: parseNotes(person.notes),
    } as Person;
  }

  /**
   * Find people by fuzzy name matching using Levenshtein distance
   * Used for entity resolution - fuzzy matching tier
   *
   * @param userId - User ID to scope search
   * @param name - Name to match against
   * @param type - Entity type (unused for PersonRepository, kept for interface consistency)
   * @param distanceThreshold - Maximum Levenshtein distance (default: 3)
   * @returns Up to 5 matching Person nodes ordered by distance
   */
  async findByFuzzyMatch(
    userId: string,
    name: string,
    _type: string = 'Person',
    distanceThreshold: number = 3
  ): Promise<Person[]> {
    const query = `
      MATCH (p:Person {user_id: $user_id})
      WITH p, apoc.text.distance(p.name, $name) AS distance
      WHERE distance <= $threshold
      RETURN p, distance
      ORDER BY distance ASC
      LIMIT 5
    `;

    const result = await neo4jService.executeQuery<{ p: Person; distance: number }>(query, {
      user_id: userId,
      name: name,
      threshold: distanceThreshold,
    });

    return result.map((r) => ({
      ...r.p,
      notes: parseNotes(r.p.notes),
    })) as Person[];
  }

  /**
   * Find people by embedding similarity using cosine similarity
   * Used for entity resolution - embedding-based matching tier
   *
   * @param userId - User ID to scope search
   * @param embedding - Vector embedding to compare against
   * @param type - Entity type (unused for PersonRepository, kept for interface consistency)
   * @param similarityThreshold - Minimum cosine similarity score (default: 0.75)
   * @param limit - Maximum number of results (default: 20)
   * @returns Array of Person nodes with similarity_score, ordered by score DESC
   */
  async findByEmbeddingSimilarity(
    userId: string,
    embedding: number[],
    _type: string = 'Person',
    similarityThreshold: number = 0.75,
    limit: number = 20
  ): Promise<Array<Person & { similarity_score: number }>> {
    const query = `
      MATCH (p:Person {user_id: $user_id})
      WHERE p.embedding IS NOT NULL
      WITH p, gds.similarity.cosine(p.embedding, $embedding) AS score
      WHERE score > $threshold
      RETURN p, score AS similarity_score
      ORDER BY score DESC
      LIMIT $limit
    `;

    const result = await neo4jService.executeQuery<{ p: Person; similarity_score: number }>(query, {
      user_id: userId,
      embedding: embedding,
      threshold: similarityThreshold,
      limit: neo4jInt(limit),
    });

    return result.map((r) => ({
      ...r.p,
      notes: parseNotes(r.p.notes),
      similarity_score: r.similarity_score,
    })) as Array<Person & { similarity_score: number }>;
  }

  /**
   * Deduplicate and aggregate candidates from multiple search tiers
   * Helper method for entity resolution
   *
   * @param exact - Results from exact match search
   * @param fuzzy - Results from fuzzy match search
   * @param similar - Results from embedding similarity search (with similarity_score)
   * @param maxCandidates - Maximum number of unique candidates to return (default: 20)
   * @returns Deduplicated array of Person nodes (up to maxCandidates)
   */
  deduplicateCandidates(
    exact: Person[],
    fuzzy: Person[],
    similar: Array<Person & { similarity_score: number }>,
    maxCandidates: number = 20
  ): Person[] {
    const candidateMap = new Map<string, Person>();

    // Add exact matches first (highest priority)
    for (const person of exact) {
      if (!candidateMap.has(person.entity_key)) {
        candidateMap.set(person.entity_key, person);
      }
    }

    // Add fuzzy matches (medium priority)
    for (const person of fuzzy) {
      if (!candidateMap.has(person.entity_key)) {
        candidateMap.set(person.entity_key, person);
      }
    }

    // Add embedding similarity matches (lower priority, but may have better semantic matches)
    // Sort by similarity_score DESC to prioritize higher scores
    const sortedSimilar = [...similar].sort((a, b) => b.similarity_score - a.similarity_score);
    for (const person of sortedSimilar) {
      if (!candidateMap.has(person.entity_key)) {
        candidateMap.set(person.entity_key, person);
      }
    }

    // Return up to maxCandidates
    return Array.from(candidateMap.values()).slice(0, maxCandidates);
  }

  /**
   * Find the owner Person node (is_owner=true) for a given user
   */
  async findOwner(userId: string): Promise<Person | null> {
    const query = `
      MATCH (p:Person {user_id: $user_id, is_owner: true})
      RETURN p
      LIMIT 1
    `;
    const result = await neo4jService.executeQuery<{ p: Person }>(query, { user_id: userId });
    if (!result[0]?.p) return null;
    const person = result[0].p;
    return {
      ...person,
      notes: parseNotes(person.notes),
    } as Person;
  }

  /**
   * Find or create the owner Person node for a user
   *
   * Check-then-create pattern with clear semantics for owner creation.
   * Ensures exactly one owner Person node per user.
   *
   * @param userId - User ID
   * @param name - Name for the owner Person node
   * @returns Existing or newly created owner Person node
   */
  async findOrCreateOwner(userId: string, name: string): Promise<Person> {
    // First, try to find existing owner
    const existingOwner = await this.findOwner(userId);
    if (existingOwner) {
      // Update name if it changed
      if (existingOwner.name !== name) {
        return await this.update({
          entity_key: existingOwner.entity_key,
          name: name,
          is_owner: true,
          last_update_source: 'system',
          confidence: 1.0,
        });
      }
      return existingOwner;
    }

    // No existing owner found - create one
    // First, ensure no other Person nodes for this user have is_owner=true (safety check)
    const clearQuery = `
      MATCH (p:Person {user_id: $user_id})
      WHERE p.is_owner = true
      SET p.is_owner = null
    `;
    await neo4jService.executeQuery(clearQuery, { user_id: userId });

    // Create the owner node using create() method
    const canonicalName = name.toLowerCase().trim();
    const result = await this.create({
      user_id: userId,
      canonical_name: canonicalName,
      name: name,
      is_owner: true,
      notes: [],
      last_update_source: 'system',
      confidence: 1.0,
    });

    // Fetch the created person to return full Person object
    const createdPerson = await this.findById(result.entity_key);
    if (!createdPerson) {
      throw new Error('Failed to create owner person');
    }

    return createdPerson;
  }

  /**
   * Get all people for a specific user
   * Ordered by most recently updated
   */
  async findByUserId(userId: string, limit: number = 100): Promise<Person[]> {
    const query = `
      MATCH (p:Person {user_id: $user_id})
      RETURN p
      ORDER BY p.updated_at DESC
      LIMIT $limit
    `;
    const result = await neo4jService.executeQuery<{ p: Person }>(query, { user_id: userId, limit: neo4jInt(limit) });
    return result.map((r) => ({
      ...r.p,
      notes: parseNotes(r.p.notes),
    })) as Person[];
  }

  /**
   * Get count of Source nodes that mention a user's owner Person node
   * Used to track how many conversations reference the user
   */
  async getConversationCount(userId: string): Promise<number> {
    const query = `
      MATCH (p:Person {user_id: $user_id, is_owner: true})<-[:mentions]-(s:Source)
      RETURN count(s) as count
    `;
    const result = await neo4jService.executeQuery<{ count: number }>(query, { user_id: userId });
    return result[0]?.count !== undefined ? result[0].count : 0;
  }

  /**
   * Create relationship: Person has_relationship_with Person
   * Properties: attitude_towards_person, closeness, relationship_type, notes
   *
   * Uses CREATE (not MERGE) for fail-fast behavior.
   * Will throw error if relationship already exists.
   */
  async createRelationshipWith(
    fromEntityKey: string,
    toEntityKey: string,
    properties: {
      attitude_towards_person?: string;
      closeness?: number;
      relationship_type?: string;
      notes?: NoteObject[];
    }
  ): Promise<void> {
    const query = `
      MATCH (p1:Person {entity_key: $from_key})
      MATCH (p2:Person {entity_key: $to_key})
      CREATE (p1)-[r:has_relationship_with]->(p2)
      SET r.attitude_towards_person = $attitude_towards_person,
          r.closeness = $closeness,
          r.relationship_type = $relationship_type,
          r.notes = $notes,
          r.created_at = datetime(),
          r.updated_at = datetime()
    `;

    await neo4jService.executeQuery(query, {
      from_key: fromEntityKey,
      to_key: toEntityKey,
      attitude_towards_person: properties.attitude_towards_person || null,
      closeness: properties.closeness || null,
      relationship_type: properties.relationship_type || null,
      notes: properties.notes !== undefined ? stringifyNotes(properties.notes) : null,
    });
  }

  /**
   * Create relationship: Person engages_with Concept
   * Properties: mood, frequency
   *
   * Uses CREATE (not MERGE) for fail-fast behavior.
   * Will throw error if relationship already exists.
   */
  async createEngagesWithConcept(
    personEntityKey: string,
    conceptEntityKey: string,
    properties: {
      mood?: string;
      frequency?: number;
    }
  ): Promise<void> {
    const query = `
      MATCH (p:Person {entity_key: $person_key})
      MATCH (c:Concept {entity_key: $concept_key})
      CREATE (p)-[r:engages_with]->(c)
      SET r.mood = $mood,
          r.frequency = $frequency,
          r.created_at = datetime(),
          r.updated_at = datetime()
    `;

    await neo4jService.executeQuery(query, {
      person_key: personEntityKey,
      concept_key: conceptEntityKey,
      mood: properties.mood || null,
      frequency: properties.frequency || null,
    });
  }

  /**
   * Create relationship: Person associated_with Entity
   * Properties: relationship_type, notes, relevance
   *
   * Uses CREATE (not MERGE) for fail-fast behavior.
   * Will throw error if relationship already exists.
   */
  async createAssociationWithEntity(
    personEntityKey: string,
    entityEntityKey: string,
    properties: {
      relationship_type?: string;
      notes?: NoteObject[];
      relevance?: number;
    }
  ): Promise<void> {
    const query = `
      MATCH (p:Person {entity_key: $person_key})
      MATCH (e:Entity {entity_key: $entity_key})
      CREATE (p)-[r:associated_with]->(e)
      SET r.relationship_type = $relationship_type,
          r.notes = $notes,
          r.relevance = $relevance,
          r.created_at = datetime(),
          r.updated_at = datetime()
    `;

    await neo4jService.executeQuery(query, {
      person_key: personEntityKey,
      entity_key: entityEntityKey,
      relationship_type: properties.relationship_type || null,
      notes: properties.notes !== undefined ? stringifyNotes(properties.notes) : null,
      relevance: properties.relevance || null,
    });
  }

  /**
   * Get all people a person has relationships with
   */
  async getRelatedPeople(entityKey: string): Promise<
    Array<{
      person: Person;
      attitude_towards_person?: string;
      closeness?: number;
      relationship_type?: string;
      notes?: NoteObject[];
    }>
  > {
    const query = `
      MATCH (p1:Person {entity_key: $entity_key})-[r:has_relationship_with]->(p2:Person)
      RETURN p2 as person,
             r.attitude_towards_person as attitude_towards_person,
             r.closeness as closeness,
             r.relationship_type as relationship_type,
             r.notes as notes
      ORDER BY r.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{
      person: Person;
      attitude_towards_person?: string;
      closeness?: number;
      relationship_type?: string;
      notes?: string;
    }>(query, { entity_key: entityKey });

    return result.map((r) => ({
      person: {
        ...r.person,
        notes: parseNotes(r.person.notes),
      } as Person,
      attitude_towards_person: r.attitude_towards_person,
      closeness: r.closeness,
      relationship_type: r.relationship_type,
      notes: r.notes !== undefined ? parseNotes(r.notes) : undefined,
    }));
  }

  /**
   * Get all concepts a person engages with
   */
  async getRelatedConcepts(entityKey: string): Promise<
    Array<{
      concept: {
        entity_key: string;
        name: string;
        description?: string;
        notes?: unknown;
      };
      mood?: string;
      frequency?: number;
    }>
  > {
    const query = `
      MATCH (p:Person {entity_key: $entity_key})-[r:engages_with]->(c:Concept)
      RETURN c as concept,
             r.mood as mood,
             r.frequency as frequency
      ORDER BY r.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{
      concept: {
        entity_key: string;
        name: string;
        description?: string;
        notes?: unknown;
      };
      mood?: string;
      frequency?: number;
    }>(query, { entity_key: entityKey });

    return result;
  }

  /**
   * Get all entities a person is associated with
   */
  async getRelatedEntities(entityKey: string): Promise<
    Array<{
      entity: {
        entity_key: string;
        name: string;
        type?: string;
        description?: string;
        notes?: unknown;
      };
      relationship_type?: string;
      notes?: string;
      relevance?: number;
    }>
  > {
    const query = `
      MATCH (p:Person {entity_key: $entity_key})-[r:associated_with]->(e:Entity)
      RETURN e as entity,
             r.relationship_type as relationship_type,
             r.notes as notes,
             r.relevance as relevance
      ORDER BY r.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{
      entity: {
        entity_key: string;
        name: string;
        type?: string;
        description?: string;
        notes?: unknown;
      };
      relationship_type?: string;
      notes?: string;
      relevance?: number;
    }>(query, { entity_key: entityKey });

    return result;
  }

  /**
   * Increment access tracking for a person when they're retrieved
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
      MATCH (p:Person {entity_key: $entityKey})
      SET
        p.access_count = coalesce(p.access_count, 0) + 1,
        p.recall_frequency = coalesce(p.recall_frequency, 0) + 1,
        p.last_accessed_at = datetime(),
        p.salience = CASE
          WHEN coalesce(p.salience, 0.5) + $salienceBoost > 1.0 THEN 1.0
          ELSE coalesce(p.salience, 0.5) + $salienceBoost
        END,
        p.state = CASE
          WHEN coalesce(p.access_count, 0) + 1 >= 10 THEN 'core'
          WHEN coalesce(p.access_count, 0) + 1 >= 1 THEN 'active'
          ELSE coalesce(p.state, 'candidate')
        END
    `;

    await neo4jService.executeQuery(query, { entityKey, salienceBoost });
  }

  /**
   * Batch increment access for multiple people
   * More efficient than calling incrementAccess multiple times
   */
  async batchIncrementAccess(entityKeys: string[]): Promise<void> {
    if (entityKeys.length === 0) return;

    const salienceBoost = 0.075;

    const query = `
      UNWIND $entityKeys AS entityKey
      MATCH (p:Person {entity_key: entityKey})
      SET
        p.access_count = coalesce(p.access_count, 0) + 1,
        p.recall_frequency = coalesce(p.recall_frequency, 0) + 1,
        p.last_accessed_at = datetime(),
        p.salience = CASE
          WHEN coalesce(p.salience, 0.5) + $salienceBoost > 1.0 THEN 1.0
          ELSE coalesce(p.salience, 0.5) + $salienceBoost
        END,
        p.state = CASE
          WHEN coalesce(p.access_count, 0) + 1 >= 10 THEN 'core'
          WHEN coalesce(p.access_count, 0) + 1 >= 1 THEN 'active'
          ELSE coalesce(p.state, 'candidate')
        END
    `;

    await neo4jService.executeQuery(query, { entityKeys, salienceBoost });
  }
}

export const personRepository = new PersonRepository();
