# Saturn Backend - CLAUDE.md

Express TypeScript API + background worker for Cosmo AI companion.

## Development Commands

### Setup
- `pnpm install` - Install dependencies
- `docker compose up -d` - Start Neo4j with APOC and GDS plugins
- `docker compose down` - Stop Neo4j

### Running
- `pnpm run dev` - Start API server with hot reload
- `pnpm run worker:local` - Start background worker (pg-boss, local env)
- `pnpm run worker` - Start background worker (production env)
- `pnpm run orchestrator` - Run ingestion orchestrator script (batch processing)

All `dev`, `worker`, `worker:local`, and `orchestrator` scripts auto-tee to `logs/` (gitignored, append mode):
- `logs/dev.log` - API server
- `logs/worker.log` - Production worker
- `logs/worker-local.log` - Local worker
- `logs/orchestrator.log` - Batch ingestion

### Building & Testing
- `pnpm run build` - Compile TypeScript
- `pnpm run type-check` - Type-check without emitting
- `pnpm run test:run` - Run tests once

### Database
- `pnpm run db:pull` - Generate Supabase types
- `pnpm run db:reset-neo4j` - Reset Neo4j database (delete all data)
- `pnpm run db:cli` - Run Neo4j CLI queries (use with tsx cli.ts)

### Evaluation
- `pnpm tsx scripts/evaluation/run-locomo10-eval.ts <conv-index>` - Generate answers (parallel)
- `pnpm tsx scripts/evaluation/score-locomo10-eval.ts <answers-file>` - Score answers (parallel)

## Architecture

```
src/
├── index.ts              # API server entry (Express)
├── worker.ts             # Background worker entry (pg-boss)
├── routes/               # Express route definitions
├── controllers/          # Request handlers
├── services/             # Business logic
│   ├── conversationService.ts    # Conversation lifecycle management
│   ├── agentService.ts           # AI SDK agent orchestration
│   ├── ingestionService.ts       # Memory extraction pipeline orchestrator
│   ├── authService.ts            # JWT device authentication
│   └── embeddingGenerationService.ts  # Vector embeddings for semantic search
├── repositories/         # Neo4j database access (Person, Concept, Entity, Source repositories)
├── agents/               # AI SDK agents (see agents/CLAUDE.md)
│   ├── orchestrator.ts   # Main conversation agent
│   ├── ingestionAgent.ts # Memory extraction agent (3-phase pipeline)
│   ├── tools/            # Agent tools for node/relationship manipulation
│   ├── schemas/          # Zod validation schemas
│   └── prompts/          # System prompts
├── queue/                # pg-boss job definitions
├── types/                # TypeScript type definitions
└── db/                   # Database clients (Supabase, Neo4j)
```

## Key Patterns

**Dual-Process Architecture**: API server + separate background worker for async memory extraction

**Agent-Based Ingestion**: AI SDK agent with tools for creating/updating Neo4j graph nodes and relationships (replaces service orchestration pattern)

**Repository Pattern**: Each Neo4j entity type (Person, Concept, Entity, Source) has dedicated repository with query isolation

**Background Jobs**: pg-boss queue processes memory extraction pipeline after conversations end

**Tool-Based Graph Manipulation**: LLM agents use tools to directly create/update nodes and relationships, validated by Zod schemas

## Observability & Instrumentation

**Langfuse** - LLM monitoring and observability for agent execution
- Tracks agent calls, tool usage, token consumption
- Integrated via `@langfuse/client` for production observability

**OpenTelemetry** - Distributed tracing across Express routes and worker jobs
- Node.js SDK with Vercel OTEL integration
- HTTP exporter for trace collection

**LangSmith** - Optional debugging library for development

## Development Tools

**Neo4j Graph Visualizer** (`graph-visualizer.html`) - D3.js-based graph visualization
- Force-directed and UMAP projection views
- Local (direct HTTP) and production (API proxy) modes
- Semantic search + text matching with node type filtering
- Node/relationship details panel, zoom/pan controls
- Usage: Open in browser, add `?userId=<user-id>` for production mode
- Supports both local Neo4j (HTTP) and Railway production (API endpoint)

## Tech Stack

- **Runtime**: Node.js 20+ / Express 4
- **Language**: TypeScript 5
- **AI Agents**: Anthropic Claude Agent SDK
- **Databases**: PostgreSQL (Supabase) + Neo4j
- **Jobs**: pg-boss (PostgreSQL-backed queue)
- **Validation**: Zod
- **Testing**: Vitest
