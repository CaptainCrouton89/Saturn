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

**Step 1.5: Intelligent Entity Resolution** (NEW):

For each extracted entity, determine if it's new or matches an existing node through multi-tier matching:

```typescript
// Step 1: Generate embeddings for all extracted entities
const entityEmbeddings = await Promise.all(
  entities.map(async (entity) => {
    const embeddingInput = `${entity.name} (${entity.entity_type})\n${(entity.subpoints || []).join('\n')}`
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: embeddingInput
    })
    return { entity, embedding: embedding.data[0].embedding }
  })
)

// Step 2: Multi-tier candidate search for each entity
const resolvedEntities = await Promise.all(
  entityEmbeddings.map(async ({ entity, embedding }) => {
    // 2a. Exact name + type match
    const exactMatches = await neo4j.run(`
      MATCH (n {user_id: $userId, entity_type: $entityType})
      WHERE n.name = $name OR n.canonical_name = $canonical_name
      RETURN n.entity_key AS entity_key, n.name AS name, n.description AS description
      LIMIT 5
    `, {
      userId,
      entityType: entity.entity_type,
      name: entity.name,
      canonical_name: entity.canonical_name
    })

    // 2b. Fuzzy name match (for typos/variations)
    const fuzzyMatches = await neo4j.run(`
      MATCH (n {user_id: $userId, entity_type: $entityType})
      WHERE apoc.text.distance(n.name, $name) < 3  // Levenshtein distance < 3
      RETURN n.entity_key AS entity_key, n.name AS name, n.description AS description,
             apoc.text.distance(n.name, $name) AS distance
      ORDER BY distance ASC
      LIMIT 5
    `, {
      userId,
      entityType: entity.entity_type,
      name: entity.name
    })

    // 2c. Embedding similarity search (top-K=20 nearest neighbors of subpoints)
    const similarityMatches = await neo4j.run(`
      MATCH (n {user_id: $userId, entity_type: $entityType})
      WHERE n.embedding IS NOT NULL
      WITH n, gds.similarity.cosine(n.embedding, $embedding) AS score
      WHERE score > 0.75
      RETURN n.entity_key AS entity_key, n.name AS name, n.description AS description, score
      ORDER BY score DESC
      LIMIT 20
    `, {
      userId,
      entityType: entity.entity_type,
      embedding
    })

    // Deduplicate and collect candidates (max 20)
    const candidateSet = new Map()
    ;[...exactMatches, ...fuzzyMatches, ...similarityMatches].forEach(c => {
      if (!candidateSet.has(c.entity_key)) {
        candidateSet.set(c.entity_key, c)
      }
    })
    const candidates = Array.from(candidateSet.values()).slice(0, 20)

    // Step 3: LLM-based resolution (LLM as arbiter)
    const resolutionModel = new ChatOpenAI({ modelName: 'gpt-4.1-mini' })
      .withStructuredOutput(EntityResolutionSchema)

    const resolution = await resolutionModel.invoke([
      new SystemMessage(ENTITY_RESOLUTION_SYSTEM_PROMPT),
      new HumanMessage(`
        ## Extracted Entity
        Name: ${entity.name}
        Type: ${entity.entity_type}
        Description: ${entity.description}
        Subpoints: ${(entity.subpoints || []).join('\n')}

        ## Candidate Nodes (0-20)
        ${candidates.map(c => `
        - entity_key: ${c.entity_key}
          name: ${c.name}
          description: ${c.description || 'N/A'}
        `).join('\n')}

        ## Task
        Determine if the extracted entity matches any existing node. Return { resolved: true, entity_key: "...", reason: "..." } if match found, or { resolved: false, reason: "..." } if new entity.
      `)
    ])

    return {
      ...entity,
      embedding,
      resolved: resolution.resolved,
      entity_key: resolution.entity_key,
      resolution_reason: resolution.reason,
      candidates
    }
  })
)
```

**Resolution Schema** (Zod):
```typescript
const EntityResolutionSchema = z.object({
  resolved: z.boolean().describe('Whether extracted entity matches existing node'),
  entity_key: z.string().optional().describe('entity_key if resolved=true'),
  reason: z.string().describe('Explanation of resolution decision')
})
```

**Step 2: Update Path (for resolved entities)**:

For entities marked as `resolved=true`, use agent-based update with additive notes:

```typescript
for (const entity of resolvedEntities.filter(e => e.resolved)) {
  // Load existing node with all context
  const existingNode = await neo4j.run(`
    MATCH (n {entity_key: $entity_key})
    WITH n,
         [(n)-[r:related_to|:associated_with|:mentioned_in]-(m) |
          {name: m.name, description: m.description, notes: m.notes}] AS neighbors
    RETURN n {.*, description: coalesce(n.description, ''), notes: coalesce(n.notes, [])} AS node,
           neighbors
  `, { entity_key: entity.entity_key })

  // Agent with access only to update tools
  const updateAgent = new ChatOpenAI({ modelName: 'gpt-4.1-mini' })
  const updateMessages = [
    new SystemMessage(NODE_UPDATE_SYSTEM_PROMPT),
    new HumanMessage(`
      ## Existing Node
      ${JSON.stringify(existingNode.node, null, 2)}

      ## Connected Nodes
      ${JSON.stringify(existingNode.neighbors, null, 2)}

      ## New Information
      ${entity.description}

      ## Task
      Update node and relationships additively (favor adding notes over rewriting). Only use update_node and update_edge tools.
    `)
  ]

  await updateAgent.invoke(updateMessages, { tools: [updateNodeTool, updateEdgeTool] })

  // Regenerate embeddings for updated node
  await regenerateNodeEmbeddings(entity.entity_key)
}
```

**Step 3: New Node Path (for new entities)**:

For entities marked as `resolved=false`, create new node with neighbor-aware edge creation:

```typescript
for (const entity of resolvedEntities.filter(e => !e.resolved)) {
  // Structured extraction for new node
  const extractionModel = new ChatOpenAI({ modelName: 'gpt-4.1-mini' })
    .withStructuredOutput(NewEntitySchema)

  const newEntity = await extractionModel.invoke([
    new SystemMessage(NEW_ENTITY_EXTRACTION_PROMPT),
    new HumanMessage(`
      Name: ${entity.name}
      Type: ${entity.entity_type}
      Context: ${entity.description}
    `)
  ])

  // Create node with embedding
  const nodeEmbedding = await generateNodeEmbedding(
    `${newEntity.name}\n${newEntity.description}\n${(newEntity.notes || []).join('\n')}`
  )

  const newNodeKey = await neo4j.run(`
    CREATE (n {
      entity_key: $entity_key,
      name: $name,
      description: $description,
      notes: $notes,
      entity_type: $entity_type,
      user_id: $user_id,
      embedding: $embedding,
      created_at: datetime(),
      confidence: $confidence,
      salience: 0.5,
      state: 'candidate'
    })
    RETURN n.entity_key
  `, {
    entity_key: uuidv4(),
    name: newEntity.name,
    description: newEntity.description,
    notes: newEntity.notes || [],
    entity_type: entity.entity_type,
    user_id: userId,
    embedding: nodeEmbedding,
    confidence: entity.confidence
  })

  // Find top-K neighbors for edge creation context
  const neighbors = await neo4j.run(`
    MATCH (n {user_id: $user_id, entity_type: $entity_type})
    WHERE n.embedding IS NOT NULL AND n.entity_key <> $new_entity_key
    WITH n, gds.similarity.cosine(n.embedding, $embedding) AS score
    WHERE score > 0.6
    RETURN n {.entity_key, .name, .description, .notes} AS node, score
    ORDER BY score DESC
    LIMIT 5
  `, {
    user_id: userId,
    entity_type: entity.entity_type,
    new_entity_key: newNodeKey,
    embedding: nodeEmbedding
  })

  // Agent with access to create/relate tools
  const createAgent = new ChatOpenAI({ modelName: 'gpt-4.1-mini' })
  const createMessages = [
    new SystemMessage(NODE_CREATION_SYSTEM_PROMPT),
    new HumanMessage(`
      ## New Node
      Name: ${newEntity.name}
      Type: ${entity.entity_type}
      Description: ${newEntity.description}

      ## Similar Neighbors (consider creating edges)
      ${neighbors.map(n => `
      - ${n.node.name} (similarity: ${(n.score * 100).toFixed(0)}%)
        Description: ${n.node.description}
        Notes: ${n.node.notes?.join('; ') || 'N/A'}
      `).join('\n')}

      ## Original Source Content
      ${source.content.substring(0, 1000)}...

      ## Task
      Create edges between this node and similar neighbors if semantically related. Only use create_relationship and add_note_to_relationship tools.
    `)
  ]

  await createAgent.invoke(createMessages, { tools: [createRelationshipTool, addNoteToRelationshipTool] })
}
```

**Cost & Performance**:
- Embeddings: ~$0.005 per entity (small batch)
- LLM Resolution: ~$0.001 per entity (gpt-4.1-mini structured output)
- Update/Create Agents: ~$0.002-0.003 per entity
- **Total**: ~$0.01 per entity (vs. $0.03 per source in Phase 2 Agent step)

**Step 4: Entity Persistence via MERGE** (fallback for unhandled entities):

Note: For resolved entities, node updates are handled in Step 2. For new entities, nodes are created in Step 3. This step handles any additional MERGE logic for entity type-specific properties:

```cypher
// Concept nodes - ensure consistent properties
UNWIND $unresolvedNewConcepts AS concept
MERGE (c:Concept {name: concept.name, user_id: $userId})
ON MATCH SET
  c.updated_at = datetime()
RETURN c.entity_key

// Entity nodes - ensure consistent properties
UNWIND $unresolvedNewEntities AS entity
MERGE (e:Entity {name: entity.name, user_id: $userId})
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

**Step 5: Create Source [mentions] relationships**:
```cypher
// Link Source to all extracted entities
MATCH (s:Source {entity_key: $sourceEntityKey})
UNWIND $entityKeys AS entityKey
MATCH (n {entity_key: entityKey})
MERGE (s)-[:mentions]->(n)
```

**Step 5.5: Update hierarchical memory counters** (automatic):
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

**Step 6: Agent-based semantic updates** (see `phase3-4.ts` patterns):

Note: This step is now supplementary. Primary agent-based updates occur in Step 2 (update path) and Step 3 (new node path) during entity resolution. This step handles additional relationship refinement if needed:
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

**Step 6.5: Attach Source to existing Storylines** (if applicable):

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

**Step 7: Update Source node status**:
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
