import { neo4jService } from '../db/neo4j.js';
import type { GraphNode, GraphLink, GraphData, NodeType } from '../types/visualization.js';

interface Neo4jNode {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
}

export class GraphService {
  /**
   * Get all users for the dropdown selector
   */
  async getAllUsers(): Promise<Array<{ id: string; name: string; created_at: string }>> {
    const query = `
      MATCH (u:User)
      RETURN u.id as id, u.name as name, u.created_at as created_at
      ORDER BY u.created_at DESC
    `;

    const result = await neo4jService.executeQuery<{
      id: string;
      name: string;
      created_at: string;
    }>(query, {});

    return result;
  }

  /**
   * Get full graph data for a specific user
   * Returns all nodes and relationships connected to the user
   */
  async getFullGraphForUser(userId: string): Promise<GraphData> {
    // Query to get all nodes and relationships for a user
    const query = `
      // Get the user node
      MATCH (u:User {id: $userId})

      // Get all connected nodes and their relationships
      OPTIONAL MATCH (u)-[r1]-(n)
      WHERE n:Person OR n:Project OR n:Topic OR n:Idea OR n:Conversation OR n:Note OR n:Artifact

      // Get relationships between non-user nodes
      OPTIONAL MATCH (n1)-[r2]-(n2)
      WHERE (n1:Person OR n1:Project OR n1:Topic OR n1:Idea OR n1:Conversation)
        AND (n2:Person OR n2:Project OR n2:Topic OR n2:Idea OR n2:Conversation)
        AND id(n1) < id(n2)  // Avoid duplicate relationships

      // Return everything
      WITH u,
           collect(DISTINCT n) as nodes,
           collect(DISTINCT {type: type(r1), start: startNode(r1), end: endNode(r1), properties: properties(r1)}) as userRelationships,
           collect(DISTINCT {type: type(r2), start: startNode(r2), end: endNode(r2), properties: properties(r2)}) as nodeRelationships

      RETURN u,
             [node IN nodes WHERE node IS NOT NULL | {
               id: CASE WHEN node.id IS NOT NULL THEN node.id ELSE toString(id(node)) END,
               labels: labels(node),
               properties: properties(node)
             }] as connectedNodes,
             [rel IN userRelationships WHERE rel.type IS NOT NULL | rel] as userRels,
             [rel IN nodeRelationships WHERE rel.type IS NOT NULL | rel] as nodeRels
    `;

    const result = await neo4jService.executeQuery<{
      u: { id: string; name: string; created_at: string; question_preferences?: any };
      connectedNodes: Neo4jNode[];
      userRels: Array<{ type: string; start: any; end: any; properties: Record<string, any> }>;
      nodeRels: Array<{ type: string; start: any; end: any; properties: Record<string, any> }>;
    }>(query, { userId });

    if (!result[0]) {
      throw new Error(`User with id ${userId} not found`);
    }

    const { u: user, connectedNodes, userRels, nodeRels } = result[0];

    // Debug logging
    console.log('[DEBUG] User raw:', JSON.stringify(user, null, 2));
    console.log('[DEBUG] Connected nodes:', connectedNodes.length);
    console.log('[DEBUG] User relationships:', userRels.length);
    console.log('[DEBUG] Node relationships:', nodeRels.length);

    // Transform to GraphData format
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];

    // Add user node
    // Neo4j may return user properties directly or nested under 'properties'
    const userNode = 'properties' in user ? (user as { properties: typeof user }).properties : user;

    if (!userNode.id) {
      throw new Error('User node missing required id property');
    }

    if (!userNode.name) {
      throw new Error('User node missing required name property');
    }

    nodes.push({
      id: userNode.id,
      name: userNode.name,
      type: 'User',
      val: 15, // Make user node MUCH larger
      details: userNode as unknown as GraphNode['details'],
    });

    // Build a map of user→entity relationships for quick lookup
    const userRelationshipMap = new Map<string, Record<string, unknown>>();
    for (const rel of userRels) {
      // Extract IDs with proper null checking
      const sourceId = rel.start.properties?.id || rel.start.id;
      const targetId = rel.end.properties?.id || rel.end.id;

      if (!sourceId || !targetId) {
        throw new Error('Relationship missing source or target ID');
      }

      // If this relationship starts from the user, store it by target entity ID
      if (sourceId === userId) {
        userRelationshipMap.set(targetId, rel.properties);
      } else if (targetId === userId) {
        userRelationshipMap.set(sourceId, rel.properties);
      }
    }

    // Add all connected nodes
    for (const node of connectedNodes) {
      const nodeType = node.labels[0] as NodeType;
      const props = node.properties;

      // Get node name based on available properties with explicit validation
      let name: string;
      if (props.name && typeof props.name === 'string') {
        name = props.name;
      } else if (props.canonical_name && typeof props.canonical_name === 'string') {
        name = props.canonical_name;
      } else if (props.title && typeof props.title === 'string') {
        name = props.title;
      } else if (typeof props.summary === 'string') {
        name = props.summary.substring(0, 50);
      } else {
        name = nodeType;
      }

      nodes.push({
        id: node.id,
        name,
        type: nodeType,
        val: 1,
        // Use properties as-is - they match the domain type structure
        details: props as unknown as GraphNode['details'],
        // Add user's relationship to this entity (if exists)
        userRelationship: userRelationshipMap.get(node.id),
      });
    }

    // Transform relationships to links
    const processRelationship = (rel: {
      type: string;
      start: { properties?: { id?: string }; id?: string; identity?: { low: number } };
      end: { properties?: { id?: string }; id?: string; identity?: { low: number } };
      properties: Record<string, unknown>;
    }) => {
      const sourceId = rel.start.properties?.id || rel.start.id;
      const targetId = rel.end.properties?.id || rel.end.id;

      if (!sourceId || !targetId) {
        throw new Error('Relationship missing source or target ID');
      }

      links.push({
        source: sourceId,
        target: targetId,
        label: rel.type,
        value: 1,
        properties: rel.properties as GraphLink['properties'],
      });
    };

    // Add user relationships
    userRels.forEach(processRelationship);

    // Add node-to-node relationships
    nodeRels.forEach(processRelationship);

    return {
      nodes,
      links,
    };
  }
}

export const graphService = new GraphService();
