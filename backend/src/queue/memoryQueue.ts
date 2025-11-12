/**
 * pg-boss queue configuration for background job processing
 *
 * Uses dedicated PostgreSQL database for job persistence - no Redis needed.
 * Handles async memory extraction pipeline: transcript → Neo4j graph updates
 */

import { PgBoss } from 'pg-boss';

// Queue names
export const QUEUE_NAMES = {
  PROCESS_CONVERSATION_MEMORY: 'process-conversation-memory',
  PROCESS_INFORMATION_DUMP: 'process-information-dump',
} as const;

// Job data types
export interface ProcessConversationMemoryJobData {
  conversationId: string;
  userId: string;
}

export interface ProcessInformationDumpJobData {
  informationDumpId: string;
  userId: string;
}

// Singleton instance
let queueInstance: PgBoss | null = null;

/**
 * Get or create the queue instance
 */
export async function getQueue(): Promise<PgBoss> {
  if (!queueInstance) {
    // Use dedicated database for pg-boss queue
    // Falls back to DATABASE_URL if PGBOSS_DATABASE_URL not set
    const queueDatabaseUrl = process.env.PGBOSS_DATABASE_URL || process.env.DATABASE_URL;

    if (!queueDatabaseUrl) {
      throw new Error('PGBOSS_DATABASE_URL or DATABASE_URL environment variable is required for pg-boss');
    }

    console.log('🔧 Initializing pg-boss with dedicated database connection...');

    const boss = new PgBoss({
      connectionString: queueDatabaseUrl,
      schema: 'pgboss',

      // Connection pool - limit to reduce idle connections that timeout
      max: 3, // Smaller pool for Railway's network (default is 10)
      application_name: 'pgboss',

      // Configuration
      schedule: false, // Keep disabled - not using scheduled jobs in MVP
      supervise: true, // Enable supervisor for automatic recovery
      superviseIntervalSeconds: 60, // Check supervisor every 60s (default 30s)

      // Monitoring & Maintenance - reduce frequency to minimize connection usage
      maintenanceIntervalSeconds: 300, // Run maintenance every 5 minutes
      monitorIntervalSeconds: 120, // Monitor every 2 minutes (default 60s)
    });

    // Error handling
    boss.on('error', (error: Error) => {
      // Log the error but don't crash - pg-boss will attempt to reconnect
      if ('code' in error && error.code === 'ETIMEDOUT') {
        console.warn('[pg-boss] Connection timeout - will retry automatically');
      } else {
        console.error('[pg-boss] Queue error:', error);
      }
    });

    queueInstance = boss;
    await queueInstance.start();

    // Create queues with retry/expiration policies
    await queueInstance.createQueue(QUEUE_NAMES.PROCESS_CONVERSATION_MEMORY, {
      retryLimit: 3, // Retry failed jobs up to 3 times
      retryDelay: 60, // Start with 60 second delay
      retryBackoff: true, // Exponential backoff (60s, 120s, 240s)
      expireInSeconds: 3600, // Jobs expire if not completed in 1 hour
      deleteAfterSeconds: 86400, // Delete after 24 hours
    });

    await queueInstance.createQueue(QUEUE_NAMES.PROCESS_INFORMATION_DUMP, {
      retryLimit: 3, // Retry failed jobs up to 3 times
      retryDelay: 60, // Start with 60 second delay
      retryBackoff: true, // Exponential backoff (60s, 120s, 240s)
      expireInSeconds: 3600, // Jobs expire if not completed in 1 hour
      deleteAfterSeconds: 86400, // Delete after 24 hours
    });

    console.log('✅ pg-boss queues started (conversation memory, information dumps)');
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

/**
 * Enqueue an information dump for processing
 */
export async function enqueueInformationDumpProcessing(
  informationDumpId: string,
  userId: string
): Promise<string> {
  try {
    const queue = await getQueue();

    const jobId = await queue.send(
      QUEUE_NAMES.PROCESS_INFORMATION_DUMP,
      {
        informationDumpId,
        userId,
      } as ProcessInformationDumpJobData,
      {
        // Optional: Add priority, delay, etc. here
        // priority: 10, // Higher number = higher priority
        // startAfter: new Date(Date.now() + 5000), // Delay 5 seconds
      }
    );

    if (!jobId) {
      throw new Error('pg-boss returned null jobId - queue may not be properly initialized');
    }

    console.log(`📝 Enqueued information dump processing for ${informationDumpId} (job: ${jobId})`);

    return jobId;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[pg-boss] Failed to enqueue information dump job:', errorMessage);
    throw new Error(`Failed to enqueue information dump processing job: ${errorMessage}`);
  }
}
