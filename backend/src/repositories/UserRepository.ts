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
        u.created_at = datetime(),
        u.question_preferences = $question_preferences
      ON MATCH SET
        u.name = $name,
        u.question_preferences = coalesce($question_preferences, u.question_preferences)
      RETURN u
    `;

    const result = await neo4jService.executeQuery<{ u: User }>(query, {
      id: user.id,
      name: user.name,
      question_preferences: user.question_preferences !== undefined ? user.question_preferences : null,
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

  /**
   * Update question preferences for multi-armed bandit learning
   */
  async updateQuestionPreferences(
    userId: string,
    preferences: {
      probe: number;
      reflect: number;
      reframe: number;
      contrast: number;
      hypothetical: number;
    }
  ): Promise<void> {
    const query = `
      MATCH (u:User {id: $userId})
      SET u.question_preferences = $preferences
      RETURN u
    `;

    const result = await neo4jService.executeQuery<{ u: User }>(query, { userId, preferences });

    if (!result[0]) {
      throw new Error(`User with id ${userId} not found`);
    }
  }

  /**
   * Get question preferences for a user
   */
  async getQuestionPreferences(userId: string): Promise<User['question_preferences'] | null> {
    const query = `
      MATCH (u:User {id: $userId})
      RETURN u.question_preferences as preferences
    `;

    const result = await neo4jService.executeQuery<{ preferences: User['question_preferences'] }>(
      query,
      { userId }
    );

    return result[0]?.preferences || null;
  }
}

export const userRepository = new UserRepository();
