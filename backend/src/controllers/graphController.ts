import { Request, Response } from 'express';
import { sourceRepository } from '../repositories/SourceRepository.js';
import { personRepository } from '../repositories/PersonRepository.js';
import { graphService } from '../services/graphService.js';
import { queryGeneratorService } from '../services/queryGeneratorService.js';
import { Person } from '../types/graph.js';

function resolveUserId(
  req: Request,
  res: Response,
  requestedIds: unknown[] = [],
  requireIdForAdmin = false
): string | null {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const authenticatedUserId = req.user.id;

  if (requestedIds.some((id) => id !== undefined && typeof id !== 'string')) {
    res.status(400).json({ error: 'user_id must be a string' });
    return null;
  }

  const suppliedIds = requestedIds.filter((id): id is string => typeof id === 'string');
  const requestedId = suppliedIds[0];

  if (!req.isAdmin) {
    if (suppliedIds.some((id) => id !== authenticatedUserId)) {
      res.status(403).json({ error: 'Forbidden' });
      return null;
    }
    return authenticatedUserId;
  }

  if (suppliedIds.some((id) => id !== requestedId)) {
    res.status(400).json({ error: 'Conflicting user_id values' });
    return null;
  }

  if (req.isAdmin) {
    if (requireIdForAdmin && !requestedId) {
      res.status(400).json({ error: 'Missing required field: user_id' });
      return null;
    }
    return requestedId ?? authenticatedUserId;
  }

  return authenticatedUserId;
}

export class GraphController {
  /**
   * List all users for the admin viewer, or only the authenticated user's owner node.
   * GET /api/graph/users
   */
  async getAllUsers(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.isAdmin ? undefined : resolveUserId(req, res);
      if (userId === null) return;

      const users = await graphService.getAllUsers(userId);
      res.json({ users });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Create or update a user (owner Person node).
   * POST /api/graph/users
   */
  async createUser(req: Request, res: Response): Promise<void> {
    try {
      const { id, name } = req.body;
      const userId = resolveUserId(req, res, [id], true);
      if (!userId) return;

      if (!name) {
        res.status(400).json({ error: 'Missing required field: name' });
        return;
      }

      const user = await personRepository.findOrCreateOwner(userId, name);
      res.json({ user });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Get user by ID (owner Person node).
   * GET /api/graph/users/:id
   */
  async getUser(req: Request, res: Response): Promise<void> {
    try {
      const userId = resolveUserId(req, res, [req.params.id], true);
      if (!userId) return;

      const user = await personRepository.findOwner(userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const conversationCount = await personRepository.getConversationCount(userId);
      res.json({ user, conversationCount });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Get full graph data for a user (for neo4j-viewer).
   * GET /api/graph/users/:userId/full-graph
   */
  async getFullGraph(req: Request, res: Response): Promise<void> {
    try {
      const userId = resolveUserId(req, res, [req.params.userId], true);
      if (!userId) return;

      const graphData = await graphService.getFullGraphForUser(userId);
      res.json(graphData);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Create or update a person.
   * POST /api/graph/people
   */
  async createPerson(req: Request, res: Response): Promise<void> {
    try {
      const personData = req.body as Partial<Person> & { id?: string };
      const userId = resolveUserId(req, res, [personData.user_id], true);
      if (!userId) return;

      if (!personData.id || !personData.name) {
        res.status(400).json({ error: 'Missing required fields: id, name' });
        return;
      }

      let entityKey: string | undefined = personData.entity_key;
      if (!entityKey && typeof personData.id === 'string' && personData.id.length === 64 && /^[a-f0-9]+$/.test(personData.id)) {
        entityKey = personData.id;
      }

      let existingPerson: Person | null = null;
      if (entityKey) {
        existingPerson = await personRepository.findById(entityKey);
      }

      if (existingPerson && !req.isAdmin && existingPerson.user_id !== userId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      const scopedPersonData: Partial<Person> & { user_id: string } = { ...personData, user_id: userId };
      let person: Person;

      if (existingPerson) {
        person = await personRepository.update({
          entity_key: entityKey ?? existingPerson.entity_key,
          ...scopedPersonData,
          last_update_source: scopedPersonData.last_update_source || 'api',
          confidence: scopedPersonData.confidence !== undefined ? scopedPersonData.confidence : 0.8,
        });
      } else {
        const result = await personRepository.create({
          user_id: userId,
          name: personData.name,
          description: scopedPersonData.description,
          notes: scopedPersonData.notes || [],
          is_owner: scopedPersonData.is_owner || false,
          last_update_source: scopedPersonData.last_update_source || 'api',
          confidence: scopedPersonData.confidence ?? 0.8,
        });
        const createdPerson = await personRepository.findById(result.entity_key);
        if (!createdPerson) {
          throw new Error('Failed to retrieve created person');
        }
        person = createdPerson;
      }

      res.json({ person });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Search people by name.
   * GET /api/graph/people/search?q=name
   */
  async searchPeople(req: Request, res: Response): Promise<void> {
    try {
      const query = req.query.q as string;
      if (!query) {
        res.status(400).json({ error: 'Missing query parameter: q' });
        return;
      }

      const userId = resolveUserId(req, res);
      if (!userId) return;

      const people = await personRepository.searchByName(query, userId);
      res.json({ people });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Get recently mentioned people for a user.
   * GET /api/graph/users/:userId/people/recent
   */
  async getRecentPeople(req: Request, res: Response): Promise<void> {
    try {
      const userId = resolveUserId(req, res, [req.params.userId], true);
      if (!userId) return;

      const daysBack = parseInt(req.query.days as string) || 14;
      const people = await personRepository.getRecentlyMentioned(userId, daysBack);
      res.json({ people, daysBack });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Create a conversation source.
   * POST /api/graph/conversations
   */
  async createConversation(req: Request, res: Response): Promise<void> {
    try {
      const conversationData = req.body as Partial<import('../types/graph.js').Source>;
      const userId = resolveUserId(req, res, [conversationData.user_id], true);
      if (!userId) return;

      if (!conversationData.description) {
        res.status(400).json({ error: 'Missing required field: description' });
        return;
      }
      if (!conversationData.raw_content) {
        res.status(400).json({ error: 'Missing required field: raw_content' });
        return;
      }
      if (!Array.isArray(conversationData.participants)) {
        res.status(400).json({ error: 'Missing required field: participants (must be an array)' });
        return;
      }

      const participants = conversationData.participants;
      const scopedConversationData: Parameters<typeof sourceRepository.create>[0] = {
        ...conversationData,
        user_id: userId,
        description: conversationData.description,
        raw_content: conversationData.raw_content,
        participants: participants.includes(userId) ? participants : [...participants, userId],
        started_at: conversationData.started_at ?? new Date().toISOString(),
        content: conversationData.content || {
          type: 'transcript',
          content: conversationData.raw_content,
        },
      };

      const conversation = await sourceRepository.create(scopedConversationData);
      res.json({ conversation });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Get conversation context for a user.
   * GET /api/graph/users/:userId/context
   */
  async getContext(req: Request, res: Response): Promise<void> {
    try {
      const userId = resolveUserId(req, res, [req.params.userId], true);
      if (!userId) return;

      const daysBack = parseInt(req.query.days as string) || 14;
      const context = await sourceRepository.getContext(userId, daysBack);
      res.json({ context, daysBack });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Execute a read-only manual Cypher query for the admin viewer.
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
    } catch {
      res.status(400).json({ error: 'Query rejected' });
    }
  }

  /**
   * Execute explore tool (semantic search + graph expansion).
   * POST /api/graph/explore OR POST /api/graph/users/:userId/explore
   */
  async executeExplore(req: Request, res: Response): Promise<void> {
    try {
      const userId = resolveUserId(req, res, [req.params.userId, req.body.user_id], true);
      if (!userId) return;

      const { queries, text_matches, return_explanations, search_relationships, node_types, max_results_per_type } = req.body;
      if (!queries && !text_matches) {
        res.status(400).json({ error: 'At least one of queries or text_matches is required' });
        return;
      }

      const graphData = await graphService.executeExplore(
        { queries, text_matches, search_relationships, return_explanations, node_types, max_results_per_type },
        userId
      );
      res.json(graphData);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }

  /**
   * Generate query from natural language description.
   * POST /api/graph/generate-query
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

  /**
   * Get UMAP 2D projection of semantic nodes for visualization.
   * GET /api/graph/users/:userId/umap-projection
   */
  async getUmapProjection(req: Request, res: Response): Promise<void> {
    try {
      const userId = resolveUserId(req, res, [req.params.userId], true);
      if (!userId) return;

      const projection = await graphService.getUmapProjection(userId);
      res.json({ nodes: projection });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  }
}

export const graphController = new GraphController();
