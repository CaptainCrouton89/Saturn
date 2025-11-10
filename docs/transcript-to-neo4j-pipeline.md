# Transcript to Neo4j Pipeline - Requirements & Plan

## Overview

A batch processing system that converts conversation transcripts into Neo4j graph updates. Runs daily as a batch job, processing all new transcripts and updating the knowledge graph with extracted entities, relationships, and metadata.

## Core Requirements

### Functional Requirements

1. **Entity Identification & Resolution**
   - Identify all mentioned entities (People, Projects, Ideas, Topics, Patterns, Values)
   - Resolve entity names to existing Neo4j nodes with high accuracy
   - Handle ambiguous references using context-based disambiguation
   - Extract entity IDs for all entities requiring updates

2. **Incremental Updates**
   - Fetch existing entity data before updates
   - Preserve existing information while adding new context
   - Support different update strategies per field (replace, append)
   - Update relationships with new metadata (timestamps, sentiment, importance scores)

3. **Parallel Processing**
   - Process multiple entities concurrently
   - Use lightweight models (GPT-4.1-nano) for cost efficiency
   - Generate conversation summaries in parallel with entity extraction

4. **Embedding Generation**
   - Generate embeddings for searchable entities (Projects, Topics, Ideas, Notes)
   - Use OpenAI text-embedding-3-small
   - Batch embed all entities from a conversation together

5. **Batch Execution**
   - Run as daily batch job (not real-time)
   - Process all new transcripts from last 24 hours
   - Optimize for cost using batch APIs where available

### Non-Functional Requirements

1. **Accuracy**: Medium-high stakes entity resolution (no human-in-the-loop, but use multi-agent disambiguation for close matches)
2. **Cost**: Target ~$0.02-0.05 per 10k word conversation
3. **Performance**: Complete daily batch within reasonable time (30 min for 100 conversations)
4. **Reliability**: Transactional updates to Neo4j (all-or-nothing per conversation)

### Out of Scope (TODO for Later)

- [ ] Field-level update strategy definitions (replace vs merge vs append) for each entity type
- [ ] Pattern detection implementation details (conversation-scoped vs user-history-scoped)
- [ ] Version control / audit logging for graph changes
- [ ] Real-time processing capabilities

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Daily Batch Job                          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: Entity Identification & Key Generation            │
│  - Extract mentioned entity names/types                      │
│  - Generate stable entity_key: hash(lower(name)+type+userID)│
│  - Lightweight, fast model (GPT-4.1-nano)                    │
│  - Output: List of entity candidates with keys               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 2: Entity Resolution                                  │
│  - Query Neo4j by entity_key, canonical_name, and aliases    │
│  - Fetch full context for candidate matches                  │
│  - Disambiguation agent if multiple close matches            │
│  - Track confidence score (0-1) for each resolution          │
│  - Create Alias nodes for new name variants                  │
│  - Output: Resolved entity IDs + confidence + existing data  │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 3: Parallel Entity Updates (GPT-4.1-nano)             │
│  - One agent per entity                                      │
│  - Input: Transcript + existing entity data                  │
│  - Output: Structured update commands (with provenance)      │
│  - Enforce array bounds (MAX 8-15 items per array field)     │
│  - Track: last_update_source, confidence on entity nodes     │
│  - 7 entity types × N entities = many parallel agents        │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 4: Conversation Summary Generation                    │
│  - Generate ~100 word summary (GPT-4.1-nano)                 │
│  - Include: topics discussed, people mentioned, key          │
│    decisions, emotional tone                                 │
│  - Store in Conversation node                                │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 5: Relationship Updates                               │
│  - Update relationship properties (sentiment, importance)    │
│  - LLM judgment for scoring (keep simple, not complex)       │
│  - Create new relationships (MENTIONED, DISCUSSED, etc.)     │
│  - Update User relationships (KNOWS, WORKING_ON, etc.)       │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 6: Embedding Generation                               │
│  - Batch generate embeddings for updated entities            │
│  - Store in Neo4j vector properties                          │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 7: Neo4j Transaction Execution                        │
│  - Build Cypher statements from update commands              │
│  - Execute as single transaction (UNWIND for efficiency)     │
│  - Rollback on failure                                       │
└─────────────────────────────────────────────────────────────┘
```

## Detailed Phase Breakdown

### Phase 1: Entity Identification & Key Generation

**Goal:** Fast, lightweight extraction of which entities are mentioned + generate stable IDs

**Input:** Conversation transcript (string), user_id

**Process:**
```typescript
// Single generateObject call with GPT-4.1-nano
{
  people: [{
    mentionedName: "Sarah",
    contextClue: "my manager",
    entity_key: hash(toLower("sarah") + "Person" + user_id)  // Generated for idempotency
  }],
  projects: [{ mentionedName: "Saturn", contextClue: "the AI journaling app" }],
  ideas: [{ summary: "using graph databases for memory" }],
  topics: [{ name: "knowledge graphs" }],
  patterns: [{ description: "avoidance of difficult conversations" }],
  values: [{ description: "independence in relationships" }],
  emotions: [
    {
      targetName: "Sarah",
      targetType: "Person",
      emotion: "frustration",
      intensity: 0.7
    }
  ]
}
```

**Output:** Entity candidates with minimal context for resolution

**Model:** GPT-4.1-nano (single call, ~$0.002 per conversation)

---

### Phase 2: Entity Resolution

**Goal:** Map mentioned entities to existing Neo4j nodes or mark for creation

**Input:** Entity candidates from Phase 1 (with entity_key)

**Process:**

For each entity type:

1. **Query Neo4j for candidate matches (in order of preference):**
```cypher
// 1. Try entity_key match (most reliable)
MATCH (p:Person {entity_key: $entity_key})
RETURN p.id, p.name, p.canonical_name, p.relationship_type,
       p.how_they_met, p.current_life_situation, p.last_mentioned_at,
       p.confidence, p.last_update_source

UNION

// 2. Try canonical_name match
MATCH (p:Person {canonical_name: toLower($mentionedName)})
RETURN p.id, p.name, ...

UNION

// 3. Try alias match
MATCH (a:Alias {normalized_name: toLower($mentionedName)})-[:ALIAS_OF]->(p:Person)
RETURN p.id, p.name, ...

UNION

// 4. Fuzzy match on name (fallback)
MATCH (p:Person)
WHERE p.name CONTAINS $mentionedName OR $mentionedName CONTAINS p.name
RETURN p.id, p.name, ...
```

2. **If multiple candidates, run disambiguation agent:**
```typescript
// GPT-4.1-nano call
disambiguate({
  mentionedName: "Sarah",
  contextClue: "my manager",
  candidates: [
    { id: "person_001", name: "Sarah Johnson", relationship_type: "colleague", how_they_met: "work" },
    { id: "person_002", name: "Sarah Chen", relationship_type: "friend", how_they_met: "college" }
  ],
  transcript: "<relevant excerpt>"
})

// Output: { resolved_id: "person_001", confidence: 0.95 }
```

3. **If no match, mark for new node creation**

**Output:** Map of entity mentions → resolved IDs + confidence + full existing data

**Handling Ambiguity:**
- Confidence > 0.9: Auto-resolve
- 0.7 < Confidence < 0.9: Create soft/tentative node with status:'tentative'
- Confidence < 0.7: Create new entity
- Multiple high-confidence matches: Use additional context from transcript

**Create Alias Nodes:**
If resolved to existing entity but mentioned with new name variant:
```cypher
MERGE (a:Alias {name: $mentionedName, normalized_name: toLower($mentionedName), type: "Person"})
MERGE (a)-[:ALIAS_OF]->(p:Person {id: $resolvedId})
```

---

### Phase 3: Parallel Entity Updates

**Goal:** Generate structured update commands for each entity with provenance tracking

**Input (per entity):**
- Transcript
- Resolved entity ID
- Full existing entity data from Neo4j
- Entity type (Person, Project, Idea, Topic, Pattern, Value)
- Conversation ID (for provenance)
- Confidence score from Phase 2

**Process:**

Spawn one agent per entity with schema-specific tool calls:

```typescript
// Example for Person entity
const personUpdateAgent = await generateObject({
  model: "gpt-4.1-nano",
  schema: z.object({
    updates: z.object({
      // Fields that REPLACE existing value
      current_life_situation: z.string().optional(),
      relationship_status: z.string().optional(),
      communication_cadence: z.string().optional(),

      // Fields that MERGE (add new, keep existing) - MAX 10 items
      personality_traits: z.array(z.string()).max(10).optional(),

      // Fields that APPEND
      why_they_matter: z.string().optional(), // Append to existing

      // Provenance (always update)
      last_update_source: z.string(), // conversation_id
      confidence: z.number().min(0).max(1), // from Phase 2

      // Metadata (always update)
      last_mentioned_at: z.string().datetime(),
      updated_at: z.string().datetime()
    }),

    // New relationships or relationship updates
    relationships: z.array(z.object({
      type: z.enum(['RELATED_TO', 'INVOLVED_IN', 'ASSOCIATED_WITH', 'SHARED_EXPERIENCE', 'TENSION_WITH']),
      targetId: z.string(),
      properties: z.record(z.any())
    }))
  }),

  prompt: `
    You are updating a Person entity in a knowledge graph based on new information from a conversation.

    Existing entity data:
    ${JSON.stringify(existingPersonData, null, 2)}

    Conversation transcript excerpt:
    ${relevantTranscriptExcerpt}

    Instructions:
    - current_life_situation: REPLACE if there's new information about their current state
    - personality_traits: ADD new traits, keep existing ones
    - why_they_matter: APPEND new context to existing value
    - Only include fields that have NEW information from the transcript
    - Set last_mentioned_at to now
    - Create/update relationships if mentioned
  `
})
```

**Agent Tools/Actions:**
Each entity type has specific update schema. Examples with array bounds:

**Person Updates:**
- Replace: `current_life_situation`, `relationship_status`, `communication_cadence`
- Merge: `personality_traits` (MAX 10 items)
- Append: `why_they_matter`, `how_they_met`
- Provenance: `last_update_source`, `confidence` on node; timeline in MENTIONED relationship

**Project Updates:**
- Replace: `status`, `confidence_level`, `excitement_level`, `vision`
- Merge: `blockers` (MAX 8), `key_decisions` (MAX 10)
- Append: `vision` (if evolved, append note about evolution)
- Provenance: `last_update_source`, `confidence` on node; timeline in MENTIONED relationship

**Idea Updates:**
- Replace: `status`, `confidence_level`, `excitement_level`, `potential_impact`
- Merge: `obstacles` (MAX 8), `resources_needed` (MAX 10), `experiments_tried` (MAX 10), `next_steps` (MAX 8)
- Append: `evolution_notes`, `context_notes`
- Provenance: `last_update_source`, `confidence` on node; timeline in EXPLORED relationship

**Topic Updates:**
- Replace: `description`, `category`
- Merge: None (mostly metadata updates)
- Provenance: `last_update_source`, `confidence` on node; timeline in DISCUSSED relationship

**Pattern Updates (NOT IN MVP):**
- Replace: `confidence_score` (increase with evidence)
- Increment: `evidence_count`

**Value Updates (NOT IN MVP):**
- Replace: `importance`
- Metadata: `first_stated_at` (if new)

**Array Bounding Strategy:**
When an array reaches MAX limit, keep most recent/salient items:
- Sort by relevance (LLM judgment: "which of these is most important?")
- Keep top N items, discard rest
- For longer histories, create Note nodes via HAS_NOTE relationship

**Output (per entity):**
```typescript
{
  entityId: "person_001",
  entityType: "Person",
  updates: {
    current_life_situation: "just moved to Brooklyn",
    personality_traits: ["thoughtful", "direct"], // merged with existing
    last_mentioned_at: "2025-11-08T10:30:00Z"
  },
  relationships: [
    {
      type: "SHARED_EXPERIENCE",
      targetId: "person_005",
      properties: {
        description: "both attended the design conference",
        date: "2025-11-01"
      }
    }
  ]
}
```

**Parallelization:**
- Spawn all entity update agents simultaneously
- Wait for all to complete using `Promise.all()`
- Total agents = # of entities identified (typically 5-15 per conversation)

---

### Phase 4: Conversation Summary Generation

**Goal:** Create structured summary of conversation for Neo4j Conversation node

**Input:** Full conversation transcript

**Process:**
```typescript
const summary = await generateObject({
  model: "gpt-4.1-nano",
  schema: z.object({
    summary: z.string(), // ~100 words
    topics_discussed: z.array(z.string()),
    people_mentioned: z.array(z.string()),
    key_decisions: z.array(z.string()),
    emotional_tone: z.string() // e.g., "reflective", "excited", "frustrated"
  }),
  prompt: `
    Create a concise summary (~100 words) of this conversation.
    Include:
    - Main topics discussed
    - People mentioned
    - Key decisions or insights
    - Overall emotional tone

    Transcript:
    ${transcript}
  `
})
```

**Output:**
```typescript
{
  summary: "User discussed progress on Saturn project, feeling more confident about graph database approach after recent research. Mentioned conversation with Sarah who just moved to Brooklyn. Explored ideas for semantic search implementation.",
  topics_discussed: ["Saturn project", "graph databases", "semantic search"],
  people_mentioned: ["Sarah"],
  key_decisions: ["Committed to Neo4j for knowledge graph"],
  emotional_tone: "optimistic, focused"
}
```

**Note:** Conversations are never continued later (from vision.md), so summary is generated once and never regenerated.

---

### Phase 5: Relationship Updates

**Goal:** Update/create relationships between entities and User

**Key Relationships to Handle:**

**User → Entities:**
- `(User)-[:KNOWS]->(Person)` - Update `relationship_quality`, `last_mentioned_at`
- `(User)-[:WORKING_ON]->(Project)` - Update `status`, `priority`, `last_discussed_at`
- `(User)-[:INTERESTED_IN]->(Topic)` - Update `engagement_level`, `last_discussed_at`, increment `frequency`
- `(User)-[:HAS_PATTERN]->(Pattern)` - Update `confirmed_at`
- `(User)-[:VALUES]->(Value)` - Update `strength`
- `(User)-[:FEELS]->(Person|Project|Idea)` - Create/update with `emotion`, `intensity`, `noted_at`

**Conversation → Entities:**
- `(Conversation)-[:MENTIONED {count, sentiment, importance_score}]->(Person|Project|Topic|Idea)`
- `(Conversation)-[:DISCUSSED {depth}]->(Topic)`
- `(Conversation)-[:EXPLORED {outcome}]->(Idea)`
- `(Conversation)-[:REVEALED {confidence}]->(Pattern)`

**Entity → Entity:**
- Extracted from Phase 3 entity update outputs
- Examples: `(Person)-[:RELATED_TO]->(Person)`, `(Project)-[:INSPIRED_BY]->(Idea)`

**Sentiment & Importance Scoring:**

Use LLM judgment (keep simple, not complex formulas). Separate lightweight agent per entity:

```typescript
const relationshipScorer = await generateObject({
  model: "gpt-4.1-nano",
  schema: z.object({
    sentiment: z.number().min(-1).max(1), // Overall emotional tone
    importance_score: z.number().min(0).max(1), // How central was this to conversation?
    depth: z.enum(['surface', 'moderate', 'deep']).optional(), // for Topics
    outcome: z.enum(['refined', 'abandoned', 'implemented']).optional() // for Ideas
  }),
  prompt: `
    Analyze how this entity was discussed in the conversation.
    - Sentiment: Overall emotional tone (-1 negative, 0 neutral, 1 positive)
    - Importance: How central was this to the conversation? (0 = mentioned in passing, 1 = core focus)
    - Depth (topics only): How deeply was this explored?

    Entity: ${entityName}
    Transcript: ${relevantExcerpt}
  `
})
```

**Keep it simple:** Trust LLM judgment rather than building complex heuristics.
The model understands nuance better than formulas.

---

### Phase 6: Embedding Generation

**Goal:** Generate vector embeddings for semantic search

**Entities Requiring Embeddings:**
- `Project`: Embed `name + vision`
- `Topic`: Embed `name + description`
- `Idea`: Embed `summary + context_notes`
- `Note`: Embed `content`

**Process:**

1. **Collect all text to embed from updated entities:**
```typescript
const embeddingInputs = [
  { id: "project_001", text: "Saturn: AI journaling app using graph databases for contextual memory" },
  { id: "idea_042", text: "Using embeddings for semantic search across ideas..." },
  // ... etc
]
```

2. **Batch embed using OpenAI:**
```typescript
const embeddings = await openai.embeddings.create({
  model: "text-embedding-3-small",
  input: embeddingInputs.map(e => e.text)
})
```

3. **Map embeddings back to entity IDs:**
```typescript
const embeddingUpdates = embeddingInputs.map((input, idx) => ({
  entityId: input.id,
  embedding: embeddings.data[idx].embedding
}))
```

**Output:** Array of `{ entityId, embedding }` for Cypher update

---

### Phase 7: Neo4j Transaction Execution

**Goal:** Apply all updates to Neo4j atomically

**Process:**

1. **Build Cypher statements from Phase 3-6 outputs:**

Use UNWIND for efficient batch updates:

```typescript
const statements = [
  // Update Person nodes (batch)
  `
  UNWIND $persons AS p
  MERGE (n:Person {entity_key: p.entity_key})
  ON CREATE SET
    n.id = p.id,
    n.name = p.name,
    n.canonical_name = toLower(p.name),
    n.first_mentioned_at = datetime()
  SET n += apoc.map.removeKeys(p.updates, ['id', 'entity_key']),
      n.last_update_source = $conversationId,
      n.confidence = p.confidence,
      n.updated_at = datetime()
  `,

  // Create/update User->Person relationship
  `
  MATCH (u:User {id: $userId}), (p:Person {id: $personId})
  MERGE (u)-[r:KNOWS]->(p)
  SET r.relationship_quality = $quality,
      r.last_mentioned_at = datetime($timestamp)
  `,

  // Create Conversation->Person MENTIONED relationship
  `
  MATCH (c:Conversation {id: $conversationId}), (p:Person {id: $personId})
  MERGE (c)-[r:MENTIONED]->(p)
  SET r.count = coalesce(r.count, 0) + $mentionCount,
      r.sentiment = $sentiment,
      r.importance_score = $importance_score
  `,

  // Update embedding
  `
  MATCH (proj:Project {id: $projectId})
  SET proj.embedding = $embedding
  `,

  // ... more statements
]
```

2. **Execute as single transaction:**
```typescript
const session = driver.session()
const tx = session.beginTransaction()

try {
  for (const { query, params } of statements) {
    await tx.run(query, params)
  }
  await tx.commit()
} catch (error) {
  await tx.rollback()
  throw error
} finally {
  await session.close()
}
```

**Error Handling:**
- Rollback entire transaction on any failure
- Log failed conversation ID for retry
- Surface errors to batch job monitoring

**Error Handling:**
- Rollback entire transaction on any failure
- Log failed conversation ID + phase + payload hash for deterministic retry
- Surface errors to batch job monitoring

**Idempotency:**
Using entity_key ensures batch job can be safely re-run without creating duplicates.

---

## Data Flow Example

**Input:** Conversation transcript

```
User: "I had coffee with Sarah yesterday. She just moved to Brooklyn and
seems really excited about it. We talked about my Saturn project - I'm
feeling more confident about the graph database approach after reading
that paper on knowledge graphs. Sarah suggested I talk to her friend
who works on similar problems."
```

**Phase 1 Output:**
```json
{
  "people": [
    {"mentionedName": "Sarah", "contextClue": "had coffee, friend"}
  ],
  "projects": [
    {"mentionedName": "Saturn", "contextClue": "my project, graph database"}
  ],
  "topics": [
    {"name": "knowledge graphs"},
    {"name": "graph databases"}
  ],
  "ideas": [],
  "patterns": [],
  "values": [],
  "emotions": [
    {
      "targetName": "Saturn",
      "targetType": "Project",
      "emotion": "confidence",
      "intensity": 0.7
    }
  ]
}
```

**Phase 2 Output:**
```json
{
  "people": [
    {
      "mentionedName": "Sarah",
      "resolvedId": "person_001",
      "existingData": {
        "name": "Sarah Johnson",
        "relationship_type": "friend",
        "current_life_situation": "living in Manhattan",
        "personality_traits": ["thoughtful"],
        "last_mentioned_at": "2025-10-15T10:00:00Z"
      }
    }
  ],
  "projects": [
    {
      "mentionedName": "Saturn",
      "resolvedId": "project_042",
      "existingData": {
        "name": "Saturn",
        "status": "active",
        "confidence_level": 0.6,
        "vision": "AI journaling app with contextual memory"
      }
    }
  ],
  "topics": [
    {
      "name": "knowledge graphs",
      "resolvedId": "topic_099",
      "existingData": {...}
    },
    {
      "name": "graph databases",
      "resolvedId": null, // NEW TOPIC
      "existingData": null
    }
  ]
}
```

**Phase 3 Output (per entity):**

```json
// Person update
{
  "entityId": "person_001",
  "entityType": "Person",
  "updates": {
    "current_life_situation": "just moved to Brooklyn",
    "last_mentioned_at": "2025-11-08T10:30:00Z",
    "updated_at": "2025-11-08T10:30:00Z"
  },
  "relationships": []
}

// Project update
{
  "entityId": "project_042",
  "entityType": "Project",
  "updates": {
    "confidence_level": 0.75, // increased
    "last_mentioned_at": "2025-11-08T10:30:00Z"
  },
  "relationships": [
    {
      "type": "RELATED_TO",
      "targetId": "topic_099",
      "properties": {}
    }
  ]
}

// New Topic creation
{
  "entityId": null, // will be generated
  "entityType": "Topic",
  "isNew": true,
  "data": {
    "name": "graph databases",
    "description": "Database systems using graph structures",
    "category": "technical",
    "first_mentioned_at": "2025-11-08T10:30:00Z",
    "last_mentioned_at": "2025-11-08T10:30:00Z"
  }
}
```

**Phase 4 Output:**
```json
{
  "userRelationships": [
    {
      "type": "KNOWS",
      "targetId": "person_001",
      "properties": {
        "relationship_quality": 0.85,
        "last_mentioned_at": "2025-11-08T10:30:00Z"
      }
    },
    {
      "type": "WORKING_ON",
      "targetId": "project_042",
      "properties": {
        "status": "active",
        "last_discussed_at": "2025-11-08T10:30:00Z"
      }
    },
    {
      "type": "FEELS",
      "targetId": "project_042",
      "properties": {
        "emotion": "confidence",
        "intensity": 0.7,
        "noted_at": "2025-11-08T10:30:00Z"
      }
    }
  ],
  "conversationRelationships": [
    {
      "type": "MENTIONED",
      "targetId": "person_001",
      "properties": {
        "count": 3,
        "sentiment": 0.6,
        "importance_score": 0.7
      }
    },
    {
      "type": "MENTIONED",
      "targetId": "project_042",
      "properties": {
        "count": 2,
        "sentiment": 0.7,
        "importance_score": 0.8
      }
    },
    {
      "type": "DISCUSSED",
      "targetId": "topic_099",
      "properties": {
        "depth": "moderate"
      }
    }
  ]
}
```

**Phase 5 Output:**
```json
[
  {
    "entityId": "project_042",
    "embedding": [0.023, -0.891, 0.342, ...]
  },
  {
    "entityId": "topic_new_001",
    "embedding": [0.156, -0.234, 0.678, ...]
  }
]
```

**Phase 4 Output (Summary):**
```json
{
  "summary": "User discussed progress on Saturn...",
  "topics_discussed": ["Saturn project", "graph databases"],
  "people_mentioned": ["Sarah"],
  "key_decisions": ["Committed to Neo4j"],
  "emotional_tone": "optimistic"
}
```

**Phase 7:** Execute Cypher statements in transaction using UNWIND for efficiency

---

## Implementation Considerations

### Tech Stack

**Language:** TypeScript (existing project assumed)

**LLM Integration:**
- ~~Vercel AI SDK~~ (not suitable for batch jobs)
- Direct OpenAI API calls with custom batch handling

**Neo4j Client:**
- `neo4j-driver` (official Neo4j JavaScript driver)

**Batch Job Infrastructure:**
- Cron job / scheduled Lambda / Cloud Function
- Queue system (BullMQ, AWS SQS) for processing individual conversations

### Cost Estimation

**Per 10k word conversation (~13k tokens):**

- Phase 1 (entity identification + keys): 1 call × $0.002 = $0.002
- Phase 2 (disambiguation): ~3 calls × $0.002 = $0.006
- Phase 3 (entity updates): ~10 entities × $0.002 = $0.020
- Phase 4 (conversation summary): 1 call × $0.002 = $0.002
- Phase 5 (relationship scoring): ~10 calls × $0.002 = $0.020
- Phase 6 (embeddings): ~5 entities × $0.00002 = $0.0001
- **Total: ~$0.050 per conversation**

**For 100 conversations/day: ~$5.00/day or $150/month**

### Performance Optimization

1. **Parallel Processing:**
   - Process multiple conversations in parallel (10-20 at a time)
   - Within each conversation, all entity updates are parallel

2. **Neo4j Query Optimization:**
   - Create indexes on frequently queried fields:
     ```cypher
     CREATE INDEX entity_key IF NOT EXISTS FOR (n) ON (n.entity_key)
     CREATE INDEX person_canonical_name IF NOT EXISTS FOR (p:Person) ON (p.canonical_name)
     CREATE INDEX alias_normalized_name IF NOT EXISTS FOR (a:Alias) ON (a.normalized_name)
     ```
   - Use vector indexes for embedding similarity search
   - Use UNWIND for batch updates (more efficient than individual statements)

3. **Caching:**
   - Cache frequently accessed entities during batch run
   - Reduces duplicate Neo4j queries across conversations

4. **Rate Limiting:**
   - Respect OpenAI API rate limits (10k req/min for Tier 3)
   - Batch embedding calls (max 2048 inputs per call)

### Error Handling & Monitoring

**Retry Logic:**
- Retry individual conversation processing on transient failures (3 attempts)
- Dead letter queue for permanently failed conversations

**Monitoring:**
- Track success/failure rate per batch
- Log processing time per conversation
- Alert on error rate > 5%

**Logging:**
- Structured logs for each phase
- Include conversation ID, entity counts, processing time
- Log ambiguous entity resolutions for manual review

---

## Open Questions / TODOs

### High Priority

- [ ] **Field Update Strategy Definition**: Create comprehensive mapping of replace/merge/append logic for all entity properties
- [ ] **Pattern Detection Scope**: Decide on conversation-scoped vs user-history-scoped pattern detection
- [ ] **Conversation Summary Schema**: Define what metadata to include in summary (topics, people mentioned, key takeaways)

### Medium Priority

- [ ] **Entity Disambiguation Threshold Tuning**: Determine optimal confidence thresholds through testing
- [ ] **Relationship Property Calculation**: Define algorithms for `relationship_quality`, `engagement_level`, etc.
- [ ] **New Entity Validation**: Should new entity creation require higher confidence or additional checks?

### Low Priority / Future

- [ ] **Version Control**: Audit trail for graph changes (store extraction outputs before applying)
- [ ] **Real-time Processing**: Architecture changes needed if real-time mode required later
- [ ] **Multi-user Support**: How to handle conversations involving multiple users

---

## Success Metrics

**Accuracy:**
- Entity resolution accuracy > 95% (measured via manual review sample)
- False positive entity creation rate < 2%

**Performance:**
- Process 100 conversations in < 30 minutes
- Average processing time < 20 seconds per conversation

**Cost:**
- Stay under $5/day for 100 conversations

**Reliability:**
- Batch success rate > 98%
- Zero data loss (failed conversations queued for retry)

---

---

## Future Enhancements (Not MVP)

### 1. Pre-computed Conversation Starters
**Goal:** Eliminate latency from complex live queries during conversation start

**Approach:**
- Nightly batch job (separate from transcript processing)
- Query Neo4j for top conversation topics/people/projects per user
- Store in User node:
  ```cypher
  (:User {
    conversation_starters: {
      topics: ["knowledge graphs", "dating patterns"],
      people: ["Sarah", "Alex"],
      projects: ["Saturn"],
      generated_at: datetime()
    }
  })
  ```
- Live conversation reads from User node (instant) instead of complex graph traversal
- Refresh daily

**Benefits:**
- Sub-50ms conversation start latency on mobile
- Reduced Neo4j query load during live conversations
- Still allows user to override and talk about anything

### 2. Concurrent Update Locking
**Goal:** Prevent batch job from updating entities being discussed in live conversation

**Approach:**
- Mark entities as "locked" during live conversations
- Batch job skips locked entities, processes in next run
- Or use optimistic locking: version number on each entity, increment on update
- Conflict detection: if version changed between read and write, retry

**Implementation:**
```cypher
// Optimistic locking
MATCH (p:Person {id: $personId, version: $expectedVersion})
SET p.current_life_situation = $new_value,
    p.version = $expectedVersion + 1
```

**Why not MVP:**
- Low collision probability (batch runs at 3am, usage is low)
- Can implement later when usage increases

### 3. Pattern & Contradiction Detection
**Goal:** Surface behavioral patterns and value contradictions

**Approach:**
- Weekly batch job (separate from daily transcript processing)
- Analyze across all recent conversations (not per-conversation)
- Use LLM to detect:
  - Recurring behavioral patterns
  - Contradictions between stated Values and observed Patterns
  - Evolution in how user talks about people/projects
- Create/update Pattern nodes and CONTRADICTS edges

**Why not MVP:**
- User explicitly deprioritized this feature
- Requires substantial conversation history to be meaningful
- Can add once product has traction and users have months of data

---

## Next Steps

1. **Prototype Phase 1 & 2:** Build entity identification, key generation, and resolution logic
2. **Test Entity Resolution:** Run on sample conversations, measure accuracy of entity_key + alias matching
3. **Define Update Schemas:** Create detailed field-level update strategy with array bounds for each entity type
4. **Implement Phase 3:** Build parallel entity update system with provenance tracking
5. **Implement Phase 4:** Add conversation summary generation
6. **Integration Testing:** End-to-end test with real conversation data
7. **Production Deployment:** Set up batch job infrastructure and monitoring
