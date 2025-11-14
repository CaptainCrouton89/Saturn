import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import fs from 'fs';
import path from 'path';
import { EXTRACTION_SYSTEM_PROMPT } from '../../src/agents/prompts/ingestion/index.js';
import { ExtractedEntity, ExtractionOutputSchema, PipelineConfig } from './types.js';

/**
 * Phase 1: Extract entities from transcript
 *
 * Uses structured output to extract People, Concepts, and Entities
 * with confidence scores and subpoints. Filters by confidence threshold.
 */
export async function runPhase1(transcript: string, config: PipelineConfig): Promise<{ all: ExtractedEntity[]; filtered: ExtractedEntity[]; filters: { confidenceThreshold: number; minSubpoints: number } }> {
  console.log(`\n${'='.repeat(80)}`);
  console.log('PHASE 1: Extract and Disambiguate Entities');
  console.log('='.repeat(80));
  console.log('🔍 Extracting People, Concepts, and Entities\n');

  const model = new ChatOpenAI({ modelName: 'gpt-4.1-mini' }).withStructuredOutput(ExtractionOutputSchema);

  const messages = [
    new SystemMessage(EXTRACTION_SYSTEM_PROMPT),
    new HumanMessage(`## Transcript\n\n${transcript}\n\n## Instructions\n\nExtract all People, Concepts, and Entities mentioned in the transcript.`),
  ];

  const startTime = Date.now();
  const result = await model.invoke(messages);
  const duration = Date.now() - startTime;

  result.entities.sort((a, b) => b.confidence - a.confidence);

  console.log(`✅ Extraction completed in ${duration}ms`);
  console.log(`📋 Extracted ${result.entities.length} entities\n`);

  result.entities.forEach((e, idx) => {
    console.log(`  ${idx + 1}. ${e.name} (${e.entity_type}) [confidence: ${e.confidence}/10]`);
  });

  const CONFIDENCE_THRESHOLD = 7;
  const SUBPOINTS_THRESHOLD = 2;
  const filtered = result.entities.filter(
    (e) => e.confidence >= CONFIDENCE_THRESHOLD && (e.subpoints?.length ?? 0) > SUBPOINTS_THRESHOLD
  );

  console.log(`\n✅ Final extraction: ${filtered.length} entities (confidence >=${CONFIDENCE_THRESHOLD}, subpoints >${SUBPOINTS_THRESHOLD})\n`);

  // Normalize entities for Neo4j
  const normalizedAll = result.entities.map(e => ({
    name: e.name,
    entity_type: e.entity_type,
    confidence: e.confidence,
    subpoints: e.subpoints ?? [],
  }));

  const normalizedFiltered = filtered.map(e => ({
    name: e.name,
    entity_type: e.entity_type,
    confidence: e.confidence,
    subpoints: e.subpoints ?? [],
  }));

  const outputPath = path.join(config.outputDir, 'pipeline-phase1-entities.json');
  fs.writeFileSync(
    outputPath,
    JSON.stringify({ all: normalizedAll, filtered: normalizedFiltered, filters: { confidenceThreshold: CONFIDENCE_THRESHOLD, minSubpoints: SUBPOINTS_THRESHOLD } }, null, 2)
  );
  console.log(`💾 Saved to: ${outputPath}\n`);

  return {
    all: normalizedAll,
    filtered: normalizedFiltered,
    filters: {
      confidenceThreshold: CONFIDENCE_THRESHOLD,
      minSubpoints: SUBPOINTS_THRESHOLD,
    },
  };
}
