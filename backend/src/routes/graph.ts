import { Request, Response, Router } from 'express';
import { userRepository } from '../repositories/UserRepository.js';
import { personRepository } from '../repositories/PersonRepository.js';
import { conversationRepository } from '../repositories/ConversationRepository.js';
import { insightRepository } from '../repositories/InsightRepository.js';

const router: Router = Router();

/**
 * Create or update a user
 * POST /api/graph/users
 */
router.post('/users', async (req: Request, res: Response) => {
  try {
    const { id, name } = req.body;

    if (!id || !name) {
      res.status(400).json({ error: 'Missing required fields: id, name' });
      return;
    }

    const user = await userRepository.upsert({ id, name });
    res.json({ user });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get user by ID
 * GET /api/graph/users/:id
 */
router.get('/users/:id', async (req: Request, res: Response) => {
  try {
    const user = await userRepository.findById(req.params.id);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const conversationCount = await userRepository.getConversationCount(req.params.id);

    res.json({ user, conversationCount });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Create or update a person
 * POST /api/graph/people
 */
router.post('/people', async (req: Request, res: Response) => {
  try {
    const personData = req.body;

    if (!personData.id || !personData.name) {
      res.status(400).json({ error: 'Missing required fields: id, name' });
      return;
    }

    const person = await personRepository.upsert(personData);
    res.json({ person });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Search people by name
 * GET /api/graph/people/search?q=name
 */
router.get('/people/search', async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;

    if (!query) {
      res.status(400).json({ error: 'Missing query parameter: q' });
      return;
    }

    const people = await personRepository.searchByName(query);
    res.json({ people });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get recently mentioned people for a user
 * GET /api/graph/users/:userId/people/recent
 */
router.get('/users/:userId/people/recent', async (req: Request, res: Response) => {
  try {
    const daysBack = parseInt(req.query.days as string) || 14;
    const people = await personRepository.getRecentlyMentioned(req.params.userId, daysBack);
    res.json({ people, daysBack });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Create a conversation
 * POST /api/graph/conversations
 */
router.post('/conversations', async (req: Request, res: Response) => {
  try {
    const conversationData = req.body;

    if (!conversationData.id || !conversationData.summary) {
      res.status(400).json({ error: 'Missing required fields: id, summary' });
      return;
    }

    const conversation = await conversationRepository.create(conversationData);
    res.json({ conversation });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get conversation context for a user
 * GET /api/graph/users/:userId/context
 */
router.get('/users/:userId/context', async (req: Request, res: Response) => {
  try {
    const daysBack = parseInt(req.query.days as string) || 14;
    const context = await conversationRepository.getContext(req.params.userId, daysBack);
    res.json({ context, daysBack });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get contradictions (core insight feature)
 * GET /api/graph/users/:userId/insights/contradictions
 */
router.get('/users/:userId/insights/contradictions', async (req: Request, res: Response) => {
  try {
    const minConfidence = parseFloat(req.query.minConfidence as string) || 0.6;
    const contradictions = await insightRepository.findContradictions(
      req.params.userId,
      minConfidence
    );
    res.json({ contradictions });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get conversation suggestions (Conversation DJ)
 * GET /api/graph/users/:userId/insights/suggestions
 */
router.get('/users/:userId/insights/suggestions', async (req: Request, res: Response) => {
  try {
    const suggestions = await insightRepository.getConversationSuggestions(req.params.userId);
    res.json({ suggestions });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * What's currently active?
 * GET /api/graph/users/:userId/insights/active
 */
router.get('/users/:userId/insights/active', async (req: Request, res: Response) => {
  try {
    const daysBack = parseInt(req.query.days as string) || 7;
    const active = await insightRepository.getCurrentlyActive(req.params.userId, daysBack);
    res.json({ active, daysBack });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
});

export default router;
