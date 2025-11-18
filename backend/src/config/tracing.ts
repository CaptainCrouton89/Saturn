/**
 * OpenTelemetry tracing configuration with multiple exporters
 *
 * This module initializes distributed tracing for Saturn backend.
 * Supports three modes:
 * - 'console': Logs traces to stdout (default in development, no setup needed)
 * - 'langfuse': Exports to self-hosted or cloud Langfuse instance
 * - 'disabled': No tracing (default in production)
 *
 * Environment Variables:
 * - TRACING_MODE: 'console' | 'langfuse' | 'disabled' (default: 'console' in dev, 'disabled' in prod)
 * - LANGFUSE_PUBLIC_KEY: Public API key for Langfuse (required if TRACING_MODE=langfuse)
 * - LANGFUSE_SECRET_KEY: Secret API key for Langfuse (required if TRACING_MODE=langfuse)
 * - LANGFUSE_BASEURL: Langfuse instance URL (optional, defaults to http://localhost:3000 for self-hosted)
 */

import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { registerOTel } from '@vercel/otel';
import { trace } from '@opentelemetry/api';

/**
 * Initialize OpenTelemetry tracing
 *
 * Should be called at the very top of entry points (src/index.ts and src/worker.ts)
 * before any other imports or code execution.
 *
 * @throws Error if tracing is enabled but credentials are missing
 */
export async function initTracing(): Promise<void> {
  const tracingMode =
    process.env.TRACING_MODE || (process.env.NODE_ENV === 'development' ? 'console' : 'disabled');

  // Disabled mode
  if (tracingMode === 'disabled') {
    console.log('[Tracing] Disabled');
    return;
  }

  // Console mode (local development)
  if (tracingMode === 'console') {
    registerOTel({
      serviceName: 'saturn-backend',
      traceExporter: new ConsoleSpanExporter(),
    });
    console.log('[Tracing] Enabled with console exporter (logs to stdout)');
    console.log('[Tracing] Service: saturn-backend');
    return;
  }

  // Langfuse mode (self-hosted or cloud)
  if (tracingMode === 'langfuse') {
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    const baseUrl = process.env.LANGFUSE_BASEURL;

    if (!publicKey) {
      throw new Error('LANGFUSE_PUBLIC_KEY is required for TRACING_MODE=langfuse');
    }
    if (!secretKey) {
      throw new Error('LANGFUSE_SECRET_KEY is required for TRACING_MODE=langfuse');
    }
    if (!baseUrl) {
      throw new Error('LANGFUSE_BASEURL is required for TRACING_MODE=langfuse');
    }

    // Dynamic import for Langfuse (ESM compatibility)
    const { LangfuseExporter } = await import('langfuse-vercel');
    registerOTel({
      serviceName: 'saturn-backend',
      traceExporter: new LangfuseExporter({
        publicKey,
        secretKey,
        baseUrl,
      }),
    });

    console.log('[Tracing] Enabled with Langfuse exporter');
    console.log(`[Tracing] Service: saturn-backend`);
    console.log(`[Tracing] Langfuse: ${baseUrl}`);
    return;
  }

  throw new Error(
    `Invalid TRACING_MODE="${tracingMode}". Must be 'console', 'langfuse', or 'disabled'`
  );
}

/**
 * Get the global tracer instance
 *
 * @returns OpenTelemetry tracer for creating custom spans
 */
export function getTracer() {
  // Import at top of file instead
  return trace.getTracer('saturn-backend');
}
