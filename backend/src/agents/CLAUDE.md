# Agents - CLAUDE.md

LangGraph agents for conversation orchestration and memory extraction.

## Overview

This directory contains LangGraph-based agents that handle:
1. **Conversation Agent** (`orchestrator.ts`) - Real-time conversational AI with memory retrieval
2. **Ingestion Agent** (`ingestionAgent.ts`) - Async memory extraction from conversation transcripts

Both agents use tools to interact with Neo4j graph and external services, with behavior defined by system prompts.

## Directory Structure

```
agents/
├── orchestrator.ts           # Conversation agent (real-time)
├── ingestionAgent.ts         # Memory extraction agent (async)
├── tools/                    # Agent tools (see tools/CLAUDE.md)
│   ├── nodes/                # Node creation/update tools (Person, Concept, Entity)
│   ├── relationships/        # Relationship creation/update tools
│   ├── retrieval/            # Memory retrieval tools (explore, traverse)
│   └── registry.ts           # Tool registration and exports
├── schemas/                  # Zod validation schemas
│   └── ingestion.ts          # Node and relationship schemas from tech.md
├── prompts/                  # System prompts for agents
│   ├── system-prompt.ts      # Conversation agent default prompt
│   ├── onboarding.ts         # Onboarding conversation prompt
│   ├── summary.ts            # Conversation summary prompt
│   └── ingestion.ts          # Extraction and relationship agent prompts
├── graph/                    # LangGraph workflow definitions (conversation agent)
│   ├── workflow.ts           # Main workflow builder
│   └── nodes.ts              # Workflow node implementations
└── utils/                    # Agent utilities
    └── serialization.ts      # Message serialization for state management
```

## Ingestion Agent Architecture

The ingestion agent (`ingestionAgent.ts`) implements the memory extraction pipeline as a 3-node LangGraph state machine.

### State Schema

```typescript
{
  conversationId: string,    // For provenance tracking
  userId: string,            // For entity resolution
  transcript: string,        // Full conversation text
  summary: string,           // ~100 word summary
  entities: ExtractedEntity[], // Phase 1 output
  sourceEntityKey: string,   // Phase 2 output
  relationshipMessages: BaseMessage[] // Phase 3 messages
}
```

### Node 1: Extract and Disambiguate

**Purpose**: Extract entities from transcript and match to existing graph nodes

**Process**:
1. LLM receives transcript + existing entities context (from Neo4j)
2. Structured output extraction using Zod schema
3. For each mentioned entity:
   - Try matching via `entity_key` (hash of normalized name + type + user_id)
   - For People: fallback to `canonical_name` match
   - For Concepts/Entities: fallback to vector similarity search
4. Output: Array of `ExtractedEntity` with match results

**Output Schema**:
```typescript
{
  mentioned_name: string,        // How entity appeared in conversation
  entity_type: 'Person' | 'Concept' | 'Entity',
  entity_subtype?: string,       // For Entity: company, place, etc.
  context_clue: string,          // Why this should be extracted
  matched_entity_key: string | null, // Existing entity or null if new
  confidence: number,            // 0-1 confidence in match/creation
  is_new: boolean               // True if no match found
}
```

**Model**: GPT-4.1-mini with structured output

**Prompt**: `EXTRACTION_SYSTEM_PROMPT` from `prompts/ingestion.ts`

**Cost**: ~$0.01-0.02 per 10k word conversation

### Node 2: Auto-Create Source Edges

**Purpose**: Create Source node and link to mentioned entities

**Process**:
1. Create Source node via `SourceRepository.create()`
   - Stores conversation transcript as JSON content
   - Stores summary as description
   - User-scoped via `user_id`
2. For each extracted entity with `matched_entity_key`:
   - Create `(Source)-[:mentions]->(Person|Concept|Entity)` edge
   - Update target node's `updated_at` timestamp
3. Output: `source_entity_key` for downstream reference

**No LLM calls** - Pure graph operations

**Cost**: Free (Cypher queries only)

### Node 3: Relationship Agent

**Purpose**: Create/update nodes and relationships using tools

**Process**:
1. Agent receives:
   - Full transcript
   - Summary
   - Extracted entities with match status
   - `source_entity_key` for linking artifacts
2. Agent has access to 12 tools:
   - 6 node tools: `createPerson`, `updatePerson`, `createConcept`, `updateConcept`, `createEntity`, `updateEntity`
   - 2 relationship tools: `createRelationship`, `updateRelationship`
   - 2 retrieval tools: `explore` (semantic search), `traverse` (Cypher queries)
   - 2 conversation tools: `write`, `completeOnboarding` (not used in ingestion)
3. Agent iteratively calls tools until:
   - All nodes and relationships created/updated
   - Agent signals completion (no more tool calls)
   - Max iterations reached (10)
4. Output: Message history with tool calls and results

**Model**: GPT-4.1-mini with tool binding

**Cost**: ~$0.02-0.03 per 10k word conversation (depends on tool calls)

**Max Iterations**: 10 (prevents runaway loops)

### Entity Resolution Strategy

The agent uses a hierarchical matching approach:

**For People**:
1. Try `entity_key` match (most reliable - hash of canonical_name + user_id)
2. Fallback to `canonical_name` match (case-insensitive)
3. If no match: create new Person node

**For Concepts**:
1. Try `entity_key` match
2. Fallback to vector similarity search (if embeddings exist)
3. If no match or low similarity: create new Concept node

**For Entities**:
1. Try `entity_key` match
2. Fallback to vector similarity search (if embeddings exist)
3. If no match or low similarity: create new Entity node

**Important**: Only create Concepts/Entities when they have user-specific context (per tech.md:127-131). Casual mentions without personal relevance should NOT be extracted.

### Provenance Tracking

All node operations must include provenance metadata:

- `last_update_source`: conversation_id where node was last updated
- `confidence`: 0-1 confidence in entity resolution or creation

This enables:
- Audit trail for entity updates
- Conflict resolution when multiple conversations mention same entity
- Trust scoring for entity data quality

### Cost Optimization

**Target**: ~$0.05 per 10k word conversation

**Actual**:
- Phase 1 (Extraction): ~$0.01-0.02
- Phase 2 (Source Edges): Free
- Phase 3 (Relationship Agent): ~$0.02-0.03
- Embeddings (post-processing): ~$0.00001

**Total**: ~$0.03-0.05 per 10k words ✅

**Model Selection**: GPT-4.1-mini chosen for speed + cost vs. GPT-4.1 (10x cheaper, 2x faster)

## Workflow Execution

The ingestion agent is invoked by `ingestionService.ts` after conversation ends:

```typescript
// From worker.ts (pg-boss job handler)
await ingestionService.processConversation(conversationId, userId);

// Inside ingestionService.ts
const transcript = formatTranscript(conversation.transcript);
await runIngestionAgent(conversationId, userId, transcript, conversation.summary);

// Post-processing
const newNodes = await queryNewNodesFromConversation(conversationId);
const embeddings = await embeddingGenerationService.generate(newNodes);
await updateNeo4jWithEmbeddings(embeddings);
```

Flow: conversation ends → pg-boss job enqueued → worker picks up job → ingestion service → ingestion agent (3 phases) → embedding generation → mark conversation as processed

## Error Handling

**Phase 1 Failures** (Extraction):
- LLM structured output validation errors → throw error, pg-boss retries
- Neo4j query errors (fetching existing entities) → throw error, pg-boss retries

**Phase 2 Failures** (Source Edges):
- Source creation errors → throw error, pg-boss retries
- Edge creation errors → throw error, pg-boss retries (idempotent with entity_key)

**Phase 3 Failures** (Relationship Agent):
- Tool call errors → logged in message history, agent continues
- Max iterations reached → warning logged, processing completes (partial success acceptable)
- Cypher errors from tools → thrown as tool errors, visible to agent for retry

**Retry Strategy**: pg-boss automatically retries failed jobs with exponential backoff (max 3 retries)

## Idempotency

The ingestion pipeline is idempotent via:

1. **entity_key uniqueness**: Hash of normalized name + type + user_id ensures same entity always gets same key
2. **MERGE operations**: All node creation uses `MERGE ON entity_key` (upsert semantics)
3. **Conversation flag**: `entities_extracted: true` prevents re-processing
4. **Provenance tracking**: `last_update_source` identifies which conversation last updated node

Safe to re-run ingestion for same conversation without creating duplicates.

## Adding New Node Type

To add support for a new node type (e.g., `Event`, `Location`):

1. **Define schema** in `schemas/ingestion.ts`:
   ```typescript
   export const EventNodeSchema = z.object({
     name: z.string(),
     date: z.string().optional(),
     description: z.string().optional(),
     notes: z.string().optional(),
   });
   ```

2. **Create tools** in `tools/nodes/event.tool.ts`:
   ```typescript
   export const createEventTool = tool(/* ... */);
   export const updateEventTool = tool(/* ... */);
   ```

3. **Add to registry** in `tools/registry.ts`:
   ```typescript
   export const ingestionTools = [
     // existing tools...
     createEventTool,
     updateEventTool,
   ];
   ```

4. **Create repository** in `repositories/EventRepository.ts` with Neo4j queries

5. **Update prompts** in `prompts/ingestion.ts` to mention new node type

6. **Document** in `tools/CLAUDE.md`

## Testing Ingestion Agent

**Unit Testing** (tools):
```bash
# Test individual tools with mock Neo4j
npm test -- tools/nodes/person.tool.test.ts
```

**Integration Testing** (full pipeline):
```bash
# Enqueue test job via API
curl -X POST http://localhost:8000/api/conversations \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"transcript": [...], "summary": "..."}'

# Monitor worker logs
pnpm run worker
# Should see: [Ingestion] Starting ingestion for conversation <id>
```

**Manual Testing** (Neo4j Browser):
```cypher
// Check Source node creation
MATCH (s:Source {last_update_source: "conversation_123"})
RETURN s

// Check mention edges
MATCH (s:Source)-[:mentions]->(n)
WHERE s.last_update_source = "conversation_123"
RETURN s, n

// Check provenance tracking
MATCH (n)
WHERE n.last_update_source = "conversation_123"
RETURN labels(n), n.entity_key, n.confidence, n.updated_at
```

## Performance Considerations

**Bottlenecks**:
1. Phase 1: LLM call (~2-5 seconds for 10k words)
2. Phase 3: Multiple tool calls (~0.5-1 second per tool call, up to 10 iterations)
3. Embedding generation: ~1-2 seconds for batch of 10 nodes

**Optimizations**:
- Use GPT-4.1-mini instead of GPT-4.1 (2x faster)
- Batch embedding generation (up to 2048 nodes per call)
- Parallel edge creation with UNWIND in Phase 2
- Early termination in Phase 3 when agent signals completion

**Expected Total Time**: 5-15 seconds per conversation (10k words)

## Conversation Agent vs. Ingestion Agent

**Conversation Agent** (`orchestrator.ts`):
- **When**: Real-time during user conversation
- **Purpose**: Generate conversational responses
- **Tools**: `write` (respond to user), `explore` (retrieve context), `traverse` (query graph)
- **Model**: GPT-4.1 (higher quality responses)
- **Latency**: <2 seconds per turn
- **Cost**: ~$0.10-0.20 per 10k words

**Ingestion Agent** (`ingestionAgent.ts`):
- **When**: Async after conversation ends (background job)
- **Purpose**: Extract structured memory from transcript
- **Tools**: Node tools (create/update), relationship tools, retrieval tools
- **Model**: GPT-4.1-mini (cost-effective)
- **Latency**: 5-15 seconds per conversation
- **Cost**: ~$0.03-0.05 per 10k words

Key difference: Conversation agent focuses on **quality** of real-time responses, ingestion agent focuses on **cost** and **thoroughness** of memory extraction.

## See Also

- `tools/CLAUDE.md` - Detailed tool specifications and schemas
- `schemas/ingestion.ts` - Zod schemas for all node and relationship types
- `prompts/ingestion.ts` - System prompts for extraction and relationship agents
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/INGESTION_REFACTOR_PLAN.md` - Implementation plan for agent-based refactor
- `/Users/silasrhyneer/Code/Cosmo/Saturn/tech.md` - Graph schema and retrieval specifications
