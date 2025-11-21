# Reasoning Models & Thinking Capabilities

## Overview

Latest Vercel AI SDK supports models with reasoning capabilities that spend computation time "thinking" before generating responses. This leads to more accurate and reliable results for complex tasks.

## Available Reasoning Models (2025)

### OpenAI Models

```typescript
// Reasoning with dynamic performance tuning
'openai/gpt-5'              // Latest reasoning model
'openai/gpt-5-mini'         // Smaller, faster reasoning
'openai/gpt-5-nano'         // Ultra-fast, simple tasks

// Explicit thinking variants
'openai/gpt-5.1-instant'    // Fast responses
'openai/gpt-5.1-thinking'   // Extended reasoning
```

### Anthropic Models

```typescript
'anthropic/claude-4-sonnet'  // Latest reasoning
```

### Other Providers

- **DeepSeek**: R1, R1-Zero
- **Google**: Gemini 2.0 with reasoning
- **Together AI**: DeepSeek R1 variants

## Controlling Reasoning Effort

For OpenAI reasoning models, control computation effort:

```typescript
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

const { text, reasoning } = await generateText({
  model: openai('gpt-5', {
    reasoningEffort: 'low', // 'low', 'medium', 'high'
  }),
  prompt: 'Solve this complex math problem: ...',
});

// See the model's thinking process
console.log('Reasoning:', reasoning);
console.log('Answer:', text);
```

### Reasoning Effort Tradeoffs

| Effort | Speed | Quality | Use Case |
|--------|-------|---------|----------|
| **low** | Fast | Good | Simple questions, classifications |
| **medium** | Balanced | Very Good | Most applications |
| **high** | Slower | Excellent | Research, complex analysis |

## Accessing Reasoning Content

### From generateText

```typescript
const { text, reasoning } = await generateText({
  model: 'openai/gpt-5',
  prompt: 'Prove that TypeScript improves code quality',
});

console.log('Internal reasoning:');
console.log(reasoning);

console.log('\nFinal answer:');
console.log(text);
```

### From streamText

```typescript
import { streamText } from 'ai';

const result = streamText({
  model: 'openai/gpt-5',
  prompt: 'Complex reasoning task',
});

// Listen for reasoning tokens
for await (const event of result.fullStream) {
  if (event.type === 'reasoning-start') {
    console.log('Model is reasoning...');
  }

  if (event.type === 'reasoning-delta') {
    console.log('Reasoning step:', event.reasoningDelta);
  }

  if (event.type === 'reasoning-end') {
    console.log('Reasoning complete');
  }

  if (event.type === 'text-delta') {
    console.log('Response:', event.textDelta);
  }
}

// Or access complete reasoning
const fullReasoning = await result.reasoning;
console.log('Full thought process:', fullReasoning);
```

### From generateObject (Structured Outputs)

```typescript
import { generateObject } from 'ai';
import { z } from 'zod';
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai';

const { object, reasoning } = await generateObject({
  model: 'openai/gpt-5',

  schema: z.object({
    diagnosis: z.string(),
    recommendedTreatment: z.array(z.string()),
    riskFactors: z.array(z.string()),
  }),

  prompt: 'Analyze patient symptoms...',

  // Get detailed reasoning
  providerOptions: {
    openai: {
      reasoningSummary: 'detailed', // or 'basic'
    } satisfies OpenAIResponsesProviderOptions,
  },
});

console.log('Clinical reasoning:', reasoning);
console.log('Diagnosis:', object.diagnosis);
```

## Reasoning with Tools

Multi-step tool calling with reasoning:

```typescript
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';

const { text, totalUsage } = await generateText({
  model: 'openai/gpt-5',

  system: 'You are a research assistant. Use tools to find information.',

  prompt: 'Research the impact of TypeScript on code quality',

  stopWhen: stepCountIs(8), // Allow multiple tool calls

  tools: {
    search: tool({
      description: 'Search for academic papers',
      inputSchema: z.object({
        query: z.string(),
      }),
      execute: async ({ query }) => {
        // Call API
        return { results: ['Paper 1', 'Paper 2'] };
      },
    }),
    analyze: tool({
      description: 'Analyze findings',
      inputSchema: z.object({
        data: z.string(),
      }),
      execute: async ({ data }) => {
        // Analyze
        return { summary: 'Key findings...' };
      },
    }),
  },

  providerOptions: {
    openai: {
      reasoningEffort: 'high',
    },
  },
});

console.log('Research complete:', text);
console.log('Tokens used:', totalUsage.totalTokens);
```

## Extracting Reasoning from Non-Reasoning Models

For models that don't have native reasoning but output reasoning in text:

```typescript
import { streamText, extractReasoningMiddleware } from 'ai';

const result = streamText({
  model: 'deepseek/deepseek-r1', // Via Together AI or other provider

  prompt: 'Solve this problem',

  // Automatically extract <think> tags
  experimental_transform: extractReasoningMiddleware({
    // Tell middleware to look for <think> tags
    startWithReasoning: true,
  }),
});

// Reasoning extracted separately
for await (const event of result.fullStream) {
  if (event.type === 'reasoning-delta') {
    console.log('Extracted reasoning:', event.reasoningDelta);
  }
  if (event.type === 'text-delta') {
    console.log('Response:', event.textDelta);
  }
}
```

## Reasoning Cost Analysis

Reasoning tokens typically cost more than regular tokens:

```typescript
const { text, usage } = await generateText({
  model: 'openai/gpt-5',
  prompt: 'Your prompt',
  providerOptions: {
    openai: {
      reasoningEffort: 'medium',
    },
  },
});

console.log('Prompt tokens:', usage.promptTokens);
console.log('Completion tokens:', usage.completionTokens);
console.log('Total tokens:', usage.totalTokens);

// Calculate approximate cost
const reasoningTokens = usage.completionTokens; // Estimated
const cost = reasoningTokens * 0.00003; // Example: $0.03 per 1M reasoning tokens
console.log('Approximate cost:', cost);
```

## When to Use Reasoning

### ✅ Use Reasoning For

- **Complex Math** - Multi-step calculations, proofs
- **Logic Puzzles** - Requires careful analysis
- **Code Reviews** - Complex architectural decisions
- **Research** - Novel problem-solving
- **Medical/Legal** - High-stakes decisions
- **Step-by-Step Reasoning** - Explainability matters
- **Validation** - Checking correctness of answers

### ❌ Don't Use Reasoning For

- **Simple Lookups** - "What is the weather?"
- **Classification** - "Is this email spam?"
- **Completions** - "Finish this sentence"
- **Real-time Chat** - Too slow for UI
- **Budget-Constrained** - Reasoning is 10-20x more expensive
- **Latency-Sensitive** - Users can't wait 30+ seconds

## Example: Research Agent with Reasoning

```typescript
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { openai } from '@ai-sdk/openai';

const researchAgent = async (topic: string) => {
  const { text, totalUsage, steps } = await generateText({
    model: openai('gpt-5', {
      reasoningEffort: 'high',
    }),

    system: `You are a research expert. Your job is to thoroughly research
a topic and provide evidence-based insights.`,

    prompt: `Research: ${topic}`,

    stopWhen: stepCountIs(10),

    tools: {
      googleSearch: tool({
        description: 'Search Google for information',
        inputSchema: z.object({
          query: z.string().describe('Search query'),
        }),
        execute: async ({ query }) => {
          // Simulate search
          return { results: ['result1', 'result2'] };
        },
      }),
    },
  });

  return {
    findings: text,
    tokensUsed: totalUsage.totalTokens,
    stepsRequired: steps.length,
  };
};

// Usage
const research = await researchAgent(
  'Impact of AI on software development in 2025'
);

console.log('Findings:', research.findings);
console.log('Tokens:', research.tokensUsed);
console.log('Steps:', research.stepsRequired);
```

## Best Practices

1. **Match Effort to Complexity** - Use `low` for simple, `high` for complex
2. **Cache Reasoning** - Store reasoning results to avoid recomputation
3. **Monitor Costs** - Reasoning tokens cost significantly more
4. **Test Different Efforts** - Benchmark quality vs. speed tradeoff
5. **Use in Agents** - Reasoning + tools = powerful combination
6. **Log Reasoning** - Save for audit/debugging
7. **Set Timeouts** - High reasoning effort can take 30+ seconds
8. **Batch Processing** - Use for batch jobs, not real-time chat

## Limitations

1. **Model Support** - Not all models have reasoning
2. **Streaming Delay** - Reasoning must complete before streaming
3. **Cost** - 10-20x more expensive than standard inference
4. **Latency** - Can take 10-30+ seconds
5. **Tool Limitations** - Some providers limit tool usage with reasoning

## Next Steps

- **Backend Patterns**: See `06-BACKEND-PATTERNS.md`
- **Full Examples**: GitHub vercel-labs/ai-sdk-reasoning-starter
