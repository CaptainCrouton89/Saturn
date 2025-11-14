# Backend Express API Architecture

## Overview

The Saturn backend is a TypeScript Express.js application that serves as the orchestration layer for the Cosmo AI companion app. It provides RESTful APIs for conversation management, authentication, knowledge graph operations, and background job processing.

**Key Technologies:**
- Express.js (HTTP server)
- TypeScript (type-safe development)
- PostgreSQL/Supabase (primary database for transcripts, embeddings, user data)
- Neo4j (knowledge graph for structured memory)
- pg-boss (background job queue)
- LangGraph/LangChain (conversational AI agents)

---

## Directory Structure

```
backend/src/
├── index.ts                    # Application entry point, middleware setup, route mounting
├── worker.ts                   # Background worker (pg-boss job processor)
│
├── controllers/                # Request handlers (HTTP layer)
│   ├── artifactController.ts
│   ├── conversationController.ts
│   ├── graphController.ts
│   ├── informationDumpController.ts
│   ├── initController.ts
│   └── preferenceController.ts
│
├── services/                   # Business logic layer
│   ├── artifactService.ts
│   ├── authService.ts
│   ├── conversationService.ts
│   ├── embeddingGenerationService.ts
│   ├── graphService.ts
│   ├── ingestionService.ts
│   ├── initService.ts
│   ├── preferenceService.ts
│   ├── queryGeneratorService.ts
│   ├── retrievalService.ts
│   └── summaryService.ts
│
├── repositories/               # Data access layer (Neo4j + Supabase)
│   ├── ArtifactRepository.ts
│   ├── ConceptRepository.ts
│   ├── EntityRepository.ts
│   ├── MacroRepository.ts
│   ├── PersonRepository.ts
│   ├── PreferenceRepository.ts
│   ├── SourceRepository.ts
│   ├── StorylineRepository.ts
│   └── SupabaseConversationRepository.ts
│
├── routes/                     # Express route definitions
│   ├── admin.ts
│   ├── artifacts.ts
│   ├── auth.ts
│   ├── conversations.ts
│   ├── graph.ts
│   ├── informationDump.ts
│   ├── init.ts
│   └── preferences.ts
│
├── middleware/                 # Express middleware
│   └── authMiddleware.ts       # JWT authentication, admin key support
│
├── db/                         # Database clients and schema initialization
│   ├── neo4j.ts                # Neo4j driver singleton with query execution
│   ├── schema.ts               # Neo4j schema initialization (constraints, indexes)
│   └── supabase.ts             # Supabase client singleton
│
├── queue/                      # Background job queue (pg-boss)
│   └── memoryQueue.ts          # Queue configuration, job enqueuing
│
├── agents/                     # LangGraph conversational AI agents
│   ├── orchestrator.ts         # Main conversation agent orchestration
│   ├── ingestionAgent.ts       # Memory extraction agent
│   ├── graph/                  # LangGraph workflow definitions
│   ├── prompts/                # LLM prompts for agents
│   ├── tools/                  # Agent tools (retrieval, graph operations)
│   └── types/                  # Agent message types
│
├── types/                      # TypeScript type definitions
│   ├── database.types.ts      # Generated Supabase types
│   ├── dto.ts                  # Data Transfer Objects (API request/response types)
│   ├── graph.ts                # Neo4j node/relationship types
│   └── ingestion.ts            # Memory extraction types
│
└── utils/                      # Utility functions
    └── entityNormalization.ts  # Entity name normalization helpers
```

---

## Architecture Layers

### 1. HTTP Layer (`routes/` + `controllers/`)

**Pattern:** Routes define endpoints → Controllers handle HTTP request/response

#### Route Files (`routes/*.ts`)
- Define Express Router instances
- Map HTTP methods (GET, POST, etc.) to controller methods
- Apply middleware (authentication, validation)
- Document endpoint contracts (request/response formats)

**Example Pattern:**
```typescript
import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { conversationController } from '../controllers/conversationController.js';

const router: Router = Router();

router.post('/', authenticateToken, (req, res) =>
  conversationController.createConversation(req, res)
);

export default router;
```

#### Controller Files (`controllers/*.ts`)
- Handle HTTP request/response logic
- Extract and validate request parameters
- Call service layer methods
- Format responses (snake_case for API consistency)
- Handle errors with appropriate HTTP status codes

**Example Pattern:**
```typescript
export class ConversationController {
  async createConversation(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      
      const conversation = await conversationService.createConversation(
        req.user.id,
        req.body
      );
      
      res.status(201).json({ success: true, data: { conversation } });
    } catch (error) {
      // Error handling...
    }
  }
}
```

**Key Controllers:**
- `conversationController.ts` - Conversation lifecycle (create, exchange, end, list)
- `initController.ts` - App initialization data (user profile, preferences, recent conversations)
- `graphController.ts` - Knowledge graph operations (people, concepts, entities, queries)
- `authController.ts` - Device authentication (register, validate, refresh)
- `preferenceController.ts` - User preferences management
- `artifactController.ts` - Artifact generation and retrieval

---

### 2. Business Logic Layer (`services/`)

**Purpose:** Encapsulate business logic, coordinate between repositories, orchestrate complex operations

**Key Services:**

#### `conversationService.ts`
- **Purpose:** Manages conversation lifecycle
- **Key Methods:**
  - `createConversation()` - Creates new conversation in Supabase `source` table
  - `processExchange()` - Processes user message → runs LangGraph agent → stores transcript
  - `endConversation()` - Marks conversation as ended, generates summary, enqueues memory extraction
  - `getConversation()` - Retrieves conversation by ID
  - `listConversations()` - Paginated conversation listing with status filtering

#### `authService.ts`
- **Purpose:** Device-based authentication using Supabase Anonymous Auth
- **Key Methods:**
  - `registerOrAuthenticateDevice()` - Creates/retrieves device user account
  - `validateToken()` - Validates JWT access token
  - `refreshSession()` - Refreshes access token
  - `getUserProfile()` - Retrieves user profile data
  - `completeOnboarding()` - Marks user onboarding as complete

#### `initService.ts`
- **Purpose:** Aggregates initialization data for app launch
- **Key Methods:**
  - `getInitData()` - Fetches user profile, preferences, recent conversations, stats in parallel

#### `graphService.ts`
- **Purpose:** High-level knowledge graph operations
- **Key Methods:**
  - Graph queries, entity creation, relationship management
  - Context retrieval for conversations

#### `ingestionService.ts`
- **Purpose:** Memory extraction pipeline (transcript → Neo4j graph)
- **Key Methods:**
  - Processes conversations/information dumps → extracts entities → updates graph

#### `retrievalService.ts`
- **Purpose:** Semantic search and graph traversal for context loading
- **Key Methods:**
  - Retrieves relevant past conversations, active entities, related concepts

#### `summaryService.ts`
- **Purpose:** Generates conversation summaries
- **Key Methods:**
  - `generateConversationSummary()` - LLM-powered summary generation

---

### 3. Data Access Layer (`repositories/`)

**Pattern:** Repository pattern - one repository per entity type, isolates database queries from business logic

#### Neo4j Repositories (`repositories/*Repository.ts`)
- Execute Cypher queries against Neo4j knowledge graph
- Handle entity creation, updates, queries, relationships
- Use `neo4jService.executeQuery()` for query execution
- Serialize Neo4j types (Integer, DateTime) to JavaScript primitives

**Key Repositories:**
- `PersonRepository.ts` - Person nodes (people mentioned in conversations)
- `ConceptRepository.ts` - Concept nodes (abstract ideas, topics)
- `EntityRepository.ts` - Entity nodes (concrete things: projects, places, etc.)
- `SourceRepository.ts` - Source nodes (conversations, information dumps)
- `StorylineRepository.ts` - Storyline nodes (meso-level memory aggregation)
- `MacroRepository.ts` - Macro nodes (macro-level memory aggregation)
- `ArtifactRepository.ts` - Artifact nodes (generated documents, summaries)

**Example Pattern:**
```typescript
export class PersonRepository {
  async upsert(person: Partial<Person> & { canonical_name: string; user_id: string }): Promise<Person> {
    const query = `
      MERGE (p:Person {entity_key: $entity_key})
      ON CREATE SET p.user_id = $user_id, ...
      ON MATCH SET p.updated_at = datetime(), ...
      RETURN p
    `;
    const result = await neo4jService.executeQuery<{ p: Person }>(query, params);
    return result[0].p;
  }
}
```

#### Supabase Repository (`repositories/SupabaseConversationRepository.ts`)
- Direct Supabase queries for conversation data
- Used by services that need PostgreSQL-specific operations

---

### 4. Database Layer (`db/`)

#### `neo4j.ts` - Neo4j Service
- **Singleton pattern** - Single driver instance shared across application
- **Key Methods:**
  - `connect()` - Initialize Neo4j driver connection
  - `executeQuery<T>()` - Execute Cypher query, serialize Neo4j types → JavaScript primitives
  - `executeRaw()` - Execute query, return raw Neo4j records
  - `close()` - Graceful shutdown

**Type Serialization:**
- Converts Neo4j Integer → JavaScript number
- Converts Neo4j DateTime → ISO string
- Flattens Node/Relationship properties

#### `supabase.ts` - Supabase Service
- **Singleton pattern** - Single Supabase client instance
- Uses service role key for admin operations
- Provides typed client with generated database types

#### `schema.ts` - Schema Initialization
- Creates Neo4j constraints (uniqueness, existence)
- Creates Neo4j indexes for performance
- Called on server startup

---

### 5. Background Jobs (`queue/`)

#### `memoryQueue.ts` - pg-boss Queue Configuration
- **Purpose:** Async processing of memory extraction (transcript → Neo4j graph)
- **Queue Names:**
  - `process-conversation-memory` - Conversation memory extraction
  - `process-information-dump` - Information dump processing

**Key Functions:**
- `getQueue()` - Get/create pg-boss instance
- `enqueueConversationProcessing()` - Enqueue conversation for background processing
- `enqueueInformationDumpProcessing()` - Enqueue information dump for processing

**Configuration:**
- Uses dedicated PostgreSQL database (or falls back to `DATABASE_URL`)
- Retry policy: 3 retries with exponential backoff
- Job expiration: 1 hour
- Job deletion: 24 hours after completion

**Worker Processing:**
- `worker.ts` listens for jobs, calls `ingestionService` to process memory extraction

---

### 6. Agent Layer (`agents/`)

**Purpose:** LangGraph conversational AI agents for user interactions and memory extraction

#### `orchestrator.ts`
- Main conversation agent
- Runs LangGraph workflow with user message
- Uses tools: retrieval, graph exploration, artifact generation
- Returns agent response + full message history

#### `ingestionAgent.ts`
- Memory extraction agent
- Processes transcripts → extracts entities → updates Neo4j graph
- Multi-phase pipeline: notes → extraction → consolidation → updates

#### Agent Tools (`agents/tools/`)
- **Retrieval Tools:**
  - `explore.tool.ts` - Semantic search + graph expansion
  - `traverse.tool.ts` - Graph traversal queries
- **Graph Operations:**
  - `person.tool.ts` - Create/update Person nodes
  - `concept.tool.ts` - Create/update Concept nodes
  - `entity.tool.ts` - Create/update Entity nodes
  - `relationship.tool.ts` - Create relationships between nodes
- **Notes:**
  - `add-note-to-person.tool.ts` - Add notes to Person nodes
  - `add-note-to-concept.tool.ts` - Add notes to Concept nodes
  - Similar for Entity, relationships

---

## API Endpoint Organization

### Route Mounting (`index.ts`)

All routes are mounted under `/api` prefix (except `/admin`):

```typescript
app.use('/api/auth', authRouter);
app.use('/api/init', initRouter);
app.use('/api/preferences', preferencesRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/artifacts', artifactsRouter);
app.use('/api/graph', graphRouter);
app.use('/api/information-dumps', informationDumpRouter);
app.use('/admin', adminRouter); // Admin routes (no /api prefix)
```

### Endpoint Categories

#### 1. Authentication (`/api/auth`)
- `POST /api/auth/register` - Register/authenticate device
- `POST /api/auth/validate` - Validate access token
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/onboarding/complete` - Mark onboarding complete
- `GET /api/auth/me` - Get current user profile

#### 2. Initialization (`/api/init`)
- `GET /api/init` - Get app initialization data (user, preferences, recent conversations, stats)

#### 3. Conversations (`/api/conversations`)
- `POST /api/conversations` - Create new conversation
- `POST /api/conversations/:id/exchange` - Process user message + get agent response
- `POST /api/conversations/:id/end` - End conversation, generate summary, enqueue memory extraction
- `GET /api/conversations/:id` - Get conversation by ID
- `GET /api/conversations` - List conversations (paginated, filterable by status)

#### 4. Knowledge Graph (`/api/graph`)
**Public Endpoints (no auth):**
- `GET /api/graph/users` - List all users (for visualization)
- `GET /api/graph/users/:id` - Get user by ID
- `GET /api/graph/users/:userId/full-graph` - Get full graph data for visualization

**Protected Endpoints:**
- `POST /api/graph/users` - Create/update user
- `POST /api/graph/people` - Create/update person
- `GET /api/graph/people/search` - Search people by name
- `GET /api/graph/users/:userId/people/recent` - Get recently mentioned people
- `POST /api/graph/conversations` - Create conversation node
- `GET /api/graph/users/:userId/context` - Get conversation context (active entities)
- `POST /api/graph/query` - Execute manual Cypher query
- `POST /api/graph/explore` - Semantic search + graph expansion
- `POST /api/graph/generate-query` - Generate Cypher query from natural language

#### 5. Preferences (`/api/preferences`)
- CRUD operations for user preferences (conversation style, question preferences, etc.)

#### 6. Artifacts (`/api/artifacts`)
- Generate and retrieve artifacts (summaries, documents generated from conversations)

#### 7. Information Dumps (`/api/information-dumps`)
- Create and process information dumps (bulk text input for memory extraction)

#### 8. Admin (`/admin`)
- Queue monitoring, system health, debugging endpoints

---

## Request/Response Patterns

### Authentication
- **Headers:** `Authorization: Bearer <access_token>`
- **Middleware:** `authenticateToken` attaches `req.user` (Supabase User object)
- **Admin Override:** `X-Admin-Key` header bypasses JWT validation

### Response Format
- **Success:** `{ success: true, data: {...} }`
- **Error:** `{ error: string, message: string, details?: string }`
- **Status Codes:**
  - `200` - Success
  - `201` - Created
  - `400` - Bad Request
  - `401` - Unauthorized
  - `404` - Not Found
  - `500` - Internal Server Error

### Data Format
- **API Responses:** snake_case (matches PostgreSQL schema, Neo4j properties)
- **iOS Compatibility:** iOS uses `CodingKeys` to map snake_case JSON → camelCase Swift properties

---

## Middleware Stack

Applied in `index.ts`:

1. **helmet** - Security headers
2. **cors** - CORS enabled for all origins
3. **morgan** - HTTP request logging (dev mode)
4. **express.json()** - Parse JSON request bodies
5. **express.urlencoded()** - Parse URL-encoded bodies
6. **Route handlers** - Mounted routers
7. **404 handler** - Catch unmatched routes
8. **Error handler** - Global error handling middleware

---

## Error Handling

### Controller Level
- Try/catch blocks in all controller methods
- Specific error messages for different failure modes
- HTTP status codes based on error type:
  - `401` - Authentication failures
  - `404` - Not found errors
  - `400` - Validation errors
  - `500` - Unexpected errors

### Service Level
- Services throw errors (not return error objects)
- Errors bubble up to controllers for HTTP response formatting
- Error messages include context (e.g., "Failed to create conversation: ...")

### Global Error Handler
- Catches unhandled errors
- Returns generic 500 response
- Includes error details in development mode only

---

## Database Coordination

### Dual-Database Architecture

**PostgreSQL (Supabase):**
- Full conversation transcripts (stored as JSON)
- Vector embeddings for semantic search
- User profiles and preferences
- Source metadata (started_at, ended_at, summary)

**Neo4j:**
- Structured knowledge graph (Person, Concept, Entity, Source nodes)
- Relationships between entities
- Hierarchical memory (Sources → Storylines → Macros)
- Provenance tracking (last_update_source, confidence)

### Synchronization
- Conversations stored in Supabase `source` table
- Memory extraction enqueued when conversation ends
- Background worker processes queue → extracts entities → updates Neo4j
- Flags: `entities_extracted`, `neo4j_synced_at` track sync status

---

## Type Safety

### TypeScript Strict Mode
- No `any` types allowed
- All types explicitly defined
- Generated types from Supabase schema (`database.types.ts`)
- Custom types for DTOs, graph nodes, ingestion schemas

### DTOs (`types/dto.ts`)
- Request/response types for all API endpoints
- Ensures consistent API contracts
- snake_case property names for API compatibility

---

## Key Design Patterns

### 1. Repository Pattern
- Isolates database queries from business logic
- One repository per entity type
- Methods return typed entities or null

### 2. Service Layer Pattern
- Business logic lives in services
- Services coordinate between repositories
- Services throw errors (controllers handle HTTP responses)

### 3. Singleton Pattern
- Database clients (Neo4j, Supabase) are singletons
- Queue instance is singleton
- Ensures single connection pool per database

### 4. Dependency Injection (Manual)
- Services instantiate repositories
- Controllers instantiate services
- No framework - explicit instantiation

### 5. Middleware Pattern
- Authentication middleware attaches `req.user`
- Reusable across protected routes
- Optional auth middleware for public endpoints with optional user context

---

## Startup Sequence

1. **Load environment variables** (`dotenv.config()`)
2. **Initialize Express app** with middleware
3. **Mount routes** under `/api` prefix
4. **Connect to Neo4j** (`neo4jService.connect()`)
5. **Initialize Neo4j schema** (constraints, indexes)
6. **Initialize pg-boss queue** (`getQueue()`)
7. **Start Express server** (`app.listen()`)
8. **Graceful shutdown handlers** (SIGINT, SIGTERM)

---

## Development Workflow

### Adding a New Endpoint

1. **Define route** in `routes/[entity].ts`
   - Map HTTP method to controller method
   - Apply authentication middleware if needed

2. **Add controller method** in `controllers/[entity]Controller.ts`
   - Extract request parameters
   - Call service method
   - Format response

3. **Add service method** in `services/[entity]Service.ts`
   - Implement business logic
   - Call repositories as needed
   - Throw errors on failure

4. **Add repository methods** (if Neo4j operations needed)
   - Write Cypher queries
   - Use `neo4jService.executeQuery()`

5. **Update types** in `types/dto.ts`
   - Add request/response DTOs

### Working with Neo4j

- Use `neo4jService.executeQuery<T>()` for typed queries
- Use `neo4jInt()` helper for integer conversions
- Entity keys: `hash(canonical_name + user_id)` for idempotency
- Always set `last_update_source` and `confidence` for provenance

### Working with Supabase

- Use `supabaseService.getClient()` for typed client
- Generated types in `types/database.types.ts`
- Use `.from()` for table queries, `.auth` for authentication

---

## Testing & Debugging

### Local Development
- `pnpm run dev` - Start API server with hot reload
- `pnpm run worker` - Start background worker (separate process)
- Neo4j Browser: `http://localhost:7474`
- Supabase Studio: Web interface for PostgreSQL

### Logging
- Morgan middleware logs HTTP requests (dev mode)
- Console.log for service-level logging
- Error logging includes stack traces in development

### Health Checks
- `GET /health` - Basic server health
- `GET /api/neo4j/health` - Neo4j connection health

---

## Security Considerations

### Authentication
- JWT-based authentication via Supabase
- Device-based authentication (no passwords)
- Admin API key for internal tools (bypasses JWT)

### Authorization
- User-scoped data (all queries filter by `user_id`)
- Middleware validates token before route handlers
- No user can access another user's data

### Input Validation
- Controllers validate required fields
- TypeScript types provide compile-time validation
- Database constraints enforce data integrity

### Error Messages
- Generic error messages in production
- Detailed error messages in development mode only
- No sensitive data leaked in error responses

---

## Performance Considerations

### Database Queries
- Neo4j indexes on frequently queried properties (`entity_key`, `user_id`)
- Supabase indexes on foreign keys and query patterns
- Parallel queries where possible (`Promise.all()`)

### Background Processing
- Memory extraction runs async (doesn't block API responses)
- Queue retries failed jobs automatically
- Job expiration prevents stuck jobs

### Caching
- No caching layer currently (future optimization opportunity)
- Database connection pooling (Neo4j driver, Supabase client)

---

## Future Enhancements

### Potential Improvements
- Redis caching layer for frequently accessed data
- GraphQL API for flexible querying
- WebSocket support for real-time updates
- Rate limiting middleware
- Request validation middleware (e.g., Zod)
- OpenAPI/Swagger documentation generation
- Unit/integration test suite

---

## Related Documentation

- `backend/scripts/ingestion/schema.md` - Neo4j knowledge graph schema
- `docs/api-references/` - External API integration guides
- `CLAUDE.md` - High-level project overview and development guidelines
