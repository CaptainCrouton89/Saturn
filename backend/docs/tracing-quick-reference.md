# Vercel AI SDK Tracing: Quick Reference

Quick snippets for common tracing patterns in Saturn backend.

---

## 1. Basic Telemetry Configuration

```typescript
// Minimal telemetry
const result = await generateText({
  model: openai('gpt-4o'),
  prompt: userInput,
  experimental_telemetry: { isEnabled: true },
});

// With metadata
const result = await generateText({
  model: openai('gpt-4o'),
  prompt: userInput,
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'operation-name',
    metadata: { userId, conversationId },
  },
});

// Privacy-focused
const result = await generateText({
  model: openai('gpt-4o'),
  prompt: sensitiveData,
  experimental_telemetry: {
    isEnabled: true,
    recordInputs: false,
    recordOutputs: false,
    functionId: 'sensitive-operation',
  },
});
```

---

## 2. Tracing with Steps and Callbacks

```typescript
const result = await generateText({
  model: openai('gpt-4o'),
  prompt: userInput,
  tools: {
    search: {
      description: 'Search for information',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ results: ['...'] }),
    },
  },
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'agent-with-tools',
  },
  onStepFinish: async (step) => {
    console.log('Step finish reason:', step.finishReason);
    console.log('Tool calls:', step.toolCalls?.length);
    console.log('Tokens:', step.usage.totalTokens);
  },
  onFinish: async ({ steps, totalUsage, text }) => {
    console.log('Total steps:', steps.length);
    console.log('Total tokens:', totalUsage.totalTokens);
  },
});
```

---

## 3. Streaming with Telemetry

```typescript
const result = streamText({
  model: openai('gpt-4o'),
  messages,
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'chat-stream',
    metadata: { userId, conversationId },
  },
  onError({ error }) {
    console.error('Stream error:', error);
  },
});

return result.toDataStreamResponse();
```

---

## 4. Custom OpenTelemetry Spans

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('my-app');

async function myOperation(input: string) {
  return tracer.startActiveSpan('operation-name', async (span) => {
    try {
      span.setAttributes({
        'operation.type': 'extraction',
        'input.length': input.length,
      });

      const result = await generateText({
        model: openai('gpt-4o'),
        prompt: input,
        experimental_telemetry: { isEnabled: true },
      });

      span.setAttributes({
        'output.length': result.text.length,
      });

      return result;
    } catch (error) {
      span.recordException(error as Error);
      throw error;
    }
  });
}
```

---

## 5. Nested Spans for Multi-Phase Operations

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('saturn-backend');

async function memoryExtractionPipeline(transcript: string, userId: string) {
  return tracer.startActiveSpan('memory-extraction', async (rootSpan) => {
    rootSpan.setAttributes({
      'pipeline.phases': 4,
      'transcript.length': transcript.length,
    });

    // Phase 1
    const phase1Result = await tracer.startActiveSpan(
      'phase-extraction',
      async (span) => {
        span.setAttributes({ phase: 1 });
        const result = await generateText({
          model: openai('gpt-4o'),
          prompt: transcript,
          experimental_telemetry: {
            isEnabled: true,
            functionId: 'phase-extraction',
          },
        });
        span.setAttributes({ entities: result.text.split('\n').length });
        return result;
      },
    );

    // Phase 2
    const phase2Result = await tracer.startActiveSpan(
      'phase-resolution',
      async (span) => {
        span.setAttributes({ phase: 2 });
        const result = await generateText({
          model: openai('gpt-4o'),
          prompt: phase1Result.text,
          experimental_telemetry: {
            isEnabled: true,
            functionId: 'phase-resolution',
          },
        });
        return result;
      },
    );

    rootSpan.setAttributes({
      'pipeline.status': 'completed',
    });

    return phase2Result;
  });
}
```

---

## 6. Tool Call Tracing

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('saturn-backend');

const tools = {
  createEntity: tool({
    description: 'Create a new entity in the knowledge graph',
    parameters: z.object({
      name: z.string(),
      type: z.string(),
    }),
    execute: async ({ name, type }, options) => {
      return tracer.startActiveSpan(
        'tool.create-entity',
        async (span) => {
          span.setAttributes({
            'tool.name': 'createEntity',
            'entity.name': name,
            'entity.type': type,
            'user.id': options.userId,
          });

          try {
            const result = await entityRepository.create(
              { name, type },
              options.userId,
            );

            span.setAttributes({
              'entity.id': result.id,
              'status': 'created',
            });

            return JSON.stringify(result);
          } catch (error) {
            span.recordException(error as Error);
            throw error;
          }
        },
      );
    },
  }),
};
```

---

## 7. Error Handling with Tracing

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('saturn-backend');

try {
  const result = await tracer.startActiveSpan('risky-operation', async (span) => {
    const output = await generateText({
      model: openai('gpt-4o'),
      prompt: userInput,
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'risky-operation',
      },
    });

    return output;
  });
} catch (error) {
  // Error automatically recorded in span
  // Log with context
  console.error('Operation failed:', {
    error: error instanceof Error ? error.message : String(error),
    timestamp: new Date(),
  });

  // Re-throw or handle
  throw error;
}
```

---

## 8. Database Operation Tracing

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('saturn-backend');

async function createConceptInGraph(
  name: string,
  description: string,
  userId: string,
) {
  return tracer.startActiveSpan('neo4j.create-concept', async (span) => {
    span.setAttributes({
      'db.system': 'neo4j',
      'operation': 'create',
      'concept.name': name,
      'user.id': userId,
    });

    try {
      const result = await driver.executeWrite((tx) =>
        tx.run(
          `
          CREATE (c:Concept { name: $name, description: $desc, userId: $userId })
          RETURN c
        `,
          { name, desc: description, userId },
        ),
      );

      span.setAttributes({
        'records.created': result.records.length,
      });

      return result.records[0];
    } catch (error) {
      span.recordException(error as Error);
      span.setAttributes({
        'error.type': error instanceof Error ? error.constructor.name : 'Unknown',
      });
      throw error;
    }
  });
}
```

---

## 9. API Endpoint Tracing

```typescript
import { Router, Request, Response } from 'express';
import { trace } from '@opentelemetry/api';

const router = Router();
const tracer = trace.getTracer('saturn-backend');

router.post(
  '/conversations/:conversationId/messages',
  async (req: Request, res: Response) => {
    const { message } = req.body;
    const { conversationId } = req.params;
    const userId = req.user!.id;

    return tracer.startActiveSpan(
      'api.chat.message',
      async (span) => {
        span.setAttributes({
          'http.method': 'POST',
          'http.target': `/conversations/${conversationId}/messages`,
          'user.id': userId,
          'conversation.id': conversationId,
        });

        try {
          const response = await conversationService.processMessage(
            message,
            userId,
            conversationId,
          );

          span.setAttributes({
            'http.status_code': 200,
          });

          res.json(response);
        } catch (error) {
          span.recordException(error as Error);
          span.setAttributes({
            'http.status_code': 500,
            'error.message': error instanceof Error ? error.message : String(error),
          });

          res.status(500).json({ error: 'Internal server error' });
        }
      },
    );
  },
);

export default router;
```

---

## 10. Conditional Tracing (Sampling)

```typescript
// Trace based on environment
const shouldTrace = process.env.NODE_ENV === 'production';

const result = await generateText({
  model: openai('gpt-4o'),
  prompt: userInput,
  experimental_telemetry: {
    isEnabled: shouldTrace,
  },
});

// Trace based on operation importance
function shouldTraceOperation(operationType: string): boolean {
  const samplingRates = {
    'critical-operation': 1.0,    // Always trace
    'important-operation': 0.5,   // 50% sample
    'routine-operation': 0.1,     // 10% sample
  };

  const rate = samplingRates[operationType] ?? 0.1;
  return Math.random() < rate;
}

const result = await generateText({
  model: openai('gpt-4o'),
  prompt: userInput,
  experimental_telemetry: {
    isEnabled: shouldTraceOperation('important-operation'),
    functionId: 'important-operation',
  },
});

// Trace based on data classification
function shouldTraceData(dataClass: string): boolean {
  return dataClass === 'public' || dataClass === 'internal';
}

const result = await generateText({
  model: openai('gpt-4o'),
  prompt: userInput,
  experimental_telemetry: {
    isEnabled: shouldTraceData(userDataClassification),
    recordInputs: dataClass === 'public', // Only record public data
    recordOutputs: dataClass === 'public',
  },
});
```

---

## 11. Batch Operation Tracing

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('saturn-backend');

async function processBatchConversations(
  conversationIds: string[],
  userId: string,
) {
  return tracer.startActiveSpan(
    'batch.process-conversations',
    async (batchSpan) => {
      batchSpan.setAttributes({
        'batch.size': conversationIds.length,
        'user.id': userId,
      });

      const results = await Promise.all(
        conversationIds.map((convId) =>
          tracer.startActiveSpan(
            'batch.item.process',
            async (itemSpan) => {
              itemSpan.setAttributes({
                'conversation.id': convId,
              });

              const result = await generateText({
                model: openai('gpt-4o'),
                prompt: `Summarize conversation ${convId}`,
                experimental_telemetry: {
                  isEnabled: true,
                  functionId: 'batch-summary',
                  metadata: { conversationId: convId, userId },
                },
              });

              itemSpan.setAttributes({
                'summary.length': result.text.length,
              });

              return result;
            },
          ),
        ),
      );

      batchSpan.setAttributes({
        'batch.completed': results.length,
        'batch.status': 'success',
      });

      return results;
    },
  );
}
```

---

## 12. Token Usage Monitoring

```typescript
import { generateText } from 'ai';

const result = await generateText({
  model: openai('gpt-4o'),
  prompt: userInput,
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'token-tracking',
  },
});

// Log token usage
console.log('Token usage:', {
  promptTokens: result.usage.promptTokens,
  completionTokens: result.usage.completionTokens,
  totalTokens: result.usage.totalTokens,
  costEstimate:
    (result.usage.promptTokens * 0.03 + result.usage.completionTokens * 0.06) /
    1000, // Rough GPT-4o pricing
});

// Or with callback
const streamResult = streamObject({
  model: openai('gpt-4o'),
  schema: MySchema,
  prompt: userInput,
  onFinish({ usage }) {
    // Send to analytics
    analytics.trackTokenUsage({
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      timestamp: new Date(),
    });
  },
});
```

---

## 13. Performance Baseline Testing

```typescript
// Measure tracing overhead
async function benchmarkTracing() {
  const iterations = 100;

  // Without tracing
  const noTracingStart = Date.now();
  for (let i = 0; i < iterations; i++) {
    await generateText({
      model: openai('gpt-4o'),
      prompt: 'Short test prompt',
      experimental_telemetry: { isEnabled: false },
    });
  }
  const noTracingTime = Date.now() - noTracingStart;

  // With tracing
  const withTracingStart = Date.now();
  for (let i = 0; i < iterations; i++) {
    await generateText({
      model: openai('gpt-4o'),
      prompt: 'Short test prompt',
      experimental_telemetry: { isEnabled: true },
    });
  }
  const withTracingTime = Date.now() - withTracingStart;

  const overhead = ((withTracingTime - noTracingTime) / noTracingTime) * 100;
  console.log(`Tracing overhead: ${overhead.toFixed(2)}%`);

  return overhead;
}
```

---

## 14. Production Configuration Template

```typescript
// config/tracing.ts
interface TracingConfig {
  enabled: boolean;
  samplingRate: number;
  recordInputs: boolean;
  recordOutputs: boolean;
  exporterUrl: string;
  serviceName: string;
}

function getTracingConfig(): TracingConfig {
  const isProd = process.env.NODE_ENV === 'production';

  return {
    enabled: isProd || process.env.ENABLE_TRACING === 'true',
    samplingRate: parseFloat(process.env.SAMPLING_RATE ?? '0.1'),
    recordInputs: process.env.RECORD_INPUTS !== 'false',
    recordOutputs: process.env.RECORD_OUTPUTS !== 'false',
    exporterUrl: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '',
    serviceName: process.env.SERVICE_NAME ?? 'saturn-backend',
  };
}

// Use in application
const config = getTracingConfig();

const result = await generateText({
  model: openai('gpt-4o'),
  prompt: userInput,
  experimental_telemetry: {
    isEnabled: config.enabled && Math.random() < config.samplingRate,
    recordInputs: config.recordInputs,
    recordOutputs: config.recordOutputs,
    functionId: 'operation-name',
    metadata: { environment: process.env.NODE_ENV },
  },
});
```

---

## Key Configuration Variables

```bash
# Enable/disable tracing globally
ENABLE_TRACING=true

# OpenTelemetry exporter configuration
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.langfuse.com/api
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer YOUR_KEY

# Langfuse authentication
LANGFUSE_API_KEY=your_api_key
LANGFUSE_PUBLIC_KEY=your_public_key

# Sampling rate (0.0 - 1.0)
SAMPLING_RATE=0.1

# Privacy controls
RECORD_INPUTS=true
RECORD_OUTPUTS=true

# Service identification
SERVICE_NAME=saturn-backend
ENVIRONMENT=production
```

---

## Common Patterns Summary

| Pattern | Use Case |
|---------|----------|
| Basic telemetry | Simple LLM calls, quick monitoring |
| With metadata | User-scoped tracing, contextual debugging |
| Privacy-focused | Sensitive data, PII concerns |
| Nested spans | Multi-phase operations, orchestration |
| Callbacks | Step-by-step tracking, token monitoring |
| Custom spans | Application logic, database ops |
| Sampling | High-volume operations, cost optimization |
| Batch operations | Parallel processing, bulk operations |
| Error handling | Exception tracking, error classification |

---

## Further Reading

- **Full Guide:** `docs/vercel-ai-sdk-tracing-guide.md`
- **Saturn-Specific:** `docs/tracing-implementation-saturn.md`
- **Langfuse Docs:** https://langfuse.com/docs
- **OpenTelemetry:** https://opentelemetry.io/docs/instrumentation/js/
