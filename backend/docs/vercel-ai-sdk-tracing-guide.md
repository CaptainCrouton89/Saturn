# Vercel AI SDK Tracing & Observability Guide

## Overview

The Vercel AI SDK provides **built-in OpenTelemetry integration** for comprehensive tracing, monitoring, and observability of LLM calls. This feature is currently **experimental** and subject to change.

The tracing system enables:
- **Automatic span generation** for all AI operations
- **Custom metadata and context** tagging
- **Integration with observability platforms** (Langfuse, LangWatch, LangSmith, Axiom, SigNoz, etc.)
- **Privacy controls** (selectively disable input/output recording)
- **Custom tracer providers** for alternative backends

---

## Quick Start

### 1. Enable Telemetry for a Single Call

```typescript
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

const result = await generateText({
  model: openai('gpt-4o'),
  prompt: 'Write a short story about a cat.',
  experimental_telemetry: { isEnabled: true },
});
```

### 2. Add Metadata and Function ID

```typescript
const result = await generateText({
  model: openai('gpt-4o'),
  prompt: 'Write a short story about a cat.',
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'my-awesome-function',
    metadata: {
      userId: 'user-123',
      sessionId: 'session-456',
      custom: 'metadata-value',
    },
  },
});
```

### 3. Control Input/Output Recording

```typescript
const result = await generateText({
  model: openai('gpt-4o'),
  prompt: 'Sensitive prompt...',
  experimental_telemetry: {
    isEnabled: true,
    recordInputs: false,  // Don't record prompt
    recordOutputs: false, // Don't record generated text
    functionId: 'sensitive-operation',
    metadata: {
      sensitivityLevel: 'high',
    },
  },
});
```

---

## Core Telemetry Configuration

### `experimental_telemetry` Object Structure

```typescript
interface ExperimentalTelemetrySettings {
  // Required: Enable telemetry for this call
  isEnabled: boolean;

  // Optional: Unique identifier for this function/operation
  functionId?: string;

  // Optional: Record prompts and inputs (default: true)
  recordInputs?: boolean;

  // Optional: Record generated text and outputs (default: true)
  recordOutputs?: boolean;

  // Optional: Custom metadata key-value pairs
  metadata?: Record<string, string | number | boolean>;

  // Optional: Custom OpenTelemetry Tracer
  tracer?: Tracer;
}
```

### Configuration Examples

**Production-Safe Telemetry:**
```typescript
experimental_telemetry: {
  isEnabled: process.env.NODE_ENV === 'production',
  recordInputs: true,
  recordOutputs: true,
  functionId: 'chat-completion',
  metadata: {
    environment: process.env.NODE_ENV,
    version: '1.0.0',
  },
}
```

**Privacy-Focused Telemetry:**
```typescript
experimental_telemetry: {
  isEnabled: true,
  recordInputs: false,  // PII concerns
  recordOutputs: false, // Sensitive data
  functionId: 'sensitive-query',
  metadata: {
    dataClassification: 'confidential',
  },
}
```

**User-Scoped Telemetry:**
```typescript
experimental_telemetry: {
  isEnabled: true,
  functionId: 'customer-support-chat',
  metadata: {
    userId: req.user.id,
    accountTier: req.user.tier,
    threadId: req.body.threadId,
  },
}
```

---

## Telemetry Data Collection by Function

### Text Generation Functions

**Applies to:** `generateText()`, `streamText()`

**Span Hierarchy:**
```
ai.generateText / ai.streamText (operation span)
├── llm.request (per-provider span)
│   └── Capture: prompt, model, parameters
├── tool.call (if tools used)
│   ├── tool.execute
│   └── tool.result
└── Capture: finish reason, token usage, response time
```

**Captured Data:**
- Input prompt/messages
- Generated text output
- Model identifier (id, provider)
- Token usage (prompt tokens, completion tokens, total)
- Finish reason (stop, tool-call, length, etc.)
- Tool invocations with inputs and outputs
- Retry information
- Response metadata and headers

**Example Span Data:**
```json
{
  "name": "ai.generateText",
  "attributes": {
    "model.id": "gpt-4o",
    "model.provider": "openai",
    "input": "Explain quantum computing",
    "output": "Quantum computing uses quantum bits...",
    "usage.prompt_tokens": 15,
    "usage.completion_tokens": 120,
    "usage.total_tokens": 135,
    "function_id": "qa-assistant",
    "metadata.userId": "user-123"
  },
  "duration_ms": 2340
}
```

### Object Generation Functions

**Applies to:** `generateObject()`, `streamObject()`

**Captured Data:**
- Input prompt/messages
- JSON schema used for generation
- Stringified JSON output
- Finish reason
- Token usage
- Validation results

### Embedding Functions

**Applies to:** `embed()`, `embedMany()`

**Captured Data:**
- Input text values
- JSON-stringified embedding vectors
- Embedding dimensions
- Token usage
- Model information

---

## OpenTelemetry Integration

### Setup: Next.js with `@vercel/otel`

**1. Create instrumentation file:**

```typescript
// instrumentation.ts (at project root)
import { registerOTel } from '@vercel/otel';

export function register() {
  registerOTel({
    serviceName: 'my-ai-app',
    // Tracing is enabled by default in production
  });
}
```

**2. Configure `next.config.js`:**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
```

**3. Install dependencies:**

```bash
npm install @vercel/otel @opentelemetry/api
```

### Setup: Node.js

**1. Initialize OpenTelemetry SDK:**

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { trace } from '@opentelemetry/api';

// Configure trace exporter
const traceExporter = new OTLPTraceExporter({
  url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`,
});

const sdk = new NodeSDK({
  traceExporter,
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// Use in your application
const tracer = trace.getTracer('my-app');
```

**2. Install dependencies:**

```bash
npm install @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/api-logs @opentelemetry/instrumentation @opentelemetry/sdk-logs
```

### Using Custom Tracers

Override the default OpenTelemetry singleton:

```typescript
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

const tracerProvider = new NodeTracerProvider();
const customTracer = tracerProvider.getTracer('my-app');

const result = await generateText({
  model: openai('gpt-4o'),
  prompt: 'Write a poem about code.',
  experimental_telemetry: {
    isEnabled: true,
    tracer: customTracer,
  },
});
```

---

## Observability Platform Integrations

### Langfuse Integration

**Setup:**

```bash
npm install @vercel/otel langfuse-vercel @opentelemetry/api-logs @opentelemetry/instrumentation @opentelemetry/sdk-logs
```

**Next.js Configuration:**

```typescript
// instrumentation.ts
import { registerOTel } from '@vercel/otel';
import { LangfuseExporter } from 'langfuse-vercel';

export function register() {
  registerOTel({
    serviceName: 'langfuse-vercel-ai-nextjs-example',
    traceExporter: new LangfuseExporter(),
  });
}
```

**Node.js Configuration:**

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { LangfuseExporter } from 'langfuse-vercel';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

const sdk = new NodeSDK({
  traceExporter: new LangfuseExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

async function main() {
  const result = await generateText({
    model: openai('gpt-4o'),
    prompt: 'Invent a new holiday and describe its traditions.',
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'my-awesome-function',
      metadata: {
        something: 'custom',
        someOtherThing: 'other-value',
      },
    },
  });

  console.log(result.text);
  await sdk.shutdown(); // Flushes traces to Langfuse
}

main().catch(console.error);
```

### LangWatch Integration

**Setup:**

```bash
npm install @vercel/otel langwatch @opentelemetry/api-logs @opentelemetry/instrumentation @opentelemetry/sdk-logs
```

**Configuration:**

```typescript
// instrumentation.ts
import { registerOTel } from '@vercel/otel';
import { LangWatchExporter } from 'langwatch';

export function register() {
  registerOTel({
    serviceName: 'next-app',
    traceExporter: new LangWatchExporter(),
  });
}
```

**Usage with Metadata:**

```typescript
const result = await generateText({
  model: openai('gpt-4o-mini'),
  prompt: 'Explain why a chicken would make a terrible astronaut, be creative and humorous about it.',
  experimental_telemetry: {
    isEnabled: true,
    metadata: {
      userId: 'myuser-123',
      threadId: 'mythread-123',
    },
  },
});
```

### Axiom Integration

**Setup:**

```bash
pnpm install @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/sdk-node @opentelemetry/sdk-trace-node @opentelemetry/semantic-conventions @opentelemetry/api axiom-ai
```

**Configuration:**

```typescript
import { trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { initAxiomAI, RedactionPolicy } from 'axiom/ai';

const tracer = trace.getTracer('my-tracer');

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'my-ai-app',
  }),
  spanProcessor: new SimpleSpanProcessor(
    new OTLPTraceExporter({
      url: `https://api.axiom.co/v1/traces`,
      headers: {
        Authorization: `Bearer ${process.env.AXIOM_TOKEN}`,
        'X-Axiom-Dataset': process.env.AXIOM_DATASET,
      },
    }),
  ),
});

sdk.start();

initAxiomAI({
  tracer,
  redactionPolicy: RedactionPolicy.AxiomDefault,
});
```

**Environment Variables:**

```bash
# .env
AXIOM_TOKEN="YOUR_AXIOM_API_TOKEN"
AXIOM_DATASET="your-axiom-dataset-name"
OTEL_SERVICE_NAME="my-ai-app"
OPENAI_API_KEY="YOUR_OPENAI_API_KEY"
```

### LangSmith Integration

**Setup:**

```bash
npm install langsmith
```

**Configuration:**

```typescript
import { openai } from '@ai-sdk/openai';
import * as ai from 'ai';
import { wrapAISDK } from 'langsmith/experimental/vercel';

// Wrap AI SDK functions for automatic tracing
const { generateText, streamText, generateObject, streamObject } =
  wrapAISDK(ai);

const result = await generateText({
  model: openai('gpt-4o'),
  prompt: 'Write a vegetarian lasagna recipe for 4 people.',
});
```

**Advanced: Using `traceable` wrapper:**

```typescript
import { traceable } from 'langsmith/traceable';
import { wrapAISDK } from 'langsmith/experimental/vercel';
import { generateText } from 'ai';
import { tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const { generateText: wrappedGenerateText } = wrapAISDK(ai);

const chatWithTools = traceable(
  async (input: string) => {
    const { text } = await wrappedGenerateText({
      model: openai('gpt-4o'),
      messages: [{ role: 'user', content: input }],
      tools: {
        listOrders: tool({
          description: 'list all orders',
          inputSchema: z.object({ userId: z.string() }),
          execute: async ({ userId }) =>
            `User ${userId} has the following orders: 1`,
        }),
        viewTracking: tool({
          description: 'view tracking information for a specific order',
          inputSchema: z.object({ orderId: z.string() }),
          execute: async ({ orderId }) =>
            `Here is the tracking information for ${orderId}`,
        }),
      },
    });
    return text;
  },
  { name: 'chat-with-tools' },
);

await chatWithTools('What are my orders and where are they? My user ID is 123.');
```

### Laminar Integration

**Setup:**

```bash
npm install @lmnr-ai/lmnr
```

**Basic Usage:**

```typescript
import { getTracer, observe } from '@lmnr-ai/lmnr';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

const result = await generateText({
  model: openai('gpt-4o-mini'),
  prompt: 'Write a poem about Laminar flow.',
  experimental_telemetry: {
    isEnabled: true,
    tracer: getTracer(),
    functionId: 'poem-writer',
    metadata: {
      userId: 'user-123',
      sessionId: 'session-456',
    },
  },
});
```

**Nested Spans with `observe` Wrapper:**

```typescript
const result = await observe(
  { name: 'poem-writer' },
  async (topic: string, mood: string) => {
    const { text } = await generateText({
      model: openai('gpt-4.1-nano'),
      prompt: `Write a poem about ${topic} in ${mood} mood.`,
    });
    return text;
  },
  'Laminar flow',
  'happy',
);
```

### SigNoz Integration

**Setup:**

```bash
npm install @vercel/otel @opentelemetry/api
```

**Configuration:**

```typescript
// instrumentation.ts
import { registerOTel } from '@vercel/otel';

export function register() {
  registerOTel({
    serviceName: 'signoz-ai-app',
  });
}
```

---

## Debugging and Callbacks

### Using Callbacks for Observability

**Track generation steps:**

```typescript
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const result = await generateText({
  model: openai('gpt-4o'),
  prompt: 'Research the history of the internet.',
  tools: {
    search: {
      description: 'Search for information',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ results: ['...'] }),
    },
  },
  onStepFinish: async (stepResult) => {
    console.log(
      `\n--- Step ${stepResult.response.messages.length} ---`
    );
    console.log('Finish reason:', stepResult.finishReason);
    console.log('Tool calls:', stepResult.toolCalls?.length || 0);
    console.log('Tokens used:', stepResult.usage.totalTokens);

    if (stepResult.toolCalls) {
      stepResult.toolCalls.forEach((call) => {
        console.log(`Tool: ${call.toolName}`, call.input);
      });
    }
  },
  onFinish: async ({ steps, totalUsage, text }) => {
    console.log('\n=== Generation Complete ===');
    console.log('Total steps:', steps.length);
    console.log('Total tokens:', totalUsage.totalTokens);
    console.log('Final output length:', text.length);
  },
});
```

**Record token usage:**

```typescript
import { streamObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

streamObject({
  model: openai('gpt-4o'),
  schema: z.object({
    recipe: z.object({
      name: z.string(),
      ingredients: z.array(z.string()),
      steps: z.array(z.string()),
    }),
  }),
  prompt: 'Generate a lasagna recipe.',
  onFinish({ usage }) {
    console.log('Token usage:', usage);
    // Send to your analytics system
  },
});
```

**Handle streaming errors:**

```typescript
import { streamText } from 'ai';

const result = streamText({
  model: openai('gpt-4o'),
  prompt: 'Your prompt here',
  onError({ error }) {
    console.error('Stream error:', error);
    // Send to error tracking service
  },
});
```

### Middleware-Based Logging

**Log all model calls with custom middleware:**

```typescript
import type {
  LanguageModelV3Middleware,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';

export const loggingMiddleware: LanguageModelV3Middleware = {
  wrapGenerate: async ({ doGenerate, params }) => {
    console.log('LLM Call:', {
      messages: params.messages,
      model: params.model,
      timestamp: new Date(),
    });

    const result = await doGenerate();

    console.log('LLM Result:', {
      text: result.text,
      finishReason: result.finishReason,
      usage: result.usage,
    });

    return result;
  },

  wrapStream: async ({ doStream, params }) => {
    console.log('LLM Stream Started:', {
      messages: params.messages,
      timestamp: new Date(),
    });

    const { stream, ...rest } = await doStream();

    let generatedText = '';

    const transformStream = new TransformStream<
      LanguageModelV3StreamPart,
      LanguageModelV3StreamPart
    >({
      transform(chunk, controller) {
        if (chunk.type === 'text-delta') {
          generatedText += chunk.delta;
        }
        controller.enqueue(chunk);
      },

      flush() {
        console.log('LLM Stream Complete:', {
          generatedText,
          length: generatedText.length,
        });
      },
    });

    return {
      stream: stream.pipeThrough(transformStream),
      ...rest,
    };
  },
};
```

**Apply middleware to model:**

```typescript
const aiModel = openai('gpt-4o').withMiddleware(loggingMiddleware);

const result = await generateText({
  model: aiModel,
  prompt: 'Your prompt',
});
```

---

## Span Attributes Reference

### Standard LLM Span Attributes

All LLM operation spans include these attributes:

```typescript
{
  // Model Information
  'model.id': 'gpt-4o',
  'model.provider': 'openai',

  // Input/Output (if recorded)
  'input': 'The user prompt',
  'output': 'Generated response',

  // Token Usage
  'usage.prompt_tokens': 15,
  'usage.completion_tokens': 120,
  'usage.total_tokens': 135,

  // Generation Parameters
  'temperature': 0.7,
  'top_p': 1.0,
  'max_tokens': 1000,

  // Response Metadata
  'response.id': 'chatcmpl-123abc',
  'response.finish_reason': 'stop',

  // Telemetry Metadata
  'function_id': 'my-awesome-function',
  'metadata.userId': 'user-123',
  'metadata.custom_key': 'custom_value',

  // Request Context
  'retry.count': 0,
  'request.timeout_ms': 30000,
}
```

### Tool Call Span Attributes

```typescript
{
  'tool.name': 'search',
  'tool.call_id': 'call_123',
  'tool.input': '{"query": "what is..."}',
  'tool.output': '{"results": [...]}',
  'tool.duration_ms': 1250,
}
```

### Error Span Attributes

```typescript
{
  'error.type': 'RateLimitError',
  'error.message': 'Rate limit exceeded',
  'error.code': 'rate_limit_exceeded',
  'http.status_code': 429,
  'otel.status_code': 'ERROR',
}
```

---

## Best Practices

### 1. Selective Telemetry

Enable telemetry only for important operations:

```typescript
const shouldTrace = process.env.NODE_ENV === 'production' &&
  Math.random() < 0.1; // Sample 10% of calls

const result = await generateText({
  model: openai('gpt-4o'),
  prompt: userInput,
  experimental_telemetry: {
    isEnabled: shouldTrace,
  },
});
```

### 2. Privacy-First Configuration

Disable recording of sensitive data:

```typescript
const result = await generateText({
  model: openai('gpt-4o'),
  prompt: sensitiveUserData,
  experimental_telemetry: {
    isEnabled: true,
    recordInputs: false,  // Don't record prompt
    recordOutputs: false, // Don't record output
    functionId: 'pii-processing',
  },
});
```

### 3. Comprehensive Metadata

Include contextual information:

```typescript
experimental_telemetry: {
  isEnabled: true,
  functionId: 'customer-support',
  metadata: {
    customerId: req.user.id,
    requestId: req.id,
    environment: process.env.NODE_ENV,
    apiVersion: 'v1',
    retryCount: retries,
    duration: Date.now() - startTime,
  },
}
```

### 4. Error Handling with Telemetry

Combine error handling with tracing:

```typescript
try {
  const result = await generateText({
    model: openai('gpt-4o'),
    prompt: userInput,
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'critical-operation',
      metadata: { operationId: uuid() },
    },
  });
} catch (error) {
  // Error is included in trace
  console.error('Generation failed:', error);
  // Send to error tracking with trace ID from context
}
```

### 5. Batch Operations Tracing

Trace multiple operations with parent span:

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('my-app');

const results = await tracer.startActiveSpan(
  'batch-generation',
  async (span) => {
    const operations = [];

    for (const item of items) {
      operations.push(
        generateText({
          model: openai('gpt-4o'),
          prompt: item.prompt,
          experimental_telemetry: {
            isEnabled: true,
            functionId: 'batch-item',
            metadata: { itemId: item.id },
          },
        }),
      );
    }

    const results = await Promise.all(operations);
    span.setAttribute('batch.size', items.length);
    span.setAttribute('batch.completed', results.length);
    return results;
  },
);
```

---

## Performance Considerations

### Recording Overhead

**Telemetry recording adds minimal overhead:**
- 2-5% additional latency per call
- Memory usage: ~1-2KB per span
- Network bandwidth: ~500 bytes per span (compressed)

**Optimize with:**

```typescript
// Disable recording for high-frequency calls
experimental_telemetry: {
  isEnabled: process.env.NODE_ENV === 'production',
  recordInputs: false,
  recordOutputs: false,
  functionId: 'frequent-operation',
}
```

### Sampling

Implement sampling for high-volume applications:

```typescript
const shouldTrace = (operationName: string) => {
  const samplingRates: Record<string, number> = {
    'frequent-operation': 0.01,   // 1%
    'medium-operation': 0.1,      // 10%
    'critical-operation': 1.0,    // 100%
  };

  return Math.random() < (samplingRates[operationName] ?? 0.1);
};

const result = await generateText({
  model: openai('gpt-4o'),
  prompt: userInput,
  experimental_telemetry: {
    isEnabled: shouldTrace('my-operation'),
  },
});
```

---

## Troubleshooting

### Traces Not Appearing

1. **Verify telemetry is enabled:**
   ```typescript
   console.log('Telemetry enabled:', config.experimental_telemetry.isEnabled);
   ```

2. **Check exporter configuration:**
   ```bash
   echo $OTEL_EXPORTER_OTLP_ENDPOINT
   echo $OTEL_EXPORTER_OTLP_HEADERS
   ```

3. **Enable debug logging:**
   ```typescript
   new LangfuseExporter({ debug: true });
   ```

4. **Verify network connectivity:**
   ```bash
   curl -i ${OTEL_EXPORTER_OTLP_ENDPOINT}/health
   ```

### High Latency

1. **Use sampling** instead of 100% tracing
2. **Disable input/output recording** for large texts
3. **Use async span processors** instead of synchronous

```typescript
const sdk = new NodeSDK({
  spanProcessor: new BatchSpanProcessor(traceExporter), // Better for performance
});
```

### Memory Issues

1. **Limit span attribute size:**
   ```typescript
   recordInputs: false, // For large prompts
   recordOutputs: false, // For large outputs
   ```

2. **Use sampling with smaller sample rate**
3. **Implement span attribute filtering** in middleware

---

## References

- **Official AI SDK Telemetry Docs:** https://ai-sdk.dev/docs/guides/telemetry
- **OpenTelemetry Specification:** https://opentelemetry.io/docs/
- **Vercel AI SDK GitHub:** https://github.com/vercel/ai
- **AI SDK Examples:** https://github.com/vercel/ai/tree/main/examples/ai-core/src/telemetry
