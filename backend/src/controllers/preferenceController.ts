import { Request, Response } from 'express';
import { preferenceService } from '../services/preferenceService.js';
import { CreatePreferenceDTO } from '../types/dto.js';

export class PreferenceController {
  /**
   * GET /api/preferences
   * Get all user preferences
   */
  async getPreferences(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'User not authenticated',
        });
        return;
      }

      const preferences = await preferenceService.getUserPreferences(req.user.id);

      res.status(200).json({
        success: true,
        data: { preferences },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Get preferences error:', errorMessage);

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch preferences',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      });
    }
  }

  /**
   * POST /api/preferences
   * Create a new user preference
   */
  async createPreference(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'User not authenticated',
        });
        return;
      }

      const { type, instruction, strength } = req.body as CreatePreferenceDTO;

      // Validate required fields
      if (!type || typeof type !== 'string') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'type is required and must be a string',
        });
        return;
      }

      if (!instruction || typeof instruction !== 'string') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'instruction is required and must be a string',
        });
        return;
      }

      if (strength === null || strength === undefined || typeof strength !== 'number') {
        res.status(400).json({
          error: 'Bad Request',
          message: 'strength is required and must be a number',
        });
        return;
      }

      const preference = await preferenceService.createPreference(req.user.id, {
        type,
        instruction,
        strength,
      });

      res.status(201).json({
        success: true,
        data: { preference },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Create preference error:', errorMessage);

      // Check for specific validation errors
      if (errorMessage.includes('must be between 0 and 1')) {
        res.status(400).json({
          error: 'Bad Request',
          message: errorMessage,
        });
        return;
      }

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to create preference',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      });
    }
  }
}

export const preferenceController = new PreferenceController();
