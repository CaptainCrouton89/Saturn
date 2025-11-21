# Text Generation - generateText & streamText

## Overview

Two primary functions handle text generation:

1. **`generateText()`** - Returns complete response (good for agents, batch jobs)
2. **`streamText()`** - Returns streaming response (good for chat UI, real-time apps)

## generateText() - Complete Responses

Best for agents, batch processing, and operations where you can wait for the full response.

### Basic Example

```typescript
import { generateText } from 'ai';

const { text } = await generateText({
  model: 'openai/gpt-5',
  prompt: 'Write a haiku about TypeScript',
});

console.log(text);
```

### With System Prompt

```typescript
const { text, usage } = await generateText({
  model: 'openai/gpt-5',
  system: 'You are a TypeScript expert and code reviewer.',
  prompt: `Review this code:
${codeSnippet}`,
});

console.log('Generated review:', text);
console.log('Tokens used:', usage);
```

### Result Object Properties

```typescript
const result = await generateText({
  model: 'openai/gpt-5',
  prompt: 'Hello',
});

// Common properties:
result.text              // The generated text
result.usage            // { promptTokens, completionTokens, totalTokens }
result.finishReason     // 'stop', 'length', 'content-filter', 'error'
result.warnings         // Array of warnings from provider
result.response.headers // Raw response headers
result.response.body    // Raw response body

// For multi-step (with tools):
result.toolCalls       // Array of tool calls made
result.toolResults     // Array of tool execution results
result.steps           // Details of all steps (for debugging)
result.totalUsage      // Token usage across all steps
```

### Advanced Options

```typescript
const { text } = await generateText({
  model: 'openai/gpt-5',
  system: 'You are helpful.',
  prompt: 'How do I learn TypeScript?',

  // Abort control:
  abortSignal: controller.signal,

  // For debugging:
  headers: {                  // Custom headers
    'X-Custom-Header': 'value',
  },

  // Provider-specific options (depends on model)
  providerOptions: {
    openai: {
      reasoningEffort: 'medium', // For reasoning models
    },
  },
});
```

## streamText() - Streaming Responses

Best for chat interfaces, real-time applications, and interactive UIs where users expect immediate feedback.

### Basic Streaming

```typescript
import { streamText } from 'ai';

const result = streamText({
  model: 'openai/gpt-5',
  prompt: 'Write a long article about TypeScript',
});

// Consume as async iterable
for await (const chunk of result.textStream) {
  console.log(chunk); // Print each token
}
```

### Stream Response Object

```typescript
const result = streamText({
  model: 'openai/gpt-5',
  prompt: 'Hello',
});

// Properties (promises that resolve when stream finishes):
result.text              // Full text after stream ends
result.textStream        // ReadableStream + AsyncIterable
result.fullStream        // All events (text, tool-calls, etc)
result.usage             // Token usage
result.finishReason      // How generation ended
result.response.messages // Messages that were added to history

// HTTP helpers:
result.toTextStreamResponse()        // HTTP response with streaming text
result.pipeTextStreamToResponse()    // Pipe to Node.js response
result.toUIMessageStreamResponse()   // For AI SDK UI (with tool calls)
```

### Callbacks for Fine-Grained Control

```typescript
const result = streamText({
  model: 'openai/gpt-5',
  prompt: 'Write code',

  // Called when stream starts
  onStart() {
    console.log('Generation started');
  },

  // Called for each chunk (text, tool-calls, reasoning, etc)
  onChunk({ chunk }) {
    if (chunk.type === 'text') {
      console.log('Text:', chunk.text);
    }
    if (chunk.type === 'tool-call') {
      console.log('Tool call:', chunk.toolName);
    }
  },

  // Called when stream completes
  onFinish({ text, finishReason, usage, response }) {
    console.log('Finished with reason:', finishReason);
    console.log('Total tokens:', usage.totalTokens);
    // Save to database, etc
  },

  // Called on error
  onError({ error }) {
    console.error('Stream error:', error);
  },
});

// Don't forget to consume the stream!
for await (const _ of result.textStream) {}
```

### Full Stream Events

For maximum control, use `fullStream` to handle all event types:

```typescript
const result = streamText({
  model: 'openai/gpt-5',
  prompt: 'What is 2+2?',
});

for await (const event of result.fullStream) {
  switch (event.type) {
    case 'start':
      console.log('Stream started');
      break;

    case 'text-start':
      console.log('Text generation started');
      break;

    case 'text-delta':
      console.log('Text chunk:', event.textDelta);
      break;

    case 'text-end':
      console.log('Text generation complete');
      break;

    case 'tool-call':
      console.log('Tool called:', event.toolName);
      break;

    case 'tool-result':
      console.log('Tool result:', event.result);
      break;

    case 'error':
      console.error('Stream error:', event.error);
      break;

    case 'finish':
      console.log('Stream finished');
      break;
  }
}
```

### Streaming with Messages (Chat)

```typescript
import { streamText, MessageParam } from 'ai';

const messages: MessageParam[] = [
  { role: 'user', content: 'What is TypeScript?' },
  { role: 'assistant', content: 'TypeScript is a superset of JavaScript...' },
  { role: 'user', content: 'How do I use generics?' },
];

const result = streamText({
  model: 'openai/gpt-5',
  system: 'You are a TypeScript expert.',
  messages,
  temperature: 0.7,
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}

// Add response to message history
const assistantMessage = await result.response;
messages.push({
  role: 'assistant',
  content: await result.text,
});
```

### Next.js API Route Example

```typescript
// app/api/chat/route.ts
import { streamText } from 'ai';

export async function POST(request: Request) {
  const { messages } = await request.json();

  const result = streamText({
    model: 'openai/gpt-5',
    system: 'You are a helpful assistant.',
    messages,
  });

  return result.toTextStreamResponse();
}
```

### Express.js Backend Example

```typescript
// routes/chat.ts
import { streamText } from 'ai';
import { Router } from 'express';

const router = Router();

router.post('/chat', async (req, res) => {
  const { messages } = req.body;

  const result = streamText({
    model: 'openai/gpt-5',
    messages,
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  await result.pipeTextStreamToResponse(res);
});

export default router;
```

## Comparing generateText vs streamText

| Aspect | generateText | streamText |
|--------|------------|-----------|
| **Speed** | All at once | Immediate first token |
| **UI Feel** | Good for backend | Better for chat/UI |
| **Memory** | Buffers entire response | Streams as generated |
| **Error Handling** | try/catch | onError callback |
| **Use Cases** | Agents, batch, backend ops | Chat, real-time, UI |
| **Multi-step** | Native support | Via fullStream |

## Error Handling

### generateText Error Handling

```typescript
try {
  const { text } = await generateText({
    model: 'openai/gpt-5',
    prompt: 'Hello',
  });
} catch (error) {
  if (error instanceof Error) {
    console.error('Generation failed:', error.message);
  }
}
```

### streamText Error Handling

```typescript
const result = streamText({
  model: 'openai/gpt-5',
  prompt: 'Hello',

  onError({ error }) {
    console.error('Stream error:', error);
    // Errors don't crash server - handle gracefully
  },
});

try {
  for await (const _ of result.textStream) {
    // Process stream
  }
} catch (error) {
  console.error('Failed to consume stream:', error);
}
```

## Performance Tips

1. **Use streaming for UI** - Immediate user feedback
2. **Use generateText for agents** - Better control flow
3. **Implement backpressure** - streamText respects consumer readiness
4. **Add timeouts** - Prevent hanging requests
5. **Cache responses** - For repeated queries
6. **Use provider defaults** - Models are optimized by provider
7. **Monitor token usage** - Check usage.totalTokens in results

## Next Steps

- **Tool Calling**: See `03-TOOLS-AND-AGENTS.md`
- **Messages Format**: See `06-BACKEND-PATTERNS.md`
