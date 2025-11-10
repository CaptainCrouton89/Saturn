/**
 * Memory Extraction Service (Orchestrator)
 *
 * Coordinates the 7-phase pipeline for converting conversation transcripts
 * into structured Neo4j graph updates.
 *
 * Pipeline:
 * Phase 1: Entity Identification
 * Phase 2: Entity Resolution
 * Phase 3: Entity Updates
 * Phase 4: Conversation Summary (already generated in endConversation)
 * Phase 5: Relationship Scoring
 * Phase 6: Embedding Generation
 * Phase 7: Neo4j Transaction Execution
 */

import { supabaseService } from '../db/supabase.js';
import { entityIdentificationService } from './entityIdentificationService.js';
import { entityResolutionService } from './entityResolutionService.js';
import { entityUpdateService } from './entityUpdateService.js';
import { relationshipUpdateService } from './relationshipUpdateService.js';
import { embeddingGenerationService } from './embeddingGenerationService.js';
import { neo4jTransactionService } from './neo4jTransactionService.js';
import type { SerializedMessage } from '../agents/types/messages.js';

class MemoryExtractionService {
  /**
   * Process a single conversation through the full pipeline
   */
  async processConversation(conversationId: string, userId: string): Promise<void> {
    const startTime = Date.now();

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🧠 Memory Extraction Pipeline`);
    console.log(`   Conversation: ${conversationId}`);
    console.log(`   User: ${userId}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    try {
      // Fetch conversation from PostgreSQL
      const { transcript, summary } = await this.fetchConversation(conversationId);

      if (!transcript || transcript.length === 0) {
        console.log('⚠️  Empty transcript, skipping extraction');
        return;
      }

      // Phase 1: Entity Identification
      console.log('📍 Phase 1: Entity Identification');
      const identifiedEntities = await entityIdentificationService.identify(transcript, userId);

      const totalEntities =
        identifiedEntities.people.length +
        identifiedEntities.projects.length +
        identifiedEntities.ideas.length +
        identifiedEntities.topics.length;

      if (totalEntities === 0) {
        console.log('⚠️  No entities identified, skipping extraction');
        // Still mark as processed
        await this.markAsProcessedNoEntities(conversationId);
        return;
      }

      // Phase 2: Entity Resolution
      console.log('\n📍 Phase 2: Entity Resolution');
      const resolvedEntities = await entityResolutionService.resolve(identifiedEntities, userId);

      // Phase 3: Entity Updates
      console.log('\n📍 Phase 3: Entity Updates');
      const entityUpdates = await entityUpdateService.generateUpdates(
        transcript,
        resolvedEntities,
        conversationId
      );

      // Phase 4: Summary already generated in endConversation
      console.log('\n📍 Phase 4: Summary (already generated)');
      console.log(`   Summary: ${summary?.substring(0, 80)}...`);

      // Phase 5: Relationship Scoring
      console.log('\n📍 Phase 5: Relationship Scoring');
      const relationships = await relationshipUpdateService.scoreRelationships(
        transcript,
        entityUpdates,
        conversationId,
        userId
      );

      // Phase 6: Embedding Generation
      console.log('\n📍 Phase 6: Embedding Generation');
      const embeddings = await embeddingGenerationService.generate(entityUpdates);

      // Phase 7: Neo4j Transaction Execution
      console.log('\n📍 Phase 7: Neo4j Transaction');
      await neo4jTransactionService.execute({
        conversationId,
        userId,
        entities: entityUpdates,
        summary,
        relationships,
        embeddings,
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`✅ Memory extraction complete in ${duration}s`);
      console.log(`   Entities: ${totalEntities} (${entityUpdates.filter(e => e.isNew).length} new)`);
      console.log(`   User relationships: ${relationships.userRelationships.length}`);
      console.log(`   Conversation relationships: ${relationships.conversationRelationships.length}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      console.error(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.error(`❌ Memory extraction failed after ${duration}s`);
      console.error(`   Error: ${errorMessage}`);
      console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      // Mark conversation with extraction error
      await this.markAsProcessedWithError(conversationId, errorMessage);

      // Rethrow to trigger pg-boss retry
      throw error;
    }
  }

  /**
   * Fetch conversation transcript and summary from PostgreSQL
   */
  private async fetchConversation(
    conversationId: string
  ): Promise<{ transcript: SerializedMessage[]; summary: string | null }> {
    const supabase = supabaseService.getClient();

    const { data: conversation, error } = await supabase
      .from('conversation')
      .select('transcript, summary')
      .eq('id', conversationId)
      .single();

    if (error || !conversation) {
      throw new Error(`Failed to fetch conversation ${conversationId}: ${error?.message || 'not found'}`);
    }

    return {
      transcript: (conversation.transcript as unknown as SerializedMessage[]) || [],
      summary: conversation.summary,
    };
  }

  /**
   * Mark conversation as processed (no entities found)
   */
  private async markAsProcessedNoEntities(conversationId: string): Promise<void> {
    const supabase = supabaseService.getClient();

    const { error } = await supabase
      .from('conversation')
      .update({
        entities_extracted: true,
        neo4j_synced_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    if (error) {
      console.error(`Failed to mark conversation as processed: ${error.message}`);
    }
  }

  /**
   * Mark conversation with extraction error (for debugging/retry)
   */
  private async markAsProcessedWithError(conversationId: string, _errorMessage: string): Promise<void> {
    const supabase = supabaseService.getClient();

    const { error } = await supabase
      .from('conversation')
      .update({
        entities_extracted: false, // Will be retried
        // Could add error_message field to track failures
      })
      .eq('id', conversationId);

    if (error) {
      console.error(`Failed to mark conversation error: ${error.message}`);
    }
  }
}

export const memoryExtractionService = new MemoryExtractionService();
