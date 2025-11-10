import { Router } from 'express';
import { graphController } from '../controllers/graphController.js';

const router = Router();

/**
 * List all users (for neo4j-viewer dropdown)
 * GET /api/graph/users
 */
router.get('/users', (req, res) => graphController.getAllUsers(req, res));

/**
 * Create or update a user
 * POST /api/graph/users
 */
router.post('/users', (req, res) => graphController.createUser(req, res));

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
 * Create or update a person
 * POST /api/graph/people
 */
router.post('/people', (req, res) => graphController.createPerson(req, res));

/**
 * Search people by name
 * GET /api/graph/people/search?q=name
 */
router.get('/people/search', (req, res) => graphController.searchPeople(req, res));

/**
 * Get recently mentioned people for a user
 * GET /api/graph/users/:userId/people/recent
 */
router.get('/users/:userId/people/recent', (req, res) => graphController.getRecentPeople(req, res));

/**
 * Create a conversation
 * POST /api/graph/conversations
 */
router.post('/conversations', (req, res) => graphController.createConversation(req, res));

/**
 * Get conversation context for a user
 * GET /api/graph/users/:userId/context
 */
router.get('/users/:userId/context', (req, res) => graphController.getContext(req, res));

/**
 * Get contradictions (core insight feature)
 * GET /api/graph/users/:userId/insights/contradictions
 */
router.get('/users/:userId/insights/contradictions', (req, res) =>
  graphController.getContradictions(req, res)
);

/**
 * Get conversation suggestions (Conversation DJ)
 * GET /api/graph/users/:userId/insights/suggestions
 */
router.get('/users/:userId/insights/suggestions', (req, res) =>
  graphController.getSuggestions(req, res)
);

/**
 * What's currently active?
 * GET /api/graph/users/:userId/insights/active
 */
router.get('/users/:userId/insights/active', (req, res) => graphController.getActive(req, res));

export default router;
