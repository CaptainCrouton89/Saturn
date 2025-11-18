/**
 * Run QA Evaluation Only (Skip Ingestion)
 *
 * Runs ALL questions from a LoCoMo10 conversation against the existing graph data.
 * Use this after data is already ingested to just test QA performance.
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { neo4jService } from '../../src/db/neo4j.js';
import { initTracing } from '../../src/config/tracing.js';
import { withSpan, TraceAttributes } from '../../src/utils/tracing.js';
import { loadLoCoMo10Dataset } from './locomo10-adapter.js';
import { callChatController } from './chat-caller.js';
import { compareAnswers } from './answer-comparison.js';
import type { LoCoMo10EvalReport, LoCoMo10EvalResult } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runQAOnly() {
  // Generate unique run ID
  const runId = crypto.randomBytes(4).toString('hex');

  console.log('🎯 QA-Only Evaluation (Skipping Ingestion)\n');
  console.log('Configuration:');
  console.log(`  Run ID: ${runId}`);
  console.log(`  User ID: locomo10-eval-user`);
  console.log(`  Conversation: 0 (conv-26)`);
  console.log('');

  const datasetPath = path.join(__dirname, '../../datasets/locomo10.json');
  const userId = 'locomo10-eval-user';
  const outputDir = path.join(__dirname, '../../../output/locomo10-eval');

  // Initialize tracing
  await initTracing();

  // Load dataset
  console.log('📂 Loading LoCoMo10 dataset...');
  const conversations = await loadLoCoMo10Dataset(datasetPath);
  console.log(`✅ Loaded ${conversations.length} conversations\n`);

  const conversation = conversations[0]; // Conversation 0
  console.log(`📖 Selected conversation: ${conversation.sample_id}`);
  console.log(`   Total QA pairs: ${conversation.qa.length}`);
  console.log('');

  // Connect to Neo4j
  console.log('🔌 Connecting to Neo4j...');
  await neo4jService.connect();
  console.log('✅ Neo4j connected\n');

  // Evaluate ALL QA pairs
  console.log(`❓ Evaluating ${conversation.qa.length} questions...\n`);

  const results: LoCoMo10EvalResult[] = [];

  for (let i = 0; i < conversation.qa.length; i++) {
    const qa = conversation.qa[i];
    const categoryName =
      qa.category === 1 ? 'factual' : qa.category === 2 ? 'temporal' : qa.category === 3 ? 'reasoning' : 'other';

    console.log(`[${i + 1}/${conversation.qa.length}] Category: ${categoryName}`);
    console.log(`Question: ${qa.question}`);
    console.log(`Expected: ${qa.answer}`);

    const startTime = Date.now();

    // Build session ID with run ID for unique trace grouping
    const sessionId = `${conversation.sample_id}-qa-only-${runId}`;

    // Wrap Q&A evaluation in a span
    const result = await withSpan(
      'qa_evaluation',
      {
        [TraceAttributes.SESSION_ID]: sessionId,
        [TraceAttributes.USER_ID]: userId,
        sample_id: conversation.sample_id,
        question_id: i,
        category: categoryName,
        category_code: qa.category,
        run_id: runId,
        mode: 'qa-only',
      },
      async () => {
        try {
          // Call chat controller to get answer
          const ourAnswer = await callChatController(qa.question, userId);

          const latencyMs = Date.now() - startTime;

          console.log(`Our answer: ${ourAnswer}`);

          // Compare answers using LLM-as-judge
          const { score, reasoning } = await compareAnswers(qa.question, qa.answer, ourAnswer);

          console.log(`Score: ${(score * 100).toFixed(0)}% - ${reasoning}`);
          console.log(`Latency: ${latencyMs}ms`);
          console.log('');

          return {
            question_id: i,
            question: qa.question,
            expected_answer: String(qa.answer),
            our_answer: ourAnswer,
            category: qa.category,
            evidence: qa.evidence,
            score,
            reasoning,
            latency_ms: latencyMs,
          };
        } catch (error) {
          const latencyMs = Date.now() - startTime;
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';

          console.error(`❌ Error: ${errorMsg}`);
          console.log('');

          return {
            question_id: i,
            question: qa.question,
            expected_answer: String(qa.answer),
            our_answer: `ERROR: ${errorMsg}`,
            category: qa.category,
            evidence: qa.evidence,
            score: 0,
            reasoning: 'Evaluation failed',
            latency_ms: latencyMs,
          };
        }
      }
    );

    results.push(result);
  }

  // Generate report
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const avgLatency = results.reduce((sum, r) => sum + r.latency_ms, 0) / results.length;

  const factualResults = results.filter(r => r.category === 1);
  const temporalResults = results.filter(r => r.category === 2);
  const reasoningResults = results.filter(r => r.category === 3);
  const otherResults = results.filter(r => r.category === 4);

  const categoryScores = {
    factual: factualResults.length > 0 ? factualResults.reduce((sum, r) => sum + r.score, 0) / factualResults.length : 0,
    temporal:
      temporalResults.length > 0 ? temporalResults.reduce((sum, r) => sum + r.score, 0) / temporalResults.length : 0,
    reasoning:
      reasoningResults.length > 0 ? reasoningResults.reduce((sum, r) => sum + r.score, 0) / reasoningResults.length : 0,
    other: otherResults.length > 0 ? otherResults.reduce((sum, r) => sum + r.score, 0) / otherResults.length : 0,
  };

  const report: LoCoMo10EvalReport = {
    sample_id: conversation.sample_id,
    conversation_index: 0,
    total_sessions: 19, // Known from previous ingestion
    ingestion_time_ms: 0, // Not measured (skipped)
    total_questions: results.length,
    results,
    avg_score: avgScore,
    avg_latency_ms: avgLatency,
    category_scores: categoryScores,
  };

  // Save report
  await fs.mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(outputDir, `eval-qa-only-${conversation.sample_id}-${timestamp}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  // Print summary
  console.log('═══════════════════════════════════════════════════════');
  console.log('📊 QA-ONLY EVALUATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Conversation: ${conversation.sample_id}`);
  console.log(`Questions evaluated: ${results.length}`);
  console.log('');
  console.log('Overall Performance:');
  console.log(`  Average Score: ${(avgScore * 100).toFixed(1)}%`);
  console.log(`  Average Latency: ${avgLatency.toFixed(0)}ms`);
  console.log('');
  console.log('Category Scores:');
  console.log(`  Factual (${factualResults.length} questions): ${(categoryScores.factual * 100).toFixed(1)}%`);
  console.log(`  Temporal (${temporalResults.length} questions): ${(categoryScores.temporal * 100).toFixed(1)}%`);
  console.log(`  Reasoning (${reasoningResults.length} questions): ${(categoryScores.reasoning * 100).toFixed(1)}%`);
  if (otherResults.length > 0) {
    console.log(`  Other (${otherResults.length} questions): ${(categoryScores.other * 100).toFixed(1)}%`);
  }
  console.log('');
  console.log(`💾 Report saved: ${reportPath}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Cleanup
  await neo4jService.close();
  console.log('✅ QA Evaluation complete!\n');
}

// Run
runQAOnly()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
