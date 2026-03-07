/**
 * Background worker process for processing source memory extraction jobs
 *
 * Run separately from API server: `npm run worker`
 *
 * Responsibilities:
 * - Consume jobs from pg-boss queue
 * - Run agent-based ingestion pipeline (AI SDK) for entity/relationship extraction
 * - Update Neo4j graph with extracted entities and relationships
 */

// Initialize OpenTelemetry tracing FIRST, before any other imports
import { initTracing } from './config/tracing.js';
initTracing();

import dotenv from 'dotenv';
dotenv.config({ override: true });
import {
  getQueue,
  stopQueue,
  QUEUE_NAMES,
  ProcessConversationMemoryJobData,
  ProcessInformationDumpJobData,
} from './queue/memoryQueue.js';
import { processSource } from './services/ingestionService.js';
import { runNightlyDecay } from './services/decayService.js';
import { runNightlyConsolidation } from './services/consolidationService.js';
import { runNightlyNoteCleanup } from './services/noteCleanupService.js';
import { neo4jService } from './db/neo4j.js';
import { withSpan } from './utils/tracing.js';

/**
 * Register job handlers and start worker
 */
async function startWorker() {
  console.log('🚀 Starting worker process...');

  try {
    // Connect to Neo4j (required for memory extraction)
    await neo4jService.connect();

    // Initialize pg-boss queue
    const queue = await getQueue();

    // Register handler for conversation memory processing
    await queue.work<ProcessConversationMemoryJobData>(
      QUEUE_NAMES.PROCESS_CONVERSATION_MEMORY,
      {
        batchSize: 5, // Process up to 5 jobs at a time
        pollingIntervalSeconds: 2, // Check for new jobs every 2 seconds
      },
      async (jobs) => {
        // Process jobs in parallel
        await Promise.all(
          jobs.map(async (job) => {
            const { conversationId, userId } = job.data;

            console.log(`\n[Job ${job.id}] Processing source ${conversationId}...`);

            // Wrap job execution with tracing span
            return withSpan(
              'worker.process-conversation',
              {
                conversationId,
                userId,
                jobId: job.id,
              },
              async () => {
                try {
                  await processSource(conversationId, userId);

                  console.log(`✅ [Job ${job.id}] Successfully processed source ${conversationId}`);
                } catch (error) {
                  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                  console.error(`❌ [Job ${job.id}] Failed to process source ${conversationId}:`, errorMessage);

                  // Rethrow to trigger pg-boss retry logic
                  throw error;
                }
              }
            );
          })
        );
      }
    );

    // Register handler for information dump processing (now uses unified processSource)
    await queue.work<ProcessInformationDumpJobData>(
      QUEUE_NAMES.PROCESS_INFORMATION_DUMP,
      {
        batchSize: 5, // Process up to 5 jobs at a time
        pollingIntervalSeconds: 2, // Check for new jobs every 2 seconds
      },
      async (jobs) => {
        // Process jobs in parallel
        await Promise.all(
          jobs.map(async (job) => {
            const { informationDumpId, userId } = job.data;

            console.log(`\n[Job ${job.id}] Processing source ${informationDumpId}...`);

            // Wrap job execution with tracing span
            return withSpan(
              'worker.process-information-dump',
              {
                sourceId: informationDumpId,
                userId,
                jobId: job.id,
              },
              async () => {
                try {
                  await processSource(informationDumpId, userId);

                  console.log(`✅ [Job ${job.id}] Successfully processed source ${informationDumpId}`);
                } catch (error) {
                  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                  console.error(`❌ [Job ${job.id}] Failed to process source ${informationDumpId}:`, errorMessage);

                  // Rethrow to trigger pg-boss retry logic
                  throw error;
                }
              }
            );
          })
        );
      }
    );

    // --- Nightly maintenance jobs ---
    await queue.schedule(QUEUE_NAMES.NIGHTLY_DECAY, '0 3 * * *', {}, { tz: 'UTC', singletonKey: 'nightly-decay' });
    await queue.schedule(QUEUE_NAMES.NIGHTLY_CONSOLIDATION, '30 3 * * *', {}, { tz: 'UTC', singletonKey: 'nightly-consolidation' });
    await queue.schedule(QUEUE_NAMES.NIGHTLY_NOTE_CLEANUP, '0 4 * * *', {}, { tz: 'UTC', singletonKey: 'nightly-note-cleanup' });

    await queue.work(
      QUEUE_NAMES.NIGHTLY_DECAY,
      { pollingIntervalSeconds: 60 },
      async () => {
        console.log('[Worker] Starting nightly decay job...');
        await runNightlyDecay();
        console.log('[Worker] Nightly decay job complete.');
      }
    );

    await queue.work(
      QUEUE_NAMES.NIGHTLY_CONSOLIDATION,
      { pollingIntervalSeconds: 60 },
      async () => {
        console.log('[Worker] Starting nightly consolidation job...');
        await runNightlyConsolidation();
        console.log('[Worker] Nightly consolidation job complete.');
      }
    );

    await queue.work(
      QUEUE_NAMES.NIGHTLY_NOTE_CLEANUP,
      { pollingIntervalSeconds: 60 },
      async () => {
        console.log('[Worker] Starting nightly note cleanup job...');
        await runNightlyNoteCleanup();
        console.log('[Worker] Nightly note cleanup job complete.');
      }
    );

    console.log('✅ Worker registered for queues:', QUEUE_NAMES.PROCESS_CONVERSATION_MEMORY, QUEUE_NAMES.PROCESS_INFORMATION_DUMP);
    console.log('Worker registered for nightly jobs: decay, consolidation, note-cleanup');
    console.log('👂 Listening for jobs...\n');
  } catch (error) {
    console.error('❌ Failed to start worker:', error);
    process.exit(1);
  }
}

/**
 * Graceful shutdown handler
 */
async function shutdown() {
  console.log('\n🛑 Shutting down worker...');

  try {
    await neo4jService.close();
    await stopQueue();
    console.log('✅ Worker shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught exception:', error);
  shutdown();
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled rejection:', reason);
  shutdown();
});

// Start the worker
startWorker();
