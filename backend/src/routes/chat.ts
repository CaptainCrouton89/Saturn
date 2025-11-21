import { Router } from 'express';
import { chatController } from '../controllers/chatController.js';

const router: Router = Router();

/**
 * POST /api/chat/stream
 * Stream chat responses using Claude Code Agent SDK with Server-Sent Events
 * Body: { message: string, userId: string, sessionId?: string }
 */
router.post('/stream', (req, res) => chatController.streamChat(req, res));

/**
 * POST /api/chat/stream-memory
 * Memory-optimized streaming endpoint using Vercel AI SDK
 * Body: { message: string, userId: string, conversationId?: string }
 */
router.post('/stream-memory', (req, res) => chatController.streamMemoryOptimizedChat(req, res));

export default router;
