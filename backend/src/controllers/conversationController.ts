import { Request, Response } from 'express';
import { conversationService } from '../services/conversationService.js';
import { CreateConversationDTO, ConversationExchangeDTO } from '../types/dto.js';

export class ConversationController {
  /**
   * POST /api/conversations
   * Create a new conversation
   */
  async createConversation(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'User not authenticated',
        });
        return;
      }

      const { trigger_method } = req.body as CreateConversationDTO;

      const conversation = await conversationService.createConversation(req.user.id, {
        trigger_method,
      });

      res.status(201).json({
        success: true,
        data: {
          conversation: {
            id: conversation.id,
            user_id: conversation.user_id,
            status: conversation.status,
            created_at: conversation.created_at,
            trigger_method: conversation.trigger_method,
          },
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Create conversation error:', errorMessage);

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to create conversation',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      });
    }
  }

  /**
   * POST /api/conversations/:id/exchange
   * Process a conversation exchange (user message + agent response)
   */
  async processExchange(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'User not authenticated',
        });
        return;
      }

      const conversationId = req.params.id;
      const { user_message, turn_number } = req.body as ConversationExchangeDTO;

      // Validate required fields
      // Note: Empty string is allowed for initial onboarding prompt
      if (user_message === null || user_message === undefined || typeof user_message !== 'string') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'user_message is required and must be a string',
        });
        return;
      }

      if (turn_number === null || turn_number === undefined || typeof turn_number !== 'number') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'turn_number is required and must be a number',
        });
        return;
      }

      const result = await conversationService.processExchange(conversationId, req.user.id, {
        user_message,
        turn_number,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Conversation exchange error:', errorMessage);

      // Check for specific error types
      if (errorMessage.includes('not found')) {
        res.status(404).json({
          error: 'Not Found',
          message: errorMessage,
        });
        return;
      }

      if (errorMessage.includes('not active')) {
        res.status(400).json({
          error: 'Bad Request',
          message: errorMessage,
        });
        return;
      }

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to process conversation exchange',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      });
    }
  }

  /**
   * POST /api/conversations/:id/end
   * End a conversation
   */
  async endConversation(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'User not authenticated',
        });
        return;
      }

      const conversationId = req.params.id;

      const result = await conversationService.endConversation(conversationId, req.user.id);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('End conversation error:', errorMessage);

      if (errorMessage.includes('not found')) {
        res.status(404).json({
          error: 'Not Found',
          message: errorMessage,
        });
        return;
      }

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to end conversation',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      });
    }
  }

  /**
   * GET /api/conversations/:id
   * Get a specific conversation by ID
   */
  async getConversation(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'User not authenticated',
        });
        return;
      }

      const conversationId = req.params.id;

      const conversation = await conversationService.getConversation(conversationId, req.user.id);

      res.status(200).json({
        success: true,
        data: { conversation },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Get conversation error:', errorMessage);

      if (errorMessage.includes('not found')) {
        res.status(404).json({
          error: 'Not Found',
          message: errorMessage,
        });
        return;
      }

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch conversation',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      });
    }
  }

  /**
   * GET /api/conversations
   * List conversations with pagination
   */
  async listConversations(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'User not authenticated',
        });
        return;
      }

      const limit = parseInt(req.query.limit as string) || 10;
      const offset = parseInt(req.query.offset as string) || 0;
      const status = req.query.status as string | undefined;

      const result = await conversationService.listConversations(
        req.user.id,
        limit,
        offset,
        status
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('List conversations error:', errorMessage);

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to list conversations',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      });
    }
  }
}

export const conversationController = new ConversationController();
