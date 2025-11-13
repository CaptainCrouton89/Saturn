import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import fs from 'fs';
import path from 'path';
import { NOTES_EXTRACTION_SYSTEM_PROMPT } from "../../src/agents/prompts/ingestion/index.js";
import { PipelineConfig, PipelineState } from './types.js';

/**
 * Phase 0: Convert STT transcript to structured notes
 *
 * For voice memos and other STT sources, clean up disfluencies and organize
 * into coherent structured notes. Skip for other source types.
 */
export async function runPhase0(state: PipelineState, config: PipelineConfig): Promise<string> {
  console.log(`\n${'='.repeat(80)}`);
  console.log('PHASE 0: Convert to Structured Notes');
  console.log('='.repeat(80));

  // Skip if not in phase range
  if (config.startPhase > 0 || config.maxPhase < 0) {
    console.log(`⏭️  Skipped (startPhase=${config.startPhase})\n`);

    const notesPath = path.join(config.outputDir, 'pipeline-phase0-notes.txt');
    if (fs.existsSync(notesPath)) {
      const existingNotes = fs.readFileSync(notesPath, 'utf-8');
      console.log(`📂 Loaded existing notes from previous run\n`);
      return existingNotes;
    }
    return state.transcript;
  }

  // Skip if not an STT source
  const sttSourceTypes = ['voice-memo', 'meeting', 'phone-call', 'voice-note'];
  if (!sttSourceTypes.includes(state.sourceType)) {
    console.log(`⏭️  Skipping (source_type="${state.sourceType}" is not STT source)\n`);
    return state.transcript;
  }

  console.log(`📝 Converting transcript to structured notes\n`);

  const model = new ChatOpenAI({
    modelName: 'gpt-5-nano',
    reasoning: { effort: 'medium' },
  });

  const messages = [
    new SystemMessage(NOTES_EXTRACTION_SYSTEM_PROMPT),
    new HumanMessage(`## Transcript\n\n${state.transcript}\n\n## Instructions\n\nConvert the transcript to structured notes, in chronological order.`),
  ];

  const startTime = Date.now();
  const response = await model.invoke(messages);
  const duration = Date.now() - startTime;

  const structuredNotes = typeof response.content === 'string' ? response.content : String(response.content);

  console.log(`✅ Conversion completed in ${duration}ms`);
  console.log(`📉 Compression: ${state.transcript.length} → ${structuredNotes.length} chars`);

  const outputPath = path.join(config.outputDir, 'pipeline-phase0-notes.txt');
  fs.writeFileSync(outputPath, structuredNotes);
  console.log(`💾 Saved to: ${outputPath}\n`);

  return structuredNotes;
}
