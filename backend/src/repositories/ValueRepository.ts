import { neo4jService } from '../db/neo4j';
import { Value } from '../types/graph';

export class ValueRepository {
  /**
   * Create or update a value
   */
  async upsert(value: Partial<Value> & { id: string; description: string }): Promise<Value> {
    const query = `
      MERGE (v:Value {id: $id})
      ON CREATE SET
        v.description = $description,
        v.first_stated_at = datetime(),
        v.importance = $importance
      ON MATCH SET
        v.description = $description,
        v.importance = coalesce($importance, v.importance)
      RETURN v
    `;

    const params = {
      id: value.id,
      description: value.description,
      importance: value.importance !== undefined ? value.importance : 'secondary',
    };

    const result = await neo4jService.executeQuery<{ v: Value }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create/update value');
    }

    return result[0].v;
  }

  /**
   * Find value by ID
   */
  async findById(id: string): Promise<Value | null> {
    const query = 'MATCH (v:Value {id: $id}) RETURN v';
    const result = await neo4jService.executeQuery<{ v: Value }>(query, { id });
    return result[0]?.v !== undefined ? result[0].v : null;
  }

  /**
   * Find values by importance level
   */
  async findByImportance(importance: string): Promise<Value[]> {
    const query = `
      MATCH (v:Value {importance: $importance})
      RETURN v
      ORDER BY v.first_stated_at DESC
    `;

    const result = await neo4jService.executeQuery<{ v: Value }>(query, { importance });
    return result.map((r) => r.v);
  }

  /**
   * Get all values for a user
   */
  async getUserValues(userId: string): Promise<Value[]> {
    const query = `
      MATCH (u:User {id: $userId})-[r:VALUES]->(v:Value)
      RETURN v, r.strength as strength
      ORDER BY r.strength DESC, v.importance
    `;

    const result = await neo4jService.executeQuery<{ v: Value; strength: number }>(query, { userId });
    return result.map((r) => r.v);
  }

  /**
   * Link value to user
   */
  async linkToUser(userId: string, valueId: string, strength: number = 0.7): Promise<void> {
    const query = `
      MATCH (u:User {id: $userId})
      MATCH (v:Value {id: $valueId})
      MERGE (u)-[r:VALUES]->(v)
      SET r.strength = $strength
    `;

    await neo4jService.executeQuery(query, { userId, valueId, strength });
  }

  /**
   * Update value strength for a user
   */
  async updateStrength(userId: string, valueId: string, strength: number): Promise<void> {
    if (strength < 0 || strength > 1) {
      throw new Error('Strength must be between 0 and 1');
    }

    const query = `
      MATCH (u:User {id: $userId})-[r:VALUES]->(v:Value {id: $valueId})
      SET r.strength = $strength
      RETURN r
    `;

    const result = await neo4jService.executeQuery(query, { userId, valueId, strength });

    if (!result[0]) {
      throw new Error(`Relationship between user ${userId} and value ${valueId} not found`);
    }
  }
}

export const valueRepository = new ValueRepository();
