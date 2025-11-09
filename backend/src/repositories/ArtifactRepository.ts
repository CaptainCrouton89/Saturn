import { neo4jService } from '../db/neo4j.js';
import { Artifact } from '../types/graph.js';

export class ArtifactRepository {
  /**
   * Create or update an artifact
   */
  async upsert(artifact: Partial<Artifact> & { id: string; title: string }): Promise<Artifact> {
    const query = `
      MERGE (a:Artifact {id: $id})
      ON CREATE SET
        a.type = $type,
        a.title = $title,
        a.created_at = datetime(),
        a.storage_location = $storage_location
      ON MATCH SET
        a.type = coalesce($type, a.type),
        a.title = $title,
        a.storage_location = coalesce($storage_location, a.storage_location)
      RETURN a
    `;

    const params = {
      id: artifact.id,
      title: artifact.title,
      type: artifact.type !== undefined ? artifact.type : 'technical_doc',
      storage_location: artifact.storage_location !== undefined ? artifact.storage_location : '',
    };

    const result = await neo4jService.executeQuery<{ a: Artifact }>(query, params);

    if (!result[0]) {
      throw new Error('Failed to create/update artifact');
    }

    return result[0].a;
  }

  /**
   * Find artifact by ID
   */
  async findById(id: string): Promise<Artifact | null> {
    const query = 'MATCH (a:Artifact {id: $id}) RETURN a';
    const result = await neo4jService.executeQuery<{ a: Artifact }>(query, { id });
    return result[0]?.a !== undefined ? result[0].a : null;
  }

  /**
   * Find artifacts by type
   */
  async findByType(type: string): Promise<Artifact[]> {
    const query = `
      MATCH (a:Artifact {type: $type})
      RETURN a
      ORDER BY a.created_at DESC
    `;

    const result = await neo4jService.executeQuery<{ a: Artifact }>(query, { type });
    return result.map((r) => r.a);
  }

  /**
   * Get all artifacts produced by a conversation
   */
  async getConversationArtifacts(conversationId: string): Promise<Artifact[]> {
    const query = `
      MATCH (c:Conversation {id: $conversationId})-[:PRODUCED]->(a:Artifact)
      RETURN a
      ORDER BY a.created_at DESC
    `;

    const result = await neo4jService.executeQuery<{ a: Artifact }>(query, { conversationId });
    return result.map((r) => r.a);
  }

  /**
   * Link artifact to conversation
   */
  async linkToConversation(artifactId: string, conversationId: string): Promise<void> {
    const query = `
      MATCH (a:Artifact {id: $artifactId})
      MATCH (c:Conversation {id: $conversationId})
      MERGE (c)-[:PRODUCED]->(a)
    `;

    await neo4jService.executeQuery(query, { artifactId, conversationId });
  }

  /**
   * Search artifacts by title
   */
  async searchByTitle(title: string): Promise<Artifact[]> {
    const query = `
      MATCH (a:Artifact)
      WHERE a.title CONTAINS $title
      RETURN a
      ORDER BY a.created_at DESC
    `;

    const result = await neo4jService.executeQuery<{ a: Artifact }>(query, { title });
    return result.map((r) => r.a);
  }
}

export const artifactRepository = new ArtifactRepository();
