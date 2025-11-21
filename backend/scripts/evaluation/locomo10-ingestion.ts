/**
 * LoCoMo10 Ingestion Module
 *
 * Handles ingestion of all sessions from a LoCoMo10 conversation into Neo4j
 */

import {
  runIngestionPipeline,
  type IngestionResult as OrchestratorResult,
} from '../../src/services/ingestionOrchestratorService.js';
import type { LoCoMo10Conversation } from './types.js';
import { extractSessions, formatSessionForIngestion, parseLoCoMo10DateTime } from './locomo10-adapter.js';

/**
 * Ingest all sessions from a LoCoMo10 conversation
 *
 * Creates a Source node for each session and extracts entities/relationships
 * All sessions are scoped to the same userId for retrieval
 *
 * @param sessionLimit - Optional limit on number of sessions to ingest (for testing)
 * @param sessionOffset - Optional offset to skip first N sessions (for testing)
 * @param runId - Unique ID for this evaluation run (to group traces in Langfuse)
 */
export async function ingestLoCoMo10Conversation(
  conversation: LoCoMo10Conversation,
  userId: string,
  sessionLimit?: number,
  sessionOffset?: number,
  runId?: string
): Promise<{
  conversationId: string;
  sessionCount: number;
  processingTimeMs: number;
  sourceEntityKeys: string[];
}> {
  const startTime = Date.now();
  const allSessions = extractSessions(conversation);
  const offset = sessionOffset ?? 0;
  const sessions = sessionLimit
    ? allSessions.slice(offset, offset + sessionLimit)
    : allSessions.slice(offset);

  console.log(`📥 Ingesting ${sessions.length} sessions for ${conversation.sample_id}`);
  console.log(`   User ID: ${userId}`);
  if (sessionOffset) {
    console.log(`   Session offset: ${sessionOffset} (skipping first ${sessionOffset} sessions)`);
  }
  if (runId) {
    console.log(`   Run ID: ${runId}`);
  }
  console.log('');

  const conversationId = `locomo10-${conversation.sample_id}-eval`;
  const sourceEntityKeys: string[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const transcript = formatSessionForIngestion(
      session.sessionId,
      session.turns,
      session.dateTime  // Pass dateTime for context header
    );

    // Parse conversation date to ISO timestamp
    const conversationDate = parseLoCoMo10DateTime(session.dateTime);

    console.log(`  📦 Session ${i + 1}/${sessions.length}: ${session.sessionId}`);
    console.log(`     Turns: ${session.turns.length}`);
    console.log(`     Date/Time: ${session.dateTime}`);
    console.log(`     Parsed: ${conversationDate}`);

    // Generate unique source ID for this session
    const sourceId = `${conversationId}-${session.sessionId}`;

    // Build ingestion payload with unique session ID for each run
    const sessionId = runId ? `${conversationId}-${runId}` : conversationId;

    const payload = {
      sourceId,
      userId,
      teamId: null as string | null,
      sourceType: 'conversation', // Regular conversation source
      summary: `Session ${session.sessionId} on ${session.dateTime}`,
      transcriptRaw: transcript,
      participants: [userId],
      createdAt: conversationDate, // Use parsed date instead of current time
      metadata: {
        sample_id: conversation.sample_id,
        conversation_id: conversationId,
        session_id: session.sessionId,
        session_date_time: session.dateTime,
        session_index: i,
        run_id: runId,
      },
      sessionId, // For Langfuse session grouping (all sessions in same conversation + run)
    };

    try {
      // Run the ingestion orchestrator
      const result: OrchestratorResult = await runIngestionPipeline(payload);

      sourceEntityKeys.push(result.sourceEntityKey);

      console.log(`     ✅ Ingestion complete`);
      console.log(`        - Source: ${result.sourceEntityKey}`);
      console.log(`        - Entities: ${result.merges.length + result.creations.length}`);
      console.log(`        - Mentions: ${result.mentionsLinked}`);
      console.log(`        - Relationships: ${result.semanticRelationshipsCreated}`);
      console.log('');
    } catch (error) {
      console.error(`     ❌ Error ingesting session: ${error instanceof Error ? error.message : 'Unknown'}`);
      throw error;
    }
  }

  const processingTimeMs = Date.now() - startTime;

  console.log(`✅ All sessions ingested in ${(processingTimeMs / 1000).toFixed(2)}s`);
  console.log('');

  return {
    conversationId,
    sessionCount: sessions.length,
    processingTimeMs,
    sourceEntityKeys,
  };
}
