import fs from 'fs';
import path from 'path';
import { sourceRepository } from '../../src/repositories/SourceRepository.js';
import { PipelineState, PipelineConfig } from './types.js';
import type { Phase2Output } from '../evaluation/types.js';

/**
 * Phase 2: Create Source Node ONLY
 *
 * Creates Source node in Neo4j with full schema:
 * - Raw content, processed content, summary, keywords, tags
 * - Processing status set to 'extracted' (Phase 0 and Phase 1 completed)
 *
 * NOTE: Entity nodes and relationships are created in Phase 4.
 * This phase only creates the Source node.
 *
 * This phase uses real Neo4j via SourceRepository.
 */
export async function runPhase2(
  state: PipelineState,
  config: PipelineConfig
): Promise<Phase2Output> {
  console.log(`\n${'='.repeat(80)}`);
  console.log('PHASE 2: Create Source Node');
  console.log('='.repeat(80));
  console.log('📦 Creating Source node in Neo4j\n');

  // Create Source node with full schema
  const source = await sourceRepository.create({
    user_id: state.userId,
    description: state.summary,
    source_type: state.sourceType,
    summary: state.summary,
    raw_content: state.transcript, // Raw text
    content: {
      type: state.sourceType,
      content: state.transcript,
    },
    participants: [state.userId],
    started_at: new Date().toISOString(), // ISO timestamp string
    keywords: [],
    tags: [],
    processing_status: 'extracted',
  });

  const sourceEntityKey = source.entity_key;
  console.log(`✅ Created Source node: ${sourceEntityKey}`);
  console.log(`   - User ID: ${state.userId}`);
  console.log(`   - Type: ${state.sourceType}`);
  console.log(`   - Summary: ${state.summary.substring(0, 80)}...`);

  console.log(`\n📋 Extracted entities (to be created in Phase 4): ${state.entities.length}`);
  if (state.entities.length > 0) {
    state.entities.forEach((e) => {
      console.log(`   - ${e.name} (${e.entity_type})`);
    });
  }

  // Save output for Phase 4
  const outputData: Phase2Output = {
    source: {
      entity_key: sourceEntityKey,
      user_id: state.userId,
      source_type: state.sourceType,
      content_raw: state.transcript,
      summary: state.summary,
    },
    mentioned_entities: state.entities,
  };

  const outputPath = path.join(config.outputDir, 'pipeline-phase2-source.json');
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`\n💾 Saved to: ${outputPath}\n`);

  return outputData;
}
