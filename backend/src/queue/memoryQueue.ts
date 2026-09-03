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
  NIGHTLY_DECAY: 'nightly-decay',
  NIGHTLY_CONSOLIDATION: 'nightly-consolidation',
  NIGHTLY_NOTE_CLEANUP: 'nightly-note-cleanup',
} as const;

export const INGESTION_QUEUE_NAMES = [
  QUEUE_NAMES.PROCESS_CONVERSATION_MEMORY,
  QUEUE_NAMES.PROCESS_INFORMATION_DUMP,
] as const;

const INGESTION_QUEUE_POLICY = {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  expireInSeconds: 3600,
  deleteAfterSeconds: 2592000,
} as const;

export interface FailedIngestionJob {
  id: string;
  queue: (typeof INGESTION_QUEUE_NAMES)[number];
  source_id: string;
  retry_count: number;
  retry_limit: number;
  completed_at: string | null;
  error_message: string;
}

export interface RetriedIngestionJob {
  queue: (typeof INGESTION_QUEUE_NAMES)[number];
  source_id: string;
}

// Job data types
export interface ProcessConversationMemoryJobData {
  conversationId: string;
  userId: string;
}

// Note: Information dumps now use the same queue as conversations
// Both are stored in the unified 'source' table and processed by processSource()
export interface ProcessInformationDumpJobData {
  informationDumpId: string; // sourceId in unified source table
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
      schedule: true, // Enable scheduled jobs for nightly maintenance
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
    await queueInstance.createQueue(
      QUEUE_NAMES.PROCESS_CONVERSATION_MEMORY,
      INGESTION_QUEUE_POLICY
    );
    await queueInstance.updateQueue(
      QUEUE_NAMES.PROCESS_CONVERSATION_MEMORY,
      INGESTION_QUEUE_POLICY
    );

    await queueInstance.createQueue(
      QUEUE_NAMES.PROCESS_INFORMATION_DUMP,
      INGESTION_QUEUE_POLICY
    );
    await queueInstance.updateQueue(
      QUEUE_NAMES.PROCESS_INFORMATION_DUMP,
      INGESTION_QUEUE_POLICY
    );

    await queueInstance.createQueue(QUEUE_NAMES.NIGHTLY_DECAY, {
      retryLimit: 2,
      retryDelay: 300,
      retryBackoff: true,
      expireInSeconds: 1800,
      deleteAfterSeconds: 86400,
    });

    await queueInstance.createQueue(QUEUE_NAMES.NIGHTLY_CONSOLIDATION, {
      retryLimit: 2,
      retryDelay: 300,
      retryBackoff: true,
      expireInSeconds: 7200,
      deleteAfterSeconds: 86400,
    });

    await queueInstance.createQueue(QUEUE_NAMES.NIGHTLY_NOTE_CLEANUP, {
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 300,
      deleteAfterSeconds: 86400,
    });

    console.log('✅ pg-boss queues started (conversation memory, information dumps, nightly jobs)');
  }
  return queueInstance;
}

/**
 * Stop the queue (for graceful shutdown)
 */
export async function listFailedIngestionJobs(limit?: number): Promise<FailedIngestionJob[]> {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('Failed-job limit must be a positive integer');
  }

  const queue = await getQueue();
  const result = await queue.getDb().executeSql(
    `
      SELECT id::text, name, data, retry_count, retry_limit, completed_on, output
      FROM pgboss.job
      WHERE name = ANY($1::text[]) AND state = 'failed'
      ORDER BY completed_on DESC
      ${limit === undefined ? '' : 'LIMIT $2'}
    `,
    limit === undefined ? [[...INGESTION_QUEUE_NAMES]] : [[...INGESTION_QUEUE_NAMES], limit]
  );
  const rows: unknown[] = result.rows;

  return rows.map((row) => mapFailedJob(row));
}

export async function retryFailedIngestionJob(jobId: string): Promise<RetriedIngestionJob> {
  const queue = await getQueue();

  for (const queueName of INGESTION_QUEUE_NAMES) {
    const job = await queue.getJobById(queueName, jobId);
    if (job?.state === 'failed') {
      const sourceId = sourceIdForQueue(queueName, job.data);
      await queue.retry(queueName, jobId);
      return { queue: queueName, source_id: sourceId };
    }
  }

  throw new Error(`Failed ingestion job ${jobId} not found`);
}

function mapFailedJob(value: unknown): FailedIngestionJob {
  if (!isRecord(value)) {
    throw new Error('pg-boss returned an invalid failed-job row');
  }

  const queue = value.name;
  if (!isIngestionQueueName(queue)) {
    throw new Error(`pg-boss returned an unexpected queue name: ${String(queue)}`);
  }

  return {
    id: requiredString(value.id, 'id'),
    queue,
    source_id: sourceIdForQueue(queue, value.data),
    retry_count: requiredNumber(value.retry_count, 'retry_count'),
    retry_limit: requiredNumber(value.retry_limit, 'retry_limit'),
    completed_at: value.completed_on instanceof Date
      ? value.completed_on.toISOString()
      : typeof value.completed_on === 'string'
        ? value.completed_on
        : null,
    error_message: extractErrorMessage(value.output),
  };
}

function sourceIdForQueue(
  queue: (typeof INGESTION_QUEUE_NAMES)[number],
  data: unknown
): string {
  if (!isRecord(data)) {
    throw new Error(`pg-boss ${queue} job has invalid data`);
  }

  const field = queue === QUEUE_NAMES.PROCESS_CONVERSATION_MEMORY
    ? 'conversationId'
    : 'informationDumpId';
  return requiredString(data[field], field);
}

function extractErrorMessage(value: unknown): string {
  if (isRecord(value) && isRecord(value.value) && typeof value.value.message === 'string') {
    return value.value.message;
  }
  if (isRecord(value) && typeof value.message === 'string') {
    return value.message;
  }
  return 'Unknown error';
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`pg-boss failed-job row has invalid ${field}`);
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') {
    throw new Error(`pg-boss failed-job row has invalid ${field}`);
  }
  return value;
}

function isIngestionQueueName(
  value: unknown
): value is (typeof INGESTION_QUEUE_NAMES)[number] {
  return INGESTION_QUEUE_NAMES.some((name) => name === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
