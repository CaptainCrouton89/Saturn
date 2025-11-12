import { Router } from 'express';
import { graphController } from '../controllers/graphController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';

const router: Router = Router();

/**
 * PUBLIC ENDPOINTS - No auth required for visualization
 */

/**
 * List all users (for neo4j-viewer dropdown)
 * GET /api/graph/users
 */
router.get('/users', (req, res) => graphController.getAllUsers(req, res));

/**
 * Get user by ID
 * GET /api/graph/users/:id
 */
router.get('/users/:id', (req, res) => graphController.getUser(req, res));

/**
 * Get full graph data for a user (for neo4j-viewer)
 * GET /api/graph/users/:userId/full-graph
 */
router.get('/users/:userId/full-graph', (req, res) => graphController.getFullGraph(req, res));

/**
 * PROTECTED ENDPOINTS - Require authentication
 */

/**
 * Create or update a user
 * POST /api/graph/users
 */
router.post('/users', authenticateToken, (req, res) => graphController.createUser(req, res));

/**
 * Create or update a person
 * POST /api/graph/people
 */
router.post('/people', authenticateToken, (req, res) => graphController.createPerson(req, res));

/**
 * Search people by name
 * GET /api/graph/people/search?q=name
 */
router.get('/people/search', authenticateToken, (req, res) => graphController.searchPeople(req, res));

/**
 * Get recently mentioned people for a user
 * GET /api/graph/users/:userId/people/recent
 */
router.get('/users/:userId/people/recent', authenticateToken, (req, res) => graphController.getRecentPeople(req, res));

/**
 * Create a conversation
 * POST /api/graph/conversations
 */
router.post('/conversations', authenticateToken, (req, res) => graphController.createConversation(req, res));

/**
 * Get conversation context for a user
 * GET /api/graph/users/:userId/context
 */
router.get('/users/:userId/context', authenticateToken, (req, res) => graphController.getContext(req, res));

/**
 * Execute manual Cypher query against user's knowledge graph
 * POST /api/graph/query
 */
router.post('/query', authenticateToken, (req, res) => graphController.executeQuery(req, res));

/**
 * Execute explore tool (semantic search + graph expansion)
 * POST /api/graph/explore
 */
router.post('/explore', authenticateToken, (req, res) => graphController.executeExplore(req, res));

/**
 * Generate query from natural language description
 * POST /api/graph/generate-query
 */
router.post('/generate-query', authenticateToken, (req, res) => graphController.generateQuery(req, res));

export default router;
