/**
 * OpenTelemetry tracing configuration for the Saturn backend.
 * Supports two modes:
 * - 'langfuse': Exports to self-hosted or cloud Langfuse instance
 * - 'disabled': No tracing (default)
 *
 * Environment Variables:
 * - TRACING_MODE: 'langfuse' | 'disabled' (default: 'disabled')
 * - LANGFUSE_PUBLIC_KEY: Public API key for Langfuse (required if TRACING_MODE=langfuse)
 * - LANGFUSE_SECRET_KEY: Secret API key for Langfuse (required if TRACING_MODE=langfuse)
 * - LANGFUSE_BASEURL: Langfuse instance URL (required if TRACING_MODE=langfuse)
 */
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

let tracerProvider: NodeTracerProvider | undefined;

/**
 * Initialize OpenTelemetry tracing
 *
 * @throws Error if tracing is enabled but credentials are invalid
 */
export async function initTracing(): Promise<void> {
  const tracingMode = process.env.TRACING_MODE || 'disabled';

  // Disabled mode
  if (tracingMode === 'disabled') {
    console.log('[Tracing] Disabled');
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

    await verifyLangfuseCredentials(publicKey, secretKey, baseUrl);

    tracerProvider = new NodeTracerProvider({
      spanProcessors: [
        new LangfuseSpanProcessor({
          publicKey,
          secretKey,
          baseUrl,
          shouldExportSpan: () => true,
        }),
      ],
    });
    tracerProvider.register();

    console.log('[Tracing] Enabled with Langfuse span processor');
    console.log(`[Tracing] Service: saturn-backend`);
    console.log(`[Tracing] Langfuse: ${baseUrl}`);
    return;
  }

  throw new Error(
    `Invalid TRACING_MODE="${tracingMode}". Must be 'langfuse' or 'disabled'`
  );
}

export async function shutdownTracing(): Promise<void> {
  if (!tracerProvider) {
    return;
  }

  await tracerProvider.shutdown();
  tracerProvider = undefined;
}

async function verifyLangfuseCredentials(
  publicKey: string,
  secretKey: string,
  baseUrl: string
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(new URL('/api/public/projects', baseUrl), {
      headers: {
        Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Langfuse credential validation request failed: ${message}`);
  }

  if (!response.ok) {
    throw new Error(`Langfuse credential validation failed: ${response.status} ${response.statusText}`);
  }
}
