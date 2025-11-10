import { neo4jService } from '../db/neo4j.js';
import { Person, RelationshipProperties } from '../types/graph.js';

export class PersonRepository {
  /**
   * Create or update a person (intrinsic properties only)
   */
  async upsert(
    person: Partial<Person> & {
      id: string;
      entity_key: string;
      name: string;
      canonical_name: string;
      last_update_source: string;
      confidence: number;
    }
  ): Promise<Person> {
    const query = `
      MERGE (p:Person {entity_key: $entity_key})
      ON CREATE SET
        p.id = $id,
        p.name = $name,
        p.canonical_name = $canonical_name,
        p.updated_at = datetime(),
        p.last_update_source = $last_update_source,
        p.confidence = $confidence,
        p.personality_traits = $personality_traits,
        p.current_life_situation = $current_life_situation
      ON MATCH SET
        p.name = $name,
        p.canonical_name = $canonical_name,
        p.updated_at = datetime(),
        p.last_update_source = $last_update_source,
        p.confidence = $confidence,
        p.personality_traits = CASE
          WHEN $personality_traits IS NOT NULL
          THEN (p.personality_traits[0..9] + $personality_traits)[0..9]
          ELSE p.personality_traits
        END,
        p.current_life_situation = coalesce($current_life_situation, p.current_life_situation)
      RETURN p
    `;

    const result = await neo4jService.executeQuery<{ p: Person }>(query, {
      id: person.id,
      entity_key: person.entity_key,
      name: person.name,
      canonical_name: person.canonical_name,
      last_update_source: person.last_update_source,
      confidence: person.confidence,
      personality_traits: person.personality_traits || null,
      current_life_situation: person.current_life_situation || null,
    });

    if (!result[0]) {
      throw new Error('Failed to create/update person');
    }

    return result[0].p;
  }

  /**
   * Create or update KNOWS relationship between user and person
   */
  async upsertKnowsRelationship(
    userId: string,
    personId: string,
    properties: Partial<NonNullable<RelationshipProperties['KNOWS']>> & {
      relationship_type: string;
    }
  ): Promise<NonNullable<RelationshipProperties['KNOWS']>> {
    const query = `
      MATCH (u:User {id: $userId})
      MATCH (p:Person {id: $personId})
      MERGE (u)-[r:KNOWS]->(p)
      ON CREATE SET
        r.relationship_type = $relationship_type,
        r.relationship_quality = coalesce($relationship_quality, 0.5),
        r.how_they_met = $how_they_met,
        r.why_they_matter = $why_they_matter,
        r.relationship_status = $relationship_status,
        r.communication_cadence = $communication_cadence,
        r.first_mentioned_at = datetime(),
        r.last_mentioned_at = datetime()
      ON MATCH SET
        r.relationship_type = coalesce($relationship_type, r.relationship_type),
        r.relationship_quality = coalesce($relationship_quality, r.relationship_quality),
        r.how_they_met = coalesce($how_they_met, r.how_they_met),
        r.why_they_matter = coalesce($why_they_matter, r.why_they_matter),
        r.relationship_status = coalesce($relationship_status, r.relationship_status),
        r.communication_cadence = coalesce($communication_cadence, r.communication_cadence),
        r.last_mentioned_at = datetime()
      RETURN r
    `;

    const result = await neo4jService.executeQuery<{ r: NonNullable<RelationshipProperties['KNOWS']> }>(
      query,
      {
        userId,
        personId,
        relationship_type: properties.relationship_type,
        relationship_quality: properties.relationship_quality || null,
        how_they_met: properties.how_they_met || null,
        why_they_matter: properties.why_they_matter || null,
        relationship_status: properties.relationship_status || null,
        communication_cadence: properties.communication_cadence || null,
      }
    );

    if (!result[0]) {
      throw new Error('Failed to create/update KNOWS relationship');
    }

    return result[0].r;
  }

  /**
   * Find person by ID
   */
  async findById(id: string): Promise<Person | null> {
    const query = 'MATCH (p:Person {id: $id}) RETURN p';
    const result = await neo4jService.executeQuery<{ p: Person }>(query, { id });
    return result[0]?.p || null;
  }

  /**
   * Find person by ID with KNOWS relationship data for a specific user
   */
  async findByIdWithRelationship(
    id: string,
    userId: string
  ): Promise<{ person: Person; relationship: NonNullable<RelationshipProperties['KNOWS']> | null } | null> {
    const query = `
      MATCH (p:Person {id: $id})
      OPTIONAL MATCH (u:User {id: $userId})-[r:KNOWS]->(p)
      RETURN p, r
    `;

    const result = await neo4jService.executeQuery<{
      p: Person;
      r: NonNullable<RelationshipProperties['KNOWS']> | null;
    }>(query, { id, userId });

    if (!result[0]) {
      return null;
    }

    return {
      person: result[0].p,
      relationship: result[0].r,
    };
  }

  /**
   * Find people by name (fuzzy match) or canonical name
   */
  async searchByName(name: string): Promise<Person[]> {
    const query = `
      MATCH (p:Person)
      WHERE p.name CONTAINS $name OR p.canonical_name CONTAINS toLower($name)
      RETURN p
      ORDER BY p.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{ p: Person }>(query, { name });
    return result.map((r) => r.p);
  }

  /**
   * Find people by name for a specific user, including relationship data
   */
  async searchByNameWithRelationship(
    name: string,
    userId: string
  ): Promise<Array<{ person: Person; relationship: NonNullable<RelationshipProperties['KNOWS']> | null }>> {
    const query = `
      MATCH (p:Person)
      WHERE p.name CONTAINS $name OR p.canonical_name CONTAINS toLower($name)
      OPTIONAL MATCH (u:User {id: $userId})-[r:KNOWS]->(p)
      RETURN p, r
      ORDER BY r.last_mentioned_at DESC, p.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{
      p: Person;
      r: NonNullable<RelationshipProperties['KNOWS']> | null;
    }>(query, { name, userId });

    return result.map((r) => ({
      person: r.p,
      relationship: r.r,
    }));
  }

  /**
   * Find person by entity_key (for idempotent updates)
   */
  async findByEntityKey(entityKey: string): Promise<Person | null> {
    const query = 'MATCH (p:Person {entity_key: $entityKey}) RETURN p';
    const result = await neo4jService.executeQuery<{ p: Person }>(query, { entityKey });
    return result[0]?.p || null;
  }

  /**
   * Find person by canonical name
   */
  async findByCanonicalName(canonicalName: string): Promise<Person | null> {
    const query = 'MATCH (p:Person {canonical_name: $canonicalName}) RETURN p';
    const result = await neo4jService.executeQuery<{ p: Person }>(query, { canonicalName });
    return result[0]?.p || null;
  }

  /**
   * Get all people mentioned in recent conversations (person nodes only)
   */
  async getRecentlyMentioned(userId: string, daysBack: number = 14): Promise<Person[]> {
    const query = `
      MATCH (u:User {id: $userId})-[:HAD_CONVERSATION]->(c:Conversation)
      WHERE c.date > datetime() - duration({days: $daysBack})
      MATCH (c)-[:MENTIONED]->(p:Person)
      RETURN DISTINCT p
      ORDER BY p.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{ p: Person }>(query, {
      userId,
      daysBack,
    });

    return result.map((r) => r.p);
  }

  /**
   * Get all people mentioned in recent conversations with KNOWS relationship data
   */
  async getRecentlyMentionedWithRelationship(
    userId: string,
    daysBack: number = 14
  ): Promise<Array<{ person: Person; relationship: NonNullable<RelationshipProperties['KNOWS']> | null }>> {
    const query = `
      MATCH (u:User {id: $userId})-[:HAD_CONVERSATION]->(c:Conversation)
      WHERE c.date > datetime() - duration({days: $daysBack})
      MATCH (c)-[:MENTIONED]->(p:Person)
      OPTIONAL MATCH (u)-[r:KNOWS]->(p)
      RETURN DISTINCT p, r
      ORDER BY r.last_mentioned_at DESC, p.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{
      p: Person;
      r: NonNullable<RelationshipProperties['KNOWS']> | null;
    }>(query, {
      userId,
      daysBack,
    });

    return result.map((r) => ({
      person: r.p,
      relationship: r.r,
    }));
  }

  /**
   * Get all people known by a user with their relationship data
   */
  async getAllKnownPeople(
    userId: string
  ): Promise<Array<{ person: Person; relationship: NonNullable<RelationshipProperties['KNOWS']> }>> {
    const query = `
      MATCH (u:User {id: $userId})-[r:KNOWS]->(p:Person)
      RETURN p, r
      ORDER BY r.last_mentioned_at DESC
    `;

    const result = await neo4jService.executeQuery<{
      p: Person;
      r: NonNullable<RelationshipProperties['KNOWS']>;
    }>(query, { userId });

    return result.map((r) => ({
      person: r.p,
      relationship: r.r,
    }));
  }

  /**
   * Link person to conversation with mention metadata
   */
  async linkToConversation(
    personId: string,
    conversationId: string,
    metadata: { count?: number; sentiment?: number; importance_score?: number } = {}
  ): Promise<void> {
    const query = `
      MATCH (p:Person {id: $personId})
      MATCH (c:Conversation {id: $conversationId})
      MERGE (c)-[r:MENTIONED]->(p)
      SET r.count = coalesce($count, 1),
          r.sentiment = coalesce($sentiment, 0),
          r.importance_score = coalesce($importance_score, 0.5)
    `;

    await neo4jService.executeQuery(query, {
      personId,
      conversationId,
      count: metadata.count || 1,
      sentiment: metadata.sentiment || 0,
      importance_score: metadata.importance_score || 0.5,
    });
  }
}

export const personRepository = new PersonRepository();
