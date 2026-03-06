import { Router } from 'express';
import { chatController } from '../controllers/chatController.js';

const router: Router = Router();

/**
 * POST /api/chat/stream-memory
 * Memory-optimized streaming endpoint using Vercel AI SDK
 * Body: { message: string, userId: string, conversationId?: string }
 */
router.post('/stream-memory', (req, res) => chatController.streamMemoryOptimizedChat(req, res));

export default router;
