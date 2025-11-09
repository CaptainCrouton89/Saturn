import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { initController } from '../controllers/initController';

const router: Router = Router();

/**
 * GET /api/init
 * Get all initialization data for app launch
 * Headers: Authorization: Bearer <access_token>
 * Returns: { user, preferences, recentConversations, stats }
 */
router.get('/', authenticateToken, (req, res) => initController.getInitData(req, res));

export default router;
