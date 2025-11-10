import { Request, Response } from 'express';
import { searchService, VectorSearchResult, RAGFilteredEntity } from '../services/searchService.js';

export class SearchController {
  /**
   * Phase 1: Vector Search
   * POST /api/search/vector
   * Body: { user_id: string, query: string, limit?: number }
   */
  async vectorSearch(req: Request, res: Response): Promise<void> {
    try {
      const { user_id, query, limit } = req.body;

      if (!user_id || !query) {
        res.status(400).json({ error: 'Missing required fields: user_id, query' });
        return;
      }

      const results = await searchService.vectorSearch(user_id, query, limit);
      res.json({
        stage: 'vector_search',
        results,
        count: results.length,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[SearchController] Vector search error:', errorMessage);
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Phase 2: RAG Filtering
   * POST /api/search/filter
   * Body: { query: string, vector_results: VectorSearchResult[], top_k?: number }
   */
  async ragFilter(req: Request, res: Response): Promise<void> {
    try {
      const { query, vector_results, top_k } = req.body;

      if (!query || !vector_results || !Array.isArray(vector_results)) {
        res.status(400).json({ error: 'Missing required fields: query, vector_results (array)' });
        return;
      }

      const results = await searchService.ragFilter(query, vector_results, top_k);
      res.json({
        stage: 'rag_filtering',
        results,
        count: results.length,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[SearchController] RAG filter error:', errorMessage);
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Phase 3: Graph Retrieval
   * POST /api/search/expand
   * Body: { user_id: string, entities: RAGFilteredEntity[], expansion_depth?: number }
   */
  async graphRetrieval(req: Request, res: Response): Promise<void> {
    try {
      const { user_id, entities, expansion_depth } = req.body;

      if (!user_id || !entities || !Array.isArray(entities)) {
        res.status(400).json({ error: 'Missing required fields: user_id, entities (array)' });
        return;
      }

      const results = await searchService.graphRetrieval(user_id, entities, expansion_depth);
      res.json({
        stage: 'graph_retrieval',
        results,
        node_count: results.nodes.length,
        link_count: results.links.length,
        central_node_count: results.central_node_ids.length,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[SearchController] Graph retrieval error:', errorMessage);
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Full Search Pipeline
   * POST /api/search/pipeline
   * Body: { user_id: string, query: string }
   */
  async executePipeline(req: Request, res: Response): Promise<void> {
    try {
      const { user_id, query } = req.body;

      if (!user_id || !query) {
        res.status(400).json({ error: 'Missing required fields: user_id, query' });
        return;
      }

      const results = await searchService.executeSearchPipeline(user_id, query);
      res.json(results);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[SearchController] Pipeline execution error:', errorMessage);
      res.status(500).json({ error: errorMessage });
    }
  }
}

export const searchController = new SearchController();
