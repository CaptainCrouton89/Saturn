import { neo4jService } from '../db/neo4j.js';
import type { GraphNode, GraphLink, GraphData, NodeType } from '../types/visualization.js';

interface Neo4jNode {
  id: string;
  type: string;
  properties: Record<string, unknown>;
}

interface Neo4jLink {
  source: string;
  target: string;
  type: string;
  properties: Record<string, unknown>;
}

export class GraphService {
  /**
   * Get all users for the dropdown selector
   */
  async getAllUsers(): Promise<Array<{ id: string; name: string; created_at: string }>> {
    const query = `
      MATCH (p:Person {is_owner: true})
      RETURN p.user_id as id, p.canonical_name as name, p.created_at as created_at
      ORDER BY p.created_at DESC
    `;

    const result = await neo4jService.executeQuery<{
      id: string;
      name: string;
      created_at: string;
    }>(query);

    return result;
  }

  /**
   * Get full graph data for a specific user
   * Returns all nodes and relationships connected to the user
   */
  async getFullGraphForUser(userId: string): Promise<GraphData> {
    // Query all nodes for user
    const nodesQuery = `
      MATCH (n)
      WHERE n.user_id = $user_id
      RETURN
        n.entity_key as id,
        labels(n)[0] as type,
        properties(n) as properties
    `;

    // Query all relationships between user's nodes
    const linksQuery = `
      MATCH (source)-[r]->(target)
      WHERE source.user_id = $user_id AND target.user_id = $user_id
      RETURN
        source.entity_key as source,
        target.entity_key as target,
        type(r) as type,
        properties(r) as properties
    `;

    const nodes = await neo4jService.executeQuery<Neo4jNode>(nodesQuery, { user_id: userId });
    const links = await neo4jService.executeQuery<Neo4jLink>(linksQuery, { user_id: userId });

    // Transform to GraphData format
    const graphNodes: GraphNode[] = nodes.map((node) => {
      const name =
        (node.properties.canonical_name as string | undefined) ??
        (node.properties.name as string | undefined) ??
        (node.properties.description as string | undefined)?.substring(0, 30);

      if (!name) {
        throw new Error(
          `Node ${node.id} of type ${node.type} has no name, canonical_name, or description property`
        );
      }

      return {
        id: node.id,
        type: node.type as NodeType,
        name,
        // Details omitted - GraphNode.details is optional and requires strict entity types
        // Client can fetch full details via separate endpoint if needed
      };
    });

    const graphLinks: GraphLink[] = links.map((link) => {
      // Filter properties to only include allowed types
      const filteredProps: Record<string, string | number | boolean | null | undefined> = {};
      for (const [key, value] of Object.entries(link.properties)) {
        if (
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          value === null ||
          value === undefined
        ) {
          filteredProps[key] = value;
        }
      }

      return {
        source: link.source,
        target: link.target,
        label: link.type,
        properties: filteredProps,
      };
    });

    return {
      nodes: graphNodes,
      links: graphLinks,
    };
  }
}

export const graphService = new GraphService();
