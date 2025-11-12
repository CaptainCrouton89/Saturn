import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabaseService } from '../db/supabase.js';
import { enqueueInformationDumpProcessing } from '../queue/memoryQueue.js';
import { CreateInformationDumpRequest, InformationDump } from '../types/informationDump.js';

export class InformationDumpController {
  /**
   * POST /api/information-dumps
   * Create a new information dump and enqueue for processing
   */
  async create(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'User not authenticated',
        });
        return;
      }

      const { title, label, content, user_id } = req.body as CreateInformationDumpRequest;

      // Determine userId based on authentication type
      let userId: string;
      if (req.user.id === 'admin') {
        // Admin key authentication - require user_id in body
        if (!user_id) {
          res.status(400).json({
            error: 'Validation failed',
            details: [{
              field: 'user_id',
              message: 'user_id is required when authenticated with admin key'
            }]
          });
          return;
        }
        userId = user_id;
      } else {
        // JWT authentication - use authenticated user's ID
        userId = req.user.id;
      }

      // Input validation
      const validationErrors: { field: string; message: string }[] = [];

      if (!title || typeof title !== 'string') {
        validationErrors.push({
          field: 'title',
          message: 'title is required and must be a string',
        });
      } else if (title.length < 1 || title.length > 200) {
        validationErrors.push({
          field: 'title',
          message: 'title must be between 1 and 200 characters',
        });
      }

      if (label !== undefined && label !== null) {
        if (typeof label !== 'string') {
          validationErrors.push({
            field: 'label',
            message: 'label must be a string',
          });
        } else if (label.length > 200) {
          validationErrors.push({
            field: 'label',
            message: 'label must be at most 200 characters',
          });
        }
      }

      if (!content || typeof content !== 'string') {
        validationErrors.push({
          field: 'content',
          message: 'content is required and must be a string',
        });
      } else if (content.length < 1 || content.length > 50000) {
        validationErrors.push({
          field: 'content',
          message: 'content must be between 1 and 50,000 characters',
        });
      }

      if (validationErrors.length > 0) {
        res.status(400).json({
          error: 'Validation failed',
          details: validationErrors,
        });
        return;
      }

      // Generate dump ID
      const dumpId = uuidv4();

      // Insert to database
      const supabase = supabaseService.getClient();
      const { error: dbError } = await supabase
        .from('information_dump')
        .insert({
          id: dumpId,
          user_id: userId,
          title,
          label: label || null,
          content,
          processing_status: 'queued',
          entities_extracted: false,
        });

      if (dbError) {
        console.error('Database error creating information dump:', dbError);
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to create information dump',
          details: process.env.NODE_ENV === 'development' ? dbError.message : undefined,
        });
        return;
      }

      // Enqueue processing job
      let jobId: string;
      try {
        jobId = await enqueueInformationDumpProcessing(dumpId, userId);
      } catch (queueError) {
        const errorMessage = queueError instanceof Error ? queueError.message : 'Unknown error';
        console.error('Failed to enqueue information dump processing:', errorMessage);
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Information dump created but failed to enqueue processing',
          details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
        });
        return;
      }

      res.status(201).json({
        information_dump_id: dumpId,
        job_id: jobId,
        status: 'queued',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Create information dump error:', errorMessage);

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to create information dump',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      });
    }
  }

  /**
   * GET /api/information-dumps/:id
   * Get status and details of a specific information dump
   */
  async getStatus(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'User not authenticated',
        });
        return;
      }

      const { id } = req.params;
      const userId = req.user.id;

      // Fetch dump from database
      const supabase = supabaseService.getClient();
      const { data: dump, error: dbError } = await supabase
        .from('information_dump')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (dbError) {
        if (dbError.code === 'PGRST116') {
          // No rows returned
          res.status(404).json({
            error: 'Information dump not found',
          });
          return;
        }

        console.error('Database error fetching information dump:', dbError);
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to fetch information dump',
          details: process.env.NODE_ENV === 'development' ? dbError.message : undefined,
        });
        return;
      }

      if (!dump) {
        res.status(404).json({
          error: 'Information dump not found',
        });
        return;
      }

      res.status(200).json(dump as InformationDump);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Get information dump status error:', errorMessage);

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch information dump',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      });
    }
  }

  /**
   * GET /api/information-dumps
   * List information dumps with pagination and filtering
   */
  async list(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'User not authenticated',
        });
        return;
      }

      const userId = req.user.id;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;
      const status = req.query.status as string | undefined;

      // Build query
      const supabase = supabaseService.getClient();
      let query = supabase
        .from('information_dump')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      // Apply status filter if provided
      if (status) {
        query = query.eq('processing_status', status);
      }

      const { data: dumps, error: dbError, count } = await query;

      if (dbError) {
        console.error('Database error listing information dumps:', dbError);
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to list information dumps',
          details: process.env.NODE_ENV === 'development' ? dbError.message : undefined,
        });
        return;
      }

      res.status(200).json({
        dumps: dumps as InformationDump[],
        total: count || 0,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('List information dumps error:', errorMessage);

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to list information dumps',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      });
    }
  }
}

export const informationDumpController = new InformationDumpController();
