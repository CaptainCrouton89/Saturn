import { executeExplore } from '../agents/tools/retrieval/explore.tool.js';
import { neo4jService } from '../db/neo4j.js';
import type { GraphData, GraphLink, GraphNode, NodeType } from '../types/visualization.js';

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
      RETURN p.user_id as id, p.name as name, p.created_at as created_at
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
        (node.properties.name as string | undefined) ??
        (node.properties.description as string | undefined)?.substring(0, 30);

      if (!name) {
        throw new Error(
          `Node ${node.id} of type ${node.type} has no name or description property`
        );
      }

      // Filter properties to only include allowed types (same as links)
      const filteredProps: Record<string, string | number | boolean | null | undefined> = {};
      for (const [key, value] of Object.entries(node.properties)) {
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
        id: node.id,
        type: node.type as NodeType,
        name,
        properties: filteredProps,
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

  /**
   * Execute manual Cypher query and return graph data
   * Security: Enforces user_id constraint on all queries
   */
  async executeQuery(cypherQuery: string, userId: string): Promise<GraphData> {
    // Security: Ensure query includes user_id constraint
    if (
      !cypherQuery.includes('user_id:') &&
      !cypherQuery.includes('user_id =') &&
      !cypherQuery.includes('user_id=')
    ) {
      throw new Error(
        'Security: Cypher queries must include user_id constraint to prevent cross-user data access. Example: MATCH (p:Person {user_id: $user_id}) RETURN p'
      );
    }

    // Execute query with user_id parameter
    const results = await neo4jService.executeRaw(cypherQuery, { user_id: userId });

    // Parse results to extract nodes and relationships
    const nodesMap = new Map<string, GraphNode>();
    const linksSet = new Set<string>();
    const links: GraphLink[] = [];

    for (const record of results) {
      // Process each field in the record
      for (const key of record.keys) {
        const value = record.get(key);

        // Check if it's a node
        if (value && typeof value === 'object' && 'labels' in value && 'properties' in value) {
          const node = value as {
            labels: string[];
            properties: Record<string, unknown>;
            identity: { low: number; high: number };
          };

          const entityKey = node.properties.entity_key as string;
          if (entityKey && !nodesMap.has(entityKey)) {
            const name =
              (node.properties.name as string | undefined) ??
              (node.properties.description as string | undefined)?.substring(0, 30) ??
              entityKey;

            // Filter properties to only include allowed types
            const filteredProps: Record<string, string | number | boolean | null | undefined> = {};
            for (const [key, value] of Object.entries(node.properties)) {
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

            nodesMap.set(entityKey, {
              id: entityKey,
              type: node.labels[0] as NodeType,
              name,
              properties: filteredProps,
            });
          }
        }

        // Check if it's a relationship
        if (value && typeof value === 'object' && 'type' in value && 'start' in value && 'end' in value) {
          // Relationships without path context are skipped
          // The user should use RETURN n, r, m pattern or path patterns for full extraction
          continue;
        }

        // Check if it's a path
        if (value && typeof value === 'object' && 'segments' in value) {
          const path = value as {
            segments: Array<{
              start: {
                labels: string[];
                properties: Record<string, unknown>;
              };
              relationship: {
                type: string;
                properties: Record<string, unknown>;
              };
              end: {
                labels: string[];
                properties: Record<string, unknown>;
              };
            }>;
          };

          // Process path segments
          for (const segment of path.segments) {
            // Add start node
            const startKey = segment.start.properties.entity_key as string;
            if (startKey && !nodesMap.has(startKey)) {
              const name =
                (segment.start.properties.name as string | undefined) ??
                (segment.start.properties.description as string | undefined)?.substring(0, 30) ??
                startKey;

              // Filter properties to only include allowed types
              const startProps: Record<string, string | number | boolean | null | undefined> = {};
              for (const [key, value] of Object.entries(segment.start.properties)) {
                if (
                  typeof value === 'string' ||
                  typeof value === 'number' ||
                  typeof value === 'boolean' ||
                  value === null ||
                  value === undefined
                ) {
                  startProps[key] = value;
                }
              }

              nodesMap.set(startKey, {
                id: startKey,
                type: segment.start.labels[0] as NodeType,
                name,
                properties: startProps,
              });
            }

            // Add end node
            const endKey = segment.end.properties.entity_key as string;
            if (endKey && !nodesMap.has(endKey)) {
              const name =
                (segment.end.properties.name as string | undefined) ??
                (segment.end.properties.description as string | undefined)?.substring(0, 30) ??
                endKey;

              // Filter properties to only include allowed types
              const endProps: Record<string, string | number | boolean | null | undefined> = {};
              for (const [key, value] of Object.entries(segment.end.properties)) {
                if (
                  typeof value === 'string' ||
                  typeof value === 'number' ||
                  typeof value === 'boolean' ||
                  value === null ||
                  value === undefined
                ) {
                  endProps[key] = value;
                }
              }

              nodesMap.set(endKey, {
                id: endKey,
                type: segment.end.labels[0] as NodeType,
                name,
                properties: endProps,
              });
            }

            // Add relationship
            if (startKey && endKey) {
              const linkKey = `${startKey}:${segment.relationship.type}:${endKey}`;
              if (!linksSet.has(linkKey)) {
                linksSet.add(linkKey);

                const filteredProps: Record<string, string | number | boolean | null | undefined> = {};
                for (const [propKey, propValue] of Object.entries(segment.relationship.properties)) {
                  if (
                    typeof propValue === 'string' ||
                    typeof propValue === 'number' ||
                    typeof propValue === 'boolean' ||
                    propValue === null ||
                    propValue === undefined
                  ) {
                    filteredProps[propKey] = propValue;
                  }
                }

                links.push({
                  source: startKey,
                  target: endKey,
                  label: segment.relationship.type,
                  properties: filteredProps,
                });
              }
            }
          }
        }
      }
    }

    return {
      nodes: Array.from(nodesMap.values()),
      links,
    };
  }

  /**
   * Execute explore tool (semantic search + graph expansion)
   * Returns graph data from explore tool output
   */
  async executeExplore(
    input: {
      queries?: Array<{ query: string; threshold?: number }>;
      text_matches?: string[];
      return_explanations?: boolean;
    },
    userId: string
  ): Promise<GraphData> {
    // Normalize queries to ensure threshold is set (default 0.5)
    const normalizedInput = {
      queries: input.queries?.map(q => ({
        query: q.query,
        threshold: q.threshold ?? 0.5
      })),
      text_matches: input.text_matches,
      search_relationships: true,
      return_explanations: input.return_explanations
    };

    // Execute explore
    const resultStr = await executeExplore(userId, normalizedInput);

    // Handle both string and ToolMessage return types
    const resultJson = typeof resultStr === 'string' ? resultStr : (resultStr as { content: string }).content;
    const result = JSON.parse(resultJson as string);

    // Transform explore output to GraphData format
    const nodes: GraphNode[] = result.nodes.map((node: { entity_key: string; node_type: string; [key: string]: unknown }) => {
      const name = (node.name ?? (typeof node.description === 'string' ? node.description.substring(0, 30) : undefined) ?? node.entity_key) as string;

      // Extract all properties except entity_key and node_type (which are already mapped to id/type)
      const properties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        if (key !== 'entity_key' && key !== 'node_type') {
          properties[key] = value;
        }
      }

      // Filter properties to only include allowed types (same as full graph)
      const filteredProps: Record<string, string | number | boolean | null | undefined> = {};
      for (const [key, value] of Object.entries(properties)) {
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
        id: node.entity_key,
        type: node.node_type as NodeType,
        name,
        properties: filteredProps,
      };
    });

    // Add neighbors to nodes (neighbors have limited properties by design from retrievalService)
    if (result.neighbors) {
      for (const neighbor of result.neighbors) {
        if (!nodes.find(n => n.id === neighbor.entity_key)) {
          const name = (typeof neighbor.name === 'string' ? neighbor.name : undefined) ??
                      (typeof neighbor.description === 'string' ? neighbor.description.substring(0, 30) : undefined) ??
                      neighbor.entity_key;

          // Extract available properties from neighbor
          const properties: Record<string, string | number | boolean | null | undefined> = {};
          for (const [key, value] of Object.entries(neighbor)) {
            if (key !== 'entity_key' && key !== 'node_type') {
              if (
                typeof value === 'string' ||
                typeof value === 'number' ||
                typeof value === 'boolean' ||
                value === null ||
                value === undefined
              ) {
                properties[key] = value;
              }
            }
          }

          nodes.push({
            id: neighbor.entity_key,
            type: neighbor.node_type as NodeType,
            name,
            properties,
          });
        }
      }
    }

    const links: GraphLink[] = result.edges.map((edge: {
      from_entity_key: string;
      to_entity_key: string;
      relationship_type: string;
      properties: Record<string, unknown>;
    }) => {
      const filteredProps: Record<string, string | number | boolean | null | undefined> = {};
      for (const [key, value] of Object.entries(edge.properties)) {
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
        source: edge.from_entity_key,
        target: edge.to_entity_key,
        label: edge.relationship_type,
        properties: filteredProps,
      };
    });

    return {
      nodes,
      links,
    };
  }
}

export const graphService = new GraphService();
