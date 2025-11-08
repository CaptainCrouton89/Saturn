import { neo4jService } from '../db/neo4j';
import { User } from '../types/graph';

export class UserRepository {
  /**
   * Create or get a user
   */
  async upsert(user: Omit<User, 'created_at'>): Promise<User> {
    const query = `
      MERGE (u:User {id: $id})
      ON CREATE SET
        u.name = $name,
        u.created_at = datetime()
      ON MATCH SET
        u.name = $name
      RETURN u
    `;

    const result = await neo4jService.executeQuery<{ u: User }>(query, {
      id: user.id,
      name: user.name,
    });

    if (!result[0]) {
      throw new Error('Failed to create/update user');
    }

    return result[0].u;
  }

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User | null> {
    const query = 'MATCH (u:User {id: $id}) RETURN u';
    const result = await neo4jService.executeQuery<{ u: User }>(query, { id });
    return result[0]?.u || null;
  }

  /**
   * Get user's conversation count
   */
  async getConversationCount(userId: string): Promise<number> {
    const query = `
      MATCH (u:User {id: $userId})-[:HAD_CONVERSATION]->(c:Conversation)
      RETURN count(c) as count
    `;

    const result = await neo4jService.executeQuery<{ count: number }>(query, { userId });
    return result[0]?.count || 0;
  }
}

export const userRepository = new UserRepository();
