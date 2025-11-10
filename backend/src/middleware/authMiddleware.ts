import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService.js';
import { User } from '@supabase/supabase-js';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * Middleware to authenticate requests using Supabase access tokens or Admin API key
 * Expects Authorization: Bearer <access_token> or X-Admin-Key: <admin_key> header
 * Attaches Supabase user to req.user
 */
export async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Check for admin API key first (for neo4j-viewer and other admin tools)
    const adminKey = req.headers['x-admin-key'];
    const expectedAdminKey = process.env.ADMIN_API_KEY;

    if (adminKey && expectedAdminKey && adminKey === expectedAdminKey) {
      // Admin key valid - bypass JWT validation
      // Create a mock user for admin access (optional, depending on your needs)
      req.user = {
        id: 'admin',
        email: 'admin@localhost',
      } as User;
      next();
      return;
    }

    // Otherwise, check for JWT token
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

    // Attach user to request
    req.user = user;

    next();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    res.status(401).json({
      error: 'Unauthorized',
      message: errorMessage,
    });
  }
}

/**
 * Optional authentication middleware
 * Attaches user if token is valid, but doesn't fail if missing/invalid
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const accessToken = authHeader.substring(7);
      const user = await authService.validateToken(accessToken);
      req.user = user;
    }

    next();
  } catch {
    // Silently continue without authentication
    next();
  }
}
