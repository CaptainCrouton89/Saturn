import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PipelineState, PipelineConfig } from './types.js';
import { MockNeo4j } from './mock-neo4j.js';
import { runPhase0 } from './phase0.js';
import { runPhase1 } from './phase1.js';
import { runPhase2 } from './phase2.js';
import { runPhase3 } from './phase3.js';
import { runPhase4 } from './phase4.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

const CONFIG: PipelineConfig = {
  conversationId: 'test-conversation-123',
  userId: 'test-user-456',
  sourceType: 'voice-memo', // 'voice-memo' | 'conversation' | 'meeting' | 'phone-call' | 'voice-note'
  sampleDataPath: path.join(__dirname, '../../../sample-memo.txt'),
  outputDir: path.join(__dirname, '../..'),
  startPhase: 0, // Start from phase N (0-4)
  maxPhase: 4, // Stop after phase N (0-4)
};

// ============================================================================
// Main Pipeline Runner
// ============================================================================

async function runPipeline() {
  console.log('🧪 Ingestion Pipeline - Modular Architecture\n');
  console.log('Configuration:');
  console.log(`  Conversation ID: ${CONFIG.conversationId}`);
  console.log(`  User ID: ${CONFIG.userId}`);
  console.log(`  Source Type: ${CONFIG.sourceType}`);
  console.log(`  Sample Data: ${CONFIG.sampleDataPath}`);
  console.log(`  Phase Range: ${CONFIG.startPhase} → ${CONFIG.maxPhase}\n`);

  const transcript = fs.readFileSync(CONFIG.sampleDataPath, 'utf-8');
  const summary = 'Test conversation about personal interests and relationships';

  const state: PipelineState = {
    conversationId: CONFIG.conversationId,
    userId: CONFIG.userId,
    transcript,
    summary,
    sourceType: CONFIG.sourceType,
    entities: [],
    sourceEntityKey: '',
    episodeEntityKey: '',
    nodesWithUpdates: [],
  };

  const neo4j = new MockNeo4j(CONFIG.userId);

  try {
    // Phase 0: Convert to Structured Notes
    if (CONFIG.startPhase <= 0 && CONFIG.maxPhase >= 0) {
      state.transcript = await runPhase0(state, CONFIG);
    } else {
      console.log('⏭️  Phase 0 skipped\n');
      // Try to load from previous run
      const notesPath = path.join(CONFIG.outputDir, 'pipeline-phase0-notes.txt');
      if (fs.existsSync(notesPath)) {
        state.transcript = fs.readFileSync(notesPath, 'utf-8');
        console.log(`📂 Loaded Phase 0 output from previous run\n`);
      }
    }

    // Phase 1: Extract Entities
    if (CONFIG.startPhase <= 1 && CONFIG.maxPhase >= 1) {
      state.entities = await runPhase1(state.transcript, CONFIG);
    } else {
      console.log('⏭️  Phase 1 skipped\n');
      // Try to load from previous run
      const entitiesPath = path.join(CONFIG.outputDir, 'pipeline-phase1-entities.json');
      if (fs.existsSync(entitiesPath)) {
        const data = JSON.parse(fs.readFileSync(entitiesPath, 'utf-8'));
        state.entities = data.filtered;
        console.log(`📂 Loaded Phase 1 output from previous run (${state.entities.length} entities)\n`);
      }
    }

    // Phase 2: Create Source and Episode Nodes
    if (CONFIG.startPhase <= 2 && CONFIG.maxPhase >= 2) {
      const { sourceEntityKey, episodeEntityKey } = await runPhase2(state, CONFIG);
      state.sourceEntityKey = sourceEntityKey;
      state.episodeEntityKey = episodeEntityKey;
    } else {
      console.log('⏭️  Phase 2 skipped\n');
      // Try to load from previous run
      const sourcePath = path.join(CONFIG.outputDir, 'pipeline-phase2-source.json');
      if (fs.existsSync(sourcePath)) {
        const data = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
        // Handle both old format (flat) and new format (nested source/episode)
        if (data.source && data.episode) {
          state.sourceEntityKey = data.source.entity_key;
          state.episodeEntityKey = data.episode.entity_key;
        } else if (data.entity_key) {
          // Old format - only has source
          state.sourceEntityKey = data.entity_key;
          console.log('⚠️  Warning: Episode data not found in previous run (old format)\n');
        }
        console.log(`📂 Loaded Phase 2 output from previous run\n`);
      }
    }

    // Phase 3: Collect Updates
    if (CONFIG.startPhase <= 3 && CONFIG.maxPhase >= 3) {
      state.nodesWithUpdates = await runPhase3(state, CONFIG);
    } else {
      console.log('⏭️  Phase 3 skipped\n');
      // Try to load from previous run
      const updatesPath = path.join(CONFIG.outputDir, 'pipeline-phase3-updates.json');
      if (fs.existsSync(updatesPath)) {
        state.nodesWithUpdates = JSON.parse(fs.readFileSync(updatesPath, 'utf-8'));
        console.log(`📂 Loaded Phase 3 output from previous run (${state.nodesWithUpdates.length} nodes)\n`);
      }
    }

    // Phase 4: Process Updates
    if (CONFIG.startPhase <= 4 && CONFIG.maxPhase >= 4) {
      await runPhase4(state, CONFIG, neo4j);
    } else {
      console.log('⏭️  Phase 4 skipped\n');
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('✅ PIPELINE COMPLETE');
    console.log('='.repeat(80));
    console.log(`📊 Final Results:`);
    console.log(`  - Nodes created: ${neo4j.nodes.length}`);
    console.log(`  - Relationships created: ${neo4j.relationships.length}`);
    console.log(`\nOutput files:`);
    console.log(`  - ${path.join(CONFIG.outputDir, 'pipeline-phase0-notes.txt')}`);
    console.log(`  - ${path.join(CONFIG.outputDir, 'pipeline-phase1-entities.json')}`);
    console.log(`  - ${path.join(CONFIG.outputDir, 'pipeline-phase2-source.json')}`);
    console.log(`  - ${path.join(CONFIG.outputDir, 'pipeline-phase3-updates.json')}`);
    console.log(`  - ${path.join(CONFIG.outputDir, 'pipeline-phase4-graph.json')}\n`);
  } catch (error) {
    console.error('❌ Pipeline failed:', error);
    throw error;
  }
}

// Run the pipeline
runPipeline().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
