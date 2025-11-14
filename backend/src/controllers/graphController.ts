import { Request, Response } from 'express';
import { sourceRepository } from '../repositories/SourceRepository.js';
import { personRepository } from '../repositories/PersonRepository.js';
import { graphService } from '../services/graphService.js';
import { queryGeneratorService } from '../services/queryGeneratorService.js';

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
   * Create or update a user (owner Person node)
   * POST /api/graph/users
   */
  async createUser(req: Request, res: Response): Promise<void> {
    try {
      const { id, name } = req.body;

      if (!id || !name) {
        res.status(400).json({ error: 'Missing required fields: id, name' });
        return;
      }

      const user = await personRepository.upsertOwner(id, name);
      res.json({ user });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Get user by ID (owner Person node)
   * GET /api/graph/users/:id
   */
  async getUser(req: Request, res: Response): Promise<void> {
    try {
      const user = await personRepository.findOwner(req.params.id);

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const conversationCount = await personRepository.getConversationCount(req.params.id);

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

      // Extract userId from authenticated request (set by authenticateToken middleware)
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const people = await personRepository.searchByName(query, userId);
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
   * Create a conversation source
   * POST /api/graph/conversations
   */
  async createConversation(req: Request, res: Response): Promise<void> {
    try {
      const conversationData = req.body;

      // Validate required fields
      if (!conversationData.user_id || !conversationData.description) {
        res.status(400).json({ error: 'Missing required fields: user_id, description' });
        return;
      }

      if (!conversationData.raw_content) {
        res.status(400).json({ error: 'Missing required field: raw_content' });
        return;
      }

      if (!conversationData.participants || !Array.isArray(conversationData.participants)) {
        res.status(400).json({ error: 'Missing required field: participants (must be an array)' });
        return;
      }

      // Ensure user_id is in participants array (required by repository invariant)
      if (!conversationData.participants.includes(conversationData.user_id)) {
        conversationData.participants = [...conversationData.participants, conversationData.user_id];
      }

      // Default started_at to current time if not provided
      if (!conversationData.started_at) {
        conversationData.started_at = new Date();
      } else {
        // Ensure started_at is a Date object if provided as string
        conversationData.started_at = new Date(conversationData.started_at);
      }

      // Ensure content field exists (required by repository)
      if (!conversationData.content) {
        conversationData.content = {
          type: 'transcript',
          content: typeof conversationData.raw_content === 'string' 
            ? conversationData.raw_content 
            : JSON.stringify(conversationData.raw_content)
        };
      }

      const conversation = await sourceRepository.create(conversationData);
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
      const context = await sourceRepository.getContext(req.params.userId, daysBack);
      res.json({ context, daysBack });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Execute manual Cypher query against user's knowledge graph
   * POST /api/graph/query
   * Body: { user_id: string, query: string }
   */
  async executeQuery(req: Request, res: Response): Promise<void> {
    try {
      const { user_id, query } = req.body;

      if (!user_id) {
        res.status(400).json({ error: 'Missing required field: user_id' });
        return;
      }

      if (!query) {
        res.status(400).json({ error: 'Missing required field: query' });
        return;
      }

      const graphData = await graphService.executeQuery(query, user_id);
      res.json(graphData);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Execute explore tool (semantic search + graph expansion)
   * POST /api/graph/explore
   * Body: { user_id: string, queries?: Array<{query: string, threshold?: number}>, text_matches?: string[], return_explanations?: boolean }
   */
  async executeExplore(req: Request, res: Response): Promise<void> {
    try {
      const { user_id, queries, text_matches, return_explanations } = req.body;

      if (!user_id) {
        res.status(400).json({ error: 'Missing required field: user_id' });
        return;
      }

      if (!queries && !text_matches) {
        res.status(400).json({ error: 'At least one of queries or text_matches is required' });
        return;
      }

      const graphData = await graphService.executeExplore(
        {
          queries,
          text_matches,
          return_explanations,
        },
        user_id
      );
      res.json(graphData);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Generate query from natural language description
   * POST /api/graph/generate-query
   * Body: { description: string, type?: 'explore' | 'cypher' }
   */
  async generateQuery(req: Request, res: Response): Promise<void> {
    try {
      const { description, type } = req.body;

      if (!description) {
        res.status(400).json({ error: 'Missing required field: description' });
        return;
      }

      const result = await queryGeneratorService.generateQuery(description, type);
      res.json(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

}

export const graphController = new GraphController();
