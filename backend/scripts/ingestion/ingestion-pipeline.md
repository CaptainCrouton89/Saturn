# Ingestion Pipeline

> **Related Documentation**:
> - [architecture.md](./architecture.md) - Memory architecture
> - [agent-tools.md](./agent-tools.md) - Agent tools API
> - [decay.md](./decay.md) - Decay mechanics
> - [hierarchical-memory.md](./hierarchical-memory.md) - Storyline/Macro promotion

## Overview

The ingestion pipeline transforms raw episodic data into personal semantic knowledge stored in Neo4j. **Semantic extraction is user-scoped** with authorship tracking. Sources can be team-scoped or personal.

### Overall Architecture

**Single-Database Model (Neo4j)**:
- **Source nodes**: Store both raw and processed data, metadata, and processing status
- **Semantic graph**: Extracted entities (Person, Concept, Entity) with relationships
- **Processing pipeline**: Updates Source node in-place through 3 phases

**Status Flow**: `raw` → `processed` → `extracted`

**Per-User Extraction** (critical for team Sources):
- **Semantic extraction runs separately per user**: For shared team Sources, extraction is triggered with `user_id = X` when that user first needs the Source (e.g., opens it, asks a related question, or explicit batch job)
- **Each user gets their own semantic graph**: User A and User B extracting from the same team Source create separate Person/Concept/Entity nodes in their respective user-scoped graphs
- **Lazy extraction (recommended)**: Rather than extracting for all team members immediately, extract on-demand when each user first accesses the Source. This saves cost and ensures relevance.
- **Implementation note**: Extraction code must always thread `user_id` through and never assume "one semantic graph per Source"

**Example**: Team meeting Source (team_id="team-001", participants=["alice", "bob", "charlie"]):
- Alice opens meeting notes → Extraction runs with user_id="alice" → Creates nodes in Alice's graph
- Bob asks "what did we discuss?" → Extraction runs with user_id="bob" → Creates nodes in Bob's graph
- Charlie never accesses → No extraction for Charlie (lazy approach saves cost)

## Phase 0: Raw Upload (Synchronous)

**Triggered by**: POST /api/sources endpoint, conversation end, file upload, email/Slack integration, etc.

**Actions**:
1. **Create Source node in Neo4j**:
   ```cypher
   CREATE (s:Source {
     entity_key: $entity_key,
     user_id: $userId,
     team_id: $teamId,

     // Raw data storage
     raw_content: $rawContent,  // Original unprocessed data
     source_type: $sourceType,  // "voice-memo", "meeting", "email", "slack-thread", etc.
     provenance: $provenance,   // {origin: "assemblyai", confidence: 0.95, ...}

     // Processed content (empty until Phase 1)
     content: {type: $sourceType, content: ""},
     summary: "",
     keywords: [],
     tags: [],
     embedding: null,

     // Context metadata
     context_type: $contextType,
     started_at: $startedAt,
     ended_at: $endedAt,
     participants: $participants,

     // Processing status
     processing_status: "raw",
     processing_started_at: null,
     processing_completed_at: null,
     extraction_started_at: null,
     extraction_completed_at: null,

     // Memory management
     salience: 0.5,
     state: "candidate",
     sensitivity: "normal",
     ttl_policy: "decay",
     access_count: 0,
     recall_frequency: 0,
     last_recall_interval: 0,
     decay_gradient: 1.0,
     last_accessed_at: null,

     created_at: datetime(),
     updated_at: datetime()
   })
   ```

   **raw_content structure** (varies by source_type):
   - Conversation: `{type: "conversation", content: <JSONL transcript>}`
   - Email: `{type: "email", from: "...", subject: "...", body: "...", headers: {...}}`
   - Slack: `{type: "slack-thread", channel: "...", messages: [...]}`
   - Text: `{type: "text-note", content: "..."}`

2. **Enqueue batch job**:
   ```typescript
   await pgBoss.send('process-source', { entity_key: uuid })
   ```

## Phase 1: Processing (Batch Job)

**Triggered by**: Background worker picking up job from queue

**Purpose**: Transform raw data into clean, structured, searchable format with metadata extraction

**Actions**:
1. **Load raw data from Neo4j**:
   ```cypher
   MATCH (s:Source {entity_key: $entity_key})
   RETURN s.raw_content AS rawContent, s.source_type AS sourceType
   ```

2. **Run content-type-specific processing** (clean raw → structured):
   - **STT Transcript** (see `phase0.ts`):
     ```typescript
     // Clean up disfluencies, organize into chronological structured notes
     const model = new ChatOpenAI({ modelName: 'gpt-5-nano' })
     const structuredNotes = await model.invoke([
       new SystemMessage(NOTES_EXTRACTION_SYSTEM_PROMPT),
       new HumanMessage(`Convert transcript to structured notes: ${rawContent.content}`)
     ])
     ```
   - **Email**: Extract body, strip signatures, clean HTML formatting
   - **Slack Thread**: Structure as chronological messages with speaker attribution
   - **Text**: Minimal cleanup (spelling, formatting)

3. **Generate summary from cleaned content**:
   ```typescript
   const summary = await model.invoke([
     new SystemMessage("Summarize in 1-2 sentences"),
     new HumanMessage(processedContent)
   ])
   ```

4. **Extract keywords and tags from cleaned content** (same stage as summary):
   ```typescript
   // Extract keywords (key terms, topics, names from processedContent)
   const keywords = await model.invoke([
     new SystemMessage("Extract 5-10 key searchable terms from this content"),
     new HumanMessage(processedContent)
   ])

   // Generate tags (metadata like context, tone, domain from processedContent)
   const tags = await model.invoke([
     new SystemMessage("Generate 3-5 metadata tags (e.g., 'work', 'personal', 'planning')"),
     new HumanMessage(processedContent)
   ])
   ```

5. **Generate embedding from summary**:
   ```typescript
   const embedding = await openai.embeddings.create({
     model: "text-embedding-3-small",
     input: summary
   })
   ```

6. **Update Source node in-place**:
   ```cypher
   MATCH (s:Source {entity_key: $entity_key})
   SET
     s.content = {type: $sourceType, content: $processedContent},
     s.summary = $summary,
     s.keywords = $keywords,
     s.tags = $tags,
     s.embedding = $embedding,
     s.processing_status = 'processed',
     s.processing_completed_at = datetime(),
     s.updated_at = datetime()
   ```

7. **Enqueue extraction job**:
   ```typescript
   await pgBoss.send('extract-entities', { entity_key })
   ```

## Phase 2: Extraction (Batch Job)

**Triggered by**: Automatic after processing completes

**Purpose**: Extract semantic entities and relationships from processed content

**Actions**:

**Step 1: Entity Extraction** (see `phase1.ts`):
```typescript
// Load processed content from Neo4j
const source = await neo4j.run(
  'MATCH (s:Source {entity_key: $entity_key}) RETURN s.content.content AS content',
  { entity_key }
)

// Extract entities with structured output
const model = new ChatOpenAI({ modelName: 'gpt-4.1-mini' })
  .withStructuredOutput(ExtractionOutputSchema)

const result = await model.invoke([
  new SystemMessage(EXTRACTION_SYSTEM_PROMPT),
  new HumanMessage(`Extract all People, Concepts, and Entities: ${source.content}`)
])

// Filter by confidence threshold (≥7/10) and subpoint count (>2)
const entities = result.entities.filter(e =>
  e.confidence >= 7 && (e.subpoints?.length ?? 0) > 2
).map(e => ({
  ...e,
  confidence: e.confidence / 10  // Normalize extraction confidence (0-10) to 0-1 range for storage
}))
```

**Step 2: Entity Resolution via MERGE**:
```cypher
// All semantic entities are user-scoped
// Person nodes - scoped by user_id
UNWIND $entities AS entity
MERGE (p:Person {canonical_name: entity.canonical_name, user_id: $userId})
ON CREATE SET
  p.entity_key = randomUUID(),
  p.name = entity.display_name,
  p.confidence = entity.confidence,  // Set from extraction (0-1)
  p.salience = 0.5,
  p.state = 'candidate',
  p.recall_frequency = 0,
  p.last_recall_interval = 0,
  p.decay_gradient = 1.0,
  p.access_count = 0,
  p.created_by = $userId,
  p.created_at = datetime()
ON MATCH SET
  p.updated_at = datetime()
RETURN p.entity_key, p.canonical_name

// Concept nodes - scoped by user_id
MERGE (c:Concept {name: entity.name, user_id: $userId})
ON CREATE SET
  c.entity_key = randomUUID(),
  c.confidence = entity.confidence,
  c.salience = 0.5,
  c.state = 'candidate',
  c.created_by = $userId,
  c.created_at = datetime()
ON MATCH SET
  c.updated_at = datetime()
RETURN c.entity_key

// Entity nodes - scoped by user_id
MERGE (e:Entity {name: entity.name, user_id: $userId})
ON CREATE SET
  e.entity_key = randomUUID(),
  e.confidence = entity.confidence,
  e.salience = 0.5,
  e.state = 'candidate',
  e.created_by = $userId,
  e.created_at = datetime()
ON MATCH SET
  e.updated_at = datetime()
RETURN e.entity_key

// Owner Person node - scoped by user_id
// canonical_name for owner: User's actual normalized name (e.g., "alex-johnson", "sarah-chen")
// This enables semantic queries like "what does the user think about X" to reference the owner node
// MUST be set from user profile data, NOT extracted from conversation text
MERGE (p:Person {user_id: $userId, is_owner: true})
ON CREATE SET
  p.entity_key = randomUUID(),
  p.canonical_name = $normalizedName,  // From user.profile.full_name, normalized (lowercase, hyphenated)
  p.name = $displayName,               // From user.profile.full_name, as-is (e.g., "Alex Johnson")
  p.confidence = 1.0,  // Owner node always has confidence=1.0
  p.salience = 1.0,    // Owner node starts with high salience
  p.state = 'core',    // Owner node is always core
  p.ttl_policy = 'keep_forever',
  p.created_by = $userId,
  p.created_at = datetime()
ON MATCH SET
  p.updated_at = datetime()
RETURN p.entity_key
```

**Step 3: Create Source [mentions] relationships**:
```cypher
// Link Source to all extracted entities
MATCH (s:Source {entity_key: $sourceEntityKey})
UNWIND $entityKeys AS entityKey
MATCH (n {entity_key: entityKey})
MERGE (s)-[:mentions]->(n)
```

**Step 3.5: Update hierarchical memory counters** (automatic):
```cypher
// For each mentioned entity, update promotion counters
// (enables nightly/weekly Storyline/Macro promotion - see hierarchical-memory.md)
MATCH (n {entity_key: $entityKey})
SET
  n.source_count = coalesce(n.source_count, 0) + 1,
  n.last_mentioned_at = datetime(),
  n.first_mentioned_at = coalesce(n.first_mentioned_at, datetime()),
  n.distinct_source_days = CASE
    WHEN date(datetime()) IN coalesce(n.distinct_days, [])
    THEN coalesce(n.distinct_source_days, 0)
    ELSE coalesce(n.distinct_source_days, 0) + 1
  END,
  n.distinct_days = coalesce(n.distinct_days, []) +
    CASE
      WHEN date(datetime()) IN coalesce(n.distinct_days, [])
      THEN []
      ELSE [date(datetime())]
    END
```

**Step 4: Agent-based semantic updates** (see `phase3-4.ts` patterns):
```typescript
// Three specialized agents run in parallel:
// - Person agent: Updates Person nodes and Person relationships
// - Concept agent: Updates Concept nodes and Concept relationships
// - Entity agent: Updates Entity nodes and Entity relationships

// Each agent:
// 1. Receives list of entities from Phase 1 extraction
// 2. Loads processed content from Neo4j Source.content
// 3. Calls add_note_to_* tools to append to notes[] arrays
// 4. Calls create_relationship / add_note_to_relationship for semantic links

// Example agent call:
const personAgent = new ChatOpenAI({ modelName: 'gpt-4.1-mini' })
const messages = [
  new SystemMessage(PERSON_PROCESSING_SYSTEM_PROMPT),
  new HumanMessage(`
    ## Extracted Entities
    ${entities.map(e => `- ${e.name} (${e.entity_type})`).join('\n')}

    ## Processed Content
    ${source.content}

    ## Task
    For each Person, add relevant notes and create/update relationships.
  `)
]

await personAgent.invoke(messages, { tools: personIngestionTools })
```

**Agent Tools**:

Agents use specialized tools to update the knowledge graph. See [agent-tools.md](./agent-tools.md) for complete API reference with signatures, parameters, and automatic properties.

Available tools:
- **Node tools**: `add_note_to_person`, `add_note_to_concept`, `add_note_to_entity`
- **Relationship tools**: `create_relationship`, `add_note_to_relationship`

All tools automatically track authorship (`added_by`), provenance (`source_id`), timestamps, and set `is_dirty = true` for nightly consolidation.

**Step 4.5: Attach Source to existing Storylines** (if applicable):

```typescript
// For each anchor mentioned in this Source, check if Storyline exists
for (const anchor of extractedAnchors) {
  if (!anchor.has_meso) continue;  // No storyline yet

  // Find candidate storylines for this anchor
  const storylines = await neo4j.run(`
    MATCH (n {entity_key: $anchorKey})<-[:about]-(st:Storyline)
    WHERE st.state IN ['active', 'core']
      AND st.last_source_at > datetime() - duration('P90D')
    ORDER BY st.last_source_at DESC
    LIMIT 3
    RETURN st
  `, { anchorKey: anchor.entity_key });

  if (storylines.length === 0) continue;  // Will promote in nightly job if threshold met

  // Simple matching: if only 1 storyline, attach to it
  // If multiple, check temporal proximity and semantic similarity
  const bestMatch = findBestStorylineMatch(source, storylines);

  if (bestMatch) {
    await neo4j.run(`
      MATCH (st:Storyline {storyline_id: $storylineId}),
            (s:Source {entity_key: $sourceKey})
      MERGE (st)-[:includes]->(s)
      SET
        st.source_count = st.source_count + 1,
        st.last_source_at = CASE
          WHEN s.started_at > st.last_source_at
          THEN s.started_at
          ELSE st.last_source_at
        END,
        st.is_dirty = true,
        st.updated_at = datetime()
    `, {
      storylineId: bestMatch.storyline_id,
      sourceKey: source.entity_key
    });

    // Also update Macro stats if storyline belongs to one
    await neo4j.run(`
      MATCH (st:Storyline {storyline_id: $storylineId})<-[:groups]-(m:Macro)
      SET
        m.total_source_count = m.total_source_count + 1,
        m.last_event_at = CASE
          WHEN $sourceStartedAt > m.last_event_at
          THEN $sourceStartedAt
          ELSE m.last_event_at
        END,
        m.is_dirty = true,
        m.updated_at = datetime()
    `, {
      storylineId: bestMatch.storyline_id,
      sourceStartedAt: source.started_at
    });
  }
}
```

**Cost**: Negligible (~$0.00001 per Source, no LLM calls)

**Step 5: Update Source node status**:
```cypher
MATCH (s:Source {entity_key: $entity_key})
SET
  s.processing_status = 'extracted',
  s.extraction_completed_at = datetime(),
  s.updated_at = datetime()
```

## Idempotency & Error Handling

**Idempotent operations**:
- MERGE operations use UNIQUE constraints for deterministic resolution
- Re-running extraction with same entity_key won't create duplicates
- Notes appends are additive (safe to re-run)

**Error handling**:
- Failed jobs automatically retry with exponential backoff (pg-boss)
- Partial failures: If extraction phase fails, processed content remains in Neo4j
- Source node `processing_status` field enables resumption from any phase

## Cost & Performance

**Target costs** (per 10k word conversation):
- Processing: ~$0.01 (gpt-5-nano)
- Extraction: ~$0.03 (gpt-4.1-mini)
- Embeddings: ~$0.01
- **Total**: ~$0.05

**Processing time**:
- Phase 1 (Processing): ~10-30 seconds
- Phase 2 (Extraction): ~30-60 seconds
- **Total**: ~1 minute end-to-end
