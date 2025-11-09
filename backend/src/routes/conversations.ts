import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { conversationController } from '../controllers/conversationController';

const router: Router = Router();

/**
 * POST /api/conversations
 * Create a new conversation
 * Headers: Authorization: Bearer <access_token>
 * Body: { triggerMethod?: string }
 * Returns: { conversation: ConversationDTO }
 */
router.post('/', authenticateToken, (req, res) =>
  conversationController.createConversation(req, res)
);

/**
 * POST /api/conversations/:id/exchange
 * Process a conversation exchange (user message + agent response)
 * Headers: Authorization: Bearer <access_token>
 * Body: { userMessage: string, turnNumber: number }
 * Returns: { response: {...}, conversationHistory: [...] }
 */
router.post('/:id/exchange', authenticateToken, (req, res) =>
  conversationController.processExchange(req, res)
);

/**
 * POST /api/conversations/:id/end
 * End a conversation
 * Headers: Authorization: Bearer <access_token>
 * Returns: { conversation: { id, status, endedAt, summary } }
 */
router.post('/:id/end', authenticateToken, (req, res) =>
  conversationController.endConversation(req, res)
);

/**
 * GET /api/conversations/:id
 * Get a specific conversation by ID
 * Headers: Authorization: Bearer <access_token>
 * Returns: { conversation: ConversationDTO }
 */
router.get('/:id', authenticateToken, (req, res) =>
  conversationController.getConversation(req, res)
);

/**
 * GET /api/conversations
 * List conversations with pagination
 * Headers: Authorization: Bearer <access_token>
 * Query params: limit, offset, status
 * Returns: { conversations: [...], total, hasMore }
 */
router.get('/', authenticateToken, (req, res) =>
  conversationController.listConversations(req, res)
);

export default router;
