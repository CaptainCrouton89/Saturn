/**
 * Admin routes for queue monitoring and management
 *
 * Endpoints:
 * - GET /admin/queue-status - View queue statistics
 * - GET /admin/failed-jobs - List failed jobs
 * - POST /admin/retry/:jobId - Retry a failed job
 */

import { Router } from 'express';
import { getQueue } from '../queue/memoryQueue.js';

const router = Router();

/**
 * Get queue status and statistics
 */
router.get('/queue-status', async (req, res) => {
  try {
    const queue = await getQueue();

    const [activeCount, completedCount, failedCount] = await Promise.all([
      queue.getQueueSize('process-conversation-memory', 'active'),
      queue.getQueueSize('process-conversation-memory', 'completed'),
      queue.getQueueSize('process-conversation-memory', 'failed'),
    ]);

    res.json({
      queue: 'process-conversation-memory',
      active: activeCount,
      completed: completedCount,
      failed: failedCount,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to get queue status', message: errorMessage });
  }
});

/**
 * Get failed jobs for inspection
 */
router.get('/failed-jobs', async (req, res) => {
  try {
    const queue = await getQueue();

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
router.post('/retry/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const queue = await getQueue();

    await queue.resume(jobId);

    res.json({ success: true, message: `Job ${jobId} resumed` });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to retry job', message: errorMessage });
  }
});

/**
 * Get conversation extraction status
 */
router.get('/conversation/:id/extraction-status', async (req, res) => {
  try {
    const { id } = req.params;

    // Query PostgreSQL to check entities_extracted flag
    const { supabaseService } = await import('../db/supabase.js');
    const supabase = supabaseService.getClient();

    const { data: conversation, error } = await supabase
      .from('conversation')
      .select('entities_extracted, neo4j_synced_at')
      .eq('id', id)
      .single();

    if (error || !conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    res.json({
      conversationId: id,
      entitiesExtracted: conversation.entities_extracted,
      neo4jSyncedAt: conversation.neo4j_synced_at,
      status: conversation.entities_extracted ? 'completed' : 'pending/processing',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to get extraction status', message: errorMessage });
  }
});

export default router;
