import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { preferenceController } from '../controllers/preferenceController';

const router = Router();

/**
 * GET /api/preferences
 * Get all user preferences
 * Headers: Authorization: Bearer <access_token>
 * Returns: { preferences: UserPreferenceDTO[] }
 */
router.get('/', authenticateToken, (req, res) => preferenceController.getPreferences(req, res));

/**
 * POST /api/preferences
 * Create a new user preference
 * Headers: Authorization: Bearer <access_token>
 * Body: { type, instruction, strength }
 * Returns: { preference: UserPreferenceDTO }
 */
router.post('/', authenticateToken, (req, res) => preferenceController.createPreference(req, res));

export default router;
