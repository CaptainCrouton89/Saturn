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

/**
 * Process a conversation through the memory extraction pipeline
 *
 * Steps:
 * 1. Fetch conversation from PostgreSQL
 * 2. Check if already processed (skip if entities_extracted: true)
 * 3. Run ingestion agent (extract entities, create Source node, update relationships)
 * 4. Generate embeddings for new Concepts/Entities
 * 5. Update Neo4j with embeddings
 * 6. Mark conversation as processed
 *
 * @param conversationId - Conversation ID to process
 * @param userId - User ID for entity resolution
 * @throws Error if conversation not found or processing fails (triggers pg-boss retry)
 */
export async function processConversation(
  conversationId: string,
  userId: string
): Promise<void> {
  console.log(`[IngestionService] Processing conversation ${conversationId} for user ${userId}`);

  // ============================================================================
  // Step 1: Fetch conversation from PostgreSQL
  // ============================================================================
  const supabase = supabaseService.getClient();

  const { data: conversation, error } = await supabase
    .from('conversation')
    .select('id, user_id, transcript, summary, entities_extracted, neo4j_synced_at')
    .eq('id', conversationId)
    .single();

  if (error || !conversation) {
    const errorMessage = error?.message || 'Conversation not found';
    throw new Error(`Failed to fetch conversation ${conversationId}: ${errorMessage}`);
  }

  // Validate conversation data
  if (!conversation.transcript || !conversation.summary) {
    throw new Error(
      `Conversation ${conversationId} missing required fields (transcript or summary)`
    );
  }

  // ============================================================================
  // Step 2: Check if already processed
  // ============================================================================
  if (conversation.entities_extracted) {
    console.log(
      `[IngestionService] Conversation ${conversationId} already processed (entities_extracted: true). Skipping.`
    );
    return;
  }

  // ============================================================================
  // Step 3: Save raw transcript and convert to string format for ingestion agent
  // ============================================================================
  // The transcript is stored as JSON array of conversation turns
  // Convert to plain text format for LLM processing
  const transcriptArray = conversation.transcript as Array<{
    speaker: string;
    message: string;
    timestamp?: string;
  }>;

  const transcriptText = transcriptArray
    .map((turn) => `${turn.speaker}: ${turn.message}`)
    .join('\n\n');

  // Save raw transcript before processing (will be converted to notes for STT sources)
  console.log(`[IngestionService] Saving raw transcript to transcript_raw...`);
  const { error: rawSaveError } = await supabase
    .from('conversation')
    .update({ transcript_raw: conversation.transcript })
    .eq('id', conversationId);

  if (rawSaveError) {
    console.error(`[IngestionService] Failed to save raw transcript: ${rawSaveError.message}`);
    // Don't throw - this is non-critical, continue with processing
  }

  // ============================================================================
  // Step 4: Run ingestion agent (4-phase LangGraph workflow)
  // ============================================================================
  console.log(`[IngestionService] Running ingestion agent for conversation ${conversationId}...`);

  let sourceEntityKey: string;
  let processedTranscript: string;
  try {
    const result = await runIngestionAgent(conversationId, userId, transcriptText, conversation.summary, 'conversation');
    sourceEntityKey = result.sourceEntityKey;
    processedTranscript = result.processedTranscript;
    console.log(`[IngestionService] Ingestion agent completed for conversation ${conversationId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[IngestionService] Ingestion agent failed: ${errorMessage}`);
    throw new Error(`Ingestion agent failed for conversation ${conversationId}: ${errorMessage}`);
  }

  // ============================================================================
  // Step 4b: Save processed transcript (may be structured notes for STT sources)
  // ============================================================================
  if (processedTranscript !== transcriptText) {
    console.log(`[IngestionService] Saving processed transcript (transcript was transformed)...`);

    // Convert back to JSON array format for consistency
    // For notes format, each bullet becomes a turn
    const processedArray = processedTranscript
      .split('\n')
      .filter(line => line.trim().startsWith('- '))
      .map((line) => ({
        speaker: 'note',
        message: line.trim().substring(2), // Remove "- " prefix
        timestamp: undefined,
      }));

    const { error: processedSaveError } = await supabase
      .from('conversation')
      .update({ transcript: processedArray })
      .eq('id', conversationId);

    if (processedSaveError) {
      console.error(`[IngestionService] Failed to save processed transcript: ${processedSaveError.message}`);
      // Don't throw - original transcript is still in place
    } else {
      console.log(`[IngestionService] Processed transcript saved (${processedArray.length} notes)`);
    }
  }

  // ============================================================================
  // Step 4b: Create Source→mentions edges for all touched entities
  // ============================================================================
  console.log(`[IngestionService] Creating Source→mentions edges for conversation ${conversationId}...`);

  try {
    // Query Neo4j for all nodes created/updated by this conversation
    const touchedNodesQuery = `
      MATCH (n)
      WHERE n.last_update_source = $conversationId
        AND (n:Person OR n:Concept OR n:Entity)
      RETURN labels(n)[0] as nodeType, n.entity_key as entityKey
    `;

    interface TouchedNode {
      nodeType: 'Person' | 'Concept' | 'Entity';
      entityKey: string;
    }

    const touchedNodes = await neo4jService.executeQuery<TouchedNode>(touchedNodesQuery, {
      conversationId,
    });

    if (touchedNodes.length > 0) {
      const { sourceRepository } = await import('../repositories/SourceRepository.js');
      const entityLinks = touchedNodes.map((node) => ({
        type: node.nodeType,
        entity_key: node.entityKey,
      }));

      await sourceRepository.linkToEntities(sourceEntityKey, entityLinks);
      console.log(`[IngestionService] Created ${entityLinks.length} Source→Entity mention edges`);
    } else {
      console.log(`[IngestionService] No entities to link for conversation ${conversationId}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[IngestionService] Failed to create Source→mentions edges: ${errorMessage}`);
    // Don't throw - this is non-critical
  }

  // ============================================================================
  // Step 5: Generate embeddings for new Concepts/Entities
  // ============================================================================
  console.log(
    `[IngestionService] Generating embeddings for new entities from conversation ${conversationId}...`
  );

  try {
    // Query Neo4j for nodes created/updated by this conversation
    const newNodesQuery = `
      MATCH (n)
      WHERE n.last_update_source = $conversationId
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
      conversationId,
    });

    if (newNodes.length === 0) {
      console.log(
        `[IngestionService] No new Concepts/Entities found for conversation ${conversationId}`
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
          last_update_source: conversationId,
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
  // Step 6: Mark conversation as processed
  // ============================================================================
  console.log(`[IngestionService] Marking conversation ${conversationId} as processed...`);

  const { error: updateError } = await supabase
    .from('conversation')
    .update({
      entities_extracted: true,
      neo4j_synced_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  if (updateError) {
    throw new Error(
      `Failed to mark conversation ${conversationId} as processed: ${updateError.message}`
    );
  }

  console.log(`[IngestionService] ✅ Successfully processed conversation ${conversationId}`);
}
