import { Router } from 'express';
import { searchController } from '../controllers/searchController.js';

const router: Router = Router();

/**
 * Phase 1: Vector Search
 * POST /api/search/vector
 * Body: { user_id: string, query: string, limit?: number }
 */
router.post('/vector', (req, res) => searchController.vectorSearch(req, res));

/**
 * Phase 2: RAG Filtering
 * POST /api/search/filter
 * Body: { query: string, vector_results: VectorSearchResult[], top_k?: number }
 */
router.post('/filter', (req, res) => searchController.ragFilter(req, res));

/**
 * Phase 3: Graph Retrieval
 * POST /api/search/expand
 * Body: { user_id: string, entities: RAGFilteredEntity[], expansion_depth?: number }
 */
router.post('/expand', (req, res) => searchController.graphRetrieval(req, res));

/**
 * Full Search Pipeline
 * POST /api/search/pipeline
 * Body: { user_id: string, query: string }
 */
router.post('/pipeline', (req, res) => searchController.executePipeline(req, res));

export default router;
