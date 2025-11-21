# Saturn Backend: Tracing Implementation Guide

This document provides specific guidance for implementing tracing in the Saturn backend using Vercel AI SDK's OpenTelemetry integration.

---

## Architecture Overview

Saturn uses:
- **Dual database:** PostgreSQL (Supabase) + Neo4j (knowledge graph)
- **AI SDK agents** for conversation and memory extraction
- **Background worker** (pg-boss) for async processing
- **Express API** for REST endpoints

Tracing should cover:
1. **Conversation API calls** - trace LLM interactions
2. **Agent executions** - trace orchestrator and ingestion agents
3. **Memory extraction** - trace entity/relationship creation
4. **Tool execution** - trace Neo4j operations and external API calls

---

## Setup

### 1. Install Dependencies

```bash
cd backend
npm install @vercel/otel @opentelemetry/api @opentelemetry/api-logs @opentelemetry/instrumentation @opentelemetry/sdk-logs langfuse-vercel
```

### 2. Create Instrumentation Module

Create `src/instrumentation.ts`:

```typescript
// src/instrumentation.ts
import { registerOTel } from '@vercel/otel';
import { LangfuseExporter } from 'langfuse-vercel';

declare global {
  var tracing_initialized: boolean;
}

/**
 * Initialize OpenTelemetry instrumentation for Saturn backend
 * Must be called as early as possible in the application lifecycle
 */
export function initializeTracing() {
  // Prevent double initialization
  if (global.tracing_initialized) {
    return;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const isTracingEnabled =
    process.env.ENABLE_TRACING === 'true' || isProduction;

  if (!isTracingEnabled) {
    console.log(
      '[Tracing] Disabled (set ENABLE_TRACING=true to enable)'
    );
    return;
  }

  try {
    const exporter =
      process.env.LANGFUSE_API_KEY || process.env.LANGFUSE_CLOUD_API_KEY
        ? new LangfuseExporter()
        : undefined;

    if (!exporter) {
      console.warn('[Tracing] No exporter configured (Langfuse API key missing)');
      return;
    }

    registerOTel({
      serviceName: 'saturn-backend',
      traceExporter: exporter,
    });

    global.tracing_initialized = true;
    console.log('[Tracing] Initialized with Langfuse exporter');
  } catch (error) {
    console.error('[Tracing] Initialization failed:', error);
  }
}
```

### 3. Initialize in Application Entry Point

Update `src/index.ts`:

```typescript
// src/index.ts
import { initializeTracing } from './instrumentation';

// Initialize tracing FIRST, before any other imports
initializeTracing();

import express from 'express';
import { routes } from './routes';
// ... rest of imports
```

### 4. Environment Configuration

Add to `.env`:

```bash
# Tracing Configuration
ENABLE_TRACING=true
LANGFUSE_API_KEY=your_api_key_here
LANGFUSE_PUBLIC_KEY=your_public_key_here
```

---

## Instrumenting AI SDK Calls

### Conversation Service

Instrument LLM calls in `src/services/conversationService.ts`:

```typescript
// src/services/conversationService.ts
import { generateText, streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

export class ConversationService {
  async generateResponse(
    messages: Message[],
    userId: string,
    conversationId: string,
  ) {
    const result = await generateText({
      model: openai('gpt-4o'),
      messages,
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'conversation-response',
        recordInputs: true,
        recordOutputs: true,
        metadata: {
          userId,
          conversationId,
          messageCount: messages.length,
          environment: process.env.NODE_ENV,
        },
      },
    });

    return result;
  }

  async streamConversation(
    messages: Message[],
    userId: string,
    conversationId: string,
  ) {
    const result = streamText({
      model: openai('gpt-4o'),
      messages,
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'conversation-stream',
        metadata: {
          userId,
          conversationId,
          environment: process.env.NODE_ENV,
        },
      },
    });

    return result;
  }
}
```

### Orchestrator Agent

Instrument agent calls in `src/agents/orchestrator.ts`:

```typescript
// src/agents/orchestrator.ts
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

export async function runOrchestrator(
  messages: Message[],
  userId: string,
  context: AgentContext,
) {
  const result = await generateText({
    model: openai('gpt-4o'),
    system: ORCHESTRATOR_SYSTEM_PROMPT,
    messages,
    tools: orchestratorTools,
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'orchestrator-agent',
      recordInputs: true,
      recordOutputs: true,
      metadata: {
        userId,
        agentType: 'orchestrator',
        toolCount: Object.keys(orchestratorTools).length,
        messageCount: messages.length,
      },
    },
    onStepFinish: async (step) => {
      // Log step-level metrics
      console.log('[Agent] Step complete:', {
        finishReason: step.finishReason,
        toolCalls: step.toolCalls?.length || 0,
        tokens: step.usage.totalTokens,
      });
    },
  });

  return result;
}
```

### Ingestion Agent

Instrument ingestion in `src/agents/ingestionAgent.ts`:

```typescript
// src/agents/ingestionAgent.ts
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

export async function runIngestionAgent(
  transcript: string,
  userId: string,
  conversationId: string,
  phase: 'extraction' | 'resolution' | 'structured' | 'relationships',
) {
  const result = await generateText({
    model: openai('gpt-4o'),
    system: getPhasePrompt(phase),
    prompt: transcript,
    experimental_telemetry: {
      isEnabled: true,
      functionId: `ingestion-phase-${phase}`,
      recordInputs: phase === 'extraction', // Full input only for extraction
      recordOutputs: true,
      metadata: {
        userId,
        conversationId,
        phase,
        transcriptLength: transcript.length,
      },
    },
  });

  return result;
}
```

---

## Tool Execution Tracing

### Tracing Repository Operations

```typescript
// src/repositories/ConceptRepository.ts
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('saturn-backend');

export class ConceptRepository {
  async create(concept: ConceptNode, userId: string) {
    return tracer.startActiveSpan('neo4j.create-concept', async (span) => {
      try {
        span.setAttributes({
          'db.system': 'neo4j',
          'operation': 'create',
          'entity.type': 'Concept',
          'entity.name': concept.name,
          'user.id': userId,
        });

        const result = await this.driver.executeWrite(
          (tx) => tx.run(CREATE_CONCEPT_QUERY, { concept, userId }),
        );

        span.setAttributes({
          'db.results': result.records.length,
        });

        return result;
      } catch (error) {
        span.recordException(error as Error);
        throw error;
      }
    });
  }

  async createRelationship(
    sourceId: string,
    targetId: string,
    relationshipType: string,
    userId: string,
  ) {
    return tracer.startActiveSpan(
      'neo4j.create-relationship',
      async (span) => {
        span.setAttributes({
          'db.system': 'neo4j',
          'operation': 'create',
          'relationship.type': relationshipType,
          'source.id': sourceId,
          'target.id': targetId,
          'user.id': userId,
        });

        const result = await this.driver.executeWrite((tx) =>
          tx.run(CREATE_RELATIONSHIP_QUERY, {
            sourceId,
            targetId,
            relationshipType,
            userId,
          }),
        );

        return result;
      },
    );
  }
}
```

### Tracing API Endpoints

```typescript
// src/routes/chat.ts
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('saturn-backend');

router.post('/conversations/:conversationId/messages', async (req, res) => {
  const { message } = req.body;
  const { conversationId } = req.params;
  const userId = req.user.id;

  return tracer.startActiveSpan(
    'api.conversation.message',
    async (span) => {
      try {
        span.setAttributes({
          'http.method': 'POST',
          'http.route': '/conversations/:conversationId/messages',
          'user.id': userId,
          'conversation.id': conversationId,
          'message.length': message.length,
        });

        const response = await conversationService.processMessage(
          message,
          userId,
          conversationId,
        );

        span.setAttributes({
          'response.status': 200,
        });

        res.json(response);
      } catch (error) {
        span.recordException(error as Error);
        span.setAttributes({
          'response.status': 500,
          'error.message': (error as Error).message,
        });
        throw error;
      }
    },
  );
});
```

---

## Background Worker Tracing

### Tracing Job Execution

```typescript
// src/worker.ts
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('saturn-backend-worker');

async function processMemoryExtractionJob(job: Job) {
  return tracer.startActiveSpan(
    'job.memory-extraction',
    async (span) => {
      const { conversationId, userId, transcript } = job.data;

      span.setAttributes({
        'job.type': 'memory-extraction',
        'job.id': job.id,
        'user.id': userId,
        'conversation.id': conversationId,
        'transcript.length': transcript.length,
      });

      try {
        // Phase 1: Entity Extraction
        const entities = await tracer.startActiveSpan(
          'job.phase-extraction',
          async (phaseSpan) => {
            phaseSpan.setAttributes({
              'phase': 'extraction',
              'order': 1,
            });

            const result = await runIngestionAgent(
              transcript,
              userId,
              conversationId,
              'extraction',
            );

            phaseSpan.setAttributes({
              'entities.extracted': result.text.split('\n').length,
            });

            return parseEntities(result.text);
          },
        );

        span.setAttributes({
          'entities.count': entities.length,
        });

        // Phase 2-4: Continue with other phases...

        span.setAttributes({
          'job.status': 'completed',
        });
      } catch (error) {
        span.recordException(error as Error);
        span.setAttributes({
          'job.status': 'failed',
          'error.message': (error as Error).message,
        });
        throw error;
      }
    },
  );
}
```

---

## Custom Spans for Application Logic

### Create Named Spans

```typescript
// src/services/embeddingGenerationService.ts
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('saturn-backend');

export class EmbeddingGenerationService {
  async generateEmbedding(text: string, userId: string) {
    return tracer.startActiveSpan(
      'embedding.generate',
      async (span) => {
        span.setAttributes({
          'text.length': text.length,
          'user.id': userId,
        });

        // Generate embedding
        const embedding = await openaiClient.embeddings.create({
          model: 'text-embedding-3-small',
          input: text,
        });

        span.setAttributes({
          'embedding.dimensions': embedding.data[0].embedding.length,
        });

        return embedding.data[0].embedding;
      },
    );
  }

  async generateMultipleEmbeddings(texts: string[], userId: string) {
    return tracer.startActiveSpan(
      'embedding.generate-batch',
      async (span) => {
        span.setAttributes({
          'batch.size': texts.length,
          'total.length': texts.reduce((sum, t) => sum + t.length, 0),
          'user.id': userId,
        });

        const embeddings = await Promise.all(
          texts.map((text) => this.generateEmbedding(text, userId)),
        );

        span.setAttributes({
          'embeddings.count': embeddings.length,
        });

        return embeddings;
      },
    );
  }
}
```

### Create Span for Tool Calls

```typescript
// src/agents/tools/index.ts
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('saturn-backend');

export const tools = {
  createConcept: tool({
    description: 'Create a new concept node',
    parameters: z.object({
      name: z.string(),
      description: z.string(),
    }),
    execute: async ({ name, description }, options) => {
      return tracer.startActiveSpan(
        'tool.create-concept',
        async (span) => {
          span.setAttributes({
            'tool.name': 'createConcept',
            'concept.name': name,
            'description.length': description.length,
          });

          try {
            const result = await conceptRepository.create(
              {
                name,
                description,
              },
              options.userId,
            );

            span.setAttributes({
              'tool.result': 'success',
              'concept.id': result.id,
            });

            return result;
          } catch (error) {
            span.recordException(error as Error);
            span.setAttributes({
              'tool.result': 'error',
            });
            throw error;
          }
        },
      );
    },
  }),
};
```

---

## Structured Metadata

### User Context

Define proper types for request extensions:

```typescript
// types/express.d.ts
declare global {
  namespace Express {
    interface Request {
      spanMetadata?: {
        userId?: string;
        requestId?: string;
        userEmail?: string;
        environment?: string;
      };
    }
  }
}

// Middleware to add user context to all telemetry
app.use((req, res, next) => {
  const userId = req.user?.id;
  const requestId = req.id;

  // Store in request context for use in spans
  req.spanMetadata = {
    userId,
    requestId,
    userEmail: req.user?.email,
    environment: process.env.NODE_ENV,
  };

  next();
});

// Use in services
const metadata = req.spanMetadata;

const result = await generateText({
  // ...
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'conversation-response',
    metadata: metadata ?? {},
  },
});
```

### Domain-Specific Metadata

```typescript
const result = await generateText({
  model: openai('gpt-4o'),
  prompt: userInput,
  experimental_telemetry: {
    isEnabled: true,
    functionId: 'memory-extraction',
    metadata: {
      // User context
      userId,
      userTier: user.tier,

      // Conversation context
      conversationId,
      messageCount: conversation.messages.length,

      // Operation context
      operation: 'memory-extraction',
      phase: 'entity-extraction',

      // Data context
      inputLength: transcript.length,
      sampleRate: 0.1,

      // Infrastructure context
      region: process.env.REGION,
      deploymentId: process.env.DEPLOYMENT_ID,
    },
  },
});
```

---

## Privacy & Security Considerations

### Redact Sensitive Data

```typescript
// src/instrumentation.ts
import { redactSensitiveData } from './utils/redaction';

// For sensitive operations
const result = await generateText({
  model: openai('gpt-4o'),
  prompt: userInput, // May contain PII
  experimental_telemetry: {
    isEnabled: true,
    recordInputs: false,  // Don't record the raw prompt
    recordOutputs: false, // Don't record outputs
    functionId: 'pii-processing',
    metadata: {
      userId, // Safe to include
      operationType: 'sensitive',
    },
  },
});
```

### Selective Tracing by Data Classification

```typescript
function shouldTrace(dataClassification: 'public' | 'internal' | 'confidential') {
  const traceByLevel = {
    public: true,
    internal: process.env.NODE_ENV === 'production',
    confidential: false,
  };

  return traceByLevel[dataClassification];
}

const result = await generateText({
  model: openai('gpt-4o'),
  prompt: userInput,
  experimental_telemetry: {
    isEnabled: shouldTrace('confidential'),
    recordInputs: false,
    recordOutputs: false,
  },
});
```

---

## Monitoring & Dashboards

### Key Metrics to Track

1. **LLM Performance:**
   - Response latency (p50, p95, p99)
   - Token usage (prompt, completion, total)
   - Finish reasons (stop, length, tool-call, error)
   - Cost per operation

2. **Agent Performance:**
   - Agent execution time by phase
   - Tool call success/failure rates
   - Retry counts
   - Error types and frequencies

3. **Database Performance:**
   - Neo4j query latency
   - Entity creation/update success rates
   - Relationship creation errors

4. **API Performance:**
   - Request latency by endpoint
   - Error rates
   - Throughput

### Langfuse Dashboard Queries

**LLM Token Usage Over Time:**
```
SELECT
  timestamp,
  SUM(usage.prompt_tokens) as prompt_tokens,
  SUM(usage.completion_tokens) as completion_tokens
FROM traces
WHERE function_id = 'conversation-response'
GROUP BY timestamp
ORDER BY timestamp DESC
```

**Error Rate by Function:**
```
SELECT
  function_id,
  COUNT(*) as total,
  COUNTIF(error IS NOT NULL) as errors,
  COUNTIF(error IS NOT NULL) / COUNT(*) as error_rate
FROM traces
GROUP BY function_id
```

**User-Level Performance:**
```
SELECT
  metadata.userId,
  COUNT(*) as operations,
  AVG(duration_ms) as avg_latency,
  SUM(usage.total_tokens) as tokens_used
FROM traces
WHERE date_range = LAST_7_DAYS
GROUP BY metadata.userId
```

---

## Testing Tracing

### Test Harness

```typescript
// test/tracing.test.ts
import { describe, it, expect, vi } from 'vitest';
import { generateText } from 'ai';

describe('Tracing Integration', () => {
  it('should enable telemetry for generateText', async () => {
    const result = await generateText({
      model: openai('gpt-4o'),
      prompt: 'Test prompt',
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'test-function',
        metadata: { test: true },
      },
    });

    expect(result.text).toBeDefined();
    // Verify span was created (would need access to tracer)
  });

  it('should handle errors within spans', async () => {
    await expect(
      generateText({
        model: openai('invalid-model'),
        prompt: 'Test',
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'error-test',
        },
      }),
    ).rejects.toThrow();
    // Verify error was recorded in span
  });
});
```

---

## Troubleshooting

### Spans Not Showing in Langfuse

1. **Verify API keys:**
   ```bash
   echo $LANGFUSE_API_KEY
   echo $LANGFUSE_PUBLIC_KEY
   ```

2. **Enable debug logging:**
   ```typescript
   new LangfuseExporter({ debug: true })
   ```

3. **Check network access:**
   ```bash
   curl -i https://api.langfuse.com/health
   ```

### High Memory Usage

1. **Reduce sampling rate:**
   ```typescript
   const shouldTrace = Math.random() < 0.01; // 1% sampling
   ```

2. **Disable input/output recording:**
   ```typescript
   recordInputs: false,
   recordOutputs: false,
   ```

### Latency Impact

Monitor latency before/after enabling tracing:

```typescript
const start = Date.now();

const result = await generateText({
  // ...
  experimental_telemetry: { isEnabled: true },
});

const duration = Date.now() - start;
console.log(`Generation took ${duration}ms`);
```

Typical overhead: 2-5% latency increase.

---

## References

- **Langfuse Documentation:** https://langfuse.com/docs
- **OpenTelemetry Node.js:** https://opentelemetry.io/docs/instrumentation/js/
- **AI SDK Telemetry:** https://ai-sdk.dev/docs/guides/telemetry
- **Saturn Architecture:** See `backend/scripts/ingestion/schema.md`
