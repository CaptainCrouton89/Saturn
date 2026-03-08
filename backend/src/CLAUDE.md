# backend/src - CLAUDE.md

Core application logic for Express API and background worker.

## Architecture Layers

**Entry Points**
- `index.ts` - Express API server (port 3001)
- `worker.ts` - pg-boss background worker for async jobs

**Request Pipeline** (API)
- `routes/` - Express route definitions
- `controllers/` - Request handlers (parse input, delegate to services)
- `services/` - Business logic (orchestrate repositories, external APIs, jobs)
- `repositories/` - Neo4j query layer (isolated from business logic)

**Agent-Based Processing** (Worker + Ingestion)
- `agents/` - AI SDK agents with tool-based graph manipulation
  - `orchestrator.ts` - Main conversation agent
  - `ingestionAgent.ts` - Memory extraction (3-phase: extract → resolve → create/merge)
  - `tools/` - Zod-validated tools for node/relationship operations
- `queue/` - pg-boss job definitions

**Supporting Systems**
- `db/` - Supabase (PostgreSQL) and Neo4j clients
- `middleware/` - Express middleware (auth, logging, error handling)
- `config/` - Environment and feature flags
- `constants/` - App-wide constants and enums
- `types/` - Shared TypeScript interfaces

## Key Patterns

**Layered Isolation**: Controllers never touch repositories directly—always via services. Services orchestrate business logic.

**Tool-Based Graph Manipulation**: Agents use validated Zod tools to create/update Neo4j nodes and relationships (not direct Cypher in services).

**Background Job Enqueue**: `conversationService` enqueues memory extraction after conversation ends; worker picks up via `ingestionAgent`.

**Dual Database Coordination**: PostgreSQL for transcripts/embeddings, Neo4j for knowledge graph. Services maintain consistency.

**Snake Case Convention**: All API responses and database properties use snake_case (match PostgreSQL schema and Neo4j property conventions).

## Development Conventions

**Adding API Endpoint**:
1. Define route in `routes/[entity].ts`
2. Add controller handler in `controllers/[entity]Controller.ts`
3. Implement business logic in `services/[entity]Service.ts`
4. Add Neo4j queries to `repositories/[Entity]Repository.ts` (if needed)

**Working with Neo4j**: Reference `scripts/ingestion/schema.md` for node schemas and relationships. Use repositories for queries, agents for graph mutations.

**Error Handling**: Throw early with descriptive messages. Controllers catch and format for HTTP response.

**Type Safety**: Always define interfaces in `types/` or inline with Zod schemas. Never use `any`.

## Running Locally

```bash
pnpm install
docker compose up -d              # Start Neo4j + Supabase
pnpm run db:reset-neo4j           # Initialize schema
pnpm run dev                       # API server (port 3001)
pnpm run worker:local             # Background worker (separate terminal)
```

Logs tee to `logs/` directory (gitignored). Monitor with `tail -f logs/*.log`.
