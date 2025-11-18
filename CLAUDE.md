# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Cosmo (Saturn)** is an AI companion app focused on conversational engagement through voice-first interactions. The system asks users questions rather than waiting to be asked, turning passive scrolling time into active thinking sessions.

**Architecture**: Dual-platform system with iOS native app, Express/TypeScript backend, and Neo4j knowledge graph for contextual memory.

**Current State**: Early development, rapidly iterating on core infrastructure.

## Repository Structure

```
Saturn/
├── backend/              # Express TypeScript API + background worker
│   └── scripts/ingestion/schema.md  # ⭐ Memory architecture docs (START HERE)
├── Saturn/Saturn/        # iOS app (Swift/SwiftUI)
├── web/                  # Next.js landing page (waitlist, graph viz)
├── docs/                 # Architecture docs, API references
├── vision.md             # Product vision and design principles
└── db.md                 # PostgreSQL schema documentation
```

## Development Commands

### Backend (Express/TypeScript)
```bash
cd backend
pnpm install
pnpm run dev              # Dev server with hot reload (API only)
pnpm run worker           # Background worker for memory extraction
pnpm run build            # Build for production
pnpm run type-check       # Type-check without emitting
pnpm run db:pull          # Generate Supabase types
pnpm run db:init-neo4j    # Initialize Neo4j with schema/constraints
pnpm run db:reset-neo4j   # Reset Neo4j database (delete all data)
```

### Web App (Next.js)
```bash
cd web
pnpm run dev              # Dev server at localhost:3000
pnpm run build            # Production build
```

### iOS App
```bash
xcodebuild -project Saturn/Saturn.xcodeproj -scheme Saturn -destination 'platform=macOS' build
```

## Deployment (Railway)

**Production URL**: `https://saturn-backend-production.up.railway.app`

**Important**:
- Push to `main` triggers auto-deployment (~60 seconds)
- Wait 90+ seconds before testing new code
- Check logs: `railway logs --service api &`
- Logs stop after deployment completes - must restart to see new deployment logs

## High-Level Architecture

### System Components

**iOS App (Swift/SwiftUI)** - Voice-first mobile interface
- Real-time audio with AssemblyAI streaming STT
- Device authentication via Keychain
- Live transcript display

**Express Backend (TypeScript)** - API + background worker
- RESTful API for conversations, auth, preferences
- AI SDK agents for conversational AI
- pg-boss queue for async memory extraction
- Dual-database coordination (PostgreSQL + Neo4j)

**Dual Database Architecture**:
- **PostgreSQL (Supabase)**: Full transcripts, embeddings, user data
- **Neo4j**: Structured knowledge graph (semantic + episodic memory)

**Web App (Next.js)** - Landing page
- Interactive knowledge graph visualization (D3)
- Waitlist signup

### Core Data Flow

1. **Conversation**: iOS → AssemblyAI STT → Backend AI SDK agent → Response
2. **Transcript Storage**: Full conversation saved to PostgreSQL
3. **Batch Processing**: Worker extracts entities/relationships → Neo4j graph
4. **Context Retrieval**: Next conversation loads semantic search + graph relationships

## Memory Architecture (Neo4j)

**⭐ For detailed schema documentation, see: `backend/scripts/ingestion/schema.md`**

This comprehensive index covers:
- Architecture & memory design (semantic vs episodic)
- Node schemas (Person, Concept, Entity, Source, Artifact, Storyline, Macro)
- Relationships and properties
- Data lifecycle (ingestion, decay, hierarchical aggregation)
- Retrieval & context loading
- Team management

**Key Design Principles**:
- **User-Scoped Semantics**: Every user has their own knowledge graph (nodes scoped by `user_id`)
- **Shared Episodic Sources**: Conversations can be team-scoped, but each user extracts their own semantic interpretation
- **Hierarchical Memory**: Sources → Storylines (meso-level) → Macros (macro-level)
- **Salience-Based Decay**: Memories fade over time unless accessed
- **Entity Creation Rule**: Only create Concepts/Entities when they have user-specific context (not casual mentions)

## Backend Architecture

### Directory Structure
```
backend/src/
├── index.ts              # API server entry point
├── worker.ts             # Background worker (pg-boss)
├── controllers/          # Request handlers
├── services/             # Business logic
├── repositories/         # Neo4j query layer
├── routes/               # Express routes
├── agents/               # AI SDK agent definitions
├── db/                   # Database clients
└── types/                # TypeScript types
```

### Key Patterns

**Repository Pattern**: Each entity type has dedicated repository with Neo4j queries isolated from business logic.

**Service Layer**: Core services:
- `conversationService`: Conversation lifecycle, enqueues memory extraction
- `agentService`: AI SDK agent orchestration
- `memoryExtractionService`: Batch pipeline for entity extraction
- `authService`: JWT device authentication

**Background Jobs**: pg-boss queue processes memory extraction asynchronously after conversations end.

## iOS Architecture

### Directory Structure
```
Saturn/Saturn/
├── Views/                    # SwiftUI views
├── ViewModels/               # Observable view models
├── Services/                 # Backend API clients
└── Models/                   # Data models
```

**Patterns**: MVVM architecture with `@StateObject`, Keychain device auth, real-time AssemblyAI transcription.

## Key Documents

### Start Here
1. `backend/scripts/ingestion/schema.md` - Memory architecture index
2. `vision.md` - Product vision and design principles
3. `db.md` - PostgreSQL schema

### API Guides (`docs/api-references/`)
- `assemblyai-stt-guide.md` - Speech-to-text
- `elevenlabs-tts-guide.md` - Text-to-speech
- `ai-sdk-guide.md` - AI SDK patterns

## Product Philosophy

**Conversational, Not Transactional**: This isn't Siri. We're having conversations, not issuing commands.

**Questions Over Answers**: Default to asking rather than telling. Help users reach their own conclusions through Socratic dialogue.

**No Generic Advice**: "You should meditate" is useless. Users want to think more deeply, not receive platitudes.

**Memory Serves Understanding**: The graph provides context naturally, without showmanship.

**Effortless Engagement**: One tap, start talking. Zero friction.

## API Conventions

**snake_case for all API responses** to match:
- PostgreSQL schema
- Neo4j properties
- REST standards

**iOS**: Use `CodingKeys` to map snake_case JSON → camelCase Swift properties.

## Development Workflow

### Local Setup
1. Start Neo4j: `docker run --name neo4j -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/password -d neo4j:latest`
2. Initialize schema: `cd backend && pnpm run db:init-neo4j`
3. Start API: `cd backend && pnpm run dev`
4. Start worker: `cd backend && pnpm run worker`

### Common Tasks

**Adding API Endpoint**:
1. Route in `backend/src/routes/[entity].ts`
2. Controller in `backend/src/controllers/[entity]Controller.ts`
3. Service logic in `backend/src/services/[entity]Service.ts`
4. Repository (if Neo4j) in `backend/src/repositories/[Entity]Repository.ts`

**Working with Neo4j**: See `backend/scripts/ingestion/schema.md` for node schemas, relationships, and patterns.

**Adding Entity Types**: Follow guide in `backend/scripts/ingestion/schema.md` → "Common Tasks" → "Adding a New Node Type"

## Testing & Debugging

- **Backend**: `pnpm run type-check`, Neo4j Browser at `http://localhost:7474`, Supabase Studio
- **iOS**: Xcode simulator (Cmd+R)

## Notes for Contributors

- **Type Safety**: Never use `any` - look up actual types
- **Move Fast**: It's okay to break code when refactoring (pre-production)
- **Error Handling**: Throw errors early and often - no silent fallbacks
- **Check Schema Docs**: When working with memory/graph, always reference `backend/scripts/ingestion/schema.md`
- **THIS IS A PROTOTYPE**: No backwards compatibility—just delete and refactor, always