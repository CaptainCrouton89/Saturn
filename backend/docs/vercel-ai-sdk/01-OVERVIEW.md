# Vercel AI SDK 2025 - Comprehensive Guide for TypeScript Backends

## Quick Overview

The **Vercel AI SDK** is a TypeScript-first toolkit for building AI-powered applications and agents. It provides:

- **Unified Provider API** - Supports OpenAI, Anthropic, Google, Mistral, and 20+ other providers
- **Type-Safe Operations** - Full end-to-end TypeScript support with inference
- **Agentic Workflows** - Built-in agent patterns with tool calling and multi-step reasoning
- **Streaming Support** - Real-time text and structured data streaming
- **Zero Provider Lock-in** - Switch providers with a single string change

### Latest Versions (2025)

- **Stable**: AI SDK v5.x (latest recommended for production)
- **Beta**: AI SDK v6 (early access)
- **Gateway**: Vercel AI Gateway for unified model access (no provider accounts needed)

## Installation

```bash
# Core package
pnpm add ai

# Model providers (choose as needed)
pnpm add @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google

# Validation library (required for structured outputs)
pnpm add zod

# Dev dependencies
pnpm add -D typescript @types/node tsx
```

## Core Concepts

### 1. **Models**
- Abstraction over provider APIs
- Usage: `'openai/gpt-5'` or `openai('gpt-5')`
- Supports: Text generation, structured outputs, tool calling, reasoning

### 2. **Text Generation**
- `generateText()` - Single response (good for agents, batch operations)
- `streamText()` - Streaming response (good for chat, real-time UI)

### 3. **Structured Outputs**
- `generateObject()` - Generate typed data using Zod schemas
- `streamObject()` - Stream structured data as it's generated

### 4. **Tools & Tool Calling**
- LLMs can invoke functions to extend capabilities
- Tools are validated with Zod schemas
- Supports multi-step tool calling loops

### 5. **Agents**
- Agent class or multi-step loops with `stopWhen`
- `prepareStep()` callback for per-step customization
- `onStepFinish()` callback for logging/persistence

## Architecture for Node.js Backend

```
Your Node.js Server
├── AI SDK Core (generateText, streamText, etc)
├── Tool Definitions (with Zod validation)
├── Agent Definitions (with stopWhen conditions)
└── Model Provider (OpenAI, Anthropic, etc)
    └── LLM (gpt-5, claude-sonnet, etc)
```

## Key Features by Use Case

| Use Case | Function | Key Features |
|----------|----------|--------------|
| **Simple API Response** | `generateText()` | Single LLM call, no tools |
| **Chat/Real-time** | `streamText()` | Streaming tokens, backpressure |
| **Data Extraction** | `generateObject()` | Zod schema validation, type-safe |
| **Multi-step Agent** | `generateText()` + `stopWhen` | Tool loops, context management |
| **Complex Workflows** | `Agent` class | Pre/post hooks, model switching |

## Configuration & Environment

### Using Vercel AI Gateway (Recommended)

```typescript
// No provider setup needed! Uses Vercel AI Gateway
const { text } = await generateText({
  model: 'openai/gpt-5', // Just use string format
  prompt: 'What is 2+2?',
});
```

Requires: `process.env.VERCEL_API_KEY` from your Vercel dashboard

### Using Provider Directly

```typescript
import { openai } from '@ai-sdk/openai';

const { text } = await generateText({
  model: openai('gpt-5', {
    reasoningEffort: 'high', // Provider-specific options
  }),
  prompt: 'What is 2+2?',
});
```

Requires: `process.env.OPENAI_API_KEY`

## Next Steps

1. **Basic Usage**: See `02-TEXT-GENERATION.md`
2. **Tools & Agents**: See `03-TOOLS-AND-AGENTS.md`
3. **Structured Data**: See `04-STRUCTURED-OUTPUTS.md`
4. **Reasoning**: See `05-REASONING.md`
5. **Backend Patterns**: See `06-BACKEND-PATTERNS.md`
