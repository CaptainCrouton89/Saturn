import { Request, Response } from 'express';
import { initService } from '../services/initService';

export class InitController {
  /**
   * GET /api/init
   * Get all initialization data for app launch
   */
  async getInitData(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'User not authenticated',
        });
        return;
      }

      const initData = await initService.getInitData(req.user.id);

      res.status(200).json({
        success: true,
        data: initData,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Init endpoint error:', errorMessage);

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch initialization data',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      });
    }
  }
}

export const initController = new InitController();
