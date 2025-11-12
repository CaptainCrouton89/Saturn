import { createHash } from 'crypto';
import { neo4jService, neo4jInt } from '../db/neo4j.js';
import { Entity, Person, Concept, RelationshipProperties } from '../types/graph.js';

export class EntityRepository {
  /**
   * Generate stable entity_key for idempotent operations
   */
  static generateEntityKey(name: string, type: string, userId: string): string {
    return createHash('sha256')
      .update(name.toLowerCase() + type + userId)
      .digest('hex');
  }

  /**
   * Create or update an entity (intrinsic properties only)
   */
  async upsert(
    entity: Partial<Entity> & {
      name: string;
      type: string;
      user_id: string;
      description: string;
      last_update_source: string;
      confidence: number;
    }
  ): Promise<Entity> {
    // Generate entity_key if not provided
    const entity_key =
      entity.entity_key || EntityRepository.generateEntityKey(entity.name, entity.type, entity.user_id);

    const query = `
      MERGE (e:Entity {entity_key: $entity_key})
      ON CREATE SET
        e.user_id = $user_id,
        e.name = $name,
        e.type = $type,
        e.description = $description,
        e.notes = $notes,
        e.created_at = datetime(),
        e.updated_at = datetime(),
        e.last_update_source = $last_update_source,
        e.confidence = $confidence
      ON MATCH SET
        e.name = $name,
        e.type = $type,
        e.description = coalesce($description, e.description),
        e.notes = coalesce($notes, e.notes),
        e.updated_at = datetime(),
        e.last_update_source = $last_update_source,
        e.confidence = $confidence
      RETURN e
    `;

    const result = await neo4jService.executeQuery<{ e: Entity }>(query, {
      entity_key,
      user_id: entity.user_id,
      name: entity.name,
      type: entity.type,
      description: entity.description,
      notes: entity.notes || '',
      last_update_source: entity.last_update_source,
      confidence: entity.confidence,
    });

    if (!result[0]) {
      throw new Error('Failed to create/update entity');
    }

    return result[0].e;
  }

  /**
   * Create or update relates_to relationship between two entities
   */
  async upsertEntityRelationship(
    fromEntityKey: string,
    toEntityKey: string,
    properties: Partial<NonNullable<RelationshipProperties['RELATES_TO_ENTITY']>> & {
      relationship_type: string;
    }
  ): Promise<NonNullable<RelationshipProperties['RELATES_TO_ENTITY']>> {
    const query = `
      MATCH (e1:Entity {entity_key: $fromEntityKey})
      MATCH (e2:Entity {entity_key: $toEntityKey})
      MERGE (e1)-[r:relates_to]->(e2)
      ON CREATE SET
        r.relationship_type = $relationship_type,
        r.notes = coalesce($notes, ''),
        r.relevance = coalesce($relevance, 5),
        r.created_at = datetime(),
        r.updated_at = datetime()
      ON MATCH SET
        r.relationship_type = coalesce($relationship_type, r.relationship_type),
        r.notes = coalesce($notes, r.notes),
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
      notes: properties.notes || '',
      relevance: properties.relevance || 5,
    });

    if (!result[0]) {
      throw new Error('Failed to create/update entity-entity relationship');
    }

    return result[0].r;
  }

  /**
   * Create or update relates_to relationship between Person and Entity
   */
  async upsertPersonRelationship(
    personEntityKey: string,
    entityKey: string,
    properties: Partial<NonNullable<RelationshipProperties['RELATES_TO_PERSON']>> & {
      relationship_type: string;
    }
  ): Promise<NonNullable<RelationshipProperties['RELATES_TO_PERSON']>> {
    const query = `
      MATCH (p:Person {entity_key: $personEntityKey})
      MATCH (e:Entity {entity_key: $entityKey})
      MERGE (p)-[r:relates_to]->(e)
      ON CREATE SET
        r.relationship_type = $relationship_type,
        r.notes = coalesce($notes, ''),
        r.relevance = coalesce($relevance, 5),
        r.created_at = datetime(),
        r.updated_at = datetime()
      ON MATCH SET
        r.relationship_type = coalesce($relationship_type, r.relationship_type),
        r.notes = coalesce($notes, r.notes),
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
      notes: properties.notes || '',
      relevance: properties.relevance || 5,
    });

    if (!result[0]) {
      throw new Error('Failed to create/update person-entity relationship');
    }

    return result[0].r;
  }

  /**
   * Find entity by entity_key
   */
  async findById(entityKey: string): Promise<Entity | null> {
    const query = 'MATCH (e:Entity {entity_key: $entity_key}) RETURN e';
    const result = await neo4jService.executeQuery<{ e: Entity }>(query, { entity_key: entityKey });
    return result[0]?.e !== undefined ? result[0].e : null;
  }

  /**
   * Find entities by type for a specific user
   */
  async findByType(type: string, userId: string): Promise<Entity[]> {
    const query = `
      MATCH (e:Entity {type: $type, user_id: $userId})
      RETURN e
      ORDER BY e.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{ e: Entity }>(query, { type, userId });
    return result.map((r) => r.e);
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
    return result.map((r) => r.e);
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

    return result.map((r) => ({
      entity: r.e,
      similarity: r.similarity,
    }));
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

    return result.map((r) => r.e);
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
    return result.map((r) => r.e);
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

    return result.map((r) => ({
      entity: r.entity,
      relationship: r.relationship,
    }));
  }

  /**
   * Get people related to a specific entity
   */
  async getRelatedPeople(
    entityKey: string
  ): Promise<Array<{ person: Person; relationship: NonNullable<RelationshipProperties['RELATES_TO_PERSON']> }>> {
    const query = `
      MATCH (p:Person)-[r:relates_to]->(e:Entity {entity_key: $entityKey})
      RETURN p as person, r as relationship
      ORDER BY r.relevance DESC, r.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{
      person: Person;
      relationship: NonNullable<RelationshipProperties['RELATES_TO_PERSON']>;
    }>(query, { entityKey });

    return result.map((r) => ({
      person: r.person,
      relationship: r.relationship,
    }));
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

    return result.map((r) => ({
      concept: r.concept,
      relationship: r.relationship,
    }));
  }
}

export const entityRepository = new EntityRepository();
