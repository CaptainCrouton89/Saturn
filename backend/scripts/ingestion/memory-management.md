# Memory Management

> **⚠️ DEPRECATED**: This file has been refactored into focused documents:
> - [ingestion-pipeline.md](./ingestion-pipeline.md) - Ingestion phases (Phase 0-2)
> - [decay.md](./decay.md) - Memory lifecycle and decay mechanics
> - [hierarchical-memory.md](./hierarchical-memory.md) - Storyline/Macro promotion
>
> This file is kept for reference but should not be used for new development.

This document describes how data flows through the Cosmo memory system, including ingestion (how data gets added), lifecycle management (how data gets updated), and decay mechanisms (how data gets deleted or archived).

## Ingestion

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

### Phase 0: Raw Upload (Synchronous)

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

### Phase 1: Processing (Batch Job)

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

### Phase 2: Extraction (Batch Job)

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
MERGE (e:Entity {name: entity.name, type: entity.type, user_id: $userId})
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

### Idempotency & Error Handling

**Idempotent operations**:
- MERGE operations use UNIQUE constraints for deterministic resolution
- Re-running extraction with same entity_key won't create duplicates
- Notes appends are additive (safe to re-run)

**Error handling**:
- Failed jobs automatically retry with exponential backoff (pg-boss)
- Partial failures: If extraction phase fails, processed content remains in Neo4j
- Source node `processing_status` field enables resumption from any phase

### Cost & Performance

**Target costs** (per 10k word conversation):
- Processing: ~$0.01 (gpt-5-nano)
- Extraction: ~$0.03 (gpt-4.1-mini)
- Embeddings: ~$0.01
- **Total**: ~$0.05

**Processing time**:
- Phase 1 (Processing): ~10-30 seconds
- Phase 2 (Extraction): ~30-60 seconds
- **Total**: ~1 minute end-to-end

---

## Hierarchical Memory Promotion

After Sources are ingested, separate batch jobs promote frequently-mentioned semantic nodes into meso-level (**Storyline**) and macro-level (**Macro**) aggregation nodes. This enables retrieval at different granularities without expensive clustering operations.

See [hierarchical-memory.md](./hierarchical-memory.md) for complete details on Storyline/Macro node schemas, promotion logic, and retrieval patterns.

### Nightly Storyline Promotion Job

**Triggered by**: pg-boss scheduled task (runs at 3am daily)

**Purpose**: Promote semantic nodes with 5+ Sources across 3+ days into Storyline nodes

**Logic**:
```cypher
// Find candidate anchors
MATCH (n)
WHERE (n:Person OR n:Concept OR n:Entity)
  AND n.source_count >= 5
  AND n.state IN ['active', 'core']
  AND n.distinct_source_days >= 3
  AND datetime() - n.first_mentioned_at > duration('P3D')
  AND coalesce(n.has_meso, false) = false
RETURN n
ORDER BY n.source_count DESC
LIMIT 100
```

**Process**:
1. Find 100 eligible anchors based on counters (no LLM)
2. For each anchor:
   - Create Storyline node with metadata
   - Link to anchor: `(Storyline)-[:about]->(anchor)`
   - Link to Sources: `(Storyline)-[:includes]->(Source)`
3. Generate 2-3 sentence summary from Source summaries (gpt-4.1-mini)
4. Embed summary and store in Storyline node
5. Set `anchor.has_meso = true`

**Cost**: ~$0.01/night (~100 storylines × 200 tokens/call)

### Weekly Macro Promotion Job

**Triggered by**: pg-boss scheduled task (runs Sunday at 2am)

**Purpose**: Group 2+ Storylines spanning 30+ days into Macro nodes

**Logic**:
```cypher
// Find anchors with multiple Storylines
MATCH (n)<-[:about]-(st:Storyline)
WHERE st.state IN ['active', 'core']
WITH n, collect(st) AS storylines, count(st) AS storylineCount
WHERE storylineCount >= 2
  AND datetime() - n.first_mentioned_at > duration('P30D')
  AND coalesce(n.has_macro, false) = false
RETURN n, storylines
ORDER BY storylineCount DESC
LIMIT 50
```

**Process**:
1. Find 50 eligible anchors with multiple Storylines (no LLM)
2. For each anchor:
   - Create Macro node with metadata
   - Link to anchor: `(Macro)-[:rooted_in]->(anchor)`
   - Link to Storylines: `(Macro)-[:groups]->(Storyline)`
3. Generate 2-4 sentence overview from Storyline descriptions (gpt-4.1-mini)
4. Embed overview and store in Macro node
5. Set `anchor.has_macro = true`

**Cost**: ~$0.003/week (~20 macros × 300 tokens/call)

### Nightly Storyline Refresh Job

**Triggered by**: pg-boss scheduled task (runs at 3:30am daily, after promotion job)

**Purpose**: Re-summarize Storylines marked as `is_dirty` to reflect newly added Sources

**Logic**:
```cypher
// Find dirty storylines
MATCH (st:Storyline)
WHERE st.is_dirty = true
  AND st.state IN ['active', 'core']
  AND st.last_source_at > datetime() - duration('P90D')
RETURN st
ORDER BY st.source_count DESC
LIMIT 100
```

**Process**:
1. Find 100 dirty storylines (marked when Sources attached in Step 4.5)
2. For each storyline:
   - Fetch last 10 Source summaries
   - Prompt: "Update this storyline summary: [current] with new events: [10 summaries]"
   - Generate updated 2-3 sentence description (gpt-4.1-mini)
   - Re-embed updated description
   - Clear `is_dirty` flag

**Cost**: ~$0.006/night (~50 dirty storylines × 250 tokens/call) = ~$0.18/month

### Weekly Macro Refresh Job

**Triggered by**: pg-boss scheduled task (runs Sunday at 2:30am, after promotion job)

**Purpose**: Re-summarize Macros marked as `is_dirty` to reflect evolving Storylines

**Logic**:
```cypher
// Find dirty macros
MATCH (m:Macro)
WHERE m.is_dirty = true
  AND m.state IN ['active', 'core']
RETURN m
ORDER BY m.total_source_count DESC
LIMIT 50
```

**Process**:
1. Find 50 dirty macros (marked when Sources/Storylines added)
2. For each macro:
   - Fetch all Storyline descriptions (chronological)
   - Prompt: "Update this macro overview: [current] with storylines: [descriptions]"
   - Generate updated 2-4 sentence overview (gpt-4.1-mini)
   - Re-embed updated overview
   - Update `storyline_count`
   - Clear `is_dirty` flag

**Cost**: ~$0.0035/week (~20 dirty macros × 350 tokens/call) = ~$0.015/month

**Total Hierarchical Memory Cost**:
- Initial promotion: ~$0.31/month (storyline + macro creation)
- Refresh: ~$0.195/month (storyline + macro re-summarization)
- Embeddings: ~$0.09/month
- **Total**: ~$0.60/month (keeps storylines/macros fresh, still under $0.05/10k-word-conversation budget)

---

## Memory Lifecycle & Decay

All nodes (both semantic and episodic) use salience scoring and decay mechanisms to determine what stays in active memory. However, semantic nodes persist longer and decay more slowly than episodic nodes, reflecting their role as consolidated knowledge.

### Salience Updates

**On Every Retrieval** (when a node is returned in `explore()` or `traverse()` results):
```
For each returned node:
1. access_count += 1
2. recall_frequency += 1
3. last_accessed_at = now
4. salience = min(1.0, salience + α) where α ∈ [0.05, 0.1]
```

### Memory Lifecycle (State Transitions)

**Universal State Flow** (applies to all nodes and relationships with full lifecycle tracking):

```
candidate → active → core → archived
```

**State Definitions**:
- **candidate**: Newly created, not yet retrieved (initial state)
- **active**: Retrieved 1-9 times (confirmed through use)
- **core**: Retrieved 10+ times (highly important, resistant to decay)
- **archived**: Salience < 0.01 or ttl_policy expired (excluded from default searches)

**Transition Rules**:
- `candidate → active`: On first retrieval (`access_count >= 1`)
- `active → core`: On frequent retrieval (`access_count >= 10`)
- `active/core → archived`: When salience drops below 0.01 OR ttl_policy forces archival
- `archived → active`: If re-accessed after archival (salience boosted)

**Which Nodes Have Full Lifecycle Tracking**:
- **Semantic nodes**: Person, Concept, Entity (all properties)
- **Semantic relationships**: All relationship types (all properties)
- **Hierarchical nodes**: Storyline, Macro (all properties)
- **Episodic nodes**: Source, Artifact (simplified - see below)

**Simplified Lifecycle for Episodic Nodes** (Source, Artifact):
- Include: `state`, `salience`, `access_count`, `last_accessed_at`, `ttl_policy`
- Include: `recall_frequency`, `last_recall_interval`, `decay_gradient` (for spacing effect)
- These nodes participate in full decay mechanics despite being episodic

### Candidate Semantics (Confidence + State Interaction)

**How confidence affects decay** (candidates only):

- **state = candidate** & **confidence >= 0.8**: High confidence candidate
  - No decay until first retrieval
  - Persists indefinitely (tentative but likely real)
  - Purpose: High-certainty extractions don't fade until validated by use
  - Once retrieved → state becomes `active`, normal decay applies

- **state = candidate** & **confidence < 0.8**: Low confidence candidate
  - Accelerated decay based on confidence score
  - Formula: `decay_rate = base_decay_rate × (1 + (1 - confidence) × 2)`
  - Example (confidence = 0.4): decay_rate = 0.02 × 2.2 = 0.044 (2.2× faster)
  - Example (confidence = 0.7): decay_rate = 0.02 × 1.6 = 0.032 (1.6× faster)
  - Purpose: Uncertain extractions fade quickly if never confirmed through retrieval

- **state = active/core/archived**: Confidence no longer affects decay (only relevant for candidates)

**Offline/Nightly Decay Job**:
```
For all nodes with salience > 0:
1. days = days_since(last_accessed_at or created_at)
2. Calculate dynamic decay rate incorporating recall frequency AND confidence:
   base_decay_rate = 0.02 / (1 + recall_frequency^decay_gradient)

   // Apply confidence penalty for low-confidence candidates
   if (state === 'candidate' && confidence < 0.8):
     confidence_penalty = 1 + (1 - confidence) * 2  // 0.4 conf → 2.2x faster, 0.7 conf → 1.6x faster
     decay_rate = base_decay_rate * confidence_penalty
   else if (state === 'candidate' && confidence >= 0.8):
     decay_rate = 0  // No decay for high-confidence candidates until accessed
   else:
     decay_rate = base_decay_rate  // Normal decay for active/core/archived

3. salience *= exp(-decay_rate * days)
4. Update spacing effect:
   - If recalled: calculate new_interval = days_since_last_recall
   - If new_interval > last_recall_interval: decay_gradient += 0.1 (slower forgetting)
   - If new_interval < last_recall_interval: decay_gradient -= 0.05 (faster forgetting)
   - last_recall_interval = new_interval
5. If salience < 0.01: state = 'archived' (optional governance)
```

**Nightly Description Consolidation** (semantic nodes and relationships):
```
For all Person, Concept, Entity nodes with is_dirty = true:
1. Gather current description + all notes (sorted by date_added)
2. LLM synthesizes updated description incorporating new notes:
   - Person: Short description of who they are (appearance, role, context)
   - Concept: 1-sentence overview of most important information
   - Entity: Short overview of most important information
3. Update description field with new synthesized version
4. Regenerate embedding from updated description + notes
5. Set is_dirty = false
6. Update updated_at timestamp

For all relationships with is_dirty = true:
1. Gather current description + all notes (sorted by date_added)
2. LLM synthesizes updated description incorporating new notes:
   - 1-sentence overview of the relationship nature and key details
3. Update description field with new synthesized version
4. Regenerate notes_embedding from concatenated notes (max 1000 chars)
5. Optionally update relation_embedding if relationship_type, attitude, or proximity changed
6. Set is_dirty = false
7. Update updated_at timestamp

When is_dirty gets set:
- During ingestion when notes array is appended to (Step 4: Relationship Agent using add_note_* tools)
- When relationship description is updated via update_relationship tool
- Manually when user edits notes through UI

Benefits:
- Descriptions stay current without blocking real-time ingestion
- Notes accumulate throughout the day, consolidated overnight
- Embeddings stay fresh for semantic search (nodes only)
- Mimics human memory consolidation (processing during sleep)
```

**Nightly Note Cleanup** (remove expired notes):
```cypher
// Run nightly at 4am - cleanup expired notes from all nodes and relationships
MATCH (n)
WHERE n.notes IS NOT NULL
WITH n, [note IN n.notes
  WHERE note.expires_at IS NULL
  OR note.expires_at > datetime()] AS validNotes
WHERE size(validNotes) < size(n.notes)
SET n.notes = validNotes, n.updated_at = datetime()
```

**Purpose**:
- Removes notes where `expires_at` timestamp has passed
- Keeps notes with `expires_at = null` (lifetime: "forever")
- Automatic cleanup ensures notes don't accumulate indefinitely
- Runs after description consolidation (which uses all notes before cleanup)

**Cost**: Negligible (simple property filtering, no LLM calls)

---

### Nightly Consolidation Cost Estimates

**Assumptions** (per 1000 active users):
- Average nodes per user: 50 semantic nodes (Person + Concept + Entity)
- Average relationships per user: 30 relationships
- Dirty rate: 20% of nodes updated daily (10 nodes/user)
- Relationship dirty rate: 15% (4.5 relationships/user)
- Model: gpt-4.1-mini ($0.075/1M input, $0.30/1M output)
- Only consolidate nodes accessed in last 7 days (reduces scope by 60%)

**Node Description Consolidation**:
- Eligible nodes/night: 1000 users × 10 dirty nodes × 40% (recent access) = 4000 nodes
- Tokens per node: ~200 input (description + notes) + 100 output (new description) = 300 tokens
- Total tokens: 4000 × 300 = 1.2M tokens
- Cost: (1.2M × 0.67 input + 0.33 output ratio) × $0.15/1M avg = **~$0.18/night** = **$5.40/month**

**Relationship Description Consolidation**:
- Eligible relationships/night: 1000 users × 4.5 dirty × 40% (recent access) = 1800 relationships
- Tokens per relationship: ~150 input + 50 output = 200 tokens
- Total tokens: 1800 × 200 = 360k tokens
- Cost: 360k × $0.15/1M avg = **~$0.05/night** = **$1.50/month**

**Embedding Regeneration**:
- Nodes: 4000 nodes × 1536 dims × $0.00001/1k dims = **$0.06/night** = **$1.80/month**
- Relationships (notes only): 1800 × 1536 dims × $0.00001/1k dims = **~$0.03/night** = **$0.90/month**

**Total Nightly Consolidation Cost**: **$9.60/month** (for 1000 users)

**Per-User Cost**: **$0.0096/month** (~$0.12/year per user)

**Cost Optimization Strategies**:
1. **Recent access filtering** (implemented above): Only consolidate nodes accessed in last 7 days
2. **Use gpt-4.1-nano for simple consolidations**: If notes < 3, use nano (~4x cheaper)
3. **Batch multiple notes together**: Consolidate 5-10 notes in single call (reduces overhead)
4. **Skip re-embedding if description unchanged**: Compare old/new description, skip embedding if identical
5. **Lazy consolidation**: Only consolidate on next access instead of nightly (trades freshness for cost)

With these optimizations, cost can be reduced to **~$3-5/month** (for 1000 users).

**Decay Formula with Recall Frequency:**
```
decay_rate = base_rate / (1 + recall_frequency^decay_gradient)
salience_t = salience_0 * exp(-decay_rate * days_unused)

where:
- base_rate = 0.02 (default decay constant)
- recall_frequency = number of times node was retrieved
- decay_gradient = 1.0 initially, increases with spacing effect
- Spacing effect: memories recalled at longer intervals retain better

Examples (recall_frequency=0, decay_gradient=1.0):
- After 35 days unused: salience × 0.5 (half-life)
- After 70 days unused: salience × 0.25
- After 105 days unused: salience × 0.125

Examples (recall_frequency=5, decay_gradient=1.5):
- decay_rate = 0.02 / (1 + 5^1.5) ≈ 0.0015 (much slower decay)
- After 35 days: salience × 0.95 (minimal decay)
- After 70 days: salience × 0.90
- Frequently recalled memories become highly resistant to forgetting

Examples with confidence (candidates only):
- state=candidate, confidence=0.5, recall_frequency=0:
  - base_decay_rate = 0.02
  - confidence_penalty = 1 + (1 - 0.5) × 2 = 2.0
  - decay_rate = 0.02 × 2.0 = 0.04 (2x faster decay)
  - After 17 days unused: salience × 0.5 (half-life cut in half)
  - After 35 days unused: salience × 0.25 (archives quickly)

- state=candidate, confidence=0.85, recall_frequency=0:
  - decay_rate = 0 (no decay for high-confidence candidates)
  - Node persists indefinitely until first access
  - After first access: state → active, normal decay applies

- state=active, confidence=0.4, recall_frequency=0:
  - Confidence no longer matters (only affects candidates)
  - decay_rate = 0.02 (normal decay)
  - After 35 days: salience × 0.5 (standard half-life)
```

**Initial Values** (when node is created):
- salience: 0.5 (starts neutral, can go up or down)
- state: 'candidate' (promoted to 'active' after first retrieval, 'core' after 10+ retrievals)
- confidence: <set by extraction agent> (0-1, based on context and certainty)
- access_count: 0
- recall_frequency: 0
- last_recall_interval: 0
- decay_gradient: 1.0
- last_accessed_at: null

### Memory Consolidation (Episodic → Semantic)

Over time, episodic memory consolidates into semantic knowledge, mimicking human memory processes during sleep:

**Consolidation triggers:**
- Source older than 7 days with salience < 0.2
- Multiple sources (5+) with overlapping entities
- Source with high access_count but low salience (frequently referenced detail)

**Consolidation process:**
1. **Identify consolidation candidates**: Cluster related sources by temporal proximity, shared entities, semantic similarity
2. **Extract insights**: LLM generates semantic summaries from source clusters
3. **Update semantic nodes**: Append extracted insights to Person/Concept/Entity notes, or create new semantic facts
4. **Preserve provenance**: Maintain links from semantic nodes to original sources
5. **Archive sources**: Mark consolidated sources as `state: 'archived'` (still retrievable but excluded from default search)

**Benefits:**
- Reduces graph size 40-60% over time
- Faster semantic queries (smaller search space)
- Preserves drill-down capability: "Show me the original conversation about X"
- Mirrors human memory: specific experiences become generalized knowledge

### State Transitions

See [Memory Lifecycle](#memory-lifecycle-state-transitions) section above for complete state flow and transition rules.

### Access Pattern Examples

**High-frequency topic** (accessed every 3 days):
- Salience quickly rises to 1.0 and stays there
- access_count grows rapidly
- state: 'candidate' → 'active' (first access) → 'core' (10+ accesses, ~30 days)

**One-off mention** (never retrieved):
- Salience decays from 0.5 → 0.25 in 35 days
- access_count remains 0
- state: 'candidate' → 'archived' after 100 days (salience < 0.01)

**Seasonal topic** (accessed in bursts):
- Salience spikes during usage, decays between
- Maintains moderate baseline (0.3-0.6)
- state: 'active' with cyclical salience

**Low-confidence candidate** (confidence=0.4, never accessed):
- Accelerated decay: salience 0.5 → 0.25 in ~17 days (2x faster)
- state: 'candidate' → 'archived' after ~50 days (salience < 0.01)
- Purpose: Tentative extractions fade quickly if never confirmed

**High-confidence candidate** (confidence=0.9, never accessed):
- No decay while in candidate state
- Persists indefinitely until first retrieval
- state: 'candidate' → 'active' on first access, then normal decay applies
- Purpose: High-certainty extractions don't fade until validated by use

### Governance Hooks

Governance policies control node lifecycle independent of salience decay.

#### TTL Policy Table

**Policy precedence** (highest to lowest):

| ttl_policy | Behavior | Use for |
|------------|----------|---------|
| `keep_forever` | No decay, never archived, salience stays 1.0 | Owner node, key Macros, permanent facts |
| `ephemeral` | Hard expiry (30d episodic / 90d semantic), archival guaranteed | Strictly short-lived data |
| `decay` (default) | Salience-based decay only, archives when salience < 0.01 | Most memories |

**Conflict Resolution**: Highest precedence wins. Examples:
- `keep_forever` + low salience → keep_forever wins, salience stays 1.0
- `ephemeral` + high salience → ephemeral wins, archives at deadline despite high salience

#### Sensitivity Field (Access Control Only)

- **Field**: `sensitivity: enum (low | normal | high)` - defaults to `normal`
- **Scope**: Episodic nodes only (Source, Artifact)
- **Does NOT affect decay behavior** - purely a governance flag for permissions/access control
- **Use cases**: audit trails, privacy controls, data classification
- Semantic nodes (Person/Concept/Entity) do NOT have sensitivity field

**Raw Data Preservation** (Episodic nodes):
- Source node `raw_content` field preserves unprocessed data indefinitely
- Persists even if Source is archived (state: 'archived')
- Independent of ttl_policy and salience

**Note Retention:**
- Each note in the `notes` array (on both nodes and relationships) has its own `expires_at` timestamp
- Notes with `expires_at` in the past are automatically deleted during nightly cleanup
- Notes with `expires_at = null` (lifetime: "forever") are never deleted
- Agent chooses lifetime based on information relevance:
  - "week" for transient details (temporary situations, short-term plans)
  - "month" for typical contextual information (default)
  - "year" for long-term relevant details (major life events, ongoing projects)
  - "forever" for foundational facts (core personality traits, permanent relationships)

---

## Retrieval Granularity Controls

The hierarchical memory system enables the agent to retrieve context at three different granularities, trading detail for breadth. See [hierarchical-memory.md](./hierarchical-memory.md) for complete retrieval query patterns.

### Granularity Levels

**Granularity 1: Micro (Source-level)**
- **What it returns**: Individual Sources with full processed content, relationships, entities
- **Use case**: Agent needs specific conversation details, quotes, or complete context
- **Cost per query**: Moderate (returns full content + neighbor traversal)
- **Example**: "Show me the conversation where I discussed the Google job offer on Jan 5th"

**Granularity 2: Meso (Storyline-level)**
- **What it returns**: Storyline summaries (2-3 sentences) with Source metadata (summary, date, context_type)
- **Use case**: Agent needs thematic overview without diving into individual conversations
- **Cost per query**: Low (returns summaries only, not full content)
- **Example**: "What's been happening with the Google job situation?"
- **Drill-down**: Agent can request specific Sources from Storyline if more detail needed

**Granularity 3: Macro (Theme-level)**
- **What it returns**: Macro overviews (2-4 sentences) with Storyline metadata (one-liner, date range, source count)
- **Use case**: Agent needs highest-level view of major themes
- **Cost per query**: Very low (returns overviews + metadata, no individual sources)
- **Example**: "What are the main things happening in my life?"
- **Drill-down**: Agent can request specific Storylines or Sources if more detail needed

### Retrieval Flow Examples

**Granularity Selection Guide**:

| User Question | Suggested Granularity | Why |
|---------------|----------------------|-----|
| "What's been going on lately?" | 3 (Macro) | High-level life themes |
| "How's the Google job going?" | 2 (Storyline) | Single ongoing storyline |
| "What did I say about compensation?" | 1 (Source) | Needs exact wording |
| "What are the big work things this week?" | 2 then 1 as needed | Overview then drill-down |

**Agent Pattern**: The agent may start at higher granularity and drill down when details are needed. For example:
1. Query "job situation" at granularity 3 → finds "Google" Macro + "Job Search" Macro
2. Decide "Google" is more relevant → drill to granularity 2
3. Read most recent Storyline
4. If needs salary details → drill to granularity 1 for specific Sources

### Implementation Notes

**Search Strategy**:
- Each granularity searches over different embeddings:
  - Granularity 1: Source.embedding (from summary)
  - Granularity 2: Storyline.embedding (from description)
  - Granularity 3: Macro.embedding (from overview)

**Agent Tool Parameter**:
```typescript
explore({
  queries: [{query: "Google job situation", threshold: 0.8}],
  granularity: 2,  // 1=micro, 2=meso, 3=macro (default: 1)
  mode: "fast"
})
```

**Hybrid Retrieval**:
- Default retrieve at granularity 1 (Sources) + semantic nodes (Person/Concept/Entity)
- Returns both episodic (Sources) and semantic (entities with relationships) context
- Granularity can be explicitly specified in the `explore()` call (1=micro, 2=meso, 3=macro)
