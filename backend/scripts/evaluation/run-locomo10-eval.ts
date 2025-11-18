/**
 * LoCoMo10 Evaluation Pipeline
 *
 * Evaluates the memory system's ability to answer questions about ingested conversations
 *
 * Usage:
 *   pnpm tsx scripts/evaluation/run-locomo10-eval.ts [conversationIndex] [questionLimit]
 *
 * Examples:
 *   pnpm tsx scripts/evaluation/run-locomo10-eval.ts 0        # Evaluate conversation 0, all questions
 *   pnpm tsx scripts/evaluation/run-locomo10-eval.ts 0 10     # Evaluate conversation 0, first 10 questions
 *   pnpm tsx scripts/evaluation/run-locomo10-eval.ts 5        # Evaluate conversation 5
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
import { ingestLoCoMo10Conversation } from './locomo10-ingestion.js';
import { callChatController } from './chat-caller.js';
import { compareAnswers } from './answer-comparison.js';
import type { LoCoMo10EvalReport, LoCoMo10EvalResult } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface EvalConfig {
  conversationIndex: number; // 0-9
  userId: string;
  outputDir: string;
  questionLimit?: number; // For testing
  sessionLimit?: number; // Limit sessions to ingest (for testing)
}

/**
 * Run the LoCoMo10 evaluation pipeline
 */
async function runEvaluation(config: EvalConfig): Promise<void> {
  // Generate unique run ID for this evaluation (8 random hex chars)
  const runId = crypto.randomBytes(4).toString('hex');

  console.log('🎯 LoCoMo10 Evaluation Pipeline\n');
  console.log('Configuration:');
  console.log(`  Run ID: ${runId}`);
  console.log(`  Conversation index: ${config.conversationIndex}`);
  console.log(`  User ID: ${config.userId}`);
  console.log(`  Output directory: ${config.outputDir}`);
  if (config.sessionLimit) {
    console.log(`  Session limit: ${config.sessionLimit} (testing mode)`);
  }
  if (config.questionLimit) {
    console.log(`  Question limit: ${config.questionLimit} (testing mode)`);
  }
  console.log('');

  const datasetPath = path.join(__dirname, '../../datasets/locomo10.json');

  // Initialize tracing
  await initTracing();

  // Step 1: Load dataset
  console.log('📂 Loading LoCoMo10 dataset...');
  const conversations = await loadLoCoMo10Dataset(datasetPath);
  console.log(`✅ Loaded ${conversations.length} conversations\n`);

  if (config.conversationIndex >= conversations.length) {
    throw new Error(
      `Invalid conversation index: ${config.conversationIndex} (valid range: 0-${conversations.length - 1})`
    );
  }

  const conversation = conversations[config.conversationIndex];
  console.log(`📖 Selected conversation: ${conversation.sample_id}`);
  console.log(`   Total QA pairs: ${conversation.qa.length}`);
  console.log('');

  // Step 2: Connect to Neo4j and ingest all sessions
  console.log('🔌 Connecting to Neo4j...');
  await neo4jService.connect();
  console.log('✅ Neo4j connected\n');

  let conversationId: string;
  let ingestionTimeMs: number;
  let sessionCount: number;

  try {
    const ingestionResult = await ingestLoCoMo10Conversation(
      conversation,
      config.userId,
      config.sessionLimit,
      runId // Pass unique run ID for trace grouping
    );
    conversationId = ingestionResult.conversationId;
    ingestionTimeMs = ingestionResult.processingTimeMs;
    sessionCount = ingestionResult.sessionCount;
  } catch (error) {
    console.error('❌ Ingestion failed:', error);
    await neo4jService.close();
    throw error;
  }

  // Step 3: Evaluate QA pairs
  const questions = config.questionLimit
    ? conversation.qa.slice(0, config.questionLimit)
    : conversation.qa;

  console.log(`❓ Evaluating ${questions.length} questions...\n`);

  const results: LoCoMo10EvalResult[] = [];

  for (let i = 0; i < questions.length; i++) {
    const qa = questions[i];
    const categoryName =
      qa.category === 1 ? 'factual' : qa.category === 2 ? 'temporal' : qa.category === 3 ? 'reasoning' : 'other';

    console.log(`[${i + 1}/${questions.length}] Category: ${categoryName}`);
    console.log(`Question: ${qa.question}`);
    console.log(`Expected: ${qa.answer}`);

    const startTime = Date.now();

    // Build session ID with run ID for unique trace grouping
    const sessionId = `${conversationId}-${runId}`;

    // Wrap Q&A evaluation in a span with session ID for Langfuse grouping
    const result = await withSpan(
      'qa_evaluation',
      {
        [TraceAttributes.SESSION_ID]: sessionId, // Unique session ID per evaluation run
        [TraceAttributes.CONVERSATION_ID]: conversationId,
        [TraceAttributes.USER_ID]: config.userId,
        sample_id: conversation.sample_id,
        question_id: i,
        category: categoryName,
        category_code: qa.category,
        run_id: runId,
      },
      async () => {
        try {
          // Call chat controller to get answer
          const ourAnswer = await callChatController(qa.question, config.userId, conversationId);

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

  // Step 4: Generate report
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
    conversation_index: config.conversationIndex,
    total_sessions: sessionCount,
    ingestion_time_ms: ingestionTimeMs,
    total_questions: results.length,
    results,
    avg_score: avgScore,
    avg_latency_ms: avgLatency,
    category_scores: categoryScores,
  };

  // Step 5: Save report
  await fs.mkdir(config.outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(config.outputDir, `eval-${conversation.sample_id}-${timestamp}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  // Step 6: Print summary
  console.log('═══════════════════════════════════════════════════════');
  console.log('📊 EVALUATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Conversation: ${conversation.sample_id}`);
  console.log(`Sessions ingested: ${sessionCount}`);
  console.log(`Ingestion time: ${(ingestionTimeMs / 1000).toFixed(2)}s`);
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
  console.log('✅ Evaluation complete!\n');
}

// CLI Entry Point
if (import.meta.url === `file://${process.argv[1]}`) {
  // Parse conversation index (default to 0 if not provided)
  let conversationIndex = 0;
  if (process.argv[2]) {
    conversationIndex = parseInt(process.argv[2], 10);
    if (isNaN(conversationIndex)) {
      console.error('Error: conversationIndex must be a number (0-9)');
      process.exit(1);
    }
  }

  // Parse optional flags: --session-limit N, --question-limit N
  let sessionLimit: number | undefined;
  let questionLimit: number | undefined;

  for (let i = 3; i < process.argv.length; i++) {
    if (process.argv[i] === '--session-limit' && process.argv[i + 1]) {
      sessionLimit = parseInt(process.argv[i + 1], 10);
      if (isNaN(sessionLimit)) {
        console.error('Error: --session-limit must be a number');
        process.exit(1);
      }
      i++; // Skip next arg
    } else if (process.argv[i] === '--question-limit' && process.argv[i + 1]) {
      questionLimit = parseInt(process.argv[i + 1], 10);
      if (isNaN(questionLimit)) {
        console.error('Error: --question-limit must be a number');
        process.exit(1);
      }
      i++; // Skip next arg
    } else if (!process.argv[i].startsWith('--')) {
      // Legacy support: if a number without flag, treat as question limit
      const legacyLimit = parseInt(process.argv[i], 10);
      if (!isNaN(legacyLimit) && !questionLimit) {
        questionLimit = legacyLimit;
      }
    }
  }

  runEvaluation({
    conversationIndex,
    userId: 'locomo10-eval-user',
    outputDir: path.join(__dirname, '../../../output/locomo10-eval'),
    sessionLimit,
    questionLimit,
  })
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    });
}

export { runEvaluation };
