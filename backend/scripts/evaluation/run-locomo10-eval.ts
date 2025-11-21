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
import type { LoCoMo10EvalReport, LoCoMo10EvalResult } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Process an array in batches with Promise.all
 */
async function processBatch<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((item, batchIndex) => processor(item, i + batchIndex)));
    results.push(...batchResults);
  }
  return results;
}

interface EvalConfig {
  conversationIndex: number; // 0-9
  userId: string;
  outputDir: string;
  questionLimit?: number; // For testing
  sessionLimit?: number; // Limit sessions to ingest (for testing)
  sessionOffset?: number; // Skip first N sessions (for testing)
  concurrency?: number; // Number of questions to process in parallel (default: 5)
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
  if (config.sessionOffset) {
    console.log(`  Session offset: ${config.sessionOffset} (skipping first ${config.sessionOffset} sessions)`);
  }
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
      config.sessionOffset,
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

  // Step 3: Generate answers for QA pairs (parallel processing, no scoring)
  const questions = config.questionLimit
    ? conversation.qa.slice(0, config.questionLimit)
    : conversation.qa;

  const concurrency = config.concurrency ?? 5;
  console.log(`❓ Generating answers for ${questions.length} questions (concurrency: ${concurrency})...\n`);

  // Build session ID with run ID for unique trace grouping
  const sessionId = `${conversationId}-${runId}`;

  // Process questions in parallel batches
  const results = await processBatch(
    questions,
    concurrency,
    async (qa, i): Promise<LoCoMo10EvalResult> => {
      const categoryName =
        qa.category === 1 ? 'factual' : qa.category === 2 ? 'temporal' : qa.category === 3 ? 'reasoning' : 'other';

      console.log(`[${i + 1}/${questions.length}] Category: ${categoryName}`);
      console.log(`Question: ${qa.question}`);
      console.log(`Expected: ${qa.answer}`);

      const startTime = Date.now();

      // Wrap Q&A answer generation in a span with session ID for Langfuse grouping
      return await withSpan(
        'qa_answer_generation',
        {
          [TraceAttributes.SESSION_ID]: sessionId,
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
            console.log(`Latency: ${latencyMs}ms`);
            console.log('');

            return {
              question_id: i,
              question: qa.question,
              expected_answer: String(qa.answer),
              our_answer: ourAnswer,
              category: qa.category,
              evidence: qa.evidence,
              // No scoring yet
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
              latency_ms: latencyMs,
            };
          }
        }
      );
    }
  );

  // Step 4: Generate report (without scoring)
  const avgLatency = results.reduce((sum, r) => sum + r.latency_ms, 0) / results.length;

  const factualResults = results.filter(r => r.category === 1);
  const temporalResults = results.filter(r => r.category === 2);
  const reasoningResults = results.filter(r => r.category === 3);
  const otherResults = results.filter(r => r.category === 4);

  const report: LoCoMo10EvalReport = {
    sample_id: conversation.sample_id,
    conversation_index: config.conversationIndex,
    total_sessions: sessionCount,
    ingestion_time_ms: ingestionTimeMs,
    total_questions: results.length,
    results,
    scored: false, // Scoring not performed yet
    avg_latency_ms: avgLatency,
    // No score fields until scoring is performed
  };

  // Step 5: Save report
  await fs.mkdir(config.outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(config.outputDir, `answers-${conversation.sample_id}-${timestamp}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  // Step 6: Print summary
  console.log('═══════════════════════════════════════════════════════');
  console.log('📝 ANSWER GENERATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Conversation: ${conversation.sample_id}`);
  console.log(`Sessions ingested: ${sessionCount}`);
  console.log(`Ingestion time: ${(ingestionTimeMs / 1000).toFixed(2)}s`);
  console.log(`Questions answered: ${results.length}`);
  console.log('');
  console.log('Question Breakdown:');
  console.log(`  Factual: ${factualResults.length} questions`);
  console.log(`  Temporal: ${temporalResults.length} questions`);
  console.log(`  Reasoning: ${reasoningResults.length} questions`);
  if (otherResults.length > 0) {
    console.log(`  Other: ${otherResults.length} questions`);
  }
  console.log('');
  console.log('Performance:');
  console.log(`  Average Latency: ${avgLatency.toFixed(0)}ms per question`);
  console.log(`  Concurrency: ${concurrency} parallel questions`);
  console.log('');
  console.log(`💾 Answers saved: ${reportPath}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  Score answers: pnpm tsx scripts/evaluation/score-locomo10-eval.ts "${reportPath}"`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Cleanup
  await neo4jService.close();
  console.log('✅ Answer generation complete!\n');
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

  // Parse optional flags: --session-limit N, --session-offset N, --question-limit N, --concurrency N
  let sessionLimit: number | undefined;
  let sessionOffset: number | undefined;
  let questionLimit: number | undefined;
  let concurrency: number | undefined;

  for (let i = 3; i < process.argv.length; i++) {
    if (process.argv[i] === '--session-limit' && process.argv[i + 1]) {
      sessionLimit = parseInt(process.argv[i + 1], 10);
      if (isNaN(sessionLimit)) {
        console.error('Error: --session-limit must be a number');
        process.exit(1);
      }
      i++; // Skip next arg
    } else if (process.argv[i] === '--session-offset' && process.argv[i + 1]) {
      sessionOffset = parseInt(process.argv[i + 1], 10);
      if (isNaN(sessionOffset)) {
        console.error('Error: --session-offset must be a number');
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
    } else if (process.argv[i] === '--concurrency' && process.argv[i + 1]) {
      concurrency = parseInt(process.argv[i + 1], 10);
      if (isNaN(concurrency)) {
        console.error('Error: --concurrency must be a number');
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
    sessionOffset,
    questionLimit,
    concurrency,
  })
    .then(() => process.exit(0))
    .catch(error => {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    });
}

export { runEvaluation };
