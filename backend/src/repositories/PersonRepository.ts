import crypto from 'crypto';
import { neo4jService, neo4jInt } from '../db/neo4j.js';
import { Person } from '../types/graph.js';

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

    // Owner nodes must have team_id=null
    if (person.is_owner === true && person.team_id !== undefined && person.team_id !== null) {
      throw new Error('Owner Person node cannot have team_id set (must be null)');
    }

    // Non-owner nodes should have team_id=null (Person nodes are user-scoped, not team-scoped)
    if (person.is_owner !== true && person.team_id !== undefined && person.team_id !== null) {
      throw new Error('Person nodes are user-scoped (not team-scoped). team_id must be null.');
    }
  }

  /**
   * Create or update a person
   * Uses MERGE by entity_key for idempotency
   */
  async upsert(person: Partial<Person> & { canonical_name: string; user_id: string }): Promise<Person> {
    // Validate invariants before database operation
    this.validatePersonInvariants(person);

    const entityKey = person.entity_key || generateEntityKey(person.canonical_name, person.user_id);

    const query = `
      MERGE (p:Person {entity_key: $entity_key})
      ON CREATE SET
        p.user_id = $user_id,
        p.team_id = null,
        p.name = $name,
        p.canonical_name = $canonical_name,
        p.is_owner = $is_owner,
        p.appearance = $appearance,
        p.situation = $situation,
        p.history = $history,
        p.personality = $personality,
        p.expertise = $expertise,
        p.interests = $interests,
        p.notes = $notes,
        p.created_at = datetime(),
        p.updated_at = datetime(),
        p.last_update_source = $last_update_source,
        p.confidence = $confidence,
        p.salience = 0.5,
        p.state = 'candidate',
        p.access_count = 0,
        p.recall_frequency = 0,
        p.last_recall_interval = 0,
        p.decay_gradient = 1.0,
        p.last_accessed_at = null,
        p.is_dirty = false
      ON MATCH SET
        p.team_id = null,
        p.name = coalesce($name, p.name),
        p.is_owner = coalesce($is_owner, p.is_owner),
        p.appearance = coalesce($appearance, p.appearance),
        p.situation = coalesce($situation, p.situation),
        p.history = coalesce($history, p.history),
        p.personality = coalesce($personality, p.personality),
        p.expertise = coalesce($expertise, p.expertise),
        p.interests = coalesce($interests, p.interests),
        p.notes = coalesce($notes, p.notes),
        p.updated_at = datetime(),
        p.last_update_source = coalesce($last_update_source, p.last_update_source),
        p.confidence = coalesce($confidence, p.confidence)
      RETURN p
    `;

    const params = {
      entity_key: entityKey,
      user_id: person.user_id,
      name: person.name !== undefined ? person.name : person.canonical_name,
      canonical_name: person.canonical_name,
      is_owner: person.is_owner !== undefined ? person.is_owner : null,
      appearance: person.appearance !== undefined ? person.appearance : null,
      situation: person.situation !== undefined ? person.situation : null,
      history: person.history !== undefined ? person.history : null,
      personality: person.personality !== undefined ? person.personality : null,
      expertise: person.expertise !== undefined ? person.expertise : null,
      interests: person.interests !== undefined ? person.interests : null,
      notes: person.notes !== undefined ? person.notes : null,
      last_update_source: person.last_update_source !== undefined ? person.last_update_source : null,
      confidence: person.confidence !== undefined ? person.confidence : null,
    };

    const result = await neo4jService.executeQuery<{ p: Person }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create/update person');
    }

    return result[0].p;
  }

  /**
   * Find person by entity_key
   */
  async findById(entityKey: string): Promise<Person | null> {
    const query = 'MATCH (p:Person {entity_key: $entity_key}) RETURN p';
    const result = await neo4jService.executeQuery<{ p: Person }>(query, { entity_key: entityKey });
    return result[0]?.p !== undefined ? result[0].p : null;
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
    return result[0]?.p !== undefined ? result[0].p : null;
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
    return result.map((r) => r.p);
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
    return result.map((r) => r.p);
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
    return result[0]?.p !== undefined ? result[0].p : null;
  }

  /**
   * Create or update the owner Person node for a user
   */
  async upsertOwner(userId: string, name: string): Promise<Person> {
    // First, ensure no other Person nodes for this user have is_owner=true
    const clearQuery = `
      MATCH (p:Person {user_id: $user_id})
      WHERE p.is_owner = true
      SET p.is_owner = null
    `;
    await neo4jService.executeQuery(clearQuery, { user_id: userId });

    // Now create/update the owner node
    const canonicalName = name.toLowerCase().trim();
    const entityKey = generateEntityKey(canonicalName, userId);

    const query = `
      MERGE (p:Person {entity_key: $entity_key})
      ON CREATE SET
        p.user_id = $user_id,
        p.name = $name,
        p.canonical_name = $canonical_name,
        p.is_owner = true,
        p.team_id = null,
        p.created_at = datetime(),
        p.updated_at = datetime(),
        p.salience = 0.5,
        p.state = 'candidate',
        p.access_count = 0,
        p.recall_frequency = 0,
        p.last_recall_interval = 0,
        p.decay_gradient = 1.0,
        p.last_accessed_at = null,
        p.is_dirty = false
      ON MATCH SET
        p.name = $name,
        p.is_owner = true,
        p.team_id = null,
        p.updated_at = datetime()
      RETURN p
    `;

    const result = await neo4jService.executeQuery<{ p: Person }>(query, {
      entity_key: entityKey,
      user_id: userId,
      name: name,
      canonical_name: canonicalName,
    });

    if (!result[0]) {
      throw new Error('Failed to create/update owner person');
    }

    return result[0].p;
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
    return result.map((r) => r.p);
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
   */
  async createRelationshipWith(
    fromEntityKey: string,
    toEntityKey: string,
    properties: {
      attitude_towards_person?: string;
      closeness?: number;
      relationship_type?: string;
      notes?: string;
    }
  ): Promise<void> {
    const query = `
      MATCH (p1:Person {entity_key: $from_key})
      MATCH (p2:Person {entity_key: $to_key})
      MERGE (p1)-[r:has_relationship_with]->(p2)
      SET r.attitude_towards_person = $attitude_towards_person,
          r.closeness = $closeness,
          r.relationship_type = $relationship_type,
          r.notes = $notes,
          r.updated_at = datetime()
      ON CREATE SET r.created_at = datetime()
    `;

    await neo4jService.executeQuery(query, {
      from_key: fromEntityKey,
      to_key: toEntityKey,
      attitude_towards_person: properties.attitude_towards_person || null,
      closeness: properties.closeness || null,
      relationship_type: properties.relationship_type || null,
      notes: properties.notes || null,
    });
  }

  /**
   * Create relationship: Person thinks_about Concept
   * Properties: mood, frequency
   */
  async createThinksAboutConcept(
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
      MERGE (p)-[r:thinks_about]->(c)
      SET r.mood = $mood,
          r.frequency = $frequency,
          r.updated_at = datetime()
      ON CREATE SET r.created_at = datetime()
    `;

    await neo4jService.executeQuery(query, {
      person_key: personEntityKey,
      concept_key: conceptEntityKey,
      mood: properties.mood || null,
      frequency: properties.frequency || null,
    });
  }

  /**
   * Create relationship: Person relates_to Entity
   * Properties: relationship_type, notes, relevance
   */
  async createRelationshipWithEntity(
    personEntityKey: string,
    entityEntityKey: string,
    properties: {
      relationship_type?: string;
      notes?: string;
      relevance?: number;
    }
  ): Promise<void> {
    const query = `
      MATCH (p:Person {entity_key: $person_key})
      MATCH (e:Entity {entity_key: $entity_key})
      MERGE (p)-[r:relates_to]->(e)
      SET r.relationship_type = $relationship_type,
          r.notes = $notes,
          r.relevance = $relevance,
          r.updated_at = datetime()
      ON CREATE SET r.created_at = datetime()
    `;

    await neo4jService.executeQuery(query, {
      person_key: personEntityKey,
      entity_key: entityEntityKey,
      relationship_type: properties.relationship_type || null,
      notes: properties.notes || null,
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
      notes?: string;
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

    return result;
  }

  /**
   * Get all concepts a person thinks about
   */
  async getRelatedConcepts(entityKey: string): Promise<
    Array<{
      concept: {
        entity_key: string;
        name: string;
        description?: string;
        notes?: string;
      };
      mood?: string;
      frequency?: number;
    }>
  > {
    const query = `
      MATCH (p:Person {entity_key: $entity_key})-[r:thinks_about]->(c:Concept)
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
        notes?: string;
      };
      mood?: string;
      frequency?: number;
    }>(query, { entity_key: entityKey });

    return result;
  }

  /**
   * Get all entities a person relates to
   */
  async getRelatedEntities(entityKey: string): Promise<
    Array<{
      entity: {
        entity_key: string;
        name: string;
        type?: string;
        description?: string;
        notes?: string;
      };
      relationship_type?: string;
      notes?: string;
      relevance?: number;
    }>
  > {
    const query = `
      MATCH (p:Person {entity_key: $entity_key})-[r:relates_to]->(e:Entity)
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
        notes?: string;
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
