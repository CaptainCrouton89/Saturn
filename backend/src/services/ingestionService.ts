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
 * Note: Embeddings are now generated during extraction phase (Phase 1), not post-processing.
 * Reference: /Users/silasrhyneer/Code/Cosmo/Saturn/backend/INGESTION_REFACTOR_PLAN_V2.md
 */

import { supabaseService } from '../db/supabase.js';
import {
  runIngestionPipeline,
  type IngestionPayload,
  type IngestionResult,
} from './ingestionOrchestratorService.js';
import { withSpan } from '../utils/tracing.js';

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
  userId: string
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

      // ============================================================================
      // Step 3: Run ingestion orchestrator pipeline
      // ============================================================================
      try {
        // Build IngestionPayload from Supabase fields
        const payload: IngestionPayload = {
          sourceId: source.id,
          userId: source.user_id,
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

        // Update Supabase with processing results
        const { error: updateError } = await supabase
          .from('source')
          .update({
            entities_extracted: true,
            neo4j_synced_at: new Date().toISOString(),
            content_processed: result.contentProcessed, // Update with normalized content
          })
          .eq('id', sourceId);

        if (updateError) {
          console.error(
            `[IngestionService] Failed to update source ${sourceId}: ${updateError.message}`
          );
          // Don't throw - pipeline succeeded, update failure is non-critical
        }

        console.log(
          `[IngestionService] Successfully processed source ${sourceId}: ${result.extractedEntities.length} entities extracted, ${result.merges.length} merged, ${result.creations.length} created`
        );

        // Log any errors from best-effort phases
        if (result.errors && result.errors.length > 0) {
          console.warn(
            `[IngestionService] Pipeline completed with ${result.errors.length} phase errors:`
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
