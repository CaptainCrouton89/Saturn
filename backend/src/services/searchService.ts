/**
 * Search Service
 *
 * Implements three-phase search pipeline:
 * 1. Vector Search: Semantic similarity search across entity embeddings
 * 2. RAG Filtering: LLM-powered relevance filtering and ranking
 * 3. Graph Retrieval: Expand filtered entities with their relationships
 */

import { ChatOpenAI } from '@langchain/openai';
import { OpenAIEmbeddings } from '@langchain/openai';
import neo4j from 'neo4j-driver';
import { neo4jService } from '../db/neo4j.js';

export interface VectorSearchResult {
  entity_id: string;
  entity_type: 'Project' | 'Topic' | 'Idea' | 'Note' | 'Person';
  entity_name: string;
  similarity_score: number;
  excerpt?: string;
}

export interface RAGFilteredEntity {
  entity_id: string;
  entity_type: string;
  entity_name: string;
  relevance_score: number;
  reasoning: string;
}

export interface GraphRetrievalResult {
  nodes: GraphNode[];
  links: GraphLink[];
  central_node_ids: string[];
}

interface GraphNode {
  id: string;
  type: string;
  name: string;
  details?: Record<string, unknown>;
}

interface GraphLink {
  source: string;
  target: string;
  label?: string;
  properties?: Record<string, unknown>;
}

class SearchService {
  private embeddings: OpenAIEmbeddings;
  private llm: ChatOpenAI;

  constructor() {
    this.embeddings = new OpenAIEmbeddings({
      modelName: 'text-embedding-3-small',
    });

    this.llm = new ChatOpenAI({
      modelName: 'gpt-4.1-mini',
    });
  }

  /**
   * Phase 1: Vector Search
   * Perform semantic similarity search across entity embeddings
   *
   * @param userId - User ID to search within
   * @param query - Natural language search query
   * @param limit - Maximum number of results (default: 12)
   * @returns Array of entities with similarity scores
   */
  async vectorSearch(
    userId: string,
    query: string,
    limit: number = 12
  ): Promise<VectorSearchResult[]> {
    console.log(`[Vector Search] Query: "${query}" for user ${userId}`);

    // Generate embedding for the query
    const queryEmbedding = await this.embeddings.embedQuery(query);

    // Search across Project, Topic, Idea, Note, and Person entities
    const searchQuery = `
      MATCH (u:User {id: $userId})

      CALL {
        WITH u
        // Search Projects
        MATCH (u)-[r:WORKING_ON]->(p:Project)
        WHERE p.embedding IS NOT NULL
        WITH p, r, vector.similarity.cosine(p.embedding, $queryEmbedding) AS score
        WHERE score > 0.7
        RETURN p.id AS entity_id,
               'Project' AS entity_type,
               p.name AS entity_name,
               score,
               p.vision AS excerpt
        ORDER BY score DESC
        LIMIT $limit

        UNION

        WITH u
        // Search Topics
        MATCH (u)-[r:INTERESTED_IN]->(t:Topic)
        WHERE t.embedding IS NOT NULL
        WITH t, r, vector.similarity.cosine(t.embedding, $queryEmbedding) AS score
        WHERE score > 0.7
        RETURN t.id AS entity_id,
               'Topic' AS entity_type,
               t.name AS entity_name,
               score,
               t.description AS excerpt
        ORDER BY score DESC
        LIMIT $limit

        UNION

        WITH u
        // Search Ideas
        MATCH (u)-[:HAS_IDEA]->(i:Idea)
        WHERE i.embedding IS NOT NULL
        WITH i, vector.similarity.cosine(i.embedding, $queryEmbedding) AS score
        WHERE score > 0.7
        RETURN i.id AS entity_id,
               'Idea' AS entity_type,
               i.summary AS entity_name,
               score,
               i.context_notes AS excerpt
        ORDER BY score DESC
        LIMIT $limit

        UNION

        WITH u
        // Search People (name-based matching, no embedding)
        MATCH (u)-[r:KNOWS]->(person:Person)
        WHERE toLower(person.name) CONTAINS toLower($queryText)
           OR person.canonical_name CONTAINS toLower($queryText)
        RETURN person.id AS entity_id,
               'Person' AS entity_type,
               person.name AS entity_name,
               0.85 AS score,
               person.current_life_situation AS excerpt
        ORDER BY r.last_mentioned_at DESC
        LIMIT $limit
      }

      RETURN entity_id, entity_type, entity_name, score AS similarity_score, excerpt
      ORDER BY similarity_score DESC
      LIMIT $limit
    `;

    try {
      const results = await neo4jService.executeQuery<{
        entity_id: string;
        entity_type: string;
        entity_name: string;
        similarity_score: number;
        excerpt?: string;
      }>(searchQuery, {
        userId,
        queryEmbedding,
        queryText: query,
        limit: neo4j.int(limit),
      });

      const vectorResults: VectorSearchResult[] = results.map((record) => ({
        entity_id: record.entity_id,
        entity_type: record.entity_type as 'Project' | 'Topic' | 'Idea' | 'Note' | 'Person',
        entity_name: record.entity_name,
        similarity_score: record.similarity_score,
        excerpt: record.excerpt,
      }));

      console.log(`[Vector Search] Found ${vectorResults.length} results`);
      return vectorResults;
    } catch (error) {
      console.error('[Vector Search] Error:', error);
      throw new Error('Vector search failed');
    }
  }

  /**
   * Phase 2: RAG Filtering
   * Use LLM to filter and rank vector search results based on relevance
   *
   * @param query - Original user query
   * @param vectorResults - Results from vector search
   * @param topK - Number of top entities to return (default: 6)
   * @returns Filtered and ranked entities with reasoning
   */
  async ragFilter(
    query: string,
    vectorResults: VectorSearchResult[],
    topK: number = 6
  ): Promise<RAGFilteredEntity[]> {
    console.log(`[RAG Filter] Filtering ${vectorResults.length} results to top ${topK}`);

    if (vectorResults.length === 0) {
      return [];
    }

    // If we have fewer results than topK, return all
    if (vectorResults.length <= topK) {
      return vectorResults.map((result) => ({
        entity_id: result.entity_id,
        entity_type: result.entity_type,
        entity_name: result.entity_name,
        relevance_score: result.similarity_score,
        reasoning: 'High semantic similarity to query',
      }));
    }

    // Prepare context for LLM
    const entitiesContext = vectorResults
      .map(
        (result, idx) =>
          `${idx + 1}. [${result.entity_type}] ${result.entity_name}
   Similarity: ${(result.similarity_score * 100).toFixed(1)}%
   Context: ${result.excerpt || 'N/A'}`
      )
      .join('\n\n');

    const prompt = `You are helping filter search results from a knowledge graph.

User Query: "${query}"

Candidate Entities (from vector search):
${entitiesContext}

Task: Select the top ${topK} most relevant entities for this query. Consider:
1. Direct relevance to the query intent
2. Importance and centrality in the user's knowledge graph
3. Recency and current activity level
4. Semantic similarity score

For each selected entity, provide:
- entity_id (exactly as given above)
- relevance_score (0-1, your assessment of relevance)
- reasoning (brief explanation of why this entity is relevant)

Respond with ONLY a JSON array in this exact format:
[
  {
    "entity_id": "...",
    "relevance_score": 0.95,
    "reasoning": "Direct match to query topic with high activity"
  }
]`;

    try {
      const response = await this.llm.invoke(prompt);
      const content = response.content as string;

      // Extract JSON from response (handle code blocks)
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('[RAG Filter] No JSON array found in LLM response');
        throw new Error('Failed to parse LLM response');
      }

      const filtered: Array<{
        entity_id: string;
        relevance_score: number;
        reasoning: string;
      }> = JSON.parse(jsonMatch[0]);

      // Map back to full entity data
      const results: RAGFilteredEntity[] = filtered.map((item) => {
        const original = vectorResults.find((v) => v.entity_id === item.entity_id);
        if (!original) {
          throw new Error(`Entity ${item.entity_id} not found in vector results`);
        }

        return {
          entity_id: item.entity_id,
          entity_type: original.entity_type,
          entity_name: original.entity_name,
          relevance_score: item.relevance_score,
          reasoning: item.reasoning,
        };
      });

      console.log(`[RAG Filter] Filtered to ${results.length} entities`);
      return results;
    } catch (error) {
      console.error('[RAG Filter] Error:', error);
      // Fallback: return top K by similarity score
      console.log('[RAG Filter] Falling back to top K by similarity');
      return vectorResults.slice(0, topK).map((result) => ({
        entity_id: result.entity_id,
        entity_type: result.entity_type,
        entity_name: result.entity_name,
        relevance_score: result.similarity_score,
        reasoning: 'High semantic similarity (fallback ranking)',
      }));
    }
  }

  /**
   * Phase 3: Graph Retrieval
   * Expand filtered entities with their connected nodes and relationships
   *
   * @param userId - User ID
   * @param entities - Filtered entities from RAG
   * @param expansionDepth - How many levels to expand (default: 1)
   * @returns Graph data with nodes and links
   */
  async graphRetrieval(
    userId: string,
    entities: RAGFilteredEntity[],
    _expansionDepth: number = 1
  ): Promise<GraphRetrievalResult> {
    console.log(
      `[Graph Retrieval] Expanding ${entities.length} entities for user ${userId}`
    );

    if (entities.length === 0) {
      return { nodes: [], links: [], central_node_ids: [] };
    }

    const centralNodeIds = entities.map((e) => e.entity_id);

    // Retrieve central nodes + their immediate connections
    const retrievalQuery = `
      MATCH (u:User {id: $userId})
      WITH u

      // Get central nodes (the filtered entities)
      MATCH (central)
      WHERE central.id IN $centralIds

      // Collect central nodes
      WITH u, collect(DISTINCT central) AS centralNodes

      // Expand to connected nodes (1 hop)
      UNWIND centralNodes AS central
      OPTIONAL MATCH (central)-[r]-(connected)
      WHERE connected.id IS NOT NULL

      // Collect all nodes and relationships
      WITH u, centralNodes,
           collect(DISTINCT {
             node: connected,
             rel: r,
             source: startNode(r),
             target: endNode(r)
           }) AS connections

      // Return nodes
      UNWIND centralNodes AS cn
      WITH u, cn, connections, labels(cn) AS cnLabels
      WITH u, connections,
           collect(DISTINCT {
             id: cn.id,
             type: cnLabels[0],
             name: COALESCE(cn.name, cn.summary, cn.content),
             details: properties(cn)
           }) AS centralNodeData

      // Store connections before processing
      WITH u, centralNodeData, connections

      // Return connected nodes
      UNWIND connections AS conn
      WITH u, centralNodeData, connections, conn, labels(conn.node) AS connLabels
      WITH u, centralNodeData, connections,
           collect(DISTINCT {
             id: conn.node.id,
             type: connLabels[0],
             name: COALESCE(conn.node.name, conn.node.summary, conn.node.content),
             details: properties(conn.node)
           }) AS connectedNodeData

      // Combine all nodes
      WITH u, centralNodeData + connectedNodeData AS allNodes, connections

      // Return relationships
      UNWIND connections AS conn
      WITH allNodes,
           collect(DISTINCT {
             source: startNode(conn.rel).id,
             target: endNode(conn.rel).id,
             label: type(conn.rel),
             properties: properties(conn.rel)
           }) AS allLinks

      RETURN allNodes, allLinks
    `;

    try {
      const results = await neo4jService.executeQuery<{allNodes: GraphNode[]; allLinks: GraphLink[]}>(retrievalQuery, {
        userId,
        centralIds: centralNodeIds,
      });

      if (results.length === 0) {
        console.log('[Graph Retrieval] No data found');
        return { nodes: [], links: [], central_node_ids: centralNodeIds };
      }

      const record = results[0];
      const nodes = record.allNodes || [];
      const links = record.allLinks || [];

      // Filter out any null nodes/links
      const validNodes = nodes.filter((n) => n && n.id);
      const validLinks = links.filter(
        (l) => l && l.source && l.target && validNodes.some((n) => n.id === l.source) && validNodes.some((n) => n.id === l.target)
      );

      console.log(
        `[Graph Retrieval] Retrieved ${validNodes.length} nodes and ${validLinks.length} links`
      );

      return {
        nodes: validNodes,
        links: validLinks,
        central_node_ids: centralNodeIds,
      };
    } catch (error) {
      console.error('[Graph Retrieval] Error:', error);
      throw new Error('Graph retrieval failed');
    }
  }

  /**
   * Execute full search pipeline
   * Combines all three phases: vector search → RAG filtering → graph retrieval
   *
   * @param userId - User ID
   * @param query - Natural language search query
   * @returns Complete search results with pipeline stages
   */
  async executeSearchPipeline(userId: string, query: string) {
    const startTime = Date.now();

    // Phase 1: Vector Search
    const vectorResults = await this.vectorSearch(userId, query);

    // Phase 2: RAG Filtering
    const ragFiltered = await this.ragFilter(query, vectorResults);

    // Phase 3: Graph Retrieval
    const graphData = await this.graphRetrieval(userId, ragFiltered);

    const totalTime = Date.now() - startTime;

    return {
      query,
      pipeline_stages: {
        vector_search: vectorResults,
        rag_filtering: ragFiltered,
        graph_retrieval: graphData,
      },
      total_execution_time_ms: totalTime,
    };
  }
}

export const searchService = new SearchService();
