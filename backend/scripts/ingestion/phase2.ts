import fs from 'fs';
import path from 'path';
import { PipelineState, PipelineConfig } from './types.js';

/**
 * Phase 2: Create Source and Episode nodes
 *
 * Creates mock Source and Episode nodes representing the conversation/transcript.
 * Episode groups related Sources by context (e.g., work session, phone call).
 * In production, these would be stored in Neo4j.
 */
export async function runPhase2(
  state: PipelineState,
  config: PipelineConfig
): Promise<{ sourceEntityKey: string; episodeEntityKey: string }> {
  console.log(`\n${'='.repeat(80)}`);
  console.log('PHASE 2: Create Source and Episode Nodes');
  console.log('='.repeat(80));
  console.log('📦 Creating Source and Episode nodes (mocked)\n');

  // Create Source node
  const sourceEntityKey = `source_${state.conversationId}_${state.userId}`;
  const mockSource = {
    entity_key: sourceEntityKey,
    user_id: state.userId,
    description: state.summary,
    content: { type: state.sourceType, content: state.transcript },
    created_at: new Date().toISOString(),
  };

  console.log(`✅ Created Source node: ${sourceEntityKey}`);

  // Create Episode node
  // Use provided episodeId or generate from conversationId (1:1 mapping for now)
  const episodeId = config.episodeId || state.conversationId;
  const episodeEntityKey = `episode_${episodeId}_${state.userId}`;

  // Determine context_type from config or sourceType
  const contextType = config.episodeContextType || state.sourceType;

  // Default importance to 5 if not provided
  const importance = config.episodeImportance || 5;

  const mockEpisode = {
    entity_key: episodeEntityKey,
    episode_id: episodeId,
    user_id: state.userId,
    started_at: new Date().toISOString(),
    ended_at: null, // null for ongoing episodes
    summary: state.summary,
    context_type: contextType,
    importance,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  console.log(`✅ Created Episode node: ${episodeEntityKey}`);
  console.log(`   - Context Type: ${contextType}`);
  console.log(`   - Importance: ${importance}/10\n`);

  // Save output
  const outputData = {
    source: mockSource,
    episode: mockEpisode,
  };

  const outputPath = path.join(config.outputDir, 'pipeline-phase2-source.json');
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`💾 Saved to: ${outputPath}\n`);

  return { sourceEntityKey, episodeEntityKey };
}
