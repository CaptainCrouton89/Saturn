import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { artifactController } from '../controllers/artifactController';

const router: Router = Router();

/**
 * GET /api/artifacts
 * List artifacts with pagination and optional type filtering
 * Headers: Authorization: Bearer <access_token>
 * Query params: limit, offset, type
 * Returns: { artifacts: [...], total, hasMore }
 */
router.get('/', authenticateToken, (req, res) => artifactController.listArtifacts(req, res));

/**
 * GET /api/artifacts/:id
 * Get a specific artifact by ID
 * Headers: Authorization: Bearer <access_token>
 * Returns: { artifact: ArtifactDTO }
 */
router.get('/:id', authenticateToken, (req, res) => artifactController.getArtifact(req, res));

export default router;
