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
├── services/             # Business logic (see services/CLAUDE.md)
│   ├── entityUpdaters/   # Entity-specific update logic
│   └── entityResolvers/  # Entity-specific resolution logic
├── repositories/         # Neo4j database access (14 entity repositories)
├── agents/               # LangGraph conversation orchestration
├── queue/                # pg-boss job definitions
└── db/                   # Database clients (Supabase, Neo4j)
```

## Key Patterns

**Dual-Process Architecture**: API server + separate background worker for async memory extraction

**Repository Pattern**: Each Neo4j entity type (Person, Project, Topic, Idea, etc.) has dedicated repository

**Strategy Pattern**: `entityUpdateService` and `entityResolutionService` delegate to specialized updater/resolver classes (see `services/CLAUDE.md`)

**Background Jobs**: pg-boss queue processes memory extraction pipeline after conversations end

## Adding New Entity Type

1. Create `repositories/[Entity]Repository.ts` with Neo4j queries
2. Create `services/entityUpdaters/[Entity]Updater.ts` extending `BaseEntityUpdater`
3. Create `services/entityResolvers/[Entity]Resolver.ts` extending `BaseResolver`
4. Add to Maps in `entityUpdateService` and `entityResolutionService`
