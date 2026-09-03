/**
 * Pipeline Orchestration: Ingestion Service (Orchestrator)
 *
 * Wraps AI SDK agents and handles job processing for conversation memory extraction.
 *
 * Main workflow:
 * 1. Fetch conversation from PostgreSQL (transcript, summary, check if already processed)
 * 2. Skip if already processed (entities_extracted: true)
 * 3. Invoke ingestion orchestrator (extraction → resolution → merge/create agents)
 * 4. Mark conversation as processed (entities_extracted: true, neo4j_synced_at)
 *
 * Note: Embeddings are now generated during extraction phase (Phase 3), not post-processing.
 * Reference: /Users/silasrhyneer/Code/Cosmo/Saturn/backend/INGESTION_REFACTOR_PLAN_V2.md
 */

import { supabaseService } from '../db/supabase.js';
import {
  runIngestionPipeline,
  type IngestionPayload,
  type IngestionResult,
} from './ingestionOrchestratorService.js';
import { withSpan } from '../utils/tracing.js';
import { sourceManagementService } from './sourceManagementService.js';

type ProcessingStatus = 'queued' | 'processing' | 'completed' | 'failed';

/**
 * Process a source through the memory extraction pipeline
 *
 * Steps:
 * 1. Fetch source from PostgreSQL
 * 2. Check if already processed (skip if entities_extracted: true)
 * 3. Run ingestion orchestrator pipeline:
 *    - Content Normalization (cleanup content_raw → content_processed)
 *    - Entity Extraction (with embeddings generated during extraction)
 *    - Parallel Resolution (MERGE/CREATE agents)
 *    - Source node creation and mentions linking
 * 4. Mark source as processed (entities_extracted: true, neo4j_synced_at)
 *
 * @param sourceId - Source ID to process
 * @param userId - User ID for entity resolution
 * @throws Error if source not found or processing fails (triggers pg-boss retry)
 */
export async function processSource(
  sourceId: string,
  userId: string,
  attemptCount: number
): Promise<void> {
  return withSpan(
    'ingestion.process-source',
    {
      sourceId,
      userId,
    },
    async () => {
      console.log(`[IngestionService] Processing source ${sourceId} for user ${userId}`);

      // ============================================================================
      // Step 1: Fetch source from PostgreSQL
      // ============================================================================
      const supabase = supabaseService.getClient();

      const { data: source, error } = await supabase
        .from('source')
        .select(
          'id, user_id, source_type, content_raw, content_processed, summary, entities_extracted, neo4j_synced_at, created_at'
        )
        .eq('id', sourceId)
        .single();

      if (error) {
        throw new Error(`Failed to fetch source ${sourceId}: ${error.message}`);
      }

      if (!source) {
        throw new Error(`Source ${sourceId} not found`);
      }

      // Validate source data
      if (!source.content_raw) {
        throw new Error(
          `Source ${sourceId} missing required field: content_raw`
        );
      }

      // ============================================================================
      // Step 2: Check if already processed
      // ============================================================================
      if (source.entities_extracted) {
        console.log(
          `[IngestionService] Source ${sourceId} already processed (entities_extracted: true). Skipping.`
        );
        return;
      }

      await updateSourceProcessing(sourceId, attemptCount);

      // ============================================================================
      // Step 2b: Fetch display name from user_profiles
      // ============================================================================
      let displayName: string | null = null;
      {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('display_name')
          .eq('id', source.user_id)
          .maybeSingle();
        displayName = profile?.display_name ?? null;
      }

      // ============================================================================
      // Step 3: Run ingestion orchestrator pipeline
      // ============================================================================
      try {
        // Build IngestionPayload from Supabase fields
        const payload: IngestionPayload = {
          sourceId: source.id,
          userId: source.user_id,
          displayName,
          teamId: null, // team_id not in source schema, default to null
          sourceType: source.source_type,
          summary: source.summary || 'No summary',
          transcriptRaw: source.content_raw as string | string[], // Json type can be string or array
          transcriptProcessed: source.content_processed
            ? (source.content_processed as string[])
            : undefined,
          participants: [source.user_id], // Default to user_id (participants not in schema)
          createdAt: source.created_at || new Date().toISOString(),
          metadata: undefined, // metadata not in schema
        };

        // Run ingestion pipeline with phase-specific spans
        const result: IngestionResult = await runIngestionPipeline(payload);

        await sourceManagementService.markCompleted(sourceId);

        const { error: updateError } = await supabase
          .from('source')
          .update({
            entities_extracted: true,
            neo4j_synced_at: new Date().toISOString(),
            content_processed: result.contentProcessed,
            processing_status: 'completed',
            error_message: null,
          })
          .eq('id', sourceId);

        if (updateError) {
          throw new Error(`Failed to record completion for source ${sourceId}: ${updateError.message}`);
        }

        console.log(
          `[IngestionService] Successfully processed source ${sourceId}: ${result.extractedEntities.length} entities extracted, ${result.merges.length} merged, ${result.creations.length} created`
        );

        if (result.errors && result.errors.length > 0) {
          console.warn(
            `[IngestionService] Pipeline completed with ${result.errors.length} optional phase errors:`
          );
          result.errors.forEach(({ phase, message }) => {
            console.warn(`  ${phase}: ${message}`);
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(
          `[IngestionService] Failed to process source ${sourceId}: ${message}`
        );
        // Re-throw to trigger pg-boss retry
        throw new Error(`Ingestion pipeline failed for source ${sourceId}: ${message}`);
      }
    }
  );
}

async function updateSourceProcessing(sourceId: string, attemptCount: number): Promise<void> {
  const supabase = supabaseService.getClient();
  const { error } = await supabase
    .from('source')
    .update({
      processing_status: 'processing',
      error_message: null,
      attempt_count: attemptCount,
    })
    .eq('id', sourceId);

  if (error) {
    throw new Error(`Failed to mark source ${sourceId} processing: ${error.message}`);
  }
}

export async function markSourceQueued(sourceId: string): Promise<void> {
  const supabase = supabaseService.getClient();
  const { error } = await supabase
    .from('source')
    .update({ processing_status: 'queued', error_message: null })
    .eq('id', sourceId);

  if (error) {
    throw new Error(`Failed to mark source ${sourceId} queued: ${error.message}`);
  }

  try {
    await sourceManagementService.markQueued(sourceId);
  } catch (graphError) {
    const message = graphError instanceof Error ? graphError.message : String(graphError);
    console.error(
      `[IngestionService] PostgreSQL queued source ${sourceId}; Neo4j status will reconcile: ${message}`
    );
  }
}

export async function markSourceFailed(
  sourceId: string,
  errorMessage: string,
  attemptCount: number
): Promise<void> {
  const supabase = supabaseService.getClient();
  const { error } = await supabase
    .from('source')
    .update({
      processing_status: 'failed',
      error_message: errorMessage,
      attempt_count: attemptCount,
    })
    .eq('id', sourceId);

  if (error) {
    throw new Error(`Failed to persist terminal failure for source ${sourceId}: ${error.message}`);
  }

  try {
    await sourceManagementService.markFailed(sourceId, errorMessage);
  } catch (graphError) {
    const message = graphError instanceof Error ? graphError.message : String(graphError);
    console.error(
      `[IngestionService] PostgreSQL recorded failure for ${sourceId}; Neo4j status will reconcile: ${message}`
    );
  }
}

export async function reconcileSourceStatuses(): Promise<void> {
  const supabase = supabaseService.getClient();
  const { data: sources, error } = await supabase
    .from('source')
    .select('id, processing_status, error_message')
    .in('processing_status', ['queued', 'processing', 'completed', 'failed']);

  if (error) {
    throw new Error(`Failed to load source statuses for reconciliation: ${error.message}`);
  }

  for (const source of sources ?? []) {
    if (!source.processing_status) {
      continue;
    }
    if (!isProcessingStatus(source.processing_status)) {
      throw new Error(`Source ${source.id} has an invalid processing status`);
    }

    try {
      await sourceManagementService.updateProcessingStatus(
        source.id,
        source.processing_status,
        source.processing_status === 'failed'
          ? source.error_message ?? 'Ingestion failed without an error message'
          : null
      );
    } catch (graphError) {
      const message = graphError instanceof Error ? graphError.message : String(graphError);
      console.error(
        `[IngestionService] Neo4j status reconciliation failed for source ${source.id}: ${message}`
      );
    }
  }
}

function isProcessingStatus(value: string): value is ProcessingStatus {
  return value === 'queued' || value === 'processing' || value === 'completed' || value === 'failed';
}
