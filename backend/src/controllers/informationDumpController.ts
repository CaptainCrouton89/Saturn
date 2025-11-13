import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabaseService } from '../db/supabase.js';
import { enqueueConversationProcessing } from '../queue/memoryQueue.js';
import { CreateInformationDumpDTO, CreateSourceResponseDTO, ValidationErrorDetail } from '../types/dto.js';

export class InformationDumpController {
  /**
   * POST /api/information-dumps
   * Create a new information dump and enqueue for processing
   *
   * Now inserts into unified `source` table with source_type='information_dump'
   * Uses same processing queue as conversations (both call processSource)
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

      const { content, source_type, user_id } = req.body as CreateInformationDumpDTO & {
        source_type?: string;
        user_id?: string;
      };

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
        // Validate user_id is a valid UUID
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(user_id)) {
          res.status(400).json({
            error: 'Validation failed',
            details: [{
              field: 'user_id',
              message: 'user_id must be a valid UUID'
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
      const validationErrors: ValidationErrorDetail[] = [];

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

      // Validate source_type (optional, defaults to 'other')
      const validSourceTypes = ['voice-memo', 'meeting', 'journal', 'book-summary', 'article', 'conversation', 'other'];
      const finalSourceType = source_type || 'other';

      if (typeof finalSourceType !== 'string' || !validSourceTypes.includes(finalSourceType)) {
        validationErrors.push({
          field: 'source_type',
          message: `source_type must be one of: ${validSourceTypes.join(', ')}`,
        });
      }

      if (validationErrors.length > 0) {
        res.status(400).json({
          error: 'Validation failed',
          details: validationErrors,
        });
        return;
      }

      // Generate source ID
      const sourceId = uuidv4();

      // Insert to unified source table
      const supabase = supabaseService.getClient();
      const { error: dbError } = await supabase
        .from('source')
        .insert({
          id: sourceId,
          user_id: userId,
          source_type: 'information_dump',
          content_raw: content, // Store as plain text string
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

      // Enqueue processing job (same queue as conversations)
      try {
        await enqueueConversationProcessing(sourceId, userId);
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

      // Fetch created_at timestamp
      const { data: sourceData, error: fetchError } = await supabase
        .from('source')
        .select('created_at')
        .eq('id', sourceId)
        .single();

      if (fetchError || !sourceData?.created_at) {
        console.error('Failed to fetch created_at for source:', fetchError);
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Source created but failed to fetch timestamp',
          details: process.env.NODE_ENV === 'development' ? fetchError?.message : undefined,
        });
        return;
      }

      const response: CreateSourceResponseDTO = {
        source_id: sourceId,
        processing_status: 'queued',
        message: 'Information dump queued for processing',
        created_at: sourceData.created_at,
      };

      res.status(201).json(response);
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

      // Fetch from unified source table
      const supabase = supabaseService.getClient();
      const { data: source, error: dbError } = await supabase
        .from('source')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .eq('source_type', 'information_dump')
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

      if (!source) {
        res.status(404).json({
          error: 'Information dump not found',
        });
        return;
      }

      res.status(200).json({
        id: source.id,
        user_id: source.user_id,
        content: source.content_raw,
        content_processed: source.content_processed,
        summary: source.summary,
        created_at: source.created_at,
        entities_extracted: source.entities_extracted,
        neo4j_synced_at: source.neo4j_synced_at,
      });
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

      // Build query for unified source table
      const supabase = supabaseService.getClient();
      const query = supabase
        .from('source')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .eq('source_type', 'information_dump')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data: sources, error: dbError, count } = await query;

      if (dbError) {
        console.error('Database error listing information dumps:', dbError);
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to list information dumps',
          details: process.env.NODE_ENV === 'development' ? dbError.message : undefined,
        });
        return;
      }

      // Transform to match expected response format
      const dumps = (sources || []).map(source => ({
        id: source.id,
        user_id: source.user_id,
        content: source.content_raw,
        content_processed: source.content_processed,
        summary: source.summary,
        created_at: source.created_at,
        entities_extracted: source.entities_extracted,
        neo4j_synced_at: source.neo4j_synced_at,
      }));

      res.status(200).json({
        dumps,
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
