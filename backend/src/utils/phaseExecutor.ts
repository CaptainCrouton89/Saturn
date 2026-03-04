/**
 * Phase Execution Utility
 *
 * Provides standardized phase execution with automatic timing, error handling, and logging.
 * Used by ingestion orchestrator to reduce repetitive try-catch-timing patterns.
 */

import { withSpan } from './tracing.js';

/**
 * Phase execution options
 */
export interface PhaseExecutionOptions {
  /**
   * Error handling strategy
   * - 'throw': Re-throw errors after logging (abort pipeline)
   * - 'continue': Log error and return null (best-effort mode)
   */
  onError?: 'throw' | 'continue';

  /**
   * Optional OpenTelemetry span name for tracing
   */
  spanName?: string;

  /**
   * Optional span attributes for tracing
   */
  spanAttributes?: Record<string, string | number | boolean>;

  /**
   * Skip logging (for quiet phases)
   */
  silent?: boolean;
}

/**
 * Phase execution result
 */
export interface PhaseResult<T> {
  /**
   * Phase result (null if error occurred and onError='continue')
   */
  result: T | null;

  /**
   * Time elapsed in milliseconds
   */
  timeMs: number;

  /**
   * Error that occurred (if any)
   */
  error?: { phase: string; message: string };

  /**
   * Whether phase succeeded
   */
  success: boolean;
}

/**
 * Execute a phase with automatic timing, error handling, and logging
 *
 * @param phaseName - Human-readable phase name (e.g., "Content Normalization")
 * @param fn - Phase function to execute
 * @param options - Execution options
 * @returns Phase result with timing and error info
 *
 * @example
 * ```typescript
 * const { result, timeMs } = await executePhase(
 *   'Entity Extraction',
 *   async () => extractEntities(content),
 *   { onError: 'throw' }
 * );
 * ```
 */
export async function executePhase<T>(
  phaseName: string,
  fn: () => Promise<T>,
  options: PhaseExecutionOptions = {}
): Promise<PhaseResult<T>> {
  const { onError = 'throw', spanName, spanAttributes, silent = false } = options;

  const startTime = Date.now();

  if (!silent) {
    console.log(`\n🔄 ${phaseName}...`);
  }

  try {
    // Execute with optional tracing span
    const result = spanName
      ? await withSpan(spanName, spanAttributes || {}, fn)
      : await fn();

    const timeMs = Date.now() - startTime;

    if (!silent) {
      console.log(`   ✅ ${phaseName} complete (${timeMs}ms)`);
    }

    return {
      result,
      timeMs,
      success: true,
    };
  } catch (error) {
    const timeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    const phaseError = {
      phase: phaseName.toLowerCase().replace(/\s+/g, '_'),
      message: errorMessage,
    };

    console.error(`   ❌ ${phaseName} failed: ${errorMessage}`);

    if (error instanceof Error && error.stack) {
      console.error(`   Stack trace: ${error.stack}`);
    }

    if (onError === 'throw') {
      throw new Error(`${phaseName} failed: ${errorMessage}`);
    }

    // Continue mode: return null result with error details
    return {
      result: null,
      timeMs,
      error: phaseError,
      success: false,
    };
  }
}

/**
 * Execute multiple phases in parallel
 *
 * @param phases - Array of phase configurations
 * @returns Array of phase results (same order as input)
 *
 * @example
 * ```typescript
 * const [summaryResult, extractionResult] = await executeParallelPhases([
 *   { name: 'Summary Generation', fn: async () => generateSummary(content) },
 *   { name: 'Entity Extraction', fn: async () => extractEntities(content) }
 * ]);
 * ```
 */
export async function executeParallelPhases<T extends unknown[]>(
  phases: Array<{
    name: string;
    fn: () => Promise<T[number]>;
    options?: PhaseExecutionOptions;
  }>
): Promise<PhaseResult<T[number]>[]> {
  console.log(
    `\n⚡ Running ${phases.length} phases in parallel: ${phases.map((p) => p.name).join(', ')}`
  );

  const results = await Promise.all(
    phases.map((phase) =>
      executePhase(phase.name, phase.fn, phase.options)
    )
  );

  const totalTime = Math.max(...results.map((r) => r.timeMs));
  console.log(`   ⚡ Parallel execution complete (${totalTime}ms wall time)`);

  return results;
}
