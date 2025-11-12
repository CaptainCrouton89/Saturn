/**
 * Information Dump Processing Service
 *
 * Wraps LangGraph ingestion agent and handles job processing for information dump entity extraction.
 *
 * Main workflow:
 * 1. Fetch information dump from PostgreSQL
 * 2. Check processing_status - skip if 'completed' or entities_extracted: true (idempotency)
 * 3. Update status to 'processing'
 * 4. Invoke runIngestionAgent with dump content (3-phase LangGraph workflow)
 * 5. Generate embeddings for new Concepts/Entities
 * 6. Update dump status to 'completed' and mark entities_extracted: true
 * 7. On error: Set status to 'failed' with error_message
 *
 * Follows pattern from ingestionService.ts for conversation processing.
 */

import { supabaseService } from '../db/supabase.js';
import { neo4jService } from '../db/neo4j.js';
import { runIngestionAgent } from '../agents/ingestionAgent.js';
import { embeddingGenerationService, EntityUpdate } from './embeddingGenerationService.js';

/**
 * Process an information dump through the memory extraction pipeline
 *
 * Steps:
 * 1. Fetch information dump from PostgreSQL
 * 2. Check if already processed (skip if entities_extracted: true or status: 'completed')
 * 3. Update status to 'processing'
 * 4. Run ingestion agent (extract entities, create Source node, update relationships)
 * 5. Generate embeddings for new Concepts/Entities
 * 6. Update Neo4j with embeddings
 * 7. Mark dump as processed (status: 'completed', entities_extracted: true)
 *
 * @param dumpId - Information dump ID to process
 * @param userId - User ID for entity resolution
 * @throws Error if dump not found or processing fails (triggers pg-boss retry)
 */
export async function processInformationDump(
  dumpId: string,
  userId: string
): Promise<void> {
  console.log(`[InformationDumpService] Processing dump ${dumpId} for user ${userId}`);

  // ============================================================================
  // Step 1: Fetch information dump from PostgreSQL
  // ============================================================================
  const supabase = supabaseService.getClient();

  const { data: dump, error } = await supabase
    .from('information_dump')
    .select('id, user_id, title, label, content, processing_status, entities_extracted, neo4j_synced_at')
    .eq('id', dumpId)
    .single();

  if (error || !dump) {
    const errorMessage = error?.message || 'Information dump not found';
    throw new Error(`Failed to fetch information dump ${dumpId}: ${errorMessage}`);
  }

  // Validate dump data
  if (!dump.content) {
    throw new Error(`Information dump ${dumpId} missing required field: content`);
  }

  // ============================================================================
  // Step 2: Check if already processed (idempotency)
  // ============================================================================
  if (dump.processing_status === 'completed' || dump.entities_extracted) {
    console.log(
      `[InformationDumpService] Dump ${dumpId} already processed (status: ${dump.processing_status}, entities_extracted: ${dump.entities_extracted}). Skipping.`
    );
    return;
  }

  // ============================================================================
  // Step 3: Update status to 'processing'
  // ============================================================================
  console.log(`[InformationDumpService] Updating dump ${dumpId} status to 'processing'...`);

  const { error: statusUpdateError } = await supabase
    .from('information_dump')
    .update({
      processing_status: 'processing',
      error_message: null, // Clear any previous error
    })
    .eq('id', dumpId);

  if (statusUpdateError) {
    throw new Error(
      `Failed to update dump ${dumpId} status to 'processing': ${statusUpdateError.message}`
    );
  }

  try {
    // ============================================================================
    // Step 4: Convert dump content to text format for ingestion agent
    // ============================================================================
    // Information dumps are plain text, but we'll structure them with title/label for context
    const contentWithContext = [
      dump.title && `Title: ${dump.title}`,
      dump.label && `Description: ${dump.label}`,
      '',
      dump.content,
    ]
      .filter(Boolean)
      .join('\n');

    // Generate a summary from title and label (if label exists, use it; otherwise create from title + content)
    const summary = dump.label
      ? dump.label
      : `${dump.title}: ${dump.content.substring(0, 100)}${dump.content.length > 100 ? '...' : ''}`;

    // ============================================================================
    // Step 5: Run ingestion agent (3-phase LangGraph workflow)
    // ============================================================================
    console.log(`[InformationDumpService] Running ingestion agent for dump ${dumpId}...`);

    await runIngestionAgent(dumpId, userId, contentWithContext, summary);
    console.log(`[InformationDumpService] Ingestion agent completed for dump ${dumpId}`);

    // ============================================================================
    // Step 6: Generate embeddings for new Concepts/Entities
    // ============================================================================
    console.log(
      `[InformationDumpService] Generating embeddings for new entities from dump ${dumpId}...`
    );

    try {
      // Query Neo4j for nodes created/updated by this dump
      const newNodesQuery = `
        MATCH (n)
        WHERE n.last_update_source = $dumpId
          AND (n:Concept OR n:Entity)
        RETURN
          n.entity_key as entityKey,
          labels(n)[0] as entityType,
          n.name as name,
          n.description as description,
          n.notes as notes,
          n.type as subtype
      `;

      interface NewNodeResult {
        entityKey: string;
        entityType: 'Concept' | 'Entity';
        name: string;
        description?: string;
        notes?: string;
        subtype?: string;
      }

      const newNodes = await neo4jService.executeQuery<NewNodeResult>(newNodesQuery, {
        dumpId,
      });

      if (newNodes.length === 0) {
        console.log(
          `[InformationDumpService] No new Concepts/Entities found for dump ${dumpId}`
        );
      } else {
        console.log(
          `[InformationDumpService] Found ${newNodes.length} new entities requiring embeddings`
        );

        // Convert Neo4j results to EntityUpdate format for embeddingGenerationService
        const entityUpdates: EntityUpdate[] = newNodes.map((node) => {
          // Build nodeUpdates object with only defined properties
          const nodeUpdates: Record<string, unknown> = {
            name: node.name,
          };

          if (node.description !== undefined && node.description !== null) {
            nodeUpdates.description = node.description;
          }

          if (node.notes !== undefined && node.notes !== null) {
            nodeUpdates.notes = node.notes;
          }

          if (node.subtype !== undefined && node.subtype !== null) {
            nodeUpdates.type = node.subtype;
          }

          return {
            entityId: node.entityKey,
            entityType: node.entityType,
            entityKey: node.entityKey,
            isNew: true,
            newEntityData: {
              name: node.name,
            },
            nodeUpdates,
            relationshipUpdates: {},
            last_update_source: dumpId,
            confidence: 1.0,
          };
        });

        // Generate embeddings
        const embeddingUpdates = await embeddingGenerationService.generate(entityUpdates);

        if (embeddingUpdates.length > 0) {
          // Update Neo4j with embeddings via batch Cypher query
          const updateEmbeddingsQuery = `
            UNWIND $updates as update
            MATCH (n {entity_key: update.entityKey})
            SET n.embedding = update.embedding,
                n.updated_at = datetime()
          `;

          const updates = embeddingUpdates.map((e) => ({
            entityKey: e.entityId,
            embedding: e.embedding,
          }));

          await neo4jService.executeQuery(updateEmbeddingsQuery, { updates });

          console.log(
            `[InformationDumpService] Updated ${embeddingUpdates.length} entities with embeddings`
          );
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[InformationDumpService] Embedding generation failed: ${errorMessage}`);
      // Don't throw - embeddings are nice-to-have, not critical
      // The dump will still be marked as processed
    }

    // ============================================================================
    // Step 7: Mark dump as processed (status: 'completed')
    // ============================================================================
    console.log(`[InformationDumpService] Marking dump ${dumpId} as completed...`);

    const { error: updateError } = await supabase
      .from('information_dump')
      .update({
        processing_status: 'completed',
        entities_extracted: true,
        neo4j_synced_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', dumpId);

    if (updateError) {
      throw new Error(`Failed to mark dump ${dumpId} as completed: ${updateError.message}`);
    }

    console.log(`[InformationDumpService] ✅ Successfully processed information dump ${dumpId}`);
  } catch (error) {
    // ============================================================================
    // Error Handling: Update status to 'failed' with error message
    // ============================================================================
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[InformationDumpService] Processing failed for dump ${dumpId}: ${errorMessage}`);

    const { error: failUpdateError } = await supabase
      .from('information_dump')
      .update({
        processing_status: 'failed',
        error_message: errorMessage,
      })
      .eq('id', dumpId);

    if (failUpdateError) {
      console.error(
        `[InformationDumpService] Failed to update error status for dump ${dumpId}: ${failUpdateError.message}`
      );
    }

    // Re-throw error to trigger pg-boss retry
    throw error;
  }
}
