import { neo4jService } from '../db/neo4j.js';
import { Person } from '../types/graph.js';

export class PersonRepository {
  /**
   * Create or update a person
   */
  async upsert(
    person: Partial<Person> & {
      id: string;
      entity_key: string;
      name: string;
      canonical_name: string;
      last_update_source: string;
      confidence: number;
      excerpt_span: string;
    }
  ): Promise<Person> {
    const query = `
      MERGE (p:Person {entity_key: $entity_key})
      ON CREATE SET
        p.id = $id,
        p.name = $name,
        p.canonical_name = $canonical_name,
        p.relationship_type = $relationship_type,
        p.first_mentioned_at = datetime(),
        p.last_mentioned_at = datetime(),
        p.updated_at = datetime(),
        p.last_update_source = $last_update_source,
        p.confidence = $confidence,
        p.excerpt_span = $excerpt_span,
        p.how_they_met = $how_they_met,
        p.why_they_matter = $why_they_matter,
        p.personality_traits = $personality_traits,
        p.relationship_status = $relationship_status,
        p.communication_cadence = $communication_cadence,
        p.current_life_situation = $current_life_situation
      ON MATCH SET
        p.name = $name,
        p.canonical_name = $canonical_name,
        p.relationship_type = coalesce($relationship_type, p.relationship_type),
        p.last_mentioned_at = datetime(),
        p.updated_at = datetime(),
        p.last_update_source = $last_update_source,
        p.confidence = $confidence,
        p.excerpt_span = $excerpt_span,
        p.how_they_met = coalesce($how_they_met, p.how_they_met),
        p.why_they_matter = coalesce($why_they_matter, p.why_they_matter),
        p.personality_traits = CASE
          WHEN $personality_traits IS NOT NULL
          THEN (p.personality_traits[0..9] + $personality_traits)[0..9]
          ELSE p.personality_traits
        END,
        p.relationship_status = coalesce($relationship_status, p.relationship_status),
        p.communication_cadence = coalesce($communication_cadence, p.communication_cadence),
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
      excerpt_span: person.excerpt_span,
      relationship_type: person.relationship_type || null,
      how_they_met: person.how_they_met || null,
      why_they_matter: person.why_they_matter || null,
      personality_traits: person.personality_traits || null,
      relationship_status: person.relationship_status || null,
      communication_cadence: person.communication_cadence || null,
      current_life_situation: person.current_life_situation || null,
    });

    if (!result[0]) {
      throw new Error('Failed to create/update person');
    }

    return result[0].p;
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
   * Find people by name (fuzzy match) or canonical name
   */
  async searchByName(name: string): Promise<Person[]> {
    const query = `
      MATCH (p:Person)
      WHERE p.name CONTAINS $name OR p.canonical_name CONTAINS toLower($name)
      RETURN p
      ORDER BY p.last_mentioned_at DESC
    `;

    const result = await neo4jService.executeQuery<{ p: Person }>(query, { name });
    return result.map((r) => r.p);
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
   * Get all people mentioned in recent conversations
   */
  async getRecentlyMentioned(userId: string, daysBack: number = 14): Promise<Person[]> {
    const query = `
      MATCH (u:User {id: $userId})-[:HAD_CONVERSATION]->(c:Conversation)
      WHERE c.date > datetime() - duration({days: $daysBack})
      MATCH (c)-[:MENTIONED]->(p:Person)
      RETURN DISTINCT p
      ORDER BY p.last_mentioned_at DESC
    `;

    const result = await neo4jService.executeQuery<{ p: Person }>(query, {
      userId,
      daysBack,
    });

    return result.map((r) => r.p);
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
