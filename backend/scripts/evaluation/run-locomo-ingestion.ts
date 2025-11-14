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
// Note: Phase 5 (consolidation) is a nightly batch job, not needed for initial ingestion
import type { PipelineState, PipelineConfig } from '../ingestion/types.js';
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
  Phase1Output,
  Phase2Output,
  Phase4Output,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

interface LoCoMoIngestionConfig {
  dataset_path: string;
  output_dir: string;
  dialogue_limit?: number; // Process only first N dialogues (for testing)
  chunk_config: {
    max_tokens: number;
    overlap_tokens: number;
  };
}

const DEFAULT_CONFIG: LoCoMoIngestionConfig = {
  dataset_path: path.join(__dirname, '../../../backend/datasets/locomo_dataset.json'),
  output_dir: path.join(__dirname, '../../../output/evaluation'),
  dialogue_limit: undefined, // Process all dialogues
  chunk_config: {
    max_tokens: 4000,
    overlap_tokens: 200,
  },
};

// ============================================================================
// Pipeline Functions
// ============================================================================

/**
 * Process a single chunk through the ingestion pipeline
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

  const pipelineConfig: PipelineConfig = {
    conversationId: sourceId,
    userId,
    sourceType: 'conversation',
    sampleDataPath: '', // Not used, we pass transcript directly
    outputDir,
    startPhase: 0,
    maxPhase: 4,
  };

  const state: PipelineState = {
    conversationId: sourceId,
    userId,
    transcript: chunk.transcript,
    summary: generateChunkSummary(chunk.transcript),
    sourceType: 'conversation',
    entities: [],
    sourceEntityKey: '',
  };

  try {
    // Phase 0: Convert to structured notes
    console.log(`     Phase 0: Converting to structured notes...`);
    const phase0Output = await runPhase0(state, pipelineConfig);
    state.transcript = phase0Output;

    // Phase 1: Extract entities
    console.log(`     Phase 1: Extracting entities...`);
    const phase1Output: Phase1Output = await runPhase1(state.transcript, pipelineConfig);
    console.log(`     → Phase1 output type: ${typeof phase1Output}, has filtered: ${!!phase1Output.filtered}`);
    state.entities = phase1Output.filtered;
    console.log(`     → Extracted ${phase1Output.filtered.length} entities (${phase1Output.all.length} total, filtered by confidence)`);
    console.log(`     → Entities have subpoints: ${state.entities.every(e => Array.isArray(e.subpoints))}`);

    // Phase 2: Create source node
    console.log(`     Phase 2: Creating source node...`);
    const phase2Output = await runPhase2(state, pipelineConfig);
    state.sourceEntityKey = phase2Output.source.entity_key;
    console.log(`     → Source node created: ${state.sourceEntityKey}`);

    // Phase 4: Relationship agent
    console.log(`     Phase 4: Building relationships...`);
    const phase4Output: Phase4Output = await runPhase4(state, pipelineConfig);
    console.log(`     → Relationship agent completed (${phase4Output.iterations} iterations)`);

    // Phase 4.5: Link Source to all extracted entities (deterministic step)
    console.log(`     Phase 4.5: Linking Source to extracted entities...`);
    console.log(`     → Attempting to resolve ${state.entities.length} entities from Phase 1...`);
    const { sourceRepository } = await import('../../src/repositories/SourceRepository.js');
    const { neo4jService } = await import('../../src/db/neo4j.js');

    // Resolve entity names to entity_keys by querying Neo4j
    const entityKeys: { type: 'Person' | 'Concept' | 'Entity'; entity_key: string }[] = [];
    const failedEntities: Array<{ name: string; type: string; reason: string }> = [];

    for (const entity of state.entities) {
      // Query Neo4j to find the node for this entity
      let query: string;
      let params: Record<string, unknown>;

      if (entity.entity_type === 'Person') {
        // Person nodes use canonical_name (lowercase)
        query = `
          MATCH (p:Person {user_id: $user_id})
          WHERE p.canonical_name = toLower($name)
          RETURN p.entity_key as entity_key, p.canonical_name as matched_name
          LIMIT 1
        `;
        params = { user_id: state.userId, name: entity.name };
      } else {
        // Concept/Entity nodes use name (case-preserved)
        const nodeLabel = entity.entity_type;
        query = `
          MATCH (n:${nodeLabel} {user_id: $user_id})
          WHERE toLower(n.name) = toLower($name)
          RETURN n.entity_key as entity_key, n.name as matched_name
          LIMIT 1
        `;
        params = { user_id: state.userId, name: entity.name };
      }

      const result = await neo4jService.executeQuery<{ entity_key: string; matched_name: string }>(query, params);
      if (result[0]?.entity_key) {
        entityKeys.push({
          type: entity.entity_type,
          entity_key: result[0].entity_key,
        });
        console.log(`        ✓ Resolved ${entity.entity_type} "${entity.name}" → matched "${result[0].matched_name}"`);
      } else {
        failedEntities.push({
          name: entity.name,
          type: entity.entity_type,
          reason: 'No matching node found in Neo4j',
        });
        console.log(`        ✗ FAILED to resolve ${entity.entity_type} "${entity.name}" - no match in Neo4j`);
      }
    }

    // Create [:mentions] edges from Source to all entities
    if (entityKeys.length > 0) {
      await sourceRepository.linkToEntities(state.sourceEntityKey, entityKeys);
      console.log(`     → Successfully linked Source to ${entityKeys.length}/${state.entities.length} entities`);
    }

    if (failedEntities.length > 0) {
      console.log(`     ⚠️  WARNING: ${failedEntities.length} entities failed to link:`);
      failedEntities.forEach((e) => {
        console.log(`        - ${e.type} "${e.name}": ${e.reason}`);
      });
    }

    const processingTime = Date.now() - startTime;

    const result: IngestionResult = {
      dialogue_id: chunk.dialogue_id,
      user_id: userId,
      chunk_index: chunk.chunk_index,
      source_id: sourceId,
      source_entity_key: state.sourceEntityKey,
      entities_created: phase1Output.filtered.length, // Entities extracted from Phase 1
      relationships_created: phase4Output.iterations, // Agent iterations (not actual relationship count)
      phase_outputs: {
        phase0: Array.isArray(phase0Output) ? phase0Output : [phase0Output],
        phase1: phase1Output,
        phase2: phase2Output,
        phase4: phase4Output,
      },
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
      phase_outputs: {},
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

  // Process each chunk
  const chunkResults: IngestionResult[] = [];
  let totalEntities = 0;
  let totalRelationships = 0;
  let totalProcessingTime = 0;
  let failedChunks = 0;

  for (const chunk of chunks) {
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

  // Parse --limit flag
  const limitIndex = args.indexOf('--limit');
  if (limitIndex !== -1 && args[limitIndex + 1]) {
    config.dialogue_limit = parseInt(args[limitIndex + 1], 10);
  }

  runLoCoMoIngestion(config)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { runLoCoMoIngestion, DEFAULT_CONFIG };
