/**
 * Retrieval Service - Helper methods for explore tool
 *
 * Provides semantic search, fuzzy text matching, salience calculation,
 * and graph expansion operations for the explore tool.
 *
 * Reference: tech.md lines 161-226 (Search Tools)
 */

import { OpenAIEmbeddings } from '@langchain/openai';
import { neo4jService } from '../db/neo4j.js';
import { personRepository } from '../repositories/PersonRepository.js';
import { conceptRepository } from '../repositories/ConceptRepository.js';
import { entityRepository } from '../repositories/EntityRepository.js';
import { NoteObject } from '../types/graph.js';

/**
 * Format ISO timestamp to day-level date (YYYY-MM-DD)
 */
function formatDateDayOnly(timestamp: string | undefined | null): string | undefined {
  if (!timestamp) return undefined;
  try {
    const date = new Date(timestamp);
    return date.toISOString().split('T')[0];
  } catch {
    return undefined;
  }
}

/**
 * Shorten entity key to first 12 characters
 */
function shortenEntityKey(entityKey: string): string {
  return entityKey.substring(0, 12);
}

/**
 * Convert notes array to bullet points (for inline display in pipe format)
 */
function formatNotes(notes: NoteObject[] | undefined): string {
  if (!notes || notes.length === 0) return '';
  return notes.map((note) => `- ${note.content}`).join(' ');
}

/**
 * Filter out unwanted fields from node properties
 */
function filterNodeProperties(node: GraphNode): GraphNode {
  const {
    is_dirty,
    decay_gradient,
    recall_frequency,
    last_recall_interval,
    created_by,
    last_update_source,
    embedding,
    ...filtered
  } = node;

  // Remove empty arrays
  const cleaned: GraphNode = { ...filtered };
  for (const [key, value] of Object.entries(cleaned)) {
    if (Array.isArray(value) && value.length === 0) {
      delete cleaned[key];
    }
  }

  return cleaned;
}

/**
 * Format a node to markdown format
 */
function formatNodeToMarkdown(node: GraphNode): string {
  const filtered = filterNodeProperties(node);
  const shortKey = shortenEntityKey(filtered.entity_key);
  const name = filtered.name || filtered.canonical_name || 'Unnamed';
  const nodeType = filtered.node_type;
  const description = filtered.description || '';
  const notes = formatNotes(filtered.notes as NoteObject[] | undefined);
  const state = filtered.state || '';
  const confidence =
    filtered.confidence !== undefined && filtered.confidence !== null && typeof filtered.confidence === 'number'
      ? filtered.confidence.toFixed(1)
      : '';
  const accessCount =
    filtered.access_count !== undefined && filtered.access_count !== null
      ? String(filtered.access_count)
      : '';
  const updatedAt = formatDateDayOnly(filtered.updated_at as string | undefined);

  const parts: string[] = [`## ${name} (entity_key: ${shortKey})`];
  
  if (nodeType) parts.push(`**Type**: ${nodeType}`);
  if (description) parts.push(`**Description**: ${description}`);
  if (notes) parts.push(`**Notes**: ${notes}`);
  
  const metadataParts: string[] = [];
  if (state) metadataParts.push(`State: ${state}`);
  if (confidence) metadataParts.push(`Conf: ${confidence}`);
  if (accessCount) metadataParts.push(`Access: ${accessCount}`);
  if (updatedAt) metadataParts.push(`Updated: ${updatedAt}`);
  
  if (metadataParts.length > 0) {
    parts.push(`**Metadata**: ${metadataParts.join(' | ')}`);
  }

  return parts.join(' | ');
}

/**
 * Format edges to markdown
 */
function formatEdgesToMarkdown(edges: GraphEdge[]): string {
  if (edges.length === 0) return '';
  
  return edges
    .map((edge) => {
      const fromKey = shortenEntityKey(edge.from_entity_key);
      const toKey = shortenEntityKey(edge.to_entity_key);
      const relType = edge.relationship_type;
      const updatedAt = formatDateDayOnly(edge.updated_at || edge.created_at);
      
      const parts: string[] = [`${fromKey} --[${relType}]--> ${toKey}`];
      if (updatedAt) parts.push(`(Updated: ${updatedAt})`);
      
      return `- ${parts.join(' ')}`;
    })
    .join('\n');
}

/**
 * Format neighbors to markdown
 */
function formatNeighborsToMarkdown(neighbors: GraphNode[]): string {
  if (neighbors.length === 0) return '';
  
  return neighbors.map((neighbor) => formatNodeToMarkdown(neighbor)).join('\n\n');
}

// Text similarity using Jaro-Winkler-inspired scoring
function jaroWinklerSimilarity(s1: string, s2: string): number {
  const m1 = s1.toLowerCase();
  const m2 = s2.toLowerCase();

  // Exact match
  if (m1 === m2) return 1.0;

  // Contains match (high score)
  if (m1.includes(m2) || m2.includes(m1)) {
    const shorter = m1.length < m2.length ? m1 : m2;
    const longer = m1.length >= m2.length ? m1 : m2;
    return 0.7 + (0.3 * shorter.length) / longer.length;
  }

  // Token-based similarity (split on spaces, count matching tokens)
  const tokens1 = m1.split(/\s+/);
  const tokens2 = m2.split(/\s+/);

  const matching = tokens1.filter((t1) => tokens2.some((t2) => t1 === t2 || t1.includes(t2) || t2.includes(t1)));

  if (matching.length === 0) return 0.0;

  const score = matching.length / Math.max(tokens1.length, tokens2.length);
  return Math.min(score, 0.6); // Cap fuzzy matches at 0.6
}

interface VectorSearchResult {
  entity_key: string;
  node_type: 'Concept' | 'Entity' | 'Source';
  name?: string;
  description?: string;
  notes?: NoteObject[];
  similarity: number;
}

interface TextMatchResult {
  entity_key: string;
  node_type: 'Person' | 'Entity';
  name: string;
  canonical_name?: string; // For Person nodes
  score: number;
}

interface SalienceScore {
  entity_key: string;
  connections: number;
  recency_days: number;
  salience: number;
}

interface GraphNode {
  entity_key: string;
  node_type: 'Person' | 'Concept' | 'Entity' | 'Source';
  name?: string;
  canonical_name?: string;
  description?: string;
  notes?: NoteObject[];
  [key: string]: unknown; // Allow other properties
}

interface GraphEdge {
  from_entity_key: string;
  to_entity_key: string;
  relationship_type: string;
  properties: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

class RetrievalService {
  private embeddings: OpenAIEmbeddings;

  constructor() {
    this.embeddings = new OpenAIEmbeddings({
      modelName: 'text-embedding-3-small',
    });
  }

  /**
   * Semantic search across node types using embeddings
   *
   * Searches Concepts, Entities, and Sources via vector similarity.
   * Uses cosine similarity with configurable threshold.
   *
   * @param query - Natural language query to embed
   * @param threshold - Minimum cosine similarity (0-1)
   * @param userId - User ID for filtering
   * @param nodeTypes - Node types to search (default: all embeddable types)
   * @returns Array of matching nodes with similarity scores
   */
  async vectorSearch(
    query: string,
    threshold: number,
    userId: string,
    nodeTypes: Array<'Concept' | 'Entity' | 'Source'> = ['Concept', 'Entity', 'Source']
  ): Promise<VectorSearchResult[]> {
    // Generate embedding for query
    const queryEmbedding = await this.embeddings.embedQuery(query);

    const results: VectorSearchResult[] = [];

    // Search each node type
    for (const nodeType of nodeTypes) {
      const cypherQuery = `
        MATCH (n:${nodeType} {user_id: $userId})
        WHERE n.embedding IS NOT NULL
        WITH n,
          reduce(dot = 0.0, i IN range(0, size(n.embedding)-1) |
            dot + n.embedding[i] * $embedding[i]
          ) AS dotProduct,
          sqrt(reduce(sum = 0.0, x IN n.embedding | sum + x * x)) AS normA,
          sqrt(reduce(sum = 0.0, x IN $embedding | sum + x * x)) AS normB
        WITH n, dotProduct / (normA * normB) AS similarity
        WHERE similarity >= $threshold
        RETURN
          n.entity_key as entity_key,
          n.name as name,
          n.description as description,
          n.notes as notes,
          similarity
        ORDER BY similarity DESC
        LIMIT 20
      `;

      const nodeResults = await neo4jService.executeQuery<{
        entity_key: string;
        name?: string;
        description?: string;
        notes?: NoteObject[];
        similarity: number;
      }>(cypherQuery, {
        userId,
        embedding: queryEmbedding,
        threshold,
      });

      results.push(
        ...nodeResults.map((r) => ({
          entity_key: r.entity_key,
          node_type: nodeType,
          name: r.name,
          description: r.description,
          notes: r.notes,
          similarity: r.similarity,
        }))
      );
    }

    // Sort by similarity descending
    return results.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Fuzzy text matching on Person names and Entity names
   *
   * Performs string similarity matching with scoring:
   * - Exact match: 1.0
   * - Contains match: 0.7-1.0
   * - Token overlap: 0.0-0.6
   *
   * @param text - Text to match against names
   * @param userId - User ID for filtering
   * @param nodeTypes - Node types to search (default: Person, Entity)
   * @returns Array of matching nodes with scores
   */
  async fuzzyTextMatch(
    text: string,
    userId: string,
    nodeTypes: Array<'Person' | 'Entity'> = ['Person', 'Entity']
  ): Promise<TextMatchResult[]> {
    const results: TextMatchResult[] = [];

    for (const nodeType of nodeTypes) {
      let cypherQuery: string;

      if (nodeType === 'Person') {
        cypherQuery = `
          MATCH (p:Person {user_id: $userId})
          RETURN
            p.entity_key as entity_key,
            p.name as name,
            p.canonical_name as canonical_name
        `;
      } else {
        // Entity
        cypherQuery = `
          MATCH (e:Entity {user_id: $userId})
          RETURN
            e.entity_key as entity_key,
            e.name as name
        `;
      }

      const nodeResults = await neo4jService.executeQuery<{
        entity_key: string;
        name: string;
        canonical_name?: string;
      }>(cypherQuery, { userId });

      // Score each result using fuzzy matching
      for (const node of nodeResults) {
        const nameScore = jaroWinklerSimilarity(text, node.name);
        const canonicalScore = node.canonical_name ? jaroWinklerSimilarity(text, node.canonical_name) : 0;
        const score = Math.max(nameScore, canonicalScore);

        // Only include if score is above threshold (0.3)
        if (score >= 0.3) {
          results.push({
            entity_key: node.entity_key,
            node_type: nodeType,
            name: node.name,
            canonical_name: node.canonical_name,
            score,
          });
        }
      }
    }

    // Sort by score descending
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate salience score for a node
   *
   * Salience = connections * recency_factor
   * - connections: number of relationships the node has
   * - recency_factor: 1.0 for recent (last 7 days), decays to 0.1 for old (>90 days)
   *
   * @param entityKey - Entity key of node to score
   * @returns Salience metrics
   */
  async calculateSalience(entityKey: string): Promise<SalienceScore> {
    const query = `
      MATCH (n {entity_key: $entityKey})
      OPTIONAL MATCH (n)-[r]-()
      WITH n, count(DISTINCT r) as connections
      WITH n, connections,
        duration.between(n.updated_at, datetime()).days as recency_days
      RETURN
        n.entity_key as entity_key,
        connections,
        recency_days
    `;

    const result = await neo4jService.executeQuery<{
      entity_key: string;
      connections: number;
      recency_days: number;
    }>(query, { entityKey });

    if (result.length === 0) {
      return {
        entity_key: entityKey,
        connections: 0,
        recency_days: 999,
        salience: 0,
      };
    }

    const { connections, recency_days } = result[0];

    // Calculate recency factor (exponential decay)
    // 1.0 for 0-7 days, 0.5 for 30 days, 0.1 for 90+ days
    const recency_factor = Math.max(0.1, Math.exp(-recency_days / 30));

    const salience = connections * recency_factor;

    return {
      entity_key: entityKey,
      connections,
      recency_days,
      salience,
    };
  }

  /**
   * Expand graph around given nodes
   *
   * Fetches:
   * 1. All edges between the provided nodes
   * 2. All edges between nodes and the user's owner Person node
   * 3. Neighbor nodes and edges (1-hop away)
   *
   * @param nodeEntityKeys - Entity keys of nodes to expand from
   * @param userId - User ID for filtering
   * @returns Graph structure with nodes, edges, and neighbors
   */
  async expandGraph(
    nodeEntityKeys: string[],
    userId: string
  ): Promise<{
    nodes: GraphNode[];
    edges: GraphEdge[];
    neighbors: GraphNode[];
  }> {
    if (nodeEntityKeys.length === 0) {
      return { nodes: [], edges: [], neighbors: [] };
    }

    // 1. Get edges between hit nodes
    const edgesBetweenQuery = `
      MATCH (n1)-[r]->(n2)
      WHERE n1.entity_key IN $entityKeys AND n2.entity_key IN $entityKeys
      RETURN
        n1.entity_key as from_entity_key,
        n2.entity_key as to_entity_key,
        type(r) as relationship_type,
        properties(r) as properties,
        toString(r.created_at) as created_at,
        toString(r.updated_at) as updated_at
    `;

    const edgesBetween = await neo4jService.executeQuery<{
      from_entity_key: string;
      to_entity_key: string;
      relationship_type: string;
      properties: Record<string, unknown>;
      created_at?: string;
      updated_at?: string;
    }>(edgesBetweenQuery, { entityKeys: nodeEntityKeys });

    // Remove embedding fields and unwanted properties from edge properties
    const cleanEdgesBetween = edgesBetween.map((edge) => {
      const {
        relation_embedding,
        notes_embedding,
        is_dirty,
        decay_gradient,
        recall_frequency,
        last_recall_interval,
        created_by,
        last_update_source,
        ...cleanProps
      } = edge.properties;
      
      // Remove empty arrays
      const cleaned: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(cleanProps)) {
        if (Array.isArray(value) && value.length === 0) {
          continue; // Skip empty arrays
        }
        cleaned[key] = value;
      }
      
      return { ...edge, properties: cleaned };
    });

    // 2. Get edges between hit nodes and user owner node
    const edgesToUserQuery = `
      MATCH (owner:Person {user_id: $userId, is_owner: true})
      MATCH (n)-[r]-(owner)
      WHERE n.entity_key IN $entityKeys
      RETURN
        n.entity_key as from_entity_key,
        owner.entity_key as to_entity_key,
        type(r) as relationship_type,
        properties(r) as properties,
        toString(r.created_at) as created_at,
        toString(r.updated_at) as updated_at
    `;

    const edgesToUser = await neo4jService.executeQuery<{
      from_entity_key: string;
      to_entity_key: string;
      relationship_type: string;
      properties: Record<string, unknown>;
      created_at?: string;
      updated_at?: string;
    }>(edgesToUserQuery, { userId, entityKeys: nodeEntityKeys });

    // Remove embedding fields and unwanted properties from edge properties
    const cleanEdgesToUser = edgesToUser.map((edge) => {
      const {
        relation_embedding,
        notes_embedding,
        is_dirty,
        decay_gradient,
        recall_frequency,
        last_recall_interval,
        created_by,
        last_update_source,
        ...cleanProps
      } = edge.properties;
      
      // Remove empty arrays
      const cleaned: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(cleanProps)) {
        if (Array.isArray(value) && value.length === 0) {
          continue; // Skip empty arrays
        }
        cleaned[key] = value;
      }
      
      return { ...edge, properties: cleaned };
    });

    // 3. Get neighbor nodes and edges (1-hop away)
    const neighborsQuery = `
      MATCH (n)-[r]-(neighbor)
      WHERE n.entity_key IN $entityKeys
        AND NOT neighbor.entity_key IN $entityKeys
        AND neighbor.user_id = $userId
      WITH neighbor, r, n
      LIMIT 30
      RETURN DISTINCT
        neighbor.entity_key as entity_key,
        labels(neighbor)[0] as node_type,
        neighbor.name as name,
        neighbor.canonical_name as canonical_name,
        neighbor.description as description,
        n.entity_key as connected_to,
        type(r) as relationship_type,
        properties(r) as properties,
        toString(r.created_at) as created_at,
        toString(r.updated_at) as updated_at
    `;

    const neighborResults = await neo4jService.executeQuery<{
      entity_key: string;
      node_type: string;
      name?: string;
      canonical_name?: string;
      description?: string;
      connected_to: string;
      relationship_type: string;
      properties: Record<string, unknown>;
      created_at?: string;
      updated_at?: string;
    }>(neighborsQuery, { userId, entityKeys: nodeEntityKeys });

    // Extract unique neighbor nodes
    const neighborMap = new Map<string, GraphNode>();
    const neighborEdges: GraphEdge[] = [];

    for (const result of neighborResults) {
      // Add neighbor node if not already added (filter unwanted fields)
      if (!neighborMap.has(result.entity_key)) {
        neighborMap.set(result.entity_key, {
          entity_key: result.entity_key,
          node_type: result.node_type as 'Person' | 'Concept' | 'Entity' | 'Source',
          name: result.name,
          canonical_name: result.canonical_name,
          description: result.description,
        });
      }

      // Add edge between neighbor and hit node (exclude embedding fields and unwanted properties)
      const {
        relation_embedding,
        notes_embedding,
        is_dirty,
        decay_gradient,
        recall_frequency,
        last_recall_interval,
        created_by,
        last_update_source,
        ...cleanProps
      } = result.properties;
      
      // Remove empty arrays
      const cleaned: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(cleanProps)) {
        if (Array.isArray(value) && value.length === 0) {
          continue; // Skip empty arrays
        }
        cleaned[key] = value;
      }
      
      neighborEdges.push({
        from_entity_key: result.connected_to,
        to_entity_key: result.entity_key,
        relationship_type: result.relationship_type,
        properties: cleaned,
        created_at: result.created_at,
        updated_at: result.updated_at,
      });
    }

    // Get full properties for hit nodes
    const hitNodesQuery = `
      MATCH (n)
      WHERE n.entity_key IN $entityKeys
      RETURN
        n.entity_key as entity_key,
        labels(n)[0] as node_type,
        properties(n) as properties
    `;

    const hitNodeResults = await neo4jService.executeQuery<{
      entity_key: string;
      node_type: string;
      properties: Record<string, unknown>;
    }>(hitNodesQuery, { entityKeys: nodeEntityKeys });

    const nodes: GraphNode[] = hitNodeResults.map((r) => {
      // Exclude embedding fields and unwanted properties from response
      const {
        embedding,
        is_dirty,
        decay_gradient,
        recall_frequency,
        last_recall_interval,
        created_by,
        last_update_source,
        ...propsWithoutUnwanted
      } = r.properties;
      
      // Remove empty arrays
      const cleaned: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(propsWithoutUnwanted)) {
        if (Array.isArray(value) && value.length === 0) {
          continue; // Skip empty arrays
        }
        cleaned[key] = value;
      }
      
      return {
        entity_key: r.entity_key,
        node_type: r.node_type as 'Person' | 'Concept' | 'Entity' | 'Source',
        ...cleaned,
      };
    });

    // Combine all edges (using cleaned versions without embeddings)
    const allEdges: GraphEdge[] = [
      ...cleanEdgesBetween,
      ...cleanEdgesToUser,
      ...neighborEdges,
    ];

    // Increment access tracking for all returned nodes (batched by type)
    const personKeys: string[] = [];
    const conceptKeys: string[] = [];
    const entityKeys: string[] = [];

    for (const node of nodes) {
      if (node.node_type === 'Person') {
        personKeys.push(node.entity_key);
      } else if (node.node_type === 'Concept') {
        conceptKeys.push(node.entity_key);
      } else if (node.node_type === 'Entity') {
        entityKeys.push(node.entity_key);
      }
    }

    // Batch increment access (await to ensure it completes before closing connection)
    try {
      await Promise.all([
        personKeys.length > 0 ? personRepository.batchIncrementAccess(personKeys) : Promise.resolve(),
        conceptKeys.length > 0 ? conceptRepository.batchIncrementAccess(conceptKeys) : Promise.resolve(),
        entityKeys.length > 0 ? entityRepository.batchIncrementAccess(entityKeys) : Promise.resolve(),
      ]);
    } catch (err) {
      console.error('Failed to increment access tracking:', err);
      // Don't throw - retrieval should succeed even if tracking fails
    }

    return {
      nodes,
      edges: allEdges,
      neighbors: Array.from(neighborMap.values()),
    };
  }

  /**
   * Format explore results to markdown
   */
  formatExploreToMarkdown(
    nodes: GraphNode[],
    edges: GraphEdge[],
    neighbors: GraphNode[],
    explanations?: {
      vector_search_hits: number;
      text_match_hits: number;
      total_unique_hits: number;
      top_concepts: number;
      top_entities: number;
      top_persons: number;
      top_sources: number;
    }
  ): string {
    const parts: string[] = [];

    if (nodes.length > 0) {
      parts.push('# Nodes\n');
      parts.push(nodes.map((node) => formatNodeToMarkdown(node)).join('\n\n'));
      parts.push('');
    }

    if (edges.length > 0) {
      parts.push('# Edges\n');
      parts.push(formatEdgesToMarkdown(edges));
      parts.push('');
    }

    if (neighbors.length > 0) {
      parts.push('# Neighbors\n');
      parts.push(formatNeighborsToMarkdown(neighbors));
      parts.push('');
    }

    if (explanations) {
      parts.push('# Explanations\n');
      parts.push(`- Vector search hits: ${explanations.vector_search_hits}`);
      parts.push(`- Text match hits: ${explanations.text_match_hits}`);
      parts.push(`- Total unique hits: ${explanations.total_unique_hits}`);
      parts.push(`- Top concepts: ${explanations.top_concepts}`);
      parts.push(`- Top entities: ${explanations.top_entities}`);
      parts.push(`- Top persons: ${explanations.top_persons}`);
      parts.push(`- Top sources: ${explanations.top_sources}`);
    }

    return parts.join('\n');
  }
}

export const retrievalService = new RetrievalService();
