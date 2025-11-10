/**
 * pg-boss queue configuration for background job processing
 *
 * Uses PostgreSQL (Supabase) for job persistence - no Redis needed.
 * Handles async memory extraction pipeline: transcript → Neo4j graph updates
 */

import PgBoss from 'pg-boss';

// Queue names
export const QUEUE_NAMES = {
  PROCESS_CONVERSATION_MEMORY: 'process-conversation-memory',
} as const;

// Job data types
export interface ProcessConversationMemoryJobData {
  conversationId: string;
  userId: string;
}

/**
 * Initialize pg-boss instance
 *
 * Configuration:
 * - Uses existing Supabase PostgreSQL database
 * - Separate schema 'pgboss' for queue tables
 * - 3 retries with exponential backoff
 * - Jobs expire after 24 hours
 * - Archive completed jobs for 1 day, then delete after 7 days
 */
export function createQueue(): PgBoss {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required for pg-boss');
  }

  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema: 'pgboss',

    // Reliability
    retryLimit: 3, // Retry failed jobs up to 3 times
    retryDelay: 60, // Start with 60 second delay
    retryBackoff: true, // Exponential backoff (60s, 120s, 240s)
    expireInHours: 24, // Jobs expire if not completed in 24 hours

    // Performance
    newJobCheckInterval: 2000, // Check for new jobs every 2 seconds
    archiveCompletedAfterSeconds: 86400, // Archive completed jobs after 1 day

    // Monitoring & Maintenance
    maintenanceIntervalSeconds: 300, // Run maintenance every 5 minutes
    deleteAfterDays: 7, // Delete archived jobs after 7 days
  });

  // Error handling
  boss.on('error', (error) => {
    console.error('[pg-boss] Queue error:', error);
  });

  return boss;
}

// Singleton instance
let queueInstance: PgBoss | null = null;

/**
 * Get or create the queue instance
 */
export async function getQueue(): Promise<PgBoss> {
  if (!queueInstance) {
    queueInstance = createQueue();
    await queueInstance.start();
    console.log('✅ pg-boss queue started');
  }
  return queueInstance;
}

/**
 * Stop the queue (for graceful shutdown)
 */
export async function stopQueue(): Promise<void> {
  if (queueInstance) {
    await queueInstance.stop();
    queueInstance = null;
    console.log('✅ pg-boss queue stopped');
  }
}

/**
 * Enqueue a conversation for memory extraction
 */
export async function enqueueConversationProcessing(
  conversationId: string,
  userId: string
): Promise<string> {
  const queue = await getQueue();

  const jobId = await queue.send(
    QUEUE_NAMES.PROCESS_CONVERSATION_MEMORY,
    {
      conversationId,
      userId,
    } as ProcessConversationMemoryJobData,
    {
      // Optional: Add priority, delay, etc. here
      // priority: 10, // Higher number = higher priority
      // startAfter: new Date(Date.now() + 5000), // Delay 5 seconds
    }
  );

  if (!jobId) {
    throw new Error('Failed to enqueue conversation processing job');
  }

  console.log(`📝 Enqueued memory extraction for conversation ${conversationId} (job: ${jobId})`);

  return jobId;
}
