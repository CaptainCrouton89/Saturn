import { Router, Request, Response } from 'express';
import { authService } from '../services/authService.js';

const router: Router = Router();

/**
 * POST /api/auth/register
 * Register or authenticate a device using Supabase Anonymous Auth
 * Body: { deviceId: string }
 * Returns: { userId, accessToken, refreshToken, isNewUser }
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId || typeof deviceId !== 'string') {
      res.status(400).json({
        error: 'Bad Request',
        message: 'deviceId is required and must be a string',
      });
      return;
    }

    const result = await authService.registerOrAuthenticateDevice(deviceId);

    res.status(result.isNewUser ? 201 : 200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Auth registration error:', errorMessage);

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to register device',
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
    });
  }
});

/**
 * POST /api/auth/validate
 * Validate a Supabase access token
 * Headers: Authorization: Bearer <access_token>
 * Returns: { valid: true, user: {...} }
 */
router.post('/validate', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header',
      });
      return;
    }

    const accessToken = authHeader.substring(7); // Remove 'Bearer ' prefix

    const user = await authService.validateToken(accessToken);

    res.status(200).json({
      success: true,
      valid: true,
      data: { user },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    res.status(401).json({
      error: 'Unauthorized',
      message: errorMessage,
    });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 * Body: { refreshToken: string }
 * Returns: { accessToken, refreshToken }
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken || typeof refreshToken !== 'string') {
      res.status(400).json({
        error: 'Bad Request',
        message: 'refreshToken is required and must be a string',
      });
      return;
    }

    const tokens = await authService.refreshSession(refreshToken);

    res.status(200).json({
      success: true,
      data: tokens,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Token refresh error:', errorMessage);

    res.status(401).json({
      error: 'Unauthorized',
      message: errorMessage,
    });
  }
});

/**
 * POST /api/auth/onboarding/complete
 * Mark user onboarding as completed
 * Headers: Authorization: Bearer <access_token>
 * Returns: { success: true }
 */
router.post('/onboarding/complete', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header',
      });
      return;
    }

    const accessToken = authHeader.substring(7);
    const user = await authService.validateToken(accessToken);

    await authService.completeOnboarding(user.id);

    res.status(200).json({
      success: true,
      message: 'Onboarding completed',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Onboarding completion error:', errorMessage);

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to complete onboarding',
    });
  }
});

/**
 * GET /api/auth/me
 * Get current user profile
 * Headers: Authorization: Bearer <access_token>
 * Returns: { user: {...}, profile: {...} }
 */
router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header',
      });
      return;
    }

    const accessToken = authHeader.substring(7);
    const user = await authService.validateToken(accessToken);
    const profile = await authService.getUserProfile(user.id);

    res.status(200).json({
      success: true,
      data: {
        user,
        profile,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Get user error:', errorMessage);

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get user information',
    });
  }
});

export default router;
