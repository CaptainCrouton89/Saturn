/**
 * Log OpenAI prompt cache performance from AI SDK usage data.
 *
 * Call after generateObject/generateText to track cache hit rates.
 */
export function logCachePerformance(
  label: string,
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    inputTokenDetails?: {
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      noCacheTokens?: number;
    };
  }
): void {
  const cached = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const total = usage.promptTokens ?? 0;

  if (total === 0) return;

  const hitRate = total > 0 ? ((cached / total) * 100).toFixed(0) : '0';
  const written = usage.inputTokenDetails?.cacheWriteTokens ?? 0;

  if (cached > 0) {
    console.log(`   [${label}] Cache: ${cached}/${total} input tokens cached (${hitRate}% hit rate)`);
  } else if (written > 0) {
    console.log(`   [${label}] Cache: ${written} tokens written to cache (cold start)`);
  }
  // Don't log anything if no cache activity - keeps logs clean
}
