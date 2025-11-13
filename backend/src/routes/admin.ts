/**
 * Admin routes for queue monitoring and management
 *
 * Endpoints:
 * - GET /admin/queue-status - View queue statistics
 * - GET /admin/failed-jobs - List failed jobs
 * - POST /admin/retry/:jobId - Retry a failed job
 */

import { Router, Request, Response } from 'express';
import { getQueue } from '../queue/memoryQueue.js';

const router: Router = Router();

/**
 * Get queue status and statistics
 */
router.get('/queue-status', async (_req: Request, res: Response) => {
  try {
    const queue = await getQueue();

    const stats = await queue.getQueueStats('process-conversation-memory');

    res.json({
      queue: 'process-conversation-memory',
      active: stats.activeCount,
      queued: stats.queuedCount,
      total: stats.totalCount,
      deferred: stats.deferredCount,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to get queue status', message: errorMessage });
  }
});

/**
 * Get failed jobs for inspection
 */
router.get('/failed-jobs', async (_req: Request, res: Response) => {
  try {
    await getQueue();

    // pg-boss doesn't have a direct "fetchFailedJobs" method, so we query manually
    // This is a simplified version - in production, query the pgboss.job table directly
    res.json({
      message: 'Failed jobs can be queried from pgboss.job table with state = failed',
      instructions: 'Use SQL: SELECT * FROM pgboss.job WHERE state = \'failed\' ORDER BY completedon DESC LIMIT 20',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to get failed jobs', message: errorMessage });
  }
});

/**
 * Retry a failed job by ID
 */
router.post('/retry/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const queue = await getQueue();

    await queue.retry('process-conversation-memory', jobId);

    res.json({ success: true, message: `Job ${jobId} retried` });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to retry job', message: errorMessage });
  }
});

/**
 * Get conversation extraction status
 */
router.get('/conversation/:id/extraction-status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Query PostgreSQL to check entities_extracted flag
    const { supabaseService } = await import('../db/supabase.js');
    const supabase = supabaseService.getClient();

    const { data: conversation, error } = await supabase
      .from('source')
      .select('entities_extracted, neo4j_synced_at')
      .eq('id', id)
      .eq('source_type', 'conversation')
      .single();

    if (error || !conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.json({
      conversationId: id,
      entitiesExtracted: conversation.entities_extracted,
      neo4jSyncedAt: conversation.neo4j_synced_at,
      status: conversation.entities_extracted ? 'completed' : 'pending/processing',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to get extraction status', message: errorMessage });
  }
});

export default router;
