import { neo4jService } from '../db/neo4j';
import { Note } from '../types/graph';

/**
 * NOTE: tags array is bounded to MAX 15 items to prevent unbounded growth
 */
export class NoteRepository {
  /**
   * Create or update a note
   */
  async upsert(note: Partial<Note> & { id: string; content: string }): Promise<Note> {
    const query = `
      MERGE (n:Note {id: $id})
      ON CREATE SET
        n.content = $content,
        n.created_at = datetime(),
        n.updated_at = datetime(),
        n.tags = $tags,
        n.sentiment = $sentiment,
        n.embedding = $embedding
      ON MATCH SET
        n.content = $content,
        n.updated_at = datetime(),
        n.tags = CASE
          WHEN $tags IS NOT NULL
          THEN (n.tags[0..14] + $tags)[0..14]
          ELSE n.tags
        END,
        n.sentiment = coalesce($sentiment, n.sentiment),
        n.embedding = coalesce($embedding, n.embedding)
      RETURN n
    `;

    const params = {
      id: note.id,
      content: note.content,
      tags: note.tags !== undefined ? note.tags : null,
      sentiment: note.sentiment !== undefined ? note.sentiment : null,
      embedding: note.embedding !== undefined ? note.embedding : null,
    };

    const result = await neo4jService.executeQuery<{ n: Note }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create/update note');
    }

    return result[0].n;
  }

  /**
   * Find note by ID
   */
  async findById(id: string): Promise<Note | null> {
    const query = 'MATCH (n:Note {id: $id}) RETURN n';
    const result = await neo4jService.executeQuery<{ n: Note }>(query, { id });
    return result[0]?.n !== undefined ? result[0].n : null;
  }

  /**
   * Search notes by content
   */
  async searchByContent(content: string): Promise<Note[]> {
    const query = `
      MATCH (n:Note)
      WHERE n.content CONTAINS $content
      RETURN n
      ORDER BY n.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{ n: Note }>(query, { content });
    return result.map((r) => r.n);
  }

  /**
   * Find notes by tag
   */
  async findByTag(tag: string): Promise<Note[]> {
    const query = `
      MATCH (n:Note)
      WHERE $tag IN n.tags
      RETURN n
      ORDER BY n.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{ n: Note }>(query, { tag });
    return result.map((r) => r.n);
  }

  /**
   * Find notes by sentiment range
   */
  async findBySentiment(minSentiment: number, maxSentiment: number): Promise<Note[]> {
    if (minSentiment < -1 || minSentiment > 1 || maxSentiment < -1 || maxSentiment > 1) {
      throw new Error('Sentiment must be between -1 and 1');
    }

    const query = `
      MATCH (n:Note)
      WHERE n.sentiment >= $minSentiment AND n.sentiment <= $maxSentiment
      RETURN n
      ORDER BY n.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{ n: Note }>(query, {
      minSentiment,
      maxSentiment,
    });
    return result.map((r) => r.n);
  }

  /**
   * Get recent notes
   */
  async getRecent(limit: number = 20): Promise<Note[]> {
    const query = `
      MATCH (n:Note)
      RETURN n
      ORDER BY n.updated_at DESC
      LIMIT $limit
    `;

    const result = await neo4jService.executeQuery<{ n: Note }>(query, { limit });
    return result.map((r) => r.n);
  }

  /**
   * Attach note to an entity
   */
  async attachToEntity(
    noteId: string,
    entityId: string,
    entityType: 'Person' | 'Project' | 'Idea' | 'Topic' | 'Conversation'
  ): Promise<void> {
    const query = `
      MATCH (n:Note {id: $noteId})
      MATCH (e:${entityType} {id: $entityId})
      MERGE (e)-[:HAS_NOTE]->(n)
    `;

    await neo4jService.executeQuery(query, { noteId, entityId });
  }

  /**
   * Get all notes attached to an entity
   */
  async getEntityNotes(
    entityId: string,
    entityType: 'Person' | 'Project' | 'Idea' | 'Topic' | 'Conversation'
  ): Promise<Note[]> {
    const query = `
      MATCH (e:${entityType} {id: $entityId})-[:HAS_NOTE]->(n:Note)
      RETURN n
      ORDER BY n.updated_at DESC
    `;

    const result = await neo4jService.executeQuery<{ n: Note }>(query, { entityId });
    return result.map((r) => r.n);
  }

  /**
   * Delete a note
   */
  async delete(id: string): Promise<void> {
    const query = `
      MATCH (n:Note {id: $id})
      DETACH DELETE n
    `;

    await neo4jService.executeQuery(query, { id });
  }
}

export const noteRepository = new NoteRepository();
