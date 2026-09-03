import { trace } from '@opentelemetry/api';
import { withSpan } from './tracing.js';

/**
 * Attach OpenAI prompt-cache usage as a child span.
 *
 * Call after generateObject/generateText with AI SDK usage data.
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
  if (!trace.getActiveSpan()) {
    return;
  }

  const inputTokens = usage.promptTokens ?? 0;
  const cacheReadTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;

  const attributes = {
    'saturn.cache.input_tokens': inputTokens,
    'saturn.cache.read_tokens': cacheReadTokens,
    'saturn.cache.write_tokens': usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    'saturn.cache.no_cache_tokens': usage.inputTokenDetails?.noCacheTokens ?? 0,
    'saturn.cache.hit_rate': inputTokens === 0 ? 0 : cacheReadTokens / inputTokens,
  };

  void withSpan(`cache.${label}`, {}, async () => {
    const cacheSpan = trace.getActiveSpan();
    if (!cacheSpan) {
      throw new Error('Cache span is not active');
    }
    cacheSpan.setAttributes(attributes);
  });
}
