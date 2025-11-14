/**
 * Run LoCoMo Ingestion Pipeline
 *
 * Processes LoCoMo dialogues through the ingestion pipeline:
 * 1. Load and parse dialogues
 * 2. Chunk into manageable segments
 * 3. Run each chunk through orchestrator (Phase 0-4)
 * 4. Track results and save outputs
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { neo4jService } from '../../src/db/neo4j.js';
import { initializeTracing } from '../../src/utils/tracing.js';
import { runPhase0 } from '../ingestion/phase0.js';
import { runPhase1 } from '../ingestion/phase1.js';
import { runPhase2 } from '../ingestion/phase2.js';
import { runPhase4 } from '../ingestion/phase4.js';
import {
  loadLoCoMoDataset,
  parseDialogue,
  identifySpeakerNames,
  chunkDialogue,
  generateChunkSummary,
  generateDialogueUserId,
  generateChunkSourceId,
} from './locomo-adapter.js';
import type {
  LoCoMoDialogue,
  ConversationChunk,
  IngestionResult,
  DialogueIngestionResult,
} from './types.js';
import type { PipelineConfig, PipelineState, Phase4Output as PipelinePhase4Output } from '../ingestion/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

interface LoCoMoIngestionConfig {
  dataset_path: string;
  output_dir: string;
  dialogue_limit?: number; // Process only first N dialogues (for testing)
  chunk_limit?: number; // Process only first N chunks per dialogue (for testing)
  chunk_config: {
    max_tokens: number;
    overlap_tokens: number;
  };
}

const DEFAULT_CONFIG: LoCoMoIngestionConfig = {
  dataset_path: path.join(__dirname, '../../../backend/datasets/locomo_dataset.json'),
  output_dir: path.join(__dirname, '../../../output/evaluation'),
  dialogue_limit: undefined, // Process all dialogues
  chunk_limit: undefined, // Process all chunks
  chunk_config: {
    max_tokens: 4000,
    overlap_tokens: 200,
  },
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Collect entity_keys mentioned during Phase 4 tool execution
 */
function collectMentionCandidates(phase4Result: PipelinePhase4Output): string[] {
  const candidateKeys = new Set<string>(phase4Result.created_entity_keys);

  for (const invocation of phase4Result.tool_invocations) {
    if (!invocation.success) continue;

    if (invocation.name === 'create_node') {
      try {
        const parsed = JSON.parse(invocation.result) as { entity_key?: string };
        if (parsed.entity_key) {
          candidateKeys.add(parsed.entity_key);
        }
      } catch {
        // Ignore malformed payloads
      }
    }

    if (invocation.name === 'update_node') {
      const entityKey = invocation.args.entity_key;
      if (typeof entityKey === 'string' && entityKey.length > 0) {
        candidateKeys.add(entityKey);
      }
    }

    if (
      invocation.name === 'create_relationship' ||
      invocation.name === 'update_relationship' ||
      invocation.name === 'add_note_to_relationship'
    ) {
      const fromKey = invocation.args.from_entity_key;
      const toKey = invocation.args.to_entity_key;
      if (typeof fromKey === 'string' && fromKey.length > 0) {
        candidateKeys.add(fromKey);
      }
      if (typeof toKey === 'string' && toKey.length > 0) {
        candidateKeys.add(toKey);
      }
    }
  }

  return Array.from(candidateKeys);
}

/**
 * Create Source-[:mentions]->Node edges for nodes touched during ingestion
 */
async function createSourceMentionEdges(sourceEntityKey: string, entityKeys: string[]): Promise<number> {
  if (!entityKeys.length) {
    return 0;
  }

  await neo4jService.executeQuery(
    `
    MATCH (s:Source {entity_key: $sourceEntityKey})
    UNWIND $entityKeys AS entityKey
    MATCH (n {entity_key: entityKey})
    MERGE (s)-[:mentions]->(n)
    `,
    { sourceEntityKey, entityKeys }
  );

  const counts = await neo4jService.executeQuery<{ mention_count: number }>(
    `
    MATCH (s:Source {entity_key: $sourceEntityKey})
    RETURN COUNT {(s)-[:mentions]->()} AS mention_count
    `,
    { sourceEntityKey }
  );

  return counts[0]?.mention_count ?? entityKeys.length;
}

// ============================================================================
// Pipeline Functions
// ============================================================================

/**
 * Process a single chunk through the 4-phase ingestion pipeline
 */
async function processChunk(
  chunk: ConversationChunk,
  userId: string,
  outputDir: string
): Promise<IngestionResult> {
  const startTime = Date.now();
  const sourceId = generateChunkSourceId(chunk.dialogue_id, chunk.chunk_index);

  console.log(`  📦 Processing chunk ${chunk.chunk_index + 1}/${chunk.total_chunks}`);
  console.log(`     Turns: ${chunk.turn_start}-${chunk.turn_end} (${chunk.token_count} tokens)`);

  try {
    // Prepare per-chunk output directory
    const chunkOutputDir = path.join(
      outputDir,
      `dialogue-${chunk.dialogue_id}`,
      `chunk-${String(chunk.chunk_index + 1).padStart(3, '0')}`
    );
    await fs.mkdir(chunkOutputDir, { recursive: true });

    // Generate summary for the chunk (Phase 1 uses this for Source metadata)
    const summary = generateChunkSummary(chunk.transcript);

    const pipelineConfig: PipelineConfig = {
      conversationId: sourceId,
      userId,
      sourceType: 'conversation',
      sampleDataPath: chunkOutputDir,
      outputDir: chunkOutputDir,
      startPhase: 0,
      maxPhase: 4,
    };

    const pipelineState: PipelineState = {
      conversationId: sourceId,
      userId,
      transcript: chunk.transcript,
      summary,
      sourceType: pipelineConfig.sourceType,
      entities: [],
      sourceEntityKey: '',
    };

    console.log(`     Phase 0 → Cleaning transcript`);
    pipelineState.transcript = await runPhase0(pipelineState, pipelineConfig);

    console.log(`     Phase 1 → Extracting entities`);
    const phase1Result = await runPhase1(pipelineState.transcript, pipelineConfig);
    pipelineState.entities = phase1Result.filtered;
    console.log(`        - Extracted ${pipelineState.entities.length} entities ≥ threshold`);

    console.log(`     Phase 2 → Creating Source node`);
    const phase2Result = await runPhase2(pipelineState, pipelineConfig);
    pipelineState.sourceEntityKey = phase2Result.source.entity_key;
    console.log(`        - Source entity_key: ${pipelineState.sourceEntityKey}`);

    console.log(`     Phase 4 → Relationship agent + graph updates`);
    const phase4Result = await runPhase4(pipelineState, pipelineConfig);

    // Create [:mentions] edges for touched nodes (spec Step 5)
    const mentionCandidates = collectMentionCandidates(phase4Result);
    const entitiesCreated = await createSourceMentionEdges(
      pipelineState.sourceEntityKey,
      mentionCandidates
    );

    const relationshipsCreated = phase4Result.relationship_creations;
    const processingTime = Date.now() - startTime;

    console.log(`     ✅ Pipeline complete (Phase 0→4)`);
    console.log(`        - Source: ${pipelineState.sourceEntityKey}`);
    console.log(`        - Mentions created: ${entitiesCreated}`);
    console.log(`        - Relationships created: ${relationshipsCreated}`);

    const result: IngestionResult = {
      dialogue_id: chunk.dialogue_id,
      user_id: userId,
      chunk_index: chunk.chunk_index,
      source_id: sourceId,
      source_entity_key: pipelineState.sourceEntityKey,
      entities_created: entitiesCreated,
      relationships_created: relationshipsCreated,
      processing_time_ms: processingTime,
    };

    console.log(`     ✅ Chunk processed in ${processingTime}ms\n`);

    return result;
  } catch (error) {
    const processingTime = Date.now() - startTime;

    console.error(`     ❌ Error processing chunk: ${error instanceof Error ? error.message : 'Unknown error'}\n`);

    return {
      dialogue_id: chunk.dialogue_id,
      user_id: userId,
      chunk_index: chunk.chunk_index,
      source_id: sourceId,
      source_entity_key: '',
      entities_created: 0,
      relationships_created: 0,
      processing_time_ms: processingTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Process a full dialogue
 */
async function processDialogue(
  dialogue: LoCoMoDialogue,
  config: LoCoMoIngestionConfig
): Promise<DialogueIngestionResult> {
  console.log(`\n🎭 Processing Dialogue ${dialogue.dialogue_id}`);

  const userId = generateDialogueUserId(dialogue.dialogue_id);
  console.log(`   User ID: ${userId}`);

  // Parse dialogue
  const parsed = parseDialogue(dialogue);
  console.log(`   Total turns: ${parsed.utterances.length}`);

  // Identify speaker names from dialogue content
  console.log(`   Identifying speaker names...`);
  const speakerNames = await identifySpeakerNames(parsed);
  parsed.speaker_names = speakerNames;
  console.log(`   Speaker names: ${speakerNames.Speaker_1} & ${speakerNames.Speaker_2}`);

  // Chunk dialogue
  const chunks = chunkDialogue(parsed, {
    max_tokens: config.chunk_config.max_tokens,
    overlap_tokens: config.chunk_config.overlap_tokens,
    preserve_turn_boundaries: true,
  });
  console.log(`   Chunks: ${chunks.length}\n`);

  // Process each chunk (respecting chunk limit if set)
  const chunksToProcess = config.chunk_limit ? chunks.slice(0, config.chunk_limit) : chunks;
  const chunkResults: IngestionResult[] = [];
  let totalEntities = 0;
  let totalRelationships = 0;
  let totalProcessingTime = 0;
  let failedChunks = 0;

  for (const chunk of chunksToProcess) {
    const result = await processChunk(chunk, userId, config.output_dir);
    chunkResults.push(result);

    if (result.error) {
      failedChunks++;
    } else {
      totalEntities += result.entities_created;
      totalRelationships += result.relationships_created;
    }

    totalProcessingTime += result.processing_time_ms;
  }

  const dialogueResult: DialogueIngestionResult = {
    dialogue_id: dialogue.dialogue_id,
    user_id: userId,
    total_chunks: chunks.length,
    total_turns: parsed.utterances.length,
    chunks_processed: chunks.length - failedChunks,
    chunks_failed: failedChunks,
    total_entities_created: totalEntities,
    total_relationships_created: totalRelationships,
    total_processing_time_ms: totalProcessingTime,
    chunk_results: chunkResults,
    errors: chunkResults.filter((r) => r.error).map((r) => r.error!),
  };

  console.log(`\n✅ Dialogue ${dialogue.dialogue_id} completed:`);
  console.log(`   Chunks: ${chunks.length} (${failedChunks} failed)`);
  console.log(`   Entities: ${totalEntities}`);
  console.log(`   Relationships: ${totalRelationships}`);
  console.log(`   Processing time: ${(totalProcessingTime / 1000).toFixed(2)}s`);

  return dialogueResult;
}

// ============================================================================
// Main Runner
// ============================================================================

async function runLoCoMoIngestion(config: LoCoMoIngestionConfig = DEFAULT_CONFIG) {
  console.log('🚀 LoCoMo Ingestion Pipeline\n');
  console.log('Configuration:');
  console.log(`  Dataset: ${config.dataset_path}`);
  console.log(`  Output: ${config.output_dir}`);
  console.log(`  Chunk size: ${config.chunk_config.max_tokens} tokens (${config.chunk_config.overlap_tokens} overlap)`);
  if (config.dialogue_limit) {
    console.log(`  Dialogue limit: ${config.dialogue_limit} (testing mode)`);
  }
  if (config.chunk_limit) {
    console.log(`  Chunk limit: ${config.chunk_limit} per dialogue (testing mode)`);
  }
  console.log('');

  // Initialize LangSmith tracing
  await initializeTracing();

  // Ensure output directory exists
  await fs.mkdir(config.output_dir, { recursive: true });

  // Connect to Neo4j
  console.log('🔌 Connecting to Neo4j...');
  await neo4jService.connect();
  console.log('✅ Neo4j connected\n');

  try {
    // Load dataset
    console.log('📂 Loading LoCoMo dataset...');
    const allDialogues = await loadLoCoMoDataset(config.dataset_path);
    console.log(`✅ Loaded ${allDialogues.length} dialogues\n`);

    // Apply dialogue limit if specified
    const dialogues = config.dialogue_limit
      ? allDialogues.slice(0, config.dialogue_limit)
      : allDialogues;

    console.log(`📊 Processing ${dialogues.length} dialogue${dialogues.length > 1 ? 's' : ''}...\n`);

    // Process each dialogue
    const results: DialogueIngestionResult[] = [];

    for (const dialogue of dialogues) {
      const result = await processDialogue(dialogue, config);
      results.push(result);

      // Save individual dialogue result
      const resultPath = path.join(
        config.output_dir,
        `ingestion-dialogue-${dialogue.dialogue_id}.json`
      );
      await fs.writeFile(resultPath, JSON.stringify(result, null, 2));
      console.log(`💾 Saved results to ${resultPath}\n`);
    }

    // Save aggregate results
    const aggregatePath = path.join(config.output_dir, 'ingestion-aggregate.json');
    const aggregate = {
      timestamp: new Date().toISOString(),
      config,
      total_dialogues: results.length,
      total_chunks: results.reduce((sum, r) => sum + r.total_chunks, 0),
      total_turns: results.reduce((sum, r) => sum + r.total_turns, 0),
      total_entities: results.reduce((sum, r) => sum + r.total_entities_created, 0),
      total_relationships: results.reduce((sum, r) => sum + r.total_relationships_created, 0),
      total_processing_time_ms: results.reduce((sum, r) => sum + r.total_processing_time_ms, 0),
      dialogues: results,
    };

    await fs.writeFile(aggregatePath, JSON.stringify(aggregate, null, 2));
    console.log(`💾 Saved aggregate results to ${aggregatePath}\n`);

    // Print summary
    console.log('\n📈 Ingestion Summary:');
    console.log(`   Dialogues: ${results.length}`);
    console.log(`   Chunks: ${aggregate.total_chunks}`);
    console.log(`   Turns: ${aggregate.total_turns}`);
    console.log(`   Entities: ${aggregate.total_entities}`);
    console.log(`   Relationships: ${aggregate.total_relationships}`);
    console.log(`   Total time: ${(aggregate.total_processing_time_ms / 1000 / 60).toFixed(2)} minutes`);

    console.log('\n✅ Ingestion complete!\n');
  } catch (error) {
    console.error('\n❌ Ingestion failed:', error);
    throw error;
  } finally {
    // Disconnect from Neo4j
    await neo4jService.close();
    console.log('🔌 Neo4j disconnected');
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  const config = { ...DEFAULT_CONFIG };

  // Parse --limit flag (for dialogue limit)
  const limitIndex = args.indexOf('--limit');
  if (limitIndex !== -1 && args[limitIndex + 1]) {
    config.dialogue_limit = parseInt(args[limitIndex + 1], 10);
  }

  // Parse --chunk-limit flag (for chunks per dialogue)
  const chunkLimitIndex = args.indexOf('--chunk-limit');
  if (chunkLimitIndex !== -1 && args[chunkLimitIndex + 1]) {
    config.chunk_limit = parseInt(args[chunkLimitIndex + 1], 10);
  }

  runLoCoMoIngestion(config)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { runLoCoMoIngestion, DEFAULT_CONFIG };
