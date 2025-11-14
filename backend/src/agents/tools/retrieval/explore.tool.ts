/**
 * Explore Tool - Semantic search and graph exploration
 *
 * Two-phase retrieval process:
 * 1. Gather Phase: Semantic search + fuzzy text matching
 * 2. Rerank & Expand Phase: Order by salience, take top N, expand graph
 *
 * Reference: tech.md lines 167-213 (Explore tool specification)
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { ExploreInputSchema } from '../../schemas/ingestion.js';
import { retrievalService } from '../../../services/retrievalService.js';
import { NoteObject } from '../../../types/graph.js';

interface ScoredNode {
  entity_key: string;
  node_type: 'Person' | 'Concept' | 'Entity' | 'Source';
  score: number;
  salience: number;
  combined_score: number;
  name?: string;
  canonical_name?: string;
  description?: string;
  notes?: NoteObject[];
  type?: string;
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
  return new DynamicStructuredTool({
    name: 'explore',
    description:
      'Explore the knowledge graph using semantic search and text matching. ' +
      'Finds relevant entities (People, Concepts, Entities, Sources) and expands ' +
      'the graph to show relationships. Use for broad investigation when you need ' +
      'to discover what the user knows about a topic or person.',
    schema: ExploreInputSchema,
    func: async ({ queries, text_matches, return_explanations }): Promise<string> => {
      if ((!queries || queries.length === 0) && (!text_matches || text_matches.length === 0)) {
        throw new Error('At least one search method required (queries or text_matches)');
      }

      const allHits = new Map<string, ScoredNode>();

      if (queries && queries.length > 0) {
        for (const { query, threshold } of queries) {
          const vectorResults = await retrievalService.vectorSearch(query, threshold, userId);
          for (const result of vectorResults) {
            if (!allHits.has(result.entity_key)) {
              allHits.set(result.entity_key, {
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
              const existing = allHits.get(result.entity_key)!;
              existing.score = Math.max(existing.score, result.similarity);
            }
          }
        }
      }

      if (text_matches && text_matches.length > 0) {
        for (const text of text_matches) {
          const textResults = await retrievalService.fuzzyTextMatch(text, userId);
          for (const result of textResults) {
            if (!allHits.has(result.entity_key)) {
              allHits.set(result.entity_key, {
                entity_key: result.entity_key,
                node_type: result.node_type,
                score: result.score,
                salience: 0,
                combined_score: 0,
                name: result.name,
                canonical_name: result.canonical_name,
              });
            } else {
              const existing = allHits.get(result.entity_key)!;
              existing.score = Math.max(existing.score, result.score);
            }
          }
        }
      }

      const hitsWithSalience: ScoredNode[] = [];
      for (const hit of allHits.values()) {
        const salienceData = await retrievalService.calculateSalience(hit.entity_key);
        hit.salience = salienceData.salience;
        hit.combined_score = hit.score + hit.salience;
        hitsWithSalience.push(hit);
      }

      hitsWithSalience.sort((a, b) => b.combined_score - a.combined_score);

      const topConcepts = hitsWithSalience.filter((h) => h.node_type === 'Concept').slice(0, 5);
      const topEntities = hitsWithSalience.filter((h) => h.node_type === 'Entity').slice(0, 3);
      const topPersons = hitsWithSalience.filter((h) => h.node_type === 'Person').slice(0, 3);
      const topSources = hitsWithSalience.filter((h) => h.node_type === 'Source').slice(0, 5);

      const topHits = [...topConcepts, ...topEntities, ...topPersons, ...topSources];
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
            total_unique_hits: allHits.size,
            top_concepts: topConcepts.length,
            top_entities: topEntities.length,
            top_persons: topPersons.length,
            top_sources: topSources.length,
          }
        : undefined;

      return retrievalService.formatExploreToMarkdown(nodes, topEdges, neighbors, explanations);
    },
  });
}
