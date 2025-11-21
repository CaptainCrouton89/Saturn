# Vercel AI SDK 2025 - Complete Documentation Index

Comprehensive guide for building AI-powered TypeScript backends with the Vercel AI SDK.

## 📚 Documentation Structure

### 1. **[01-OVERVIEW.md](01-OVERVIEW.md)** - Getting Started
- Quick overview of AI SDK capabilities
- Installation and setup
- Core concepts (models, text generation, tools, agents)
- Architecture for Node.js backends
- Use case reference table

**Read this first** if you're new to the Vercel AI SDK.

### 2. **[02-TEXT-GENERATION.md](02-TEXT-GENERATION.md)** - Core Text Generation
- `generateText()` - Complete responses
- `streamText()` - Streaming responses
- Result objects and properties
- Advanced options and configuration
- Callbacks: `onChunk`, `onFinish`, `onError`
- Full stream event handling
- Chat integration with message history
- Next.js and Express examples
- Error handling patterns
- Performance optimization

**Use this** for any text generation, chat, or content creation tasks.

### 3. **[03-TOOLS-AND-AGENTS.md](03-TOOLS-AND-AGENTS.md)** - Tools, Tool Calling & Agents
- Defining tools with `tool()` function
- Zod schema validation
- Single and multi-step tool calling
- `stopWhen` conditions for agent loops
- `prepareStep` callback for per-step customization
- `onStepFinish` callback for logging
- Tool execution options (toolCallId, messages, abortSignal)
- Tool choice control (required, none, specific)
- Error handling (InvalidToolInputError, NoSuchToolError)
- Using ready-made tool libraries
- Agent class API
- Best practices

**Use this** for building agents, multi-step workflows, and tools.

### 4. **[04-STRUCTURED-OUTPUTS.md](04-STRUCTURED-OUTPUTS.md)** - Type-Safe Structured Data
- `generateObject()` - Type-safe object generation
- `streamObject()` - Streaming partial objects
- Output strategies: object, array, enum, no-schema
- Complex nested schemas
- Error handling and schema validation
- JSON repair mechanisms
- Combining tools with structured outputs
- Accessing reasoning from structured outputs
- Type inference patterns
- Real-world extraction examples

**Use this** for data extraction, classification, and API responses.

### 5. **[05-REASONING.md](05-REASONING.md)** - Reasoning Models & Extended Thinking
- Available reasoning models (GPT-5, Claude, DeepSeek)
- Controlling reasoning effort (low, medium, high)
- Accessing reasoning content from text and objects
- Reasoning with tool calling
- Extracting reasoning from non-native models
- Cost analysis for reasoning tokens
- When to use vs. when to avoid reasoning
- Research agent example with reasoning
- Best practices and limitations

**Use this** for complex analysis, math problems, and research tasks.

### 6. **[06-BACKEND-PATTERNS.md](06-BACKEND-PATTERNS.md)** - Backend Integration Patterns
- Express.js: Basic chat, streaming, agents
- Fastify.js: Type-safe integration
- Next.js App Router: API routes
- Hono: Lightweight backend
- Error handling middleware
- Message management and storage
- Conversation context management
- Rate limiting and throttling
- Logging and observability
- Complete server setup
- Environment configuration

**Use this** for production backend implementation.

## 🎯 Quick Start by Use Case

### I want to...

| Task | Document | Function |
|------|----------|----------|
| **Build a simple chatbot** | [02-TEXT-GENERATION.md](02-TEXT-GENERATION.md) | `streamText()` |
| **Extract data from text** | [04-STRUCTURED-OUTPUTS.md](04-STRUCTURED-OUTPUTS.md) | `generateObject()` |
| **Build a multi-step agent** | [03-TOOLS-AND-AGENTS.md](03-TOOLS-AND-AGENTS.md) | `generateText()` + `stopWhen` |
| **Classify content** | [04-STRUCTURED-OUTPUTS.md](04-STRUCTURED-OUTPUTS.md) | `generateObject()` output: 'enum' |
| **Do complex reasoning** | [05-REASONING.md](05-REASONING.md) | `generateText()` with reasoning model |
| **Build API endpoints** | [06-BACKEND-PATTERNS.md](06-BACKEND-PATTERNS.md) | Express/Fastify patterns |
| **Add tools to agent** | [03-TOOLS-AND-AGENTS.md](03-TOOLS-AND-AGENTS.md) | `tool()` helper |
| **Stream responses to UI** | [02-TEXT-GENERATION.md](02-TEXT-GENERATION.md) | `streamText()` |
| **Set up production server** | [06-BACKEND-PATTERNS.md](06-BACKEND-PATTERNS.md) | Complete setup |

## 🚀 Getting Started (5-Minute Setup)

```typescript
// 1. Install
pnpm add ai @ai-sdk/openai zod

// 2. Set environment variable
export VERCEL_API_KEY=your-key-here

// 3. First request
import { generateText } from 'ai';

const { text } = await generateText({
  model: 'openai/gpt-5',
  prompt: 'What is TypeScript?',
});

console.log(text);
```

## 📋 Latest Models (2025)

### OpenAI (Recommended)
- `openai/gpt-5` - Latest, reasoning-capable
- `openai/gpt-5-mini` - Faster, cost-effective
- `openai/gpt-5-nano` - Ultra-fast, simple tasks
- `openai/gpt-5.1-thinking` - Extended reasoning
- `openai/gpt-4.1` - Stable alternative

### Anthropic
- `anthropic/claude-4-sonnet` - Latest reasoning
- `anthropic/claude-3-5-haiku` - Fast, efficient

### Google
- `google/gemini-2.0-flash` - Fast multimodal
- `google/gemini-2.0-pro` - Advanced reasoning

### Other Providers
- DeepSeek R1, R1-Zero
- Mistral AI models
- Meta Llama via Together AI

## 🔑 Key Concepts

### Text Generation Functions
| Function | When to Use | Returns |
|----------|------------|---------|
| `generateText()` | Non-interactive, agents, batch | Complete response |
| `streamText()` | Real-time chat, UI feedback | Token stream |

### Structured Data Functions
| Function | Output | Best For |
|----------|--------|----------|
| `generateObject()` | Single object | Data extraction |
| `streamObject()` | Partial objects | Real-time updates |
| `generateObject()` (array) | Array of objects | Bulk generation |
| `generateObject()` (enum) | Single value | Classification |

### Tool & Agent Patterns
| Pattern | Purpose |
|---------|---------|
| `tool()` | Define executable function |
| `stopWhen` | Loop until condition met |
| `prepareStep()` | Customize each step |
| `onStepFinish()` | Log/process step results |

## ⚙️ Configuration

### Using Vercel AI Gateway (Recommended)
```typescript
// Just use model strings
const { text } = await generateText({
  model: 'openai/gpt-5', // Automatic routing
  prompt: 'Hello',
});
```

Requires: `VERCEL_API_KEY` environment variable

### Using Provider Directly
```typescript
import { openai } from '@ai-sdk/openai';

const { text } = await generateText({
  model: openai('gpt-5', {
    reasoningEffort: 'high',
  }),
  prompt: 'Hello',
});
```

Requires: Provider API key (e.g., `OPENAI_API_KEY`)

## 🧪 Testing & Development

```bash
# Type checking
pnpm run type-check

# Install dev dependencies
pnpm add -D @types/node typescript tsx

# Run TypeScript file directly
tsx your-script.ts
```

## 📊 Performance Tips

1. **Use appropriate model size**
   - `nano` for simple tasks
   - `mini` for general purpose
   - `gpt-5` for complex reasoning
   - Reasoning models for analysis

2. **Stream for UI, generateText for agents**
   - Streaming provides immediate feedback
   - generateText better for multi-step workflows

3. **Monitor token usage**
   - Track `usage.totalTokens` in responses
   - Plan costs accordingly
   - Reasoning tokens cost more

4. **Implement caching**
   - Cache repeated prompts
   - Reduce API calls

5. **Use appropriate reasoning effort**
   - `low` for simple tasks
   - `high` only when needed

## 🔗 External Resources

- **Official Docs**: https://ai-sdk.dev
- **GitHub**: https://github.com/vercel/ai
- **Examples**: https://github.com/vercel/ai/tree/main/examples
- **Playground**: https://ai-sdk-playground.vercel.app

## ✅ Checklist for Production

- [ ] Set API keys in environment variables
- [ ] Implement error handling and retries
- [ ] Add rate limiting
- [ ] Set up logging/monitoring
- [ ] Test with production models
- [ ] Set appropriate timeout values
- [ ] Implement message/conversation storage
- [ ] Add authentication to endpoints
- [ ] Set up database for persistence
- [ ] Monitor token usage and costs
- [ ] Implement graceful degradation
- [ ] Test streaming under load

## 🆘 Common Issues

### "Model not found"
- Check model name spelling
- Ensure API key is set
- Verify provider supports the model

### "Token limit exceeded"
- Use smaller context windows
- Implement message truncation
- Use appropriate model size

### "Rate limited"
- Implement exponential backoff
- Add rate limiting middleware
- Use appropriate model sizing

### "High latency"
- Use streaming for UI
- Consider model size (mini/nano)
- Avoid reasoning effort 'high' for simple tasks

## 📝 License & Attribution

Based on official Vercel AI SDK documentation (https://ai-sdk.dev)

---

**Last Updated**: November 2025
**AI SDK Version**: v5+
**Status**: Production Ready
