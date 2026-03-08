/**
 * Ingestion Orchestrator Service
 *
 * Single orchestration layer that handles the complete ingestion pipeline:
 * - Content normalization (cleanup and formatting)
 * - Source node lifecycle (create or find existing)
 * - Memory extraction with embeddings
 * - Memory resolution (MERGE/CREATE agents)
 * - Mentions edge wiring
 * - Error handling and telemetry
 *
 * Pipeline Phase Structure:
 * - Phase 1: Normalize Content
 * - Phase 2 (parallel): Extract & Summarize
 *   - Phase 2a: Summary Generation
 *   - Phase 2b: Entity Extraction
 * - Phase 3: Source Node Creation (depends on Phase 2a summary)
 * - Phase 4: Entity Resolution (4 internal stages: Decision, CREATE, MERGE, Relationships) - depends on Phase 2b + Phase 3
 * - Phase 5: Link Mentions
 *
 * Note: Phase 2a and Phase 2b execute in parallel. Wall-clock time = max(summaryMs, extractionMs).
 *
 * Reference: Senior Architect Design (agent 30FYX8)
 * Refactored: Parallelization + service extraction (Phase executor, Source management, Mentions linking)
 */

import { traceable } from 'langsmith/traceable';
import { trace } from '@opentelemetry/api';
import type { EntityType } from '../types/graph.js';
import type { ExtractedEntity } from '../types/ingestion.js';
import { extractEntitiesWithEmbeddings } from './entityExtractionService.js';
import { EntityResolutionService } from './entityResolutionService.js';
import { generateSourceSummary } from './summaryService.js';
import { sourceManagementService } from './sourceManagementService.js';
import { mentionsLinkingService } from './mentionsLinkingService.js';
import { executePhase, executeParallelPhases, type PhaseResult } from '../utils/phaseExecutor.js';
import { TraceAttributes } from '../utils/tracing.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Input payload for ingestion pipeline
 */
export interface IngestionPayload {
  sourceId: string;
  userId: string;
  displayName?: string | null;
  teamId?: string | null;
  sourceType: string;
  summary: string;
  transcriptRaw: string | string[];
  transcriptProcessed?: string[];
  participants: string[];
  createdAt: string;
  metadata?: Record<string, unknown>;
  sessionId?: string; // For Langfuse session grouping
}

/**
 * Resolved memory from resolution phase
 */
interface ResolvedEntity {
  name: string;
  entity_type: EntityType;
  description: string;
  subpoints?: string[];
  confidence: number;
  embedding: number[];
  resolved: boolean;
  entity_key?: string;
  resolution_reason: string;
}

/**
 * Result from ingestion pipeline
 */
export interface IngestionResult {
  sourceEntityKey: string;
  contentProcessed: string[];
  extractedEntities: ExtractedEntity[];
  merges: ResolvedEntity[];
  creations: ResolvedEntity[];
  mentionsLinked: number;
  semanticRelationshipsCreated: number;
  timings: {
    normalizeMs: number;
    summaryMs: number;
    extractionMs: number;
    resolutionMs: number;
    resolutionBreakdown?: {
      decisionPassMs: number;
      nodeExecutionMs: number;
      relationshipGenerationMs: number;
    };
    mentionsMs: number;
    totalMs: number;
  };
  errors?: Array<{ phase: string; message: string }>;
}

// ============================================================================
// Content Normalization
// ============================================================================

/**
 * Normalize content format
 *
 * Converts raw transcript (string or array) to processed format:
 * - Clean up whitespace and empty lines
 * - Return array of strings (one per turn/chunk)
 *
 * @param raw - Raw transcript (string or array of turns)
 * @returns Processed transcript as array of strings
 */
function normalizeContent(raw: string | string[]): string[] {
  if (Array.isArray(raw)) {
    // Array of turns - clean and filter
    return raw
      .map((turn) => turn.trim())
      .filter((turn) => turn.length > 0);
  }

  // Single string - split by newlines
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Convert processed content array to markdown string
 *
 * @param processed - Array of processed content strings
 * @returns Markdown formatted string
 */
function contentToMarkdown(processed: string[]): string {
  return processed.join('\n');
}

/**
 * Wrap content with source-type context for extraction
 */
function wrapContentForExtraction(markdown: string, sourceType: string, userLabel: string): string {
  switch (sourceType) {
    case 'voice-memo':
    case 'journal':
      return `[Personal ${sourceType} from user ${userLabel}]\n\n${markdown}`;
    default:
      return markdown;
  }
}

// ============================================================================
// Main Orchestrator
// ============================================================================

/**
 * Run ingestion pipeline for a source
 *
 * Orchestrates the full pipeline:
 * 1. Normalize content (cleanup and formatting)
 * 2. **PARALLEL**: Summary generation (2a) + Entity extraction (2b)
 * 3. Create/find Source node (after 2a summary completes)
 * 4. Resolve entities (MERGE/CREATE) (after 2b extraction + phase 3 source creation)
 * 5. Link mentions edges
 * 6. Finalize metrics and return result
 *
 * Error handling:
 * - Abort on normalization/Source creation failure
 * - Best-effort mode for resolution/linking
 * - Populate errors array with phase and message
 *
 * @param payload - Ingestion payload
 * @returns Ingestion result with timings and metrics
 */
export const runIngestionPipeline = traceable(
  async function runIngestionPipelineImpl(
    payload: IngestionPayload
  ): Promise<IngestionResult> {
    const startTime = Date.now();
    const errors: Array<{ phase: string; message: string }> = [];

    console.log(`\n🚀 Starting ingestion pipeline for source ${payload.sourceId}`);
    console.log(`   User: ${payload.userId}, Type: ${payload.sourceType}`);

    // Set session ID as OpenTelemetry span attribute for Langfuse grouping
    if (payload.sessionId) {
      console.log(`   Session ID: ${payload.sessionId} (for Langfuse grouping)`);
      const activeSpan = trace.getActiveSpan();
      if (activeSpan) {
        activeSpan.setAttribute(TraceAttributes.SESSION_ID, payload.sessionId);
      }
    }

    // Model ID for extraction and resolution (AI SDK compatible)
    const modelId = 'gpt-5-mini';

    // ========================================================================
    // Phase 1: Normalize Content
    // ========================================================================
    const normalizationResult = await executePhase(
      'Phase 1: Normalize Content',
      async () => {
        const processed = payload.transcriptProcessed || normalizeContent(payload.transcriptRaw);
        console.log(`   📊 Normalized ${processed.length} content chunks`);
        return processed;
      },
      { onError: 'throw' }
    );

    if (!normalizationResult.success || !normalizationResult.result) {
      throw new Error('Content normalization failed');
    }
    const contentProcessed = normalizationResult.result;
    const normalizeMs = normalizationResult.timeMs;

    // ========================================================================
    // Phase 2: Extract & Summarize (parallel)
    // Phase 2a (Summary Generation) and Phase 2b (Entity Extraction) run concurrently.
    // Wall-clock time = max(summaryMs, extractionMs).
    // Phase 3 depends on 2a; Phase 4 depends on both 2b and Phase 3.
    // ========================================================================
    const parallelResults = await executeParallelPhases<
      [string, ExtractedEntity[]]
    >([
      {
        name: 'Phase 2a: Summary Generation',
        fn: async (): Promise<string> => {
          // Use raw content for summary, wrapped with source context
          const rawText = typeof payload.transcriptRaw === 'string'
            ? payload.transcriptRaw
            : payload.transcriptRaw.join('\n');
          const userLabel = payload.displayName || payload.userId;
          const wrappedRaw = wrapContentForExtraction(rawText, payload.sourceType, userLabel);
          const summary = await generateSourceSummary(wrappedRaw, modelId);
          console.log(`   📝 Generated summary`);
          return summary;
        },
        options: {
          onError: 'throw',
          spanName: 'ingestion.phase2a-summary',
          spanAttributes: {
            sourceId: payload.sourceId,
            userId: payload.userId,
          },
        },
      },
      {
        name: 'Phase 2b: Entity Extraction',
        fn: async (): Promise<ExtractedEntity[]> => {
          const userLabel = payload.displayName || payload.userId;
          const transcriptText = wrapContentForExtraction(
            contentToMarkdown(contentProcessed),
            payload.sourceType,
            userLabel
          );
          const entities = await extractEntitiesWithEmbeddings(transcriptText, modelId);
          console.log(`   🔍 Extracted ${entities.length} entities`);
          return entities;
        },
        options: {
          onError: 'continue', // Best-effort for extraction
          spanName: 'ingestion.phase2b-extraction',
          spanAttributes: {
            sourceId: payload.sourceId,
            userId: payload.userId,
          },
        },
      },
    ]);

    const summaryResult = parallelResults[0] as PhaseResult<string>;
    const extractionResult = parallelResults[1] as PhaseResult<ExtractedEntity[]>;

    // Extract results from parallel execution
    if (!summaryResult.success || !summaryResult.result) {
      throw new Error('Summary generation failed - cannot continue without summary');
    }
    const generatedSummary = summaryResult.result;
    const summaryMs = summaryResult.timeMs;

    // Extraction is best-effort - empty array on failure
    const extractedEntities: ExtractedEntity[] = extractionResult.success && extractionResult.result
      ? extractionResult.result
      : [];
    const extractionMs = extractionResult.timeMs;

    // Collect errors from parallel phases
    if (summaryResult.error) {
      errors.push(summaryResult.error);
    }
    if (extractionResult.error) {
      errors.push(extractionResult.error);
    }

    // ========================================================================
    // Phase 3: Source Node Creation (depends on Phase 2a summary)
    // ========================================================================
    const sourceResult = await executePhase(
      'Phase 3: Source Node Creation',
      async () => {
        const entityKey = await sourceManagementService.ensureSourceNode({
          sourceId: payload.sourceId,
          userId: payload.userId,
          teamId: payload.teamId,
          sourceType: payload.sourceType,
          description: generatedSummary,
          rawContent: payload.transcriptRaw,
          processedContent: contentProcessed,
          participants: payload.participants,
          createdAt: payload.createdAt,
          metadata: payload.metadata,
        });
        console.log(`   🏗️  Source ready: ${entityKey}`);
        return entityKey;
      },
      { onError: 'throw' }
    );

    if (!sourceResult.success || !sourceResult.result) {
      throw new Error('Source node creation failed');
    }
    const sourceEntityKey = sourceResult.result;

    // ========================================================================
    // Phase 4: Entity Resolution (depends on Phase 2b + Phase 3)
    // ========================================================================
    let merges: ResolvedEntity[] = [];
    let creations: ResolvedEntity[] = [];
    let semanticRelationshipsCreated = 0;
    let resolutionMs = 0;
    let resolutionBreakdown:
      | {
          decisionPassMs: number;
          nodeExecutionMs: number;
          relationshipGenerationMs: number;
        }
      | undefined;

    if (extractedEntities.length > 0) {
      const resolutionResult = await executePhase(
        'Phase 4: Entity Resolution (MERGE/CREATE)',
        async () => {
          const resolutionService = new EntityResolutionService({}, undefined, modelId);

          // Format conversation date and prepend to transcript
          const conversationDate = new Date(payload.createdAt);
          const day = String(conversationDate.getDate()).padStart(2, '0');
          const month = String(conversationDate.getMonth() + 1).padStart(2, '0');
          const year = conversationDate.getFullYear();
          const dateStr = `${day}/${month}/${year}`;

          const transcriptText = `**Conversation Date**: ${dateStr}\n\n${contentToMarkdown(
            contentProcessed
          )}`;

          const {
            resolved,
            unresolved,
            totalRelationshipsCreated,
            timings: resolutionTimings,
          } = await resolutionService.resolveEntities(
            payload.userId,
            payload.teamId || payload.userId, // Use userId as fallback teamId
            extractedEntities,
            transcriptText,
            sourceEntityKey
          );

          console.log(
            `   🔄 Resolution: ${resolved.length} MERGE, ${unresolved.length} CREATE, ${totalRelationshipsCreated} relationships`
          );
          console.log(
            `   📊 Breakdown: Decision=${resolutionTimings.decisionPassMs}ms, Nodes=${resolutionTimings.nodeExecutionMs}ms, Relationships=${resolutionTimings.relationshipGenerationMs}ms`
          );

          return {
            resolved,
            unresolved,
            totalRelationshipsCreated,
            timings: resolutionTimings,
          };
        },
        {
          onError: 'continue', // Best-effort for resolution
          spanName: 'ingestion.phase4-entity-resolution',
          spanAttributes: {
            sourceId: payload.sourceId,
            userId: payload.userId,
            entityCount: extractedEntities.length,
          },
        }
      );

      if (resolutionResult.success && resolutionResult.result) {
        merges = resolutionResult.result.resolved;
        creations = resolutionResult.result.unresolved;
        semanticRelationshipsCreated = resolutionResult.result.totalRelationshipsCreated;
        resolutionBreakdown = resolutionResult.result.timings;
      }

      resolutionMs = resolutionResult.timeMs;

      if (resolutionResult.error) {
        errors.push(resolutionResult.error);
      }
    }

    // ========================================================================
    // Phase 5: Link Mentions
    // ========================================================================
    const mentionsResult = await executePhase(
      'Phase 5: Link Mentions',
      async () => {
        const allEntities = [...merges, ...creations];
        const entityRefs = mentionsLinkingService.extractEntityReferences(allEntities);
        const linkResult = await mentionsLinkingService.linkMentionsToSource(
          sourceEntityKey,
          entityRefs
        );
        return linkResult.created;
      },
      {
        onError: 'continue', // Best-effort for mentions
        spanName: 'ingestion.phase5-link-mentions',
        spanAttributes: {
          sourceId: payload.sourceId,
          userId: payload.userId,
          resolvedEntityCount: merges.length + creations.length,
        },
      }
    );

    const mentionsLinked = mentionsResult.success && mentionsResult.result !== null
      ? mentionsResult.result
      : 0;
    const mentionsMs = mentionsResult.timeMs;

    if (mentionsResult.error) {
      errors.push(mentionsResult.error);
    }

    // ========================================================================
    // Finalize and Return Result
    // ========================================================================
    const totalMs = Date.now() - startTime;

    console.log('\n✅ Ingestion pipeline complete!');
    console.log(`   Total time: ${totalMs}ms`);
    console.log(`   Extracted: ${extractedEntities.length} entities`);
    console.log(`   Merged: ${merges.length}, Created: ${creations.length}`);
    console.log(`   Mentions: ${mentionsLinked} edges`);
    console.log(`   Semantic relationships: ${semanticRelationshipsCreated} created`);

    if (errors.length > 0) {
      console.log(`   ⚠️  Errors: ${errors.length} phases had failures`);
    }

    return {
      sourceEntityKey,
      contentProcessed,
      extractedEntities,
      merges,
      creations,
      mentionsLinked,
      semanticRelationshipsCreated,
      timings: {
        normalizeMs,
        summaryMs,
        extractionMs,
        resolutionMs,
        resolutionBreakdown,
        mentionsMs,
        totalMs,
      },
      errors: errors.length > 0 ? errors : undefined,
    };
  },
  {
    name: 'ingestion_orchestrator',
    tags: ['ingestion', 'orchestrator'],
  }
);
