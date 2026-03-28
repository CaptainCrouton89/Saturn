# CLAUDE.md

**Cosmo (Saturn)** is an AI companion app focused on conversational engagement through voice-first interactions. The system asks users questions rather than waiting to be asked, turning passive time into active thinking sessions.

## Architecture Overview

Dual-platform system: iOS native app ↔ Express/TypeScript backend ↔ Neo4j knowledge graph + PostgreSQL.

```
Saturn/
├── backend/              # Express API + pg-boss worker
├── Saturn/Saturn/        # iOS app (Swift/SwiftUI)
├── web/                  # Next.js landing page
├── docs/                 # Architecture guides, API references
├── vision.md             # Product vision and design principles
└── db.md                 # PostgreSQL schema
```

## Technology Stack

- **iOS**: Swift/SwiftUI, Keychain auth, AssemblyAI streaming STT
- **Backend**: TypeScript, Express, pg-boss queue, Supabase client
- **Databases** (as of Mar 2026):
  - **PostgreSQL (Supabase)**: Full transcripts, embeddings, user data
  - **Neo4j Aura**: User-scoped knowledge graph (semantic + episodic memory)
- **Web**: Next.js, D3.js graph visualization
- **Node.js**: `>=22.0.0` required

## Core Data Flow

1. iOS captures conversation via AssemblyAI STT
2. Backend API stores transcript in PostgreSQL
3. Worker asynchronously extracts entities/relationships to Neo4j
4. Next conversation loads graph context + semantic search results

## Memory Architecture

**⭐ See `backend/scripts/ingestion/schema.md` for complete memory design documentation.**

Key principles:
- **User-Scoped Semantics**: Each user has their own knowledge graph
- **Hierarchical Memory**: Sources → Storylines → Macros (with salience-based decay)
- **Shared Episodic Sources**: Team conversations, individual semantic interpretation
- **Entity Creation Rule**: Only extract Concepts/Entities with user-specific context

## Development Commands

### Backend (Express/TypeScript)
```bash
cd backend
pnpm install
pnpm run dev              # API server with hot reload
pnpm run worker           # Background worker for memory extraction
pnpm run type-check       # Type-check without emitting
pnpm run db:init-neo4j    # Initialize Neo4j schema
```

### Web App (Next.js)
```bash
cd web
pnpm run dev              # Dev server at localhost:3000
```

### Local Setup
1. Start Neo4j: `docker run --name neo4j -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/password -d neo4j:latest`
2. Initialize: `cd backend && pnpm run db:init-neo4j`
3. Start API and worker

## Backend Architecture

**Directory**: `backend/src/`
- **controllers/**: Request handlers
- **services/**: Business logic (conversationService, agentService, memoryExtractionService)
- **repositories/**: Neo4j query layer (entity-specific)
- **agents/**: AI SDK agent definitions

**Patterns**:
- Repository pattern for Neo4j isolation
- Service layer for business logic
- pg-boss for async memory extraction
- JWT device authentication via Keychain

## Deployment

**Production**: `https://saturn-backend-production.up.railway.app`
- Railway Project: `415e7fdc-4cf1-45f9-9d6f-29fd52648313`
- Root Directory: `/backend` (dashboard setting, not railway.toml)
- Node: `>=22.0.0`

Deploy from repo root:
```bash
railway up --detach  # Respects dashboard Root Directory setting
```

See `backend/CLAUDE.md` for detailed deployment and troubleshooting.

## Critical Constraints & Gotchas

**Neo4j Aura** (Production):
- Free-tier instances pause/delete after inactivity — keep them active or upgrade
- Username is the instance ID (returned by Aura API), NOT `neo4j`
- Credentials: client-id `D5e5TGxGMzz55mfY7KTKsPpx4WUoGIH8`

**Build & Deployment**:
- `.gitignore` recursive globs (`query*.ts`) silently exclude files from builds — use `/query*.ts` for root-only matching
- Server must start gracefully when Neo4j is unavailable (configured in `index.ts`)

**Graph Analysis**:
- Absence from the graph ≠ absence from the user's life
- Only draw conclusions from what IS in the graph; frame gaps as "not discussed" rather than "not happening"

## Key Documents

1. **`backend/scripts/ingestion/schema.md`** - Memory architecture (start here)
2. **`vision.md`** - Product philosophy and design principles
3. **`db.md`** - PostgreSQL schema
4. **`docs/api-references/`** - AssemblyAI, ElevenLabs, AI SDK guides
5. **`backend/CLAUDE.md`** - Deployment and backend-specific troubleshooting

## API Conventions

- **snake_case** for all API responses (matches PostgreSQL, Neo4j, REST)
- iOS maps to camelCase via `CodingKeys`

## Development Philosophy

- **Conversational, not transactional**: Real dialogue, not voice commands
- **Questions over answers**: Socratic method to help users think deeper
- **No generic advice**: Context-aware, memory-informed responses
- **Effortless engagement**: One tap, start talking
- **Move fast**: Pre-production, refactor freely

## Key Integrations

- **Tartarus** (`~/Code/tartarus`): Omi webhook server → `/api/information-dumps`
- **Railway**: Automated GitHub deployment to production
- **Supabase**: Managed PostgreSQL + type generation (`pnpm run db:pull`)

## Notes for Contributors

- **Type Safety**: Never use `any` — look up actual types
- **Error Handling**: Throw early, no silent fallbacks
- **This is a prototype**: No backwards compatibility needed
- When working with memory/graph: Reference `backend/scripts/ingestion/schema.md`
