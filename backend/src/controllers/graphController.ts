import { Request, Response } from 'express';
import { conversationRepository } from '../repositories/ConversationRepository.js';
import { insightRepository } from '../repositories/InsightRepository.js';
import { personRepository } from '../repositories/PersonRepository.js';
import { userRepository } from '../repositories/UserRepository.js';
import { graphService } from '../services/graphService.js';

export class GraphController {
  /**
   * List all users (for neo4j-viewer dropdown)
   * GET /api/graph/users
   */
  async getAllUsers(_req: Request, res: Response): Promise<void> {
    try {
      const users = await graphService.getAllUsers();
      res.json({ users });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Create or update a user
   * POST /api/graph/users
   */
  async createUser(req: Request, res: Response): Promise<void> {
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
  }

  /**
   * Get user by ID
   * GET /api/graph/users/:id
   */
  async getUser(req: Request, res: Response): Promise<void> {
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
  }

  /**
   * Get full graph data for a user (for neo4j-viewer)
   * GET /api/graph/users/:userId/full-graph
   */
  async getFullGraph(req: Request, res: Response): Promise<void> {
    try {
      const graphData = await graphService.getFullGraphForUser(req.params.userId);
      res.json(graphData);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Create or update a person
   * POST /api/graph/people
   */
  async createPerson(req: Request, res: Response): Promise<void> {
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
  }

  /**
   * Search people by name
   * GET /api/graph/people/search?q=name
   */
  async searchPeople(req: Request, res: Response): Promise<void> {
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
  }

  /**
   * Get recently mentioned people for a user
   * GET /api/graph/users/:userId/people/recent
   */
  async getRecentPeople(req: Request, res: Response): Promise<void> {
    try {
      const daysBack = parseInt(req.query.days as string) || 14;
      const people = await personRepository.getRecentlyMentioned(req.params.userId, daysBack);
      res.json({ people, daysBack });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Create a conversation
   * POST /api/graph/conversations
   */
  async createConversation(req: Request, res: Response): Promise<void> {
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
  }

  /**
   * Get conversation context for a user
   * GET /api/graph/users/:userId/context
   */
  async getContext(req: Request, res: Response): Promise<void> {
    try {
      const daysBack = parseInt(req.query.days as string) || 14;
      const context = await conversationRepository.getContext(req.params.userId, daysBack);
      res.json({ context, daysBack });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Get contradictions (core insight feature)
   * GET /api/graph/users/:userId/insights/contradictions
   */
  async getContradictions(req: Request, res: Response): Promise<void> {
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
  }

  /**
   * Get conversation suggestions (Conversation DJ)
   * GET /api/graph/users/:userId/insights/suggestions
   */
  async getSuggestions(req: Request, res: Response): Promise<void> {
    try {
      const suggestions = await insightRepository.getConversationSuggestions(req.params.userId);
      res.json({ suggestions });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * What's currently active?
   * GET /api/graph/users/:userId/insights/active
   */
  async getActive(req: Request, res: Response): Promise<void> {
    try {
      const daysBack = parseInt(req.query.days as string) || 7;
      const active = await insightRepository.getCurrentlyActive(req.params.userId, daysBack);
      res.json({ active, daysBack });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }
}

export const graphController = new GraphController();
