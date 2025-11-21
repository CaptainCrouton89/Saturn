# Backend Integration Patterns

Complete patterns for integrating Vercel AI SDK into Node.js backend servers.

## Express.js Backend

### Basic Chat Route

```typescript
// routes/chat.ts
import { Router } from 'express';
import { generateText } from 'ai';
import { MessageParam } from 'ai';

const router = Router();

interface ChatRequest {
  messages: MessageParam[];
  systemPrompt?: string;
}

interface ChatResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

router.post<unknown, ChatResponse, ChatRequest>(
  '/chat',
  async (req, res, next) => {
    try {
      const { messages, systemPrompt } = req.body;

      const result = await generateText({
        model: 'openai/gpt-5',
        system:
          systemPrompt || 'You are a helpful assistant.',
        messages,
      });

      res.json({
        content: result.text,
        usage: {
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
```

### Streaming Chat Route

```typescript
// routes/chat-stream.ts
import { Router } from 'express';
import { streamText } from 'ai';
import { MessageParam } from 'ai';

const router = Router();

router.post('/chat-stream', async (req, res, next) => {
  try {
    const { messages }: { messages: MessageParam[] } = req.body;

    const result = streamText({
      model: 'openai/gpt-5',
      system: 'You are a helpful assistant.',
      messages,
    });

    // Set headers for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Pipe the stream to response
    await result.pipeTextStreamToResponse(res);
  } catch (error) {
    next(error);
  }
});

export default router;
```

### Agent Route with Tools

```typescript
// routes/agent.ts
import { Router } from 'express';
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';

const router = Router();

interface AgentRequest {
  prompt: string;
}

interface AgentResponse {
  result: string;
  steps: number;
  usage: {
    totalTokens: number;
  };
}

router.post<unknown, AgentResponse, AgentRequest>(
  '/agent',
  async (req, res, next) => {
    try {
      const { prompt } = req.body;

      const result = await generateText({
        model: 'openai/gpt-5',
        prompt,
        stopWhen: stepCountIs(5),
        tools: {
          getWeather: tool({
            description: 'Get weather for a location',
            inputSchema: z.object({
              location: z.string(),
            }),
            execute: async ({ location }) => {
              // Call weather API
              return { location, temp: 72, condition: 'sunny' };
            },
          }),
          calculator: tool({
            description: 'Perform mathematical calculations',
            inputSchema: z.object({
              operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
              a: z.number(),
              b: z.number(),
            }),
            execute: async ({ operation, a, b }) => {
              const ops = {
                add: (x: number, y: number) => x + y,
                subtract: (x: number, y: number) => x - y,
                multiply: (x: number, y: number) => x * y,
                divide: (x: number, y: number) => x / y,
              };
              return { result: ops[operation](a, b) };
            },
          }),
        },
      });

      res.json({
        result: result.text,
        steps: result.steps.length,
        usage: {
          totalTokens: result.totalUsage.totalTokens,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
```

## Fastify Backend

### Basic Integration

```typescript
// routes/chat.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { generateText } from 'ai';
import { MessageParam } from 'ai';

interface ChatBody {
  messages: MessageParam[];
  systemPrompt?: string;
}

export async function chatRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: ChatBody }>(
    '/chat',
    async (request: FastifyRequest<{ Body: ChatBody }>, reply: FastifyReply) => {
      try {
        const { messages, systemPrompt } = request.body;

        const result = await generateText({
          model: 'openai/gpt-5',
          system:
            systemPrompt || 'You are a helpful assistant.',
          messages,
        });

        reply.send({
          content: result.text,
          usage: result.usage,
        });
      } catch (error) {
        reply.status(500).send({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  );

  // Streaming endpoint
  fastify.post<{ Body: ChatBody }>(
    '/chat-stream',
    async (request: FastifyRequest<{ Body: ChatBody }>, reply: FastifyReply) => {
      const { messages } = request.body;

      const result = streamText({
        model: 'openai/gpt-5',
        messages,
      });

      reply.type('text/event-stream').send(result.toTextStreamResponse());
    }
  );
}
```

## Next.js Backend (App Router)

### API Route with Streaming

```typescript
// app/api/chat/route.ts
import { streamText } from 'ai';
import { MessageParam } from 'ai';

export const runtime = 'nodejs';

interface ChatRequest {
  messages: MessageParam[];
}

export async function POST(request: Request) {
  try {
    const { messages }: ChatRequest = await request.json();

    const result = streamText({
      model: 'openai/gpt-5',
      system: 'You are a helpful assistant.',
      messages,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
```

### API Route with Tools

```typescript
// app/api/agent/route.ts
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 60; // Vercel timeout

interface AgentRequest {
  prompt: string;
}

export async function POST(request: Request) {
  try {
    const { prompt }: AgentRequest = await request.json();

    const result = await generateText({
      model: 'openai/gpt-5',
      prompt,
      stopWhen: stepCountIs(5),
      tools: {
        // Define tools
      },
    });

    return Response.json({
      answer: result.text,
      usage: result.totalUsage,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
```

## Hono Backend

```typescript
// routes/chat.ts
import { Hono } from 'hono';
import { streamText } from 'ai';
import { MessageParam } from 'ai';

const app = new Hono();

interface ChatBody {
  messages: MessageParam[];
}

app.post('/chat', async (c) => {
  try {
    const { messages }: ChatBody = await c.req.json();

    const result = streamText({
      model: 'openai/gpt-5',
      messages,
    });

    // Stream to client
    return c.body(result.toTextStreamResponse().body as ReadableStream);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

export default app;
```

## Error Handling Middleware

```typescript
// middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';

interface AIError extends Error {
  code?: string;
  status?: number;
}

export function aiErrorHandler(
  error: AIError,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  console.error('AI SDK Error:', error);

  // Handle specific errors
  if (error.code === 'ERR_FETCH_FAILED') {
    return res.status(503).json({
      error: 'AI service unavailable',
      message: 'Please try again later',
    });
  }

  if (error.code === 'ERR_TOKEN_LIMIT') {
    return res.status(400).json({
      error: 'Request too large',
      message: 'Prompt exceeds token limit',
    });
  }

  // Generic error
  res.status(error.status || 500).json({
    error: 'Generation failed',
    message: error.message,
  });
}
```

## Message Management

### Message Storage

```typescript
// services/messageService.ts
import { MessageParam } from 'ai';
import { db } from '@/db';

export interface StoredMessage extends MessageParam {
  id: string;
  conversationId: string;
  createdAt: Date;
  tokens?: number;
}

export async function saveMessage(
  conversationId: string,
  message: MessageParam,
  tokens?: number
): Promise<StoredMessage> {
  const stored = await db.messages.create({
    conversationId,
    role: message.role,
    content:
      typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content),
    tokens,
    createdAt: new Date(),
  });

  return {
    ...message,
    id: stored.id,
    conversationId,
    createdAt: stored.createdAt,
    tokens,
  };
}

export async function getConversationHistory(
  conversationId: string,
  limit: number = 20
): Promise<MessageParam[]> {
  const messages = await db.messages.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  return messages.map(m => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }));
}
```

### Conversation Context Management

```typescript
// services/conversationService.ts
import { MessageParam } from 'ai';

const MAX_HISTORY = 20;
const MAX_TOKENS = 4000;

export class ConversationManager {
  private messages: MessageParam[] = [];
  private tokenCount = 0;

  async addMessage(message: MessageParam, tokens: number) {
    this.messages.push(message);
    this.tokenCount += tokens;

    // Trim old messages if exceeding limits
    while (
      this.messages.length > MAX_HISTORY ||
      this.tokenCount > MAX_TOKENS
    ) {
      // Keep system message, remove oldest
      if (this.messages[0]?.role === 'system') {
        const removed = this.messages.splice(1, 1)[0];
        if (removed) {
          // Estimate tokens if not available
          this.tokenCount -= Math.round(
            (typeof removed.content === 'string' ? removed.content.length : 0) / 4
          );
        }
      }
    }
  }

  getMessages(): MessageParam[] {
    return this.messages;
  }

  getContext(): { messageCount: number; approximateTokens: number } {
    return {
      messageCount: this.messages.length,
      approximateTokens: this.tokenCount,
    };
  }

  clear() {
    this.messages = [];
    this.tokenCount = 0;
  }
}
```

## Rate Limiting & Throttling

```typescript
// middleware/rateLimiter.ts
import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';

const rateLimiter = new RateLimiterMemory({
  points: 10, // 10 requests
  duration: 60, // per 60 seconds
});

export async function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = req.user?.id || req.ip;
    await rateLimiter.consume(userId);
    next();
  } catch (error) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: 60,
    });
  }
}
```

## Logging & Observability

```typescript
// middleware/aiLogger.ts
import { Request, Response, NextFunction } from 'express';

export function logAIRequest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const start = Date.now();

  // Intercept response
  const originalJson = res.json;
  res.json = function (body: any) {
    const duration = Date.now() - start;

    console.log({
      timestamp: new Date().toISOString(),
      endpoint: req.path,
      method: req.method,
      duration: `${duration}ms`,
      tokensUsed: body.usage?.totalTokens,
      status: res.statusCode,
      userId: (req as any).user?.id,
    });

    return originalJson.call(this, body);
  };

  next();
}
```

## Complete Server Setup

```typescript
// server.ts
import express from 'express';
import chatRoutes from './routes/chat';
import agentRoutes from './routes/agent';
import { aiErrorHandler } from './middleware/errorHandler';
import { rateLimitMiddleware } from './middleware/rateLimiter';
import { logAIRequest } from './middleware/aiLogger';

const app = express();

// Middleware
app.use(express.json());
app.use(rateLimitMiddleware);
app.use(logAIRequest);

// Routes
app.use('/api/chat', chatRoutes);
app.use('/api/agent', agentRoutes);

// Error handling
app.use(aiErrorHandler);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
```

## Environment Configuration

```typescript
// config/ai.ts
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';

export const models = {
  // Fast, cost-effective
  fast: 'openai/gpt-5-mini',

  // Balanced
  balanced: 'openai/gpt-5',

  // High quality, reasoning
  advanced: openai('gpt-5', {
    reasoningEffort: 'high',
  }),

  // Alternative providers
  claude: anthropic('claude-4-sonnet'),
  gemini: google('gemini-2.0-flash'),
};

export const config = {
  // Request settings
  timeout: 30000, // 30 seconds
  maxRetries: 2,

  // Rate limiting
  rateLimit: {
    requestsPerMinute: 60,
    tokensPerMinute: 90000,
  },

  // Logging
  debug: process.env.DEBUG === 'true',
  logTokenUsage: true,

  // Monitoring
  enableMetrics: true,
};
```

## Next Steps

- **Full Examples**: GitHub vercel/ai/examples
- **Deployment**: Vercel, Railway, AWS
- **Testing**: Jest + AI SDK
