/**
 * pg-boss queue configuration for background job processing
 *
 * Uses PostgreSQL (Supabase) for job persistence - no Redis needed.
 * Handles async memory extraction pipeline: transcript → Neo4j graph updates
 */

import { PgBoss } from 'pg-boss';

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
 */
export function createQueue(): PgBoss {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required for pg-boss');
  }

  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema: 'pgboss',

    // Monitoring & Maintenance
    maintenanceIntervalSeconds: 300, // Run maintenance every 5 minutes
  });

  // Error handling
  boss.on('error', (error: Error) => {
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

    // Create queue with retry/expiration policies
    await queueInstance.createQueue(QUEUE_NAMES.PROCESS_CONVERSATION_MEMORY, {
      retryLimit: 3, // Retry failed jobs up to 3 times
      retryDelay: 60, // Start with 60 second delay
      retryBackoff: true, // Exponential backoff (60s, 120s, 240s)
      expireInSeconds: 86400, // Jobs expire if not completed in 24 hours
      deleteAfterSeconds: 604800, // Delete after 7 days
    });

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
  try {
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
      throw new Error('pg-boss returned null jobId - queue may not be properly initialized');
    }

    console.log(`📝 Enqueued memory extraction for conversation ${conversationId} (job: ${jobId})`);

    return jobId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[pg-boss] Failed to enqueue job:', errorMessage);
    throw new Error(`Failed to enqueue conversation processing job: ${errorMessage}`);
  }
}
