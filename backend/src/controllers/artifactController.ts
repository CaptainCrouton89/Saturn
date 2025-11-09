import { Request, Response } from 'express';
import { artifactService } from '../services/artifactService.js';

export class ArtifactController {
  /**
   * GET /api/artifacts
   * List artifacts with pagination and optional type filtering
   */
  async listArtifacts(req: Request, res: Response): Promise<void> {
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
      const type = req.query.type as string | undefined;

      const result = await artifactService.listArtifacts(req.user.id, limit, offset, type);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('List artifacts error:', errorMessage);

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to list artifacts',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      });
    }
  }

  /**
   * GET /api/artifacts/:id
   * Get a specific artifact by ID
   */
  async getArtifact(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'User not authenticated',
        });
        return;
      }

      const artifactId = req.params.id;

      const artifact = await artifactService.getArtifact(artifactId, req.user.id);

      res.status(200).json({
        success: true,
        data: { artifact },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Get artifact error:', errorMessage);

      if (errorMessage.includes('not found')) {
        res.status(404).json({
          error: 'Not Found',
          message: errorMessage,
        });
        return;
      }

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch artifact',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      });
    }
  }
}

export const artifactController = new ArtifactController();
