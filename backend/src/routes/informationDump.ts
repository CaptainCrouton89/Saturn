/**
 * Information Dump routes for bulk data ingestion
 *
 * Endpoints:
 * - POST / - Create new information dump
 * - GET /:id - Get information dump status
 * - GET / - List all information dumps for authenticated user
 */

import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { informationDumpController } from '../controllers/informationDumpController.js';

const router: Router = Router();

/**
 * Create new information dump
 * Body: { title: string, label?: string, content: string }
 */
router.post('/', authenticateToken, (req, res) =>
  informationDumpController.create(req, res)
);

/**
 * Get information dump status by ID
 */
router.get('/:id', authenticateToken, (req, res) =>
  informationDumpController.getStatus(req, res)
);

/**
 * List all information dumps for authenticated user
 */
router.get('/', authenticateToken, (req, res) =>
  informationDumpController.list(req, res)
);

export default router;
