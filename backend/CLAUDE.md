# Saturn Backend - CLAUDE.md

Express TypeScript API + background worker for Cosmo AI companion.

## Development Commands

- `pnpm install` - Install dependencies
- `pnpm run dev` - Start API server with hot reload
- `pnpm run worker` - Start background worker (pg-boss)
- `pnpm run build` - Compile TypeScript
- `pnpm run type-check` - Type-check without emitting

## Architecture

```
src/
├── index.ts              # API server entry (Express)
├── worker.ts             # Background worker entry (pg-boss)
├── routes/               # Express route definitions
├── controllers/          # Request handlers
├── services/             # Business logic
│   ├── conversationService.ts    # Conversation lifecycle management
│   ├── agentService.ts           # AI SDK conversation agent orchestration
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