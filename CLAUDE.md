# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Cosmo (Saturn)** is an AI companion app focused on conversational engagement through voice-first interactions. The system asks users questions rather than waiting to be asked, turning passive scrolling time into active thinking sessions. Built as a dual-platform system with an iOS native app and Express/TypeScript backend.

**Current State**: Early development with core conversation infrastructure in place. iOS app handles real-time voice recording/transcription, backend manages conversation state, and Neo4j stores knowledge graph for contextual memory.

## Repository Structure

```
Saturn/
├── backend/              # Express TypeScript API
├── Saturn/Saturn/        # iOS app (Swift/SwiftUI)
├── docs/                 # Architecture docs, API references
├── vision.md             # Product vision and design principles
├── db.md                 # PostgreSQL schema documentation
├── neo4j.md              # Neo4j graph schema
└── mvp1.md               # MVP scope notes
```

## Development Commands

### Backend (Express/TypeScript)
```bash
cd backend
npm install
npm run dev              # Dev server with hot reload
npm run build            # Compile TypeScript
npm run type-check       # Type-check without emitting
npm run db:pull          # Generate Supabase types
npm run db:init-neo4j    # Initialize Neo4j schema
```

### iOS App
```bash
cd Saturn
open Saturn.xcodeproj    # Open in Xcode
# Build: Cmd+B
# Run: Cmd+R
```

### Environment Setup

Backend requires `.env` file:
```
PORT=3001
NODE_ENV=development
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
NEO4J_URI=...
NEO4J_USER=...
NEO4J_PASSWORD=...
OPENAI_API_KEY=...
JWT_SECRET=...
```

## High-Level Architecture

### Three-Tier System

**iOS App (Swift/SwiftUI)** - Voice-first mobile interface
- Real-time audio recording with AssemblyAI streaming STT
- Live transcript display during conversation
- Device authentication via Keychain-stored device ID
- Conversation archive/history views

**Express Backend (TypeScript)** - Orchestration layer
- RESTful API for conversations, auth, preferences
- LangGraph agents for conversational AI (via LangChain)
- Batch processing pipeline for transcript→graph extraction
- Dual-database coordination (PostgreSQL + Neo4j)

**Dual Database Architecture**:
- **PostgreSQL (Supabase)**: Full conversation transcripts, vector embeddings, user preferences
- **Neo4j**: Structured knowledge graph (People, Projects, Ideas, Topics) with relationship tracking

### Core Data Flow

1. **Conversation Start**: iOS app authenticates, loads user context (recent conversations + active entities from graph)
2. **Live Interaction**: User speaks → AssemblyAI STT → Backend processes with LangGraph agent → Response sent to iOS
3. **Conversation End**: Full transcript saved to PostgreSQL
4. **Batch Processing** (async): Extract entities from transcript → Update Neo4j graph with provenance tracking
5. **Context Retrieval** (next conversation): Semantic search (PostgreSQL embeddings) + graph query (Neo4j relationships)

## Backend Architecture

### Directory Structure
```
backend/src/
├── index.ts              # App entry point, middleware setup, route mounting
├── controllers/          # Request handlers
├── services/             # Business logic (auth, conversation, agent orchestration)
├── repositories/         # Database access layer (14 entity repositories)
├── routes/               # Express route definitions
├── db/                   # Database clients (Supabase, Neo4j, schema initialization)
├── middleware/           # Auth middleware
└── types/                # TypeScript type definitions
```

### Key Design Patterns

**Repository Pattern**: Each entity type (Person, Project, Idea, Topic, etc.) has dedicated repository with Neo4j query logic isolated from business logic.

**Service Layer**: Business logic lives in services:
- `conversationService.ts`: Manages conversation lifecycle, coordinates with agent
- `agentService.ts`: LangGraph agent orchestration for generating responses
- `authService.ts`: JWT-based device authentication
- `initService.ts`: User onboarding, loads context for new conversations

**Dual Database Coordination**:
- PostgreSQL stores **full content** (transcripts as JSON, embeddings as vectors)
- Neo4j stores **structured entities** (People, Projects, Ideas, Topics) + relationships
- Sync via `entities_extracted` + `neo4j_synced_at` flags on conversation records
- Entity resolution uses stable `entity_key` (hash of normalized name + type + user_id) for idempotent batch processing

**LangGraph Integration**:
- Conversational AI agent built with LangChain + LangGraph
- Agent has access to memory retrieval, web search, synthesis tools
- Responses generated with context from both databases

### Neo4j Knowledge Graph

**Node Types** (see `neo4j.md` for full schema):
- `Person`: People mentioned in conversations (with rich context: relationship type, personality traits, current life situation)
- `Project`: User's projects with status, vision, blockers, confidence/excitement levels
- `Idea`: Emerging ideas with evolution tracking, obstacles, next steps
- `Topic`: Discussion topics with semantic embeddings
- `Pattern`: Behavioral patterns (not in MVP)
- `Value`: Stated values (not in MVP)
- `Conversation`: Lightweight summary (full transcript in PostgreSQL)
- `Alias`: Name variants for entity resolution ("Sarah" → "Sarah Johnson")

**Key Relationships**:
- `(User)-[:KNOWS]->(Person)` - with relationship_quality, last_mentioned_at
- `(User)-[:WORKING_ON]->(Project)` - with status, priority
- `(User)-[:INTERESTED_IN]->(Topic)` - with engagement_level, frequency
- `(Conversation)-[:MENTIONED]->(Person|Project|Topic|Idea)` - with sentiment, importance_score
- `(Person)-[:INVOLVED_IN]->(Project)`
- `(Idea)-[:RELATED_TO]->(Project|Topic)`

**Entity Resolution Strategy**:
- Stable `entity_key` for idempotency across batch runs
- Alias tracking for name variants (confidence scores, canonical names)
- Provenance tracking: `last_update_source`, `confidence`, `excerpt_span`
- Bounded arrays (MAX 8-15 items) to prevent bloat

## iOS Architecture

### Directory Structure
```
Saturn/Saturn/
├── SaturnApp.swift           # App entry, device auth initialization
├── ContentView.swift         # Root view (unused - MainTabView is actual root)
├── Views/                    # SwiftUI views
│   ├── MainTabView.swift     # Tab navigation (Conversation, Archive)
│   ├── ConversationView.swift
│   ├── ArchiveView.swift
│   └── Components/           # Reusable UI components
├── ViewModels/               # Observable view models
├── Services/                 # Backend API clients, device managers
│   ├── ConversationService.swift
│   ├── AudioRecordingService.swift
│   ├── AssemblyAIService.swift
│   ├── AuthenticationService.swift
│   └── DeviceIDManager.swift
└── Models/                   # Data models
```

### Key Patterns

**MVVM Architecture**:
- Views observe ViewModels via `@StateObject`
- ViewModels call Services for business logic
- Services handle API communication and device state

**Device Authentication**:
- Device ID generated on first launch, stored in Keychain
- JWT-based auth with backend using device ID
- Token refresh handled transparently by `AuthenticationService`

**Real-time Transcription**:
- AssemblyAI streaming WebSocket for STT
- Live transcript updates via Combine publishers
- Microphone button manages recording state

## Key Documents

### Product Vision (`vision.md`)
Read this to understand:
- **Core insight**: People enjoy being asked questions more than asking them
- **Differentiator**: Cosmo asks YOU questions vs. ChatGPT waiting for prompts
- **Use cases**: Bedtime processing, active thinking while moving, productive conversation
- **Design principles**: Conversational not transactional, questions over answers, no generic advice
- **Data architecture**: Dual-database approach (PostgreSQL for content, Neo4j for structured knowledge)
- **MVP scope**: Focus on core conversation loop, NO pattern detection or learning system initially

### Database Schemas
- `db.md`: PostgreSQL tables (conversation, artifact, user_preference)
- `neo4j.md`: Full graph schema with node types, relationships, powerful queries
- `docs/transcript-to-neo4j-pipeline.md`: Detailed batch processing pipeline (7 phases)

### API Integration Guides (`docs/api-references/`)
- `assemblyai-stt-guide.md`: Speech-to-text integration
- `elevenlabs-tts-guide.md`: Text-to-speech integration
- `langgraph-guide.md`: LangGraph patterns
- `langgraph-toolcalling-guide.md`: Tool use in agents

## Critical Context

### Product Philosophy

**Conversational, Not Transactional**: This isn't Siri. You're having conversations, not issuing commands.

**Questions Over Answers**: Default to asking rather than telling. Help users reach their own conclusions through Socratic dialogue.

**No Generic Advice**: "You should meditate" is useless. Users want to think more deeply, not receive platitudes. Follow-up questions beat direct advice.

**Memory Serves Understanding, Not Showmanship**: When user mentions "Sarah," the graph provides context (relationship type, current situation) but Cosmo doesn't necessarily say "Oh yes, Sarah who you mentioned last week..." The memory informs responses naturally.

**Effortless Engagement**: Friction to start a conversation should be near-zero. One tap, start talking. Don't make users think about whether they "should" use it.

### Technical Constraints

**MVP Exclusions** (from `vision.md`):
- ❌ Topic suggestions / "Conversation DJ" mode
- ❌ Mode selection (therapy/brainstorm/entertainment)
- ❌ Proactive pattern recognition
- ❌ Question preference learning (multi-armed bandit)
- ❌ Calendar/email integration
- ❌ All-day transcription
- ❌ Proactive notifications

**Current Implementation Status**:
- ✅ Core conversation loop (voice in → LLM response → voice out)
- ✅ Device authentication
- ✅ Real-time transcript display
- ✅ Conversation storage (PostgreSQL)
- ✅ Neo4j schema initialized
- 🚧 Batch entity extraction pipeline (designed in `docs/transcript-to-neo4j-pipeline.md`, not yet implemented)
- 🚧 Context retrieval from graph (schema ready, retrieval logic TBD)

### Batch Processing Pipeline (Not Yet Implemented)

See `docs/transcript-to-neo4j-pipeline.md` for detailed 7-phase pipeline:

1. **Entity Identification**: Extract mentioned People, Projects, Ideas, Topics with stable entity_key
2. **Entity Resolution**: Match to existing Neo4j nodes via entity_key, canonical_name, aliases
3. **Parallel Entity Updates**: One LLM agent per entity, generate structured updates with provenance
4. **Conversation Summary**: Generate ~100 word summary for Neo4j Conversation node
5. **Relationship Updates**: Update User→Entity and Conversation→Entity relationships
6. **Embedding Generation**: Batch embed Projects, Topics, Ideas, Notes for semantic search
7. **Neo4j Transaction**: Execute all updates atomically using UNWIND for efficiency

**Cost target**: ~$0.05 per 10k word conversation using GPT-4.1-nano

**Idempotency**: Stable `entity_key` allows safe re-runs without creating duplicates

## Development Workflow

### Adding a New API Endpoint

1. Define route in `backend/src/routes/[entity].ts`
2. Add controller function in `backend/src/controllers/[entity]Controller.ts`
3. Implement business logic in `backend/src/services/[entity]Service.ts`
4. Add database queries in `backend/src/repositories/[Entity]Repository.ts` (if Neo4j)
5. Update iOS `Services/` to call new endpoint
6. Update ViewModels to use new service method

### Working with Neo4j Graph

**Entity Resolution Pattern** (see `neo4j.md`):
```cypher
// Try entity_key first (most reliable)
MATCH (p:Person {entity_key: $entity_key})
RETURN p
UNION
// Fallback to canonical_name
MATCH (p:Person {canonical_name: toLower($name)})
RETURN p
UNION
// Fallback to alias
MATCH (a:Alias {normalized_name: toLower($name)})-[:ALIAS_OF]->(p:Person)
RETURN p
```

**Provenance Tracking** (all entities):
- `last_update_source`: conversation_id where last updated
- `confidence`: 0-1, confidence in entity resolution
- `excerpt_span`: "turns 5-7" or "0:45-1:23" - where mentioned in source

**Array Bounding** (prevent unbounded growth):
- All array properties have MAX limits (8-15 items)
- Keep most recent/salient items when full
- Move long histories to Note nodes via `HAS_NOTE` relationship

### Working with LangGraph Agents

See `docs/api-references/langgraph-guide.md` for patterns.

**Current agent capabilities**:
- Memory retrieval from graph
- Web search (TBD - tool not yet implemented)
- Synthesis (TBD - artifact generation)

**Agent context loading**:
- Recent summary: Last 1-2 conversations (from PostgreSQL)
- Semantic search: Relevant past snippets (via embeddings)
- Active entities: Recently mentioned People, Projects, Topics (from Neo4j)

## Common Patterns

### Adding a New Entity Type to Neo4j

1. Define schema in `neo4j.md` with:
   - Node properties (including provenance: `last_update_source`, `confidence`, `excerpt_span`)
   - Bounded arrays with MAX limits
   - Relationships to other nodes
2. Create repository in `backend/src/repositories/[Entity]Repository.ts`
3. Add to batch extraction pipeline phases (see `docs/transcript-to-neo4j-pipeline.md`)
4. Update entity resolution queries to include new type
5. Define update schema (replace vs merge vs append fields)

### Authenticating Backend Requests from iOS

All protected endpoints require JWT token:
```swift
// iOS
let token = try await AuthenticationService.shared.getToken()
request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
```

```typescript
// Backend
app.use('/api/conversations', authenticateToken, conversationsRouter)
// authenticateToken middleware validates JWT, attaches userId to request
```

## Testing & Debugging

### Backend
- `npm run type-check` - Catch type errors before runtime
- Check logs: Morgan outputs HTTP requests in dev mode
- Neo4j queries: Test in Neo4j Browser at `http://localhost:7474`
- Supabase: Use Supabase Studio for SQL queries

### iOS
- Build errors: Check `DerivedData/` is in `.gitignore` (it is)
- Simulator: Cmd+R to run
- Device: Requires signing certificate (check `Saturn.entitlements`)

## Notes for Contributors

- **Type Safety**: Never use `any` in TypeScript - look up actual types from `@supabase/supabase-js`, `neo4j-driver`, etc.
- **Pre-production mindset**: It's okay to break code when refactoring. Move fast.
- **Error handling**: Throw errors early and often. No silent fallbacks.
- **Database sync**: Always update `entities_extracted` and `neo4j_synced_at` flags when writing to Neo4j
- **Bounded arrays**: When adding array properties to Neo4j entities, always define MAX limit
- **Provenance**: All entity updates must track `last_update_source`, `confidence`, `excerpt_span`
- **Idempotency**: Use `entity_key` (hash of normalized name + type + user_id) for all entity creation
