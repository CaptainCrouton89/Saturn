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
 * Reference: Senior Architect Design (agent 30FYX8)
 */

import { traceable } from 'langsmith/traceable';
import { trace } from '@opentelemetry/api';
import { sourceRepository } from '../repositories/SourceRepository.js';
import type { EntityType } from '../types/graph.js';
import type { ExtractedEntity } from '../types/ingestion.js';
import { extractEntitiesWithEmbeddings } from './entityExtractionService.js';
import { EntityResolutionService } from './entityResolutionService.js';
import { generateSourceSummary } from './summaryGenerationService.js';
import { withSpan, TraceAttributes } from '../utils/tracing.js';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Input payload for ingestion pipeline
 */
export interface IngestionPayload {
  sourceId: string;
  userId: string;
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

// ============================================================================
// Source Node Management
// ============================================================================

/**
 * Create or find existing Source node
 *
 * Generates stable entity_key from payload, checks if Source exists,
 * and creates new Source if needed.
 *
 * IMPORTANT: Source created BEFORE extraction for sourceEntityKey provenance
 *
 * @param payload - Ingestion payload
 * @param contentProcessed - Normalized content array
 * @param generatedSummary - AI-generated summary for description field
 * @returns Source entity_key
 */
async function ensureSourceNode(
  payload: IngestionPayload,
  contentProcessed: string[],
  generatedSummary: string
): Promise<string> {
  // First check if Source already exists by sourceId
  const existingSource = await sourceRepository.findBySourceId(payload.sourceId);

  if (existingSource) {
    console.log(`   ✅ Found existing Source: ${existingSource.entity_key}`);
    return existingSource.entity_key;
  }

  // Create new Source node with stable timestamps
  // IMPORTANT: Use payload.createdAt (not new Date()) to ensure deterministic entity_key
  const source = await sourceRepository.create({
    source_id: payload.sourceId, // Store external source ID for idempotent lookups
    user_id: payload.userId,
    team_id: payload.teamId || null,
    source_type: payload.sourceType,
    description: generatedSummary, // Use AI-generated summary
    raw_content: Array.isArray(payload.transcriptRaw)
      ? JSON.stringify(payload.transcriptRaw)
      : payload.transcriptRaw,
    content: {
      type: 'markdown',
      content: contentToMarkdown(contentProcessed),
    },
    participants: payload.participants,
    created_at: payload.createdAt, // Use payload timestamp (deterministic)
    started_at: payload.createdAt, // Conversation start time
    summary: generatedSummary, // Use AI-generated summary
    processing_status: 'in_progress',
    processing_started_at: payload.createdAt, // Use payload timestamp instead of new Date()
  });

  console.log(`   ✅ Created new Source: ${source.entity_key}`);
  return source.entity_key;
}

// ============================================================================
// Mentions Linking
// ============================================================================

/**
 * Link Source to mentioned entities via mentions edges
 *
 * Dedupes entity keys before linking.
 * Converts entity types to proper Neo4j labels (person -> Person).
 *
 * @param sourceEntityKey - Source entity_key
 * @param entities - Resolved entities (merges + creations)
 * @throws Error if any relationship already exists
 */
async function linkMentions(
  sourceEntityKey: string,
  entities: ResolvedEntity[]
): Promise<number> {
  // Filter entities with entity_key and dedupe
  const entityKeys = Array.from(
    new Set(
      entities
        .filter((e) => e.entity_key !== undefined)
        .map((e) => ({
          type: e.entity_type,
          entity_key: e.entity_key!,
        }))
    )
  );

  if (entityKeys.length === 0) {
    console.log('   ⚠️  No entities to link (all missing entity_key)');
    return 0;
  }

  // Link mentions using sourceRepository (idempotent)
  const linkResult = await sourceRepository.linkToEntities(sourceEntityKey, entityKeys);

  if (linkResult.skipped > 0) {
    console.log(`   ✅ Linked ${linkResult.created} new mentions (${linkResult.skipped} already existed)`);
  } else {
    console.log(`   ✅ Linked ${linkResult.created} mentions edges`);
  }

  return linkResult.created;
}

// ============================================================================
// Main Orchestrator
// ============================================================================

/**
 * Run ingestion pipeline for a source
 *
 * Orchestrates the full pipeline:
 * 1. Normalize content (cleanup and formatting)
 * 2. Create/find Source node (before extraction for provenance)
 * 3. Extract entities with embeddings
 * 4. Resolve entities (MERGE/CREATE)
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
    const modelId = 'gpt-5-nano';

    // ========================================================================
    // Phase 1: Content Normalization
    // ========================================================================
    let contentProcessed: string[] = [];
    let normalizeMs = 0;

    try {
      const normalizeStart = Date.now();
      console.log('\n📝 Phase 1: Content Normalization...');

      contentProcessed = payload.transcriptProcessed || normalizeContent(payload.transcriptRaw);
      normalizeMs = Date.now() - normalizeStart;

      console.log(`   ✅ Normalized ${contentProcessed.length} content chunks (${normalizeMs}ms)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ phase: 'normalization', message });
      console.error(`   ❌ Normalization failed: ${message}`);
      throw new Error(`Ingestion aborted - normalization failed: ${message}`);
    }

    // ========================================================================
    // Phase 1.5: Summary Generation
    // ========================================================================
    let generatedSummary = '';
    let summaryMs = 0;

    try {
      const summaryStart = Date.now();
      console.log('\n📋 Phase 1.5: Summary Generation...');

      // Use raw content for summary (not normalized bullets)
      generatedSummary = await generateSourceSummary(payload.transcriptRaw, modelId);
      summaryMs = Date.now() - summaryStart;

      console.log(`   ✅ Generated summary (${summaryMs}ms)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ phase: 'summary_generation', message });
      console.error(`   ❌ Summary generation failed: ${message}`);
      throw new Error(`Ingestion aborted - summary generation failed: ${message}`);
    }

    // ========================================================================
    // Phase 2: Source Node Creation
    // ========================================================================
    let sourceEntityKey = '';

    try {
      const sourceStart = Date.now();
      console.log('\n🏗️  Phase 2: Source Node Creation...');

      sourceEntityKey = await ensureSourceNode(payload, contentProcessed, generatedSummary);
      const sourceMs = Date.now() - sourceStart;

      console.log(`   ✅ Source node ready: ${sourceEntityKey} (${sourceMs}ms)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ phase: 'source_creation', message });
      console.error(`   ❌ Source creation failed: ${message}`);
      throw new Error(`Ingestion aborted - source creation failed: ${message}`);
    }

    // ========================================================================
    // Phase 3: Entity Extraction (with embeddings)
    // ========================================================================
    let extractedEntities: ExtractedEntity[] = [];
    let extractionMs = 0;

    try {
      await withSpan(
        'ingestion.phase1-extraction',
        {
          sourceId: payload.sourceId,
          userId: payload.userId,
        },
        async () => {
          const extractionStart = Date.now();
          console.log('\n🔍 Phase 3: Entity Extraction...');

          const transcriptText = contentToMarkdown(contentProcessed);
          extractedEntities = await extractEntitiesWithEmbeddings(transcriptText, modelId);
          extractionMs = Date.now() - extractionStart;

          console.log(`   ✅ Extracted ${extractedEntities.length} entities (${extractionMs}ms)`);
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ phase: 'extraction', message });
      console.error(`   ❌ Extraction failed: ${message}`);
      if (error instanceof Error && error.stack) {
        console.error(`   Stack trace: ${error.stack}`);
      }
      if (error && typeof error === 'object' && 'cause' in error) {
        console.error(`   Cause: ${JSON.stringify(error.cause, null, 2)}`);
      }
      // Best-effort: continue with empty entities
      extractedEntities = [];
    }

    // ========================================================================
    // Phase 4: Entity Resolution (MERGE/CREATE)
    // ========================================================================
    let merges: ResolvedEntity[] = [];
    let creations: ResolvedEntity[] = [];
    let semanticRelationshipsCreated = 0;
    let resolutionMs = 0;
    let resolutionBreakdown: {
      decisionPassMs: number;
      nodeExecutionMs: number;
      relationshipGenerationMs: number;
    } | undefined;

    if (extractedEntities.length > 0) {
      try {
        await withSpan(
          'ingestion.phase2-resolution',
          {
            sourceId: payload.sourceId,
            userId: payload.userId,
            entityCount: extractedEntities.length,
          },
          async () => {
            const resolutionStart = Date.now();
            console.log('\n🔄 Phase 4: Entity Resolution...');

            const resolutionService = new EntityResolutionService({}, undefined, modelId);

            // Format conversation date and prepend to transcript
            const conversationDate = new Date(payload.createdAt);
            const day = String(conversationDate.getDate()).padStart(2, '0');
            const month = String(conversationDate.getMonth() + 1).padStart(2, '0');
            const year = conversationDate.getFullYear();
            const dateStr = `${day}/${month}/${year}`;

            const transcriptText = `**Conversation Date**: ${dateStr}\n\n${contentToMarkdown(contentProcessed)}`;

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

            merges = resolved;
            creations = unresolved;
            resolutionMs = Date.now() - resolutionStart;
            resolutionBreakdown = resolutionTimings;

            // Use relationship count directly from agents (automatic instrumentation)
            semanticRelationshipsCreated = totalRelationshipsCreated;

            console.log(
              `   ✅ Resolution complete: ${merges.length} MERGE, ${creations.length} CREATE, ${semanticRelationshipsCreated} relationships created (${resolutionMs}ms)`
            );
            console.log(
              `   📊 Breakdown: Decision=${resolutionTimings.decisionPassMs}ms, Nodes=${resolutionTimings.nodeExecutionMs}ms, Relationships=${resolutionTimings.relationshipGenerationMs}ms`
            );
          }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push({ phase: 'resolution', message });
        console.error(`   ❌ Resolution failed: ${message}`);
        // Best-effort: continue without resolution
        merges = [];
        creations = [];
        semanticRelationshipsCreated = 0;
      }
    }

    // ========================================================================
    // Phase 5: Link Mentions Edges
    // ========================================================================
    let mentionsLinked = 0;
    let mentionsMs = 0;

    try {
      await withSpan(
        'ingestion.phase3-relationships',
        {
          sourceId: payload.sourceId,
          userId: payload.userId,
          resolvedEntityCount: merges.length + creations.length,
        },
        async () => {
          const mentionsStart = Date.now();
          console.log('\n🔗 Phase 5: Linking Mentions...');

          const allEntities = [...merges, ...creations];
          mentionsLinked = await linkMentions(sourceEntityKey, allEntities);
          mentionsMs = Date.now() - mentionsStart;

          console.log(`   ✅ Linked ${mentionsLinked} mentions (${mentionsMs}ms)`);
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ phase: 'mentions', message });
      console.error(`   ❌ Mentions linking failed: ${message}`);
      // Best-effort: continue without mentions
      mentionsLinked = 0;
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
