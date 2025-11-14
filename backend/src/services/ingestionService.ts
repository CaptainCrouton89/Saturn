/**
 * Phase 5: Ingestion Service (Orchestrator)
 *
 * Wraps LangGraph agent and handles job processing for conversation memory extraction.
 *
 * Main workflow:
 * 1. Fetch conversation from PostgreSQL (transcript, summary, check if already processed)
 * 2. Skip if already processed (entities_extracted: true)
 * 3. Invoke runIngestionAgent (3-phase LangGraph workflow)
 * 4. Generate embeddings for new Concepts/Entities
 * 5. Mark conversation as processed (entities_extracted: true, neo4j_synced_at)
 *
 * Reference: /Users/silasrhyneer/Code/Cosmo/Saturn/backend/INGESTION_REFACTOR_PLAN.md (lines 189-219)
 */

import { supabaseService } from '../db/supabase.js';
import { neo4jService } from '../db/neo4j.js';
import { runIngestionAgent } from '../agents/ingestionAgent.js';
import { embeddingGenerationService, EntityUpdate } from './embeddingGenerationService.js';
import { ConversationTurn, SttTurn } from '../types/dto.js';
import { NoteObject } from '../types/graph.js';

/**
 * Process a source through the memory extraction pipeline
 *
 * Steps:
 * 1. Fetch source from PostgreSQL
 * 2. Check if already processed (skip if entities_extracted: true)
 * 3. Run ingestion agent Phase 0 (cleanup content_raw → content_processed)
 * 4. Run ingestion agent Phases 1-3 (extract entities, create Source node, update relationships)
 * 5. Generate embeddings for new Concepts/Entities
 * 6. Update Neo4j with embeddings
 * 7. Mark source as processed
 *
 * @param sourceId - Source ID to process
 * @param userId - User ID for entity resolution
 * @throws Error if source not found or processing fails (triggers pg-boss retry)
 */
export async function processSource(
  sourceId: string,
  userId: string
): Promise<void> {
  console.log(`[IngestionService] Processing source ${sourceId} for user ${userId}`);

  // ============================================================================
  // Step 1: Fetch source from PostgreSQL
  // ============================================================================
  const supabase = supabaseService.getClient();

  const { data: source, error } = await supabase
    .from('source')
    .select('id, user_id, source_type, content_raw, content_processed, summary, entities_extracted, neo4j_synced_at')
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
  // Step 3: Run ingestion agent (includes Phase 0 cleanup + entity extraction)
  // ============================================================================
  console.log(`[IngestionService] Running ingestion agent for source ${sourceId}...`);

  let sourceEntityKey: string;
  let contentProcessed: string[];
  try {
    const result = await runIngestionAgent(
      sourceId,
      userId,
      source.content_raw as unknown as ConversationTurn[] | SttTurn[] | string,
      source.summary,
      source.source_type as 'conversation' | 'information_dump' | 'stt' | 'document'
    );
    sourceEntityKey = result.sourceEntityKey;
    contentProcessed = result.contentProcessed;
    console.log(`[IngestionService] Ingestion agent completed for source ${sourceId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[IngestionService] Ingestion agent failed: ${errorMessage}`);
    throw new Error(`Ingestion agent failed for source ${sourceId}: ${errorMessage}`);
  }

  // ============================================================================
  // Step 4: Save processed content (structured bullet points from Phase 0)
  // ============================================================================
  console.log(`[IngestionService] Saving processed content (${contentProcessed.length} bullet points)...`);

  const { error: processedSaveError } = await supabase
    .from('source')
    .update({ content_processed: contentProcessed })
    .eq('id', sourceId);

  if (processedSaveError) {
    console.error(`[IngestionService] Failed to save processed content: ${processedSaveError.message}`);
    // Don't throw - non-critical, continue with entity extraction
  }

  // ============================================================================
  // Step 5: Create Source→mentions edges for all touched entities
  // ============================================================================
  console.log(`[IngestionService] Creating Source→mentions edges for source ${sourceId}...`);

  try {
    // Query Neo4j for all nodes created/updated by this source
    const touchedNodesQuery = `
      MATCH (n)
      WHERE n.last_update_source = $sourceId
        AND (n:Person OR n:Concept OR n:Entity)
      RETURN labels(n)[0] as nodeType, n.entity_key as entityKey
    `;

    interface TouchedNode {
      nodeType: 'Person' | 'Concept' | 'Entity';
      entityKey: string;
    }

    const touchedNodes = await neo4jService.executeQuery<TouchedNode>(touchedNodesQuery, {
      sourceId,
    });

    if (touchedNodes.length > 0) {
      const { sourceRepository } = await import('../repositories/SourceRepository.js');
      const entityKeys = touchedNodes.map((node) => node.entityKey);

      await sourceRepository.linkToEntities(sourceEntityKey, entityKeys);
      console.log(`[IngestionService] Created ${entityKeys.length} Source→Entity mention edges`);
    } else {
      console.log(`[IngestionService] No entities to link for source ${sourceId}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[IngestionService] Failed to create Source→mentions edges: ${errorMessage}`);
    // Don't throw - this is non-critical
  }

  // ============================================================================
  // Step 6: Generate embeddings for new Concepts/Entities
  // ============================================================================
  console.log(
    `[IngestionService] Generating embeddings for new entities from source ${sourceId}...`
  );

  try {
    // Query Neo4j for nodes created/updated by this source
    const newNodesQuery = `
      MATCH (n)
      WHERE n.last_update_source = $sourceId
        AND (n:Concept OR n:Entity)
      RETURN
        n.entity_key as entityKey,
        labels(n)[0] as entityType,
        n.name as name,
        n.description as description,
        n.notes as notes
    `;

    interface NewNodeResult {
      entityKey: string;
      entityType: 'Concept' | 'Entity';
      name: string;
      description?: string;
      notes?: NoteObject[];
    }

    const newNodes = await neo4jService.executeQuery<NewNodeResult>(newNodesQuery, {
      sourceId,
    });

    if (newNodes.length === 0) {
      console.log(
        `[IngestionService] No new Concepts/Entities found for source ${sourceId}`
      );
    } else {
      console.log(
        `[IngestionService] Found ${newNodes.length} new entities requiring embeddings`
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
          last_update_source: sourceId,
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
          `[IngestionService] Updated ${embeddingUpdates.length} entities with embeddings`
        );
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[IngestionService] Embedding generation failed: ${errorMessage}`);
    // Don't throw - embeddings are nice-to-have, not critical
    // The conversation will still be marked as processed
  }

  // ============================================================================
  // Step 7: Mark source as processed
  // ============================================================================
  console.log(`[IngestionService] Marking source ${sourceId} as processed...`);

  const { error: updateError } = await supabase
    .from('source')
    .update({
      entities_extracted: true,
      neo4j_synced_at: new Date().toISOString(),
    })
    .eq('id', sourceId);

  if (updateError) {
    throw new Error(
      `Failed to mark source ${sourceId} as processed: ${updateError.message}`
    );
  }

  console.log(`[IngestionService] ✅ Successfully processed source ${sourceId}`);
}
