import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PipelineState, PipelineConfig } from './types.js';
import { runPhase0 } from './phase0.js';
import { runPhase1 } from './phase1.js';
import { runPhase2 } from './phase2.js';
import { runPhase4 } from './phase4.js';
import { runPhase5 } from './phase5.js';
import { neo4jService } from '../../src/db/neo4j.js';

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
  startPhase: 4, // Start from phase N (0, 1, 2, 4, or 5)
  maxPhase: 4, // Stop after phase N (0, 1, 2, 4, or 5) - Note: Phase 3 removed
  mockUserName: 'Saturn Test User',
};

// ============================================================================
// Main Pipeline Runner
// ============================================================================

async function runPipeline() {
  console.log('🧪 Ingestion Pipeline - 5-Phase Architecture\n');
  console.log('Configuration:');
  console.log(`  Conversation ID: ${CONFIG.conversationId}`);
  console.log(`  User ID: ${CONFIG.userId}`);
  console.log(`  Source Type: ${CONFIG.sourceType}`);
  console.log(`  Sample Data: ${CONFIG.sampleDataPath}`);
  console.log(`  Phase Range: ${CONFIG.startPhase} → ${CONFIG.maxPhase}`);
  console.log(`  Architecture: Phase 0 (optional) → Phase 1 → Phase 2 → Phase 4 → Phase 5 (consolidation)\n`);

  // Initialize Neo4j connection
  console.log('🔌 Connecting to Neo4j...');
  await neo4jService.connect();
  console.log('✅ Neo4j connected\n');

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
  };

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

    // Phase 2: Create Source Node and Link to Entities
    if (CONFIG.startPhase <= 2 && CONFIG.maxPhase >= 2) {
      state.sourceEntityKey = await runPhase2(state, CONFIG);
    } else {
      console.log('⏭️  Phase 2 skipped\n');
      // Try to load from previous run
      const sourcePath = path.join(CONFIG.outputDir, 'pipeline-phase2-source.json');
      if (fs.existsSync(sourcePath)) {
        const data = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
        if (data.source) {
          state.sourceEntityKey = data.source.entity_key;
        } else if (data.entity_key) {
          // Old format - direct entity_key
          state.sourceEntityKey = data.entity_key;
        }
        console.log(`📂 Loaded Phase 2 output from previous run\n`);
      }
    }

    // Phase 4: Create Nodes and Relationships (Phase 3 removed)
    if (CONFIG.startPhase <= 4 && CONFIG.maxPhase >= 4) {
      await runPhase4(state, CONFIG);
    } else {
      console.log('⏭️  Phase 4 skipped\n');
    }

    // Phase 5: Daily Consolidation (nightly job - processes dirty nodes/relationships)
    if (CONFIG.startPhase <= 5 && CONFIG.maxPhase >= 5) {
      await runPhase5(state, CONFIG);
    } else {
      console.log('⏭️  Phase 5 skipped\n');
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log('✅ PIPELINE COMPLETE');
    console.log('='.repeat(80));
    console.log(`📊 Final Results:`);
    console.log(`  - Entities extracted: ${state.entities.length}`);
    console.log(`  - Source node: ${state.sourceEntityKey}`);
    console.log(`\nOutput files:`);
    if (CONFIG.startPhase <= 0 && CONFIG.maxPhase >= 0) {
      console.log(`  - ${path.join(CONFIG.outputDir, 'pipeline-phase0-notes.txt')}`);
    }
    if (CONFIG.startPhase <= 1 && CONFIG.maxPhase >= 1) {
      console.log(`  - ${path.join(CONFIG.outputDir, 'pipeline-phase1-entities.json')}`);
    }
    if (CONFIG.startPhase <= 2 && CONFIG.maxPhase >= 2) {
      console.log(`  - ${path.join(CONFIG.outputDir, 'pipeline-phase2-source.json')}`);
    }
    if (CONFIG.startPhase <= 4 && CONFIG.maxPhase >= 4) {
      console.log(`  - ${path.join(CONFIG.outputDir, 'pipeline-phase4-graph.json')}`);
    }
    if (CONFIG.startPhase <= 5 && CONFIG.maxPhase >= 5) {
      console.log(`  - ${path.join(CONFIG.outputDir, 'pipeline-phase5-consolidation.json')}`);
    }
    console.log();
  } catch (error) {
    console.error('❌ Pipeline failed:', error);
    throw error;
  } finally {
    // Cleanup Neo4j connection
    console.log('🔌 Disconnecting from Neo4j...');
    await neo4jService.close();
    console.log('✅ Neo4j disconnected\n');
  }
}

// Run the pipeline
runPipeline().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
