/**
 * Explore Tool - Semantic search and graph exploration
 *
 * Two-phase retrieval process:
 * 1. Gather Phase: Semantic search + fuzzy text matching
 * 2. Rerank & Expand Phase: Order by salience, take top N, expand graph
 *
 * Reference: tech.md lines 167-213 (Explore tool specification)
 *
 * Tracing: Wrapped with withSpan to track search operations, query types,
 * and result counts.
 */

import { tool } from 'ai';
import { trace } from '@opentelemetry/api';
import { conceptRepository } from '../../../repositories/ConceptRepository.js';
import { entityRepository } from '../../../repositories/EntityRepository.js';
import { personRepository } from '../../../repositories/PersonRepository.js';
import { retrievalService } from '../../../services/retrievalService.js';
import type { EntityType, NoteObject } from '../../../types/graph.js';
import { parseNotes } from '../../../utils/notes.js';
import { ExploreInputSchema } from '../../schemas/ingestion.js';
import { withSpan, TraceAttributes } from '../../../utils/tracing.js';
import { combineRankings, type RankingSignal } from '../../../utils/rrfScoring.js';

interface ScoredNode {
  entity_key: string;
  node_type: EntityType | 'source' | 'artifact'; // Lowercase EntityType or 'source' or 'artifact'
  score: number;
  salience: number;
  combined_score: number;
  name?: string;
  description?: string;
  notes?: NoteObject[];
  type?: string;
}

/**
 * Core explore logic - can be called directly or wrapped in a tool
 */
export async function executeExplore(
  userId: string,
  { queries, text_matches, search_relationships = true, return_explanations, format = 'markdown', node_types, max_results_per_type = 10 }: {
    queries?: Array<{ query: string; threshold: number }>;
    text_matches?: string[];
    search_relationships?: boolean;
    return_explanations?: boolean;
    format?: 'markdown' | 'json';
    node_types?: Array<'concept' | 'entity' | 'person' | 'event' | 'source' | 'artifact'>;
    max_results_per_type?: number;
  }
): Promise<string> {
      console.log('[executeExplore] START - userId:', userId);
      console.log('[executeExplore] queries:', queries);
      console.log('[executeExplore] text_matches:', text_matches);

      if ((!queries || queries.length === 0) && (!text_matches || text_matches.length === 0)) {
        console.log('[executeExplore] ERROR: No search methods provided');
        throw new Error('At least one search method required (queries or text_matches)');
      }

      // Collect results from each search signal
      const signals: RankingSignal<ScoredNode>[] = [];
      let relationshipSearchHits = 0;

      // 1. Node vector search
      if (queries && queries.length > 0) {
        const vectorResults: ScoredNode[] = [];
        for (const { query, threshold } of queries) {
          const results = await retrievalService.vectorSearch(query, threshold, userId);
          for (const result of results) {
            // Deduplicate within this signal using a map
            const existing = vectorResults.find((v) => v.entity_key === result.entity_key);
            if (!existing) {
              vectorResults.push({
                entity_key: result.entity_key,
                node_type: result.node_type,
                score: result.similarity,
                salience: 0,
                combined_score: 0,
                name: result.name,
                description: result.description,
                notes: result.notes,
              });
            } else {
              // Within a signal, take max score (multiple queries might hit same entity)
              existing.score = Math.max(existing.score, result.similarity);
            }
          }
        }

        if (vectorResults.length > 0) {
          // Sort by score DESC to create ranking
          vectorResults.sort((a, b) => b.score - a.score);
          signals.push({
            name: 'vector_search',
            results: vectorResults.map((r) => ({
              id: r.entity_key,
              data: r,
              score: r.score,
            })),
          });
        }
      }

      // 2. Text matching
      if (text_matches && text_matches.length > 0) {
        const textResults: ScoredNode[] = [];
        for (const text of text_matches) {
          const results = await retrievalService.fuzzyTextMatch(text, userId);
          for (const result of results) {
            const existing = textResults.find((t) => t.entity_key === result.entity_key);
            if (!existing) {
              textResults.push({
                entity_key: result.entity_key,
                node_type: result.node_type,
                score: result.score,
                salience: 0,
                combined_score: 0,
                name: result.name,
              });
            } else {
              existing.score = Math.max(existing.score, result.score);
            }
          }
        }

        if (textResults.length > 0) {
          textResults.sort((a, b) => b.score - a.score);
          signals.push({
            name: 'text_match',
            results: textResults.map((r) => ({
              id: r.entity_key,
              data: r,
              score: r.score,
            })),
          });
        }
      }

      // 3. Relationship search
      if (search_relationships && queries && queries.length > 0) {
        const relResults: ScoredNode[] = [];
        for (const { query, threshold } of queries) {
          const { nodes: relNodes } = await retrievalService.findNodesViaRelationshipSearch(
            query,
            threshold,
            userId
          );

          relationshipSearchHits += relNodes.length;

          for (const node of relNodes) {
            const existing = relResults.find((r) => r.entity_key === node.entity_key);
            if (!existing) {
              relResults.push({
                entity_key: node.entity_key,
                node_type: node.node_type,
                score: 0.7, // Give relationship-discovered nodes a decent score
                salience: 0,
                combined_score: 0,
                name: node.name as string | undefined,
                description: node.description as string | undefined,
                notes: node.notes as NoteObject[] | undefined,
              });
            }
          }
        }

        if (relResults.length > 0) {
          relResults.sort((a, b) => b.score - a.score);
          signals.push({
            name: 'relationship_search',
            results: relResults.map((r) => ({
              id: r.entity_key,
              data: r,
              score: r.score,
            })),
          });
        }
      }

      // Combine signals using RRF
      const rrfResults = combineRankings(signals, {
        k: 60,
        topK: 50, // Take top 50 for salience calculation (higher than entity resolution)
        boosts: [], // No signal-specific boosts for explore (all signals equally valid)
      });

      // Add salience scoring
      const hitsWithSalience: ScoredNode[] = [];
      for (const rrfResult of rrfResults) {
        const hit = rrfResult.data;
        const salienceData = await retrievalService.calculateSalience(hit.entity_key);
        hit.salience = salienceData.salience;
        hit.score = rrfResult.similarity; // Use RRF-based similarity
        hit.combined_score = hit.score + hit.salience;
        hitsWithSalience.push(hit);
      }

      // Sort by similarity score (not combined_score) to ensure consistent results across thresholds
      // This prevents high-scoring results from disappearing when threshold is lowered
      hitsWithSalience.sort((a, b) => b.score - a.score);

      // Filter by requested node types (or all types if not specified)
      const allowedTypes = node_types && node_types.length > 0
        ? new Set(node_types)
        : new Set(['concept', 'entity', 'person', 'event', 'source', 'artifact']);

      // Get top N results per type using configurable max_results_per_type
      const topByType: ScoredNode[] = [];

      if (allowedTypes.has('concept')) {
        topByType.push(...hitsWithSalience.filter((h) => h.node_type === 'concept').slice(0, max_results_per_type));
      }
      if (allowedTypes.has('entity')) {
        topByType.push(...hitsWithSalience.filter((h) => h.node_type === 'entity').slice(0, max_results_per_type));
      }
      if (allowedTypes.has('person')) {
        topByType.push(...hitsWithSalience.filter((h) => h.node_type === 'person').slice(0, max_results_per_type));
      }
      if (allowedTypes.has('event')) {
        topByType.push(...hitsWithSalience.filter((h) => h.node_type === 'event').slice(0, max_results_per_type));
      }
      if (allowedTypes.has('source')) {
        topByType.push(...hitsWithSalience.filter((h) => h.node_type === 'source').slice(0, max_results_per_type));
      }
      if (allowedTypes.has('artifact')) {
        topByType.push(...hitsWithSalience.filter((h) => h.node_type === 'artifact').slice(0, max_results_per_type));
      }

      const topHits = topByType;
      const topHitEntityKeys = topHits.map((h) => h.entity_key);

      const { nodes, edges, neighbors } = await retrievalService.expandGraph(topHitEntityKeys, userId);

      const sortedEdges = edges.sort((a, b) => {
        const aRelevance = a.properties.relevance as number | undefined;
        const bRelevance = b.properties.relevance as number | undefined;

        if (aRelevance !== undefined && bRelevance !== undefined) {
          return bRelevance - aRelevance;
        }

        if (aRelevance !== undefined) return -1;
        if (bRelevance !== undefined) return 1;

        const aDate = a.updated_at ?? a.created_at;
        const bDate = b.updated_at ?? b.created_at;

        if (aDate && bDate) {
          return bDate.localeCompare(aDate);
        }

        if (aDate) return -1;
        if (bDate) return 1;

        return 0;
      });

      const topEdges = sortedEdges.slice(0, 10);

      const explanations = return_explanations
        ? {
            vector_search_hits: queries ? queries.length : 0,
            text_match_hits: text_matches ? text_matches.length : 0,
            relationship_search_hits: relationshipSearchHits,
            total_unique_hits: rrfResults.length,
            top_concepts: topHits.filter(h => h.node_type === 'concept').length,
            top_entities: topHits.filter(h => h.node_type === 'entity').length,
            top_persons: topHits.filter(h => h.node_type === 'person').length,
            top_sources: topHits.filter(h => h.node_type === 'source').length,
          }
        : undefined;

      // Return JSON format for API endpoints, markdown for LLM tools
      if (format === 'json') {
        return JSON.stringify({
          nodes: nodes.map(node => ({
            entity_key: node.entity_key,
            node_type: node.node_type,
            name: node.name,
            description: node.description,
            notes: node.notes,
          })),
          edges: topEdges,
          neighbors,
          explanations
        });
      }

      return retrievalService.formatExploreToMarkdown(nodes, topEdges, neighbors, explanations);
}

/**
 * Wrapped execute function with tracing
 */
async function executeExploreWithTracing(userId: string, params: Parameters<typeof executeExplore>[1]): Promise<string> {
  if (!userId) {
    throw new Error('userId is required for explore tool');
  }

  // Determine query type and count
  const queryCount = params.queries ? params.queries.length : 0;
  const textMatchCount = params.text_matches ? params.text_matches.length : 0;
  const hasRelationshipSearch = params.search_relationships ?? true;

  return withSpan('tool.explore', {
    [TraceAttributes.OPERATION_NAME]: 'tool.explore',
    'toolName': 'explore',
    [TraceAttributes.USER_ID]: userId,
    'queryType': 'semantic_search',
    'queryCount': queryCount,
    'textMatchCount': textMatchCount,
    'relationshipSearch': hasRelationshipSearch,
    'inputSize': JSON.stringify(params).length,
  }, async () => {
    try {
      const result = await executeExplore(userId, params);

      // Track search results metadata
      const span = trace.getActiveSpan();
      if (span) {
        span.setAttributes({
          'outputSize': result.length,
          'resultType': 'markdown',
          'hasExplanations': params.return_explanations ? true : false,
        });
      }

      return result;
    } catch (error) {
      const span = trace.getActiveSpan();
      if (span) {
        span.addEvent('explore_error', {
          'errorMessage': error instanceof Error ? error.message : 'Unknown error',
        });
      }
      throw error;
    }
  });
}

/**
 * Create explore tool for semantic search and graph exploration
 *
 * Factory function that binds userId to the tool instance.
 *
 * @param userId - User ID to filter results
 * @returns Configured explore tool
 */
export function createExploreTool(userId: string) {
  return tool({
    description:
      'Explore the knowledge graph using semantic search, text matching, and relationship search. ' +
      'Finds relevant entities (People, Concepts, Entities, Sources) and relationships. ' +
      'Expands the graph to show connections. Use for broad investigation when you need ' +
      'to discover what the user knows about a topic, person, or relationship.',
    inputSchema: ExploreInputSchema,
    execute: async (params) => {
      console.log('[Explore Tool] Called with params:', JSON.stringify(params, null, 2));
      console.log('[Explore Tool] User ID:', userId);
      const result = await executeExploreWithTracing(userId, params);
      console.log('[Explore Tool] Result length:', result?.length ?? 0);
      console.log('[Explore Tool] Result preview:', result?.substring(0, 300));
      return result;
    },
  });
}

/**
 * Find top-K nearest neighbors by embedding similarity
 *
 * Used by entity resolution service to discover similar nodes for new entity creation.
 *
 * @param userId - User ID to filter results
 * @param entityType - Type of entities to search (lowercase EntityType)
 * @param embedding - Embedding vector to compare against
 * @param k - Number of top neighbors to return (default: 5)
 * @param similarityThreshold - Minimum cosine similarity score (default: 0.6)
 * @returns Array of neighbor matches with entity details and similarity scores
 */
export async function findTopKNeighbors(
  userId: string,
  entityType: EntityType,
  embedding: number[],
  k: number = 5,
  similarityThreshold: number = 0.6
): Promise<
  Array<{
    entity_key: string;
    name: string;
    description?: string;
    notes: string[];
    similarity_score: number;
  }>
> {
  // Use appropriate repository for embedding similarity search
  const repo = entityType === 'person'
    ? personRepository
    : entityType === 'concept'
      ? conceptRepository
      : entityRepository;

  const results = await repo.findByEmbeddingSimilarity(
    userId,
    embedding,
    entityType,
    similarityThreshold,
    k
  );

  // Transform to expected format
  return results.map((result: typeof results[number]) => {
    const name = result.name ?? null;
    if (!name || typeof name !== 'string') {
      throw new Error(`Node ${result.entity_key} has no name`);
    }

      return {
        entity_key: result.entity_key,
        name,
        description: result.description,
        notes: parseNotes(result.notes).map((note) => note.content),
        similarity_score: result.similarity_score ?? 0,
      };
  });
}
