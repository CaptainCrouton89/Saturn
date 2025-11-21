# Vercel AI SDK 2025 - Complete Documentation

Comprehensive TypeScript documentation for the Vercel AI SDK v5+ covering GPT-5 models, reasoning capabilities, tool calling, agents, and production backend patterns.

## 📖 Documentation Overview

This comprehensive guide contains **3,300+ lines** of documentation across **8 core modules** plus original API reference documentation.

### Core Documentation (Start Here)

| Module | Topics | Size |
|--------|--------|------|
| **[00-INDEX.md](00-INDEX.md)** | Navigation, quick start, use cases | 8.6K |
| **[01-OVERVIEW.md](01-OVERVIEW.md)** | Installation, core concepts, architecture | 3.6K |
| **[02-TEXT-GENERATION.md](02-TEXT-GENERATION.md)** | generateText, streamText, callbacks, streaming | 8.3K |
| **[03-TOOLS-AND-AGENTS.md](03-TOOLS-AND-AGENTS.md)** | Tool definition, tool calling, agents, loops | 11K |
| **[04-STRUCTURED-OUTPUTS.md](04-STRUCTURED-OUTPUTS.md)** | generateObject, streamObject, schemas, validation | 11K |
| **[05-REASONING.md](05-REASONING.md)** | Reasoning models, thinking effort, when to use | 8.8K |
| **[06-BACKEND-PATTERNS.md](06-BACKEND-PATTERNS.md)** | Express, Fastify, Next.js, error handling, logging | 14K |
| **[07-TYPESCRIPT-TYPES.md](07-TYPESCRIPT-TYPES.md)** | Message types, tool types, error types, patterns | 13K |

**Total**: 78.4K of curated documentation

### Reference Documentation (From Official Sources)

- `ai-sdk.dev-docs-ai-sdk-core-generating-text.md` - Official text generation API reference
- `ai-sdk.dev-docs-ai-sdk-core-generating-structured-data.md` - Official structured outputs reference
- `ai-sdk.dev-docs-ai-sdk-core-tools-and-tool-calling.md` - Official tools & tool calling reference
- `ai-sdk.dev-docs-foundations-tools.md` - Official tools foundations
- `vercel.com-guides-how-to-build-ai-agents-with-vercel-and-the-ai-sdk.md` - Official agent building guide

## 🚀 Quick Start

### 1. Installation

```bash
pnpm add ai @ai-sdk/openai zod
```

### 2. Basic Usage

```typescript
import { generateText } from 'ai';

const { text } = await generateText({
  model: 'openai/gpt-5',
  prompt: 'What is TypeScript?',
});

console.log(text);
```

### 3. Next Steps

- **New to Vercel AI SDK?** → Read [01-OVERVIEW.md](01-OVERVIEW.md)
- **Want to build chat?** → Read [02-TEXT-GENERATION.md](02-TEXT-GENERATION.md)
- **Need to extract data?** → Read [04-STRUCTURED-OUTPUTS.md](04-STRUCTURED-OUTPUTS.md)
- **Building agents?** → Read [03-TOOLS-AND-AGENTS.md](03-TOOLS-AND-AGENTS.md)
- **Complex reasoning?** → Read [05-REASONING.md](05-REASONING.md)
- **Production backend?** → Read [06-BACKEND-PATTERNS.md](06-BACKEND-PATTERNS.md)

## 📚 What's Covered

### Text Generation
- `generateText()` for complete responses
- `streamText()` for real-time streaming
- Message history management
- Chat integration patterns
- Callbacks and event handling

### Structured Data
- Type-safe object generation with `generateObject()`
- Streaming partial objects with `streamObject()`
- Zod schema validation
- Array, enum, and custom outputs
- Error handling and repair

### Tools & Agents
- Defining tools with validation
- Single and multi-step tool calling
- Agent loops with `stopWhen`
- Per-step customization with `prepareStep`
- Tool choice control
- Error handling

### Reasoning Models
- GPT-5, Claude-4, DeepSeek R1
- Reasoning effort control
- Accessing model's thinking process
- Cost analysis
- When to use reasoning

### Backend Integration
- Express.js patterns
- Fastify.js setup
- Next.js API routes
- Hono framework
- Error middleware
- Rate limiting
- Message persistence
- Logging and observability

### TypeScript Types
- Message types (MessageParam, ModelMessage)
- Tool types (ToolSet, TypedToolCall)
- Result types (GenerateTextResult)
- Error types and handling
- Advanced patterns (middleware, reusable tools)

## 🎯 Use Cases

### I want to build...

| Goal | Start Here |
|------|-----------|
| A chatbot | [02-TEXT-GENERATION.md](02-TEXT-GENERATION.md) + [06-BACKEND-PATTERNS.md](06-BACKEND-PATTERNS.md) |
| A data extraction tool | [04-STRUCTURED-OUTPUTS.md](04-STRUCTURED-OUTPUTS.md) |
| A multi-step agent | [03-TOOLS-AND-AGENTS.md](03-TOOLS-AND-AGENTS.md) |
| A classification system | [04-STRUCTURED-OUTPUTS.md](04-STRUCTURED-OUTPUTS.md) (enum output) |
| A research agent | [03-TOOLS-AND-AGENTS.md](03-TOOLS-AND-AGENTS.md) + [05-REASONING.md](05-REASONING.md) |
| A production API | [06-BACKEND-PATTERNS.md](06-BACKEND-PATTERNS.md) |
| Complex reasoning | [05-REASONING.md](05-REASONING.md) |

## 🔧 Technical Details

### Models Covered

**OpenAI (Recommended for 2025)**
- `gpt-5` - Latest flagship model
- `gpt-5-mini` - Faster, cost-effective
- `gpt-5-nano` - Ultra-fast
- `gpt-5.1-thinking` - Extended reasoning
- `gpt-4.1` - Stable alternative

**Other Providers**
- Anthropic Claude-4-Sonnet
- Google Gemini 2.0 Flash
- DeepSeek R1/R1-Zero
- Mistral, Llama, and more

### Key Features

✅ **Type-Safe** - Full TypeScript support with inference
✅ **Unified API** - Single interface for 20+ model providers
✅ **Streaming** - Real-time token and object streaming
✅ **Tools** - Function calling with Zod validation
✅ **Agents** - Multi-step reasoning loops
✅ **Reasoning** - Extended thinking with effort control
✅ **Structured Outputs** - Type-validated object generation
✅ **Error Handling** - Comprehensive error types
✅ **Production Ready** - Patterns for Express, Fastify, Next.js

## 📊 Documentation Statistics

- **Total lines**: 3,300+
- **Code examples**: 150+
- **Frameworks covered**: Express, Fastify, Next.js, Hono
- **Models explained**: 15+
- **Use cases**: 20+
- **TypeScript patterns**: 15+

## 🔗 Related Resources

- **Official Docs**: https://ai-sdk.dev
- **GitHub**: https://github.com/vercel/ai
- **Examples**: https://github.com/vercel/ai/tree/main/examples
- **Cookbook**: https://sdk.vercel.ai/docs/guides
- **Discord Community**: https://discord.gg/vercel

## ✅ Verification Checklist

This documentation covers:

- [x] GPT-5.1-nano model usage (and GPT-5 variants)
- [x] Reasoning capabilities and thinking models
- [x] Tools and tool calling patterns
- [x] Agent patterns and orchestration
- [x] TypeScript-specific patterns and types
- [x] Backend integration examples
- [x] Structured outputs with Zod
- [x] Error handling strategies
- [x] Real-world use cases
- [x] Production patterns

## 📝 Document Index

```
vercel-ai-sdk/
├── README.md (this file)
├── 00-INDEX.md                    # Navigation & quick reference
├── 01-OVERVIEW.md                 # Getting started & core concepts
├── 02-TEXT-GENERATION.md          # generateText & streamText
├── 03-TOOLS-AND-AGENTS.md         # Tool calling & agents
├── 04-STRUCTURED-OUTPUTS.md       # generateObject & schemas
├── 05-REASONING.md                # Reasoning models & thinking
├── 06-BACKEND-PATTERNS.md         # Production backend setup
├── 07-TYPESCRIPT-TYPES.md         # Type definitions & patterns
├── ai-sdk.dev-docs-ai-sdk-core-generating-text.md
├── ai-sdk.dev-docs-ai-sdk-core-generating-structured-data.md
├── ai-sdk.dev-docs-ai-sdk-core-tools-and-tool-calling.md
├── ai-sdk.dev-docs-foundations-tools.md
└── vercel.com-guides-how-to-build-ai-agents-with-vercel-and-the-ai-sdk.md
```

## 🎓 Learning Path

1. **Foundation** (15 min)
   - Read: [01-OVERVIEW.md](01-OVERVIEW.md)
   - Run: Quick start example

2. **Text Generation** (30 min)
   - Read: [02-TEXT-GENERATION.md](02-TEXT-GENERATION.md)
   - Build: Simple chatbot

3. **Data & Tools** (45 min)
   - Read: [04-STRUCTURED-OUTPUTS.md](04-STRUCTURED-OUTPUTS.md)
   - Read: [03-TOOLS-AND-AGENTS.md](03-TOOLS-AND-AGENTS.md)
   - Build: Data extraction tool

4. **Agents** (1 hour)
   - Deep dive: [03-TOOLS-AND-AGENTS.md](03-TOOLS-AND-AGENTS.md)
   - Build: Multi-step agent

5. **Advanced** (1+ hours)
   - Read: [05-REASONING.md](05-REASONING.md)
   - Read: [07-TYPESCRIPT-TYPES.md](07-TYPESCRIPT-TYPES.md)
   - Build: Complex application

6. **Production** (2+ hours)
   - Read: [06-BACKEND-PATTERNS.md](06-BACKEND-PATTERNS.md)
   - Deploy: Full backend

## 💡 Pro Tips

1. **Use Vercel AI Gateway** - Unified API, no provider accounts
2. **Stream for UI** - Immediate feedback, better UX
3. **Use generateText for agents** - Better control flow
4. **Type everything** - Use TypeScript for safety
5. **Monitor tokens** - Track usage.totalTokens
6. **Cache responses** - Avoid repeated API calls
7. **Error handling matters** - Implement proper fallbacks
8. **Test locally first** - Before deploying to production

## ⚠️ Common Pitfalls

- ❌ Using `temperature` parameters with OpenAI (use defaults)
- ❌ Not typing Zod schemas properly
- ❌ Forgetting to consume streams
- ❌ Not implementing error handling
- ❌ Using reasoning for simple tasks (too expensive)
- ❌ Not setting appropriate `stopWhen` conditions
- ❌ Ignoring token limits in messages

## 📄 License & Attribution

Documentation based on:
- Official Vercel AI SDK Documentation (https://ai-sdk.dev)
- Vercel Guides (https://vercel.com/guides)
- Community research and best practices

Created: November 2025
Last Updated: November 2025
Status: Production Ready ✅

---

**Start Reading**: [00-INDEX.md](00-INDEX.md) or [01-OVERVIEW.md](01-OVERVIEW.md)
