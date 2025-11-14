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
│   ├── agentService.ts           # LangGraph conversation agent orchestration
│   ├── ingestionService.ts       # Memory extraction pipeline orchestrator
│   ├── authService.ts            # JWT device authentication
│   └── embeddingGenerationService.ts  # Vector embeddings for semantic search
├── repositories/         # Neo4j database access (Person, Concept, Entity, Source repositories)
├── agents/               # LangGraph agents (see agents/CLAUDE.md)
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

**Agent-Based Ingestion**: LangGraph agent with tools for creating/updating Neo4j graph nodes and relationships (replaces service orchestration pattern)

**Repository Pattern**: Each Neo4j entity type (Person, Concept, Entity, Source) has dedicated repository with query isolation

**Background Jobs**: pg-boss queue processes memory extraction pipeline after conversations end

**Tool-Based Graph Manipulation**: LLM agents use tools to directly create/update nodes and relationships, validated by Zod schemas

## Agent-Based Memory Extraction

The memory extraction pipeline uses a LangGraph agent with a 3-phase workflow:

### Phase 1: Extract and Disambiguate
- LLM extracts mentioned People, Concepts, Entities from transcript
- Matches entities to existing nodes via entity_key, canonical_name, or vector similarity
- Outputs list of resolved entities (new vs. matched)

### Phase 2: Auto-Create Source Edges
- Creates Source node in Neo4j with transcript content
- Links Source to mentioned entities via `(Source)-[:mentions]->(Node)` edges
- Updates node timestamps

### Phase 3: Relationship Agent
- LLM agent with 10 tools (8 node tools + 2 relationship tools + 2 retrieval tools)
- Creates/updates Person, Concept, Entity nodes using validated tools
- Creates/updates relationships with property validation per type
- Runs until completion or max iterations (10)

See `agents/CLAUDE.md` for detailed documentation of ingestion agent architecture and `agents/tools/CLAUDE.md` for tool specifications.

## Adding New Entity Type

1. Create `repositories/[Entity]Repository.ts` with Neo4j queries
2. Add Zod schema to `agents/schemas/ingestion.ts` matching tech.md specification
3. Create tools in `agents/tools/nodes/[entity].tool.ts` (create + update)
4. Add tools to `ingestionTools` array in `agents/tools/registry.ts`
5. Document in `agents/tools/CLAUDE.md`

For Specs (ALWAYS SOURCE OF TRUTH), read @scripts/ingestion/schema.md