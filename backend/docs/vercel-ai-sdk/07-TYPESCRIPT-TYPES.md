# TypeScript Types & Advanced Patterns

Complete TypeScript type definitions and advanced patterns for the Vercel AI SDK.

## Message Types

```typescript
import { MessageParam, ModelMessage } from 'ai';

// MessageParam is the input type for generateText/streamText
const messages: MessageParam[] = [
  {
    role: 'system',
    content: 'You are a helpful assistant.',
  },
  {
    role: 'user',
    content: 'Hello!',
  },
  {
    role: 'assistant',
    content: 'Hi there! How can I help?',
  },
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Can you see this image?' },
      {
        type: 'image',
        image: Buffer.from(imageData),
        mimeType: 'image/jpeg',
      },
    ],
  },
];

// ModelMessage is the output type from generateText result
const result = await generateText({ /* ... */ });
const responseMessages: ModelMessage[] = result.response.messages;
```

## Result Types

```typescript
import { GenerateTextResult, StreamTextResult } from 'ai';

// generateText result
interface GenerateTextResult {
  text: string;
  reasoning?: string; // For reasoning models
  reasoningText?: string;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  }>;
  toolResults: Array<{
    toolCallId: string;
    toolName: string;
    result: unknown;
  }>;
  finishReason:
    | 'stop'
    | 'length'
    | 'content-filter'
    | 'tool-calls'
    | 'error';
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  totalUsage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  steps: Array<{
    type: 'initial' | 'tool-result';
    text: string;
    toolCalls: Array<any>;
    toolResults: Array<any>;
    finishReason: string;
    content: Array<any>;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }>;
  warnings?: Array<any>;
  request?: {
    body?: any;
  };
  response: {
    headers?: Record<string, string>;
    body?: any;
    messages: ModelMessage[];
  };
}

// streamText result
interface StreamTextResult {
  text: Promise<string>;
  textStream: ReadableStream<string> & AsyncIterable<string>;
  fullStream: AsyncIterable<TextStreamPart<any>>;
  reasoning: Promise<string>;
  reasoningText: Promise<string>;
  usage: Promise<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>;
  finishReason: Promise<string>;
  // ... other properties
}
```

## Tool Types

```typescript
import { tool, ToolSet, TypedToolCall, TypedToolResult } from 'ai';
import { z } from 'zod';

// Define a single tool
const weatherTool = tool({
  description: 'Get weather for a location',
  inputSchema: z.object({
    location: z.string(),
  }),
  execute: async ({ location }) => ({
    location,
    temp: 72,
    condition: 'sunny',
  }),
});

// Tool execution receives additional options
const myTool = tool({
  inputSchema: z.object({ query: z.string() }),
  execute: async (
    input,
    options: {
      toolCallId: string;
      messages: MessageParam[];
      abortSignal: AbortSignal;
      experimental_context?: unknown;
    }
  ) => {
    console.log('Tool call ID:', options.toolCallId);
    return { result: 'success' };
  },
});

// Type the tools object
const toolSet = {
  weather: weatherTool,
  search: searchTool,
} as const;

type MyTools = typeof toolSet;

// Extract tool call types
type MyToolCall = TypedToolCall<MyTools>;
type MyToolResult = TypedToolResult<MyTools>;

// Use in function
async function runAgent(prompt: string): Promise<{
  text: string;
  toolCalls: MyToolCall[];
  toolResults: MyToolResult[];
}> {
  return generateText({
    model: 'openai/gpt-5',
    prompt,
    tools: toolSet,
    stopWhen: stepCountIs(5),
  });
}
```

## Dynamic Tool Types

```typescript
import { dynamicTool } from 'ai';

// For tools with unknown schemas
const customTool = dynamicTool({
  description: 'Execute user-provided functions',
  inputSchema: z.object({}), // Dynamic input
  execute: async (input: unknown) => {
    // input is typed as 'unknown'
    const validated = input as { action: string; params: Record<string, any> };
    return { result: 'executed' };
  },
});

// In tool calls, identify dynamic tools
const result = await generateText({
  tools: {
    dynamic: customTool,
    weather: weatherTool,
  },
  onStepFinish: ({ toolCalls }) => {
    for (const call of toolCalls) {
      if (call.dynamic) {
        // Handle dynamic tool
        console.log('Dynamic tool call:', call.input); // typed as unknown
      } else {
        // Handle typed tool
        if (call.toolName === 'weather') {
          console.log('Location:', call.input.location); // typed as string
        }
      }
    }
  },
});
```

## Conversation Management Types

```typescript
import { MessageParam } from 'ai';

interface ConversationState {
  id: string;
  messages: MessageParam[];
  createdAt: Date;
  updatedAt: Date;
  metadata: {
    model: string;
    systemPrompt: string;
    totalTokensUsed: number;
  };
}

interface ConversationManager {
  addMessage(
    role: 'user' | 'assistant',
    content: string | MessageParam['content']
  ): Promise<void>;

  getMessages(): MessageParam[];

  getContext(): {
    messageCount: number;
    approximateTokens: number;
  };

  clear(): void;
}

class TypedConversationManager implements ConversationManager {
  private messages: MessageParam[] = [];
  private tokenCount = 0;

  addMessage(
    role: 'user' | 'assistant',
    content: string | MessageParam['content']
  ): Promise<void> {
    this.messages.push({ role, content });
    // Estimate tokens
    const str = typeof content === 'string' ? content : JSON.stringify(content);
    this.tokenCount += Math.round(str.length / 4);
    return Promise.resolve();
  }

  getMessages(): MessageParam[] {
    return this.messages;
  }

  getContext() {
    return {
      messageCount: this.messages.length,
      approximateTokens: this.tokenCount,
    };
  }

  clear(): void {
    this.messages = [];
    this.tokenCount = 0;
  }
}
```

## Provider Options Types

```typescript
import { openai } from '@ai-sdk/openai';
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai';

// OpenAI-specific options
const result = await generateText({
  model: openai('gpt-5', {
    reasoningEffort: 'high',
    baseURL: 'https://api.openai.com/v1', // Custom endpoint
  }),
  prompt: 'Your prompt',

  // Pass provider-specific options via generateText
  providerOptions: {
    openai: {
      reasoningSummary: 'detailed',
      strictJsonSchema: true,
    } satisfies OpenAIResponsesProviderOptions,
  },
});
```

## Zod Schema Types

```typescript
import { z } from 'zod';

// Basic schema
const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  age: z.number().min(0).max(150),
});

// Extract TypeScript type
type User = z.infer<typeof userSchema>;

// Nested schemas
const postSchema = z.object({
  id: z.string(),
  author: userSchema,
  content: z.string(),
  tags: z.array(z.string()),
  metadata: z.object({
    createdAt: z.date(),
    updatedAt: z.date(),
    viewCount: z.number(),
  }),
});

type Post = z.infer<typeof postSchema>;

// Discriminated unions
const resultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    data: z.unknown(),
  }),
  z.object({
    status: z.literal('error'),
    error: z.string(),
    code: z.number(),
  }),
]);

type Result = z.infer<typeof resultSchema>;

// In generateObject
const { object } = await generateObject({
  model: 'openai/gpt-5',
  schema: postSchema,
  prompt: 'Generate a blog post',
});

// Fully typed!
const author: User = object.author;
const tags: string[] = object.tags;
```

## Error Types

```typescript
import {
  InvalidToolInputError,
  NoSuchToolError,
  ToolCallRepairError,
  NoObjectGeneratedError,
} from 'ai';

// Tool calling errors
try {
  await generateText({
    /* ... */
  });
} catch (error) {
  if (InvalidToolInputError.isInstance(error)) {
    // Handle invalid input
    console.error('Invalid tool input:', error.message);
  } else if (NoSuchToolError.isInstance(error)) {
    // Handle missing tool
    console.error('Tool not found:', error.message);
  } else if (ToolCallRepairError.isInstance(error)) {
    // Handle repair failure
    console.error('Could not repair tool call:', error.message);
  }
}

// Object generation errors
try {
  await generateObject({
    /* ... */
  });
} catch (error) {
  if (NoObjectGeneratedError.isInstance(error)) {
    console.error('Failed to generate valid object');
    console.error('Text:', error.text);
    console.error('Cause:', error.cause);
    console.error('Response:', error.response);
  }
}
```

## Advanced Patterns

### Generic Agent Function

```typescript
import { generateText, tool, stepCountIs, MessageParam } from 'ai';
import { z } from 'zod';

interface AgentConfig {
  systemPrompt: string;
  maxSteps: number;
  model: string;
  tools: Record<string, any>;
}

interface AgentResult<T = string> {
  output: T;
  steps: number;
  usage: {
    totalTokens: number;
  };
}

async function createAgent<T = string>(
  config: AgentConfig
): Promise<(prompt: string) => Promise<AgentResult<T>>> {
  return async (prompt: string): Promise<AgentResult<T>> => {
    const result = await generateText({
      model: config.model,
      system: config.systemPrompt,
      prompt,
      tools: config.tools,
      stopWhen: stepCountIs(config.maxSteps),
    });

    return {
      output: result.text as T,
      steps: result.steps.length,
      usage: {
        totalTokens: result.totalUsage.totalTokens,
      },
    };
  };
}

// Usage
const researchAgent = await createAgent({
  systemPrompt: 'You are a research assistant',
  maxSteps: 10,
  model: 'openai/gpt-5',
  tools: {
    search: searchTool,
    analyze: analyzeTool,
  },
});

const result = await researchAgent('Research TypeScript adoption');
```

### Reusable Tool Library

```typescript
// tools/types.ts
import { z } from 'zod';

export interface ToolLibrary {
  [key: string]: {
    description: string;
    inputSchema: z.ZodType<any, any, any>;
    execute: (input: any) => Promise<any>;
  };
}

// tools/database.ts
import { tool } from 'ai';
import { z } from 'zod';

export const databaseTools: ToolLibrary = {
  queryDatabase: tool({
    description: 'Execute a database query',
    inputSchema: z.object({
      query: z.string(),
    }),
    execute: async ({ query }) => {
      // Your database logic
      return { rows: [] };
    },
  }),

  insertRecord: tool({
    description: 'Insert a new record',
    inputSchema: z.object({
      table: z.string(),
      data: z.record(z.any()),
    }),
    execute: async ({ table, data }) => {
      // Your insert logic
      return { id: 'new-id' };
    },
  }),
};

// Usage
import { generateText, stepCountIs } from 'ai';
import { databaseTools } from './tools/database';

const { text } = await generateText({
  model: 'openai/gpt-5',
  prompt: 'Query the users table',
  tools: databaseTools,
  stopWhen: stepCountIs(5),
});
```

### Middleware Pattern

```typescript
import { MessageParam } from 'ai';

type TextGenerationMiddleware = {
  onRequest?: (
    options: Record<string, any>
  ) => Promise<Record<string, any>>;
  onSuccess?: (result: any) => Promise<void>;
  onError?: (error: Error) => Promise<void>;
};

async function withMiddleware(
  middleware: TextGenerationMiddleware[],
  fn: () => Promise<any>
) {
  let options: Record<string, any> = {};

  // Request phase
  for (const mw of middleware) {
    if (mw.onRequest) {
      options = await mw.onRequest(options);
    }
  }

  try {
    const result = await fn();

    // Success phase
    for (const mw of middleware) {
      if (mw.onSuccess) {
        await mw.onSuccess(result);
      }
    }

    return result;
  } catch (error) {
    // Error phase
    for (const mw of middleware) {
      if (mw.onError && error instanceof Error) {
        await mw.onError(error);
      }
    }
    throw error;
  }
}

// Usage
const loggingMiddleware: TextGenerationMiddleware = {
  onRequest: async (opts) => {
    console.log('Request:', opts);
    return opts;
  },
  onSuccess: async (result) => {
    console.log('Tokens used:', result.usage.totalTokens);
  },
};

const cachingMiddleware: TextGenerationMiddleware = {
  // Implement caching logic
};

await withMiddleware([loggingMiddleware, cachingMiddleware], () =>
  generateText({ /* ... */ })
);
```

## Best Practices

1. **Always type tool schemas** - Use Zod for validation
2. **Extract message types** - Use `MessageParam` for inputs
3. **Handle all error cases** - Use error type guards
4. **Use discriminated unions** - For complex result types
5. **Create reusable tool libraries** - Share across projects
6. **Middleware for cross-cutting concerns** - Logging, caching, etc.
7. **Type-safe tool calling** - Use `TypedToolCall<T>`
8. **Validate at runtime** - Zod provides both types and validation

## Next Steps

- **Backend Patterns**: See [06-BACKEND-PATTERNS.md](06-BACKEND-PATTERNS.md)
- **Official Types**: https://github.com/vercel/ai/tree/main/packages/ai
