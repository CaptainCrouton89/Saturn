import { neo4jService } from '../db/neo4j.js';
import { withSpan, buildEntityAttributes } from '../utils/tracing.js';

/**
 * Repository for graph-wide queries
 * Handles cross-entity operations like embeddings retrieval for visualization
 */
export class GraphRepository {
  /**
   * Fetch all semantic nodes with embeddings for UMAP projection
   * Excludes episodic Source nodes
   *
   * @param userId - User ID to scope query
   * @returns Array of nodes with entity_key, type, name, properties, and embedding
   */
  async getSemanticNodesWithEmbeddings(userId: string): Promise<
    Array<{
      entity_key: string;
      type: string;
      name: string;
      description?: string;
      properties: Record<string, unknown>;
      embedding: number[];
      relationship_count: number;
    }>
  > {
    return withSpan(
      'repository.graph.getSemanticNodesWithEmbeddings',
      buildEntityAttributes('graph', 'query', { userId }),
      async () => {
        const query = `
          MATCH (n)
          WHERE n.user_id = $userId
            AND n.embedding IS NOT NULL
            AND labels(n)[0] IN ['Person', 'Concept', 'Entity', 'Artifact', 'Event']
          OPTIONAL MATCH (n)-[r]-()
          WITH n, count(DISTINCT r) as rel_count
          RETURN
            n.entity_key AS entity_key,
            labels(n)[0] AS type,
            n.name AS name,
            n.description AS description,
            properties(n) AS properties,
            n.embedding AS embedding,
            rel_count AS relationship_count
          ORDER BY type, name
        `;

        const results = await neo4jService.executeQuery<{
          entity_key: string;
          type: string;
          name: string;
          description?: string;
          properties: Record<string, unknown>;
          embedding: number[];
          relationship_count: number;
        }>(query, { userId });

        return results;
      }
    );
  }
}

export const graphRepository = new GraphRepository();
