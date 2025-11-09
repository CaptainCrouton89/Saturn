# API Endpoints Design

## Overview

This document outlines all API endpoints needed for Cosmo MVP, organized by lifecycle phase and functional area. The backend uses LangGraph for conversation orchestration and management.

## Authentication Endpoints

All endpoints below (except auth endpoints) require:
```
Authorization: Bearer <access_token>
```

### Existing Auth Endpoints
- `POST /api/auth/register` - Register/authenticate device
- `POST /api/auth/validate` - Validate token
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/onboarding/complete` - Mark onboarding complete
- `GET /api/auth/me` - Get current user + profile

---

## App Initialization Endpoints

Called immediately when app opens (returning users).

### `GET /api/init`

**When to call:** Immediately on app launch (after auth)

**Purpose:** Single endpoint to fetch all data needed for app initialization

**Returns:**
```typescript
{
  user: {
    id: string
    device_id: string
    onboarding_completed: boolean
    created_at: string
    updated_at: string
  }
  preferences: UserPreference[]  // All user preferences
  recentConversations: Conversation[]  // Last 10 conversations (summaries only)
  stats: {
    totalConversations: number
    totalMinutes: number
    lastConversationAt: string | null
  }
}
```

**What it fetches:**
- User profile from `user_profiles`
- All preferences from `user_preference` for this user
- Recent conversations (last 10) with summaries from `conversation` table
- Conversation stats (counts, durations)

**Notes:**
- This replaces separate calls for preferences and conversations
- Preferences include conversation style preferences extracted from past interactions
- Conversations include only summary data, not full transcripts
- Optimized single query for fast app startup

---

## Preference Endpoints

### `GET /api/preferences`

**When to call:** Already handled by `/api/init` - only call separately if refreshing preferences

**Returns:**
```typescript
{
  preferences: UserPreference[]
}

interface UserPreference {
  id: string
  type: string  // "question_style", "topic_avoid", "conversation_pace", etc.
  instruction: string  // Natural language instruction for LLM
  confidence: number  // 0-1
  strength: number  // 0-1
  createdAt: string
  updatedAt: string
}
```

**Example preferences:**
- `{ type: "question_style", instruction: "Avoid yes/no questions, prefer open-ended", confidence: 0.85, strength: 0.9 }`
- `{ type: "topic_avoid", instruction: "Don't ask about work stress", confidence: 0.95, strength: 1.0 }`

### `POST /api/preferences`

**When to call:** User explicitly sets a preference (rare in MVP - mostly extracted automatically)

**Body:**
```typescript
{
  type: string
  instruction: string
  strength: number  // 0-1, how strongly to enforce
}
```

**Returns:** Created preference object

---

## Conversation Endpoints

### `POST /api/conversations`

**When to call:** User hits "Start" button to begin new conversation

**Body:**
```typescript
{
  triggerMethod?: string  // "manual", "scheduled", "notification", etc.
}
```

**Returns:**
```typescript
{
  conversation: {
    id: string
    userId: string
    status: "active"
    createdAt: string
    triggerMethod: string
  }
}
```

**What it does:**
- Creates conversation record in database with status="active"
- Returns conversation ID for client to use in subsequent calls
- **Does NOT start conversation flow** - that happens in `/api/conversations/:id/exchange`

**Notes:**
- This is a lightweight operation - just DB insert
- Client stores conversationId locally for the session
- No context loading happens here

### `GET /api/conversations/:id`

**When to call:** Fetching details of a specific conversation (e.g., viewing history)

**Returns:**
```typescript
{
  conversation: {
    id: string
    userId: string
    transcript: ConversationTurn[]  // Full transcript
    abbreviatedTranscript: ConversationTurn[]  // Abbreviated version
    summary: string | null
    status: "active" | "completed" | "abandoned"
    createdAt: string
    endedAt: string | null
    triggerMethod: string
    entitiesExtracted: boolean
    neo4jSyncedAt: string | null
  }
}

interface ConversationTurn {
  speaker: "user" | "assistant"
  text: string
  timestamp: string
  audioSegmentId?: string  // Reference to audio storage if applicable
}
```

### `GET /api/conversations`

**When to call:** Already handled by `/api/init` - only call for pagination/filtering

**Query params:**
- `limit` (default: 10)
- `offset` (default: 0)
- `status` (filter by status)

**Returns:**
```typescript
{
  conversations: Conversation[]  // Summary version (no full transcripts)
  total: number
  hasMore: boolean
}
```

---

## Real-Time Conversation Endpoint

### `POST /api/conversations/:id/exchange`

**When to call:** After user finishes speaking (full utterance transcribed by AssemblyAI/Apple STT)

**Body:**
```typescript
{
  userMessage: string  // Full transcribed user utterance
  turnNumber: number  // Sequential turn in conversation (1, 2, 3...)
}
```

**Returns:**
```typescript
{
  response: {
    text: string  // Cosmo's response text
    audioUrl?: string  // Optional: pre-generated TTS audio URL
    turnNumber: number
    timestamp: string
  }
  conversationHistory: ConversationTurn[]  // Updated full history (sliding window)
}
```

**What it does (backend orchestration with LangGraph):**

1. **Context Loading** (first turn only, cached for conversation):
   - Load user preferences from `user_preference`
   - Load recent conversation summaries (last 1-2 conversations)
   - Query Neo4j for active entities (people/projects/topics mentioned in last 14 days)
   - Semantic search: If user message mentions specific topic, pull relevant past snippets via embeddings
   - Build LangGraph state with all context

2. **LangGraph Conversation Flow:**
   - Add user message to conversation state (sliding window management)
   - LangGraph agent processes message with:
     - System prompt (conversational style, question-asking focus)
     - User preferences (loaded context)
     - Active entities from Neo4j (people, projects, topics)
     - Recent conversation summaries
     - Current conversation history (last 10-15 turns verbatim, older summarized)
   - Agent may invoke internal tools autonomously:
     - Memory search (semantic search via embeddings + Neo4j queries)
     - Web search (for factual questions)
     - Synthesis (generate artifacts like blog posts, plans)
   - Generate response (primarily questions, occasionally ideas)

3. **Update Database:**
   - Append both user message and assistant response to `conversation.transcript` (JSON array)
   - Update `conversation.updated_at`

4. **Return Response:**
   - Send assistant response back to client
   - Include updated conversation history (sliding window)

**Notes:**
- This is the **core conversational endpoint** - called repeatedly during active conversation
- Backend uses LangGraph for state management and agent orchestration
- Context is loaded once at conversation start and cached in LangGraph state
- Sliding window: Keep last 10-15 turns verbatim, summarize/drop older turns
- Client handles streaming transcription (AssemblyAI real-time), but only sends complete utterances to backend
- All tool use (memory search, web search, synthesis) happens internally via LangGraph - no user permission needed

### `POST /api/conversations/:id/end`

**When to call:** Conversation timeout (3-5 min silence) or user closes app

**Body:** (empty)

**Returns:**
```typescript
{
  conversation: {
    id: string
    status: "completed"
    endedAt: string
    summary: string | null  // Generated summary if available
  }
}
```

**What it does:**
- Mark conversation status as "completed"
- Set `ended_at` timestamp
- Trigger async background processing (see below)
- Return updated conversation object

**Background Processing (async, non-blocking):**
1. **Entity Extraction:**
   - LLM analyzes full transcript
   - Extracts: People, Projects, Topics, Ideas mentioned
   - Entity resolution: Match to existing graph nodes via aliases/canonical names
   - Track provenance (conversation_id, excerpt_span, confidence)

2. **Neo4j Graph Updates:**
   - Create/update Person, Project, Topic, Idea nodes
   - Update properties: last_mentioned_at, current_life_situation, blockers, etc.
   - Create/update relationships: MENTIONED, DISCUSSED, EXPLORED, etc.
   - Maintain bounded arrays (max 8-15 items per array property)
   - Create Alias nodes for name variants

3. **Generate Embeddings:**
   - Create embeddings for conversation summary
   - Create embeddings for extractable snippets (for semantic search)
   - Store in conversation.embedding (vector column)

4. **Create lightweight Conversation node in Neo4j:**
   - Summary (~100 words)
   - Metadata (date, duration, trigger_method, topic_tags)
   - Link to entities via MENTIONED/DISCUSSED relationships

5. **Mark Processing Complete:**
   - Set `entities_extracted = true`
   - Set `neo4j_synced_at` timestamp

**Notes:**
- All background processing is async - user doesn't wait
- Duration: 30-120 seconds typically
- Errors in background processing logged but don't block conversation end

---

## History Endpoints

### `GET /api/artifacts`

**When to call:** User browses created artifacts (blog posts, plans, etc.)

**Query params:**
- `limit`, `offset` for pagination
- `type` filter

**Returns:**
```typescript
{
  artifacts: Artifact[]
  total: number
  hasMore: boolean
}
```

---

## Summary: When Endpoints Are Called

### App Launch Flow
1. User opens app → `GET /api/auth/me` (validate session)
2. → `GET /api/init` (load preferences, recent conversations, stats)
3. App is ready with all initialization data

### Starting Conversation Flow
1. User hits "Start" → `POST /api/conversations` (create conversation object)
2. User speaks (AssemblyAI/Apple STT transcribes in real-time on client)
3. User finishes utterance → `POST /api/conversations/:id/exchange` (send full message, get response)
4. Repeat step 3 for each turn
5. Conversation timeout or user closes → `POST /api/conversations/:id/end`
6. Background processing begins (async, invisible to user)

### During Conversation (Internal Tool Use)
- All tool use happens internally via LangGraph - no API calls needed:
  - Memory search (semantic search + Neo4j queries)
  - Web search (for factual questions)
  - Synthesis (artifact generation)
- Tools execute autonomously within the `/exchange` endpoint

### Browsing History
- User views conversation list → Already loaded from `/api/init` or paginate with `GET /api/conversations`
- User views specific conversation → `GET /api/conversations/:id`
- User browses artifacts → `GET /api/artifacts`

---

## LangGraph Integration Notes

### Recommended LangGraph Architecture

**State Schema:**
```typescript
interface ConversationState {
  conversationId: string
  userId: string
  messages: ConversationTurn[]  // Sliding window
  context: {
    preferences: UserPreference[]
    activeEntities: {
      people: Person[]
      projects: Project[]
      topics: Topic[]
      ideas: Idea[]
    }
    recentSummaries: string[]  // Last 1-2 conversation summaries
    semanticMatches: string[]  // Relevant past snippets
  }
  toolCalls: ToolCall[]
  currentTurn: number
}
```

**Graph Nodes:**
1. **context_loader** - Load preferences, Neo4j entities, recent summaries (first turn only)
2. **message_processor** - Add user message to state, manage sliding window
3. **agent_responder** - LLM generates response with autonomous tool use
4. **tool_executor** - Execute internal tool calls (web search, memory search, synthesis)
5. **response_formatter** - Format final response for client

**Internal Tools (LangGraph Native):**
- **memory_search** - Semantic search via PostgreSQL embeddings + Neo4j entity queries
- **web_search** - External web search for factual questions
- **synthesis** - Generate artifacts (blog posts, plans, notes) and save to database

**Edges:**
- context_loader → message_processor (first turn)
- message_processor → agent_responder
- agent_responder → tool_executor (if tools invoked - autonomous, no user permission)
- tool_executor → agent_responder (tool results back to agent)
- agent_responder → response_formatter (final response)

**Key Point:** All tools execute autonomously within the graph - the agent decides when to use them based on conversation context. No user permission or separate API calls needed.

**Checkpointing:**
- Use LangGraph checkpointing to persist conversation state between turns
- Enables conversation resumption, audit trail, debugging

### UI + LangGraph Pattern

**Client-Side (iOS Swift):**
- AssemblyAI real-time STT for live transcription display
- Buffer user speech, detect utterance completion (pause detection)
- Send complete utterance to backend via `/api/conversations/:id/exchange`
- Display assistant response as text + play TTS audio

**Backend (Node.js + LangGraph):**
- Each `/exchange` call invokes LangGraph graph execution
- LangGraph manages conversation state (sliding window, context, tools)
- Response returned to client includes text + conversation history
- TTS can be pre-generated server-side (optional) or client-side

**No streaming in MVP:**
- Client sends complete user utterances (not streaming)
- Backend returns complete responses (not streaming)
- Simplifies implementation, fast enough for MVP
- Future: Add streaming for long responses

---

## Neo4j Access

**Important:** User has **no direct access** to Neo4j graph via API endpoints.

Neo4j is used exclusively by:
- Backend agent (via LangGraph tools) for memory retrieval
- Background processing for entity extraction and updates
- Context loading for conversation initialization

All Neo4j queries happen server-side. Client only receives processed results through conversation responses and context.

---

## Endpoint Summary Table

| Endpoint | Method | When Called | Purpose |
|----------|--------|-------------|---------|
| `/api/auth/register` | POST | First app open | Device registration |
| `/api/auth/me` | GET | App launch | Validate session |
| `/api/init` | GET | App launch (after auth) | Load all init data |
| `/api/preferences` | GET | Refresh preferences | Get user preferences |
| `/api/preferences` | POST | User sets preference | Create preference |
| `/api/conversations` | POST | User hits "Start" | Create conversation object |
| `/api/conversations/:id/exchange` | POST | After each user utterance | Get agent response (tools run internally) |
| `/api/conversations/:id/end` | POST | Timeout or app close | End conversation + trigger background processing |
| `/api/conversations/:id` | GET | View conversation details | Get full transcript |
| `/api/conversations` | GET | Browse history | List conversations |
| `/api/artifacts` | GET | Browse artifacts | List created artifacts |

---

## Implementation Priority

### Phase 1 (Core MVP)
1. ✅ Auth endpoints (already implemented)
2. `/api/init` - App initialization
3. `/api/conversations` (POST) - Create conversation
4. `/api/conversations/:id/exchange` - Real-time exchange with LangGraph
   - Context loading (preferences, Neo4j, embeddings)
   - Agent orchestration with internal tools:
     - Memory search (embeddings + Neo4j)
     - Web search (optional for MVP)
     - Synthesis (artifact generation)
5. `/api/conversations/:id/end` - End conversation + background processing
   - Entity extraction
   - Neo4j graph updates
   - Embedding generation

### Phase 2 (Enhanced MVP)
6. `/api/conversations/:id` - View full transcript
7. `/api/conversations` (GET) - List conversations with pagination
8. `/api/artifacts` - Browse created artifacts
9. `/api/preferences` (POST) - Manual preference creation

### Phase 3 (Post-MVP)
10. Advanced preference learning from conversation patterns
11. Conversation analytics endpoints
12. Audio storage and metadata (if needed)

---

## Notes on Data Flow

**Client Responsibilities:**
- Real-time STT (AssemblyAI or Apple STT)
- Utterance completion detection
- Send complete messages to backend
- Display responses + play TTS
- Manage local conversation state during active session

**Backend Responsibilities:**
- LangGraph conversation orchestration
- Context loading (preferences, Neo4j, embeddings)
- Agent response generation
- Tool execution (synthesis, search, memory)
- Background entity extraction + graph updates
- Persistence (PostgreSQL + Neo4j)

**Background Processing (async):**
- Entity extraction from transcripts
- Neo4j graph updates
- Embedding generation
- Artifact creation (if triggered)

This architecture ensures:
- Fast, responsive conversation experience
- Rich context from memory graph
- Flexible tool use via LangGraph
- Clean separation of concerns
- Scalable async processing
