# Hierarchical Memory (Meso/Macro Nodes)

> **Related Documentation**:
> - [architecture.md](./architecture.md) - Memory architecture overview
> - [nodes/person.md](./nodes/person.md), [nodes/concept.md](./nodes/concept.md), [nodes/entity.md](./nodes/entity.md) - Semantic nodes
> - [nodes/source.md](./nodes/source.md) - Episodic Source nodes
> - [ingestion-pipeline.md](./ingestion-pipeline.md) - How Sources are created
> - [decay.md](./decay.md) - Storyline/Macro decay mechanics

## Overview

This document describes the **meso-level** (Storyline) and **macro-level** (Macro) memory nodes that provide aggregated views over collections of Sources and semantic entities. These nodes enable the agent to retrieve context at different granularities (micro/meso/macro) without expensive clustering operations.

**Design Philosophy**:
- **Living aggregations, not snapshots**: Storylines/Macros continuously accumulate new Sources/Storylines as they arrive
- **Incremental at ingest**: New Sources attach to existing Storylines (if match found), update counters, set `is_dirty = true`
- **Batch consolidation**: Nightly/weekly jobs re-summarize dirty storylines/macros using recent children
- **Self-pruning**: Uses existing salience/decay machinery to archive stale storylines/macros
- **Anchored to semantics**: Every Storyline/Macro connects to one or more Person/Concept/Entity nodes
- **User-scoped aggregations**: Each user has their own Storylines/Macros based on their personal semantic graph (not shared across users)

**Scoping Semantics**:
- **Storylines/Macros are user-scoped**: Each user maintains their own hierarchical aggregations
- **team_id is metadata only**: Inherited from Sources for contextual filtering, not for ownership
- **Anchor nodes are user-scoped**: Storylines/Macros always reference the user's own Person/Concept/Entity nodes
- **Example**: Alice and Bob can both have "Google – storyline" nodes, each anchored to their own Entity:Google node with different Sources

**team_id Inheritance Rules**:

| Source Type | Storyline/Macro team_id | Rule |
|-------------|-------------------------|------|
| Team-scoped Sources (team_id set) | Inherits that team_id | Storyline/Macro visible to team members |
| Personal Sources (team_id = null) | `null` | Storyline/Macro visible only to owner |
| Mixed (some team, some personal) | Majority team_id or `null` | If >50% Sources are team-scoped, inherit team_id; else null |

**Access Control**:
- Personal Storylines/Macros (team_id = null): Only accessible to `user_id`
- Team Storylines/Macros (team_id set): Accessible to all team members + creator
- Query filter: `WHERE (n.team_id IS NULL AND n.user_id = $userId) OR n.team_id IN $userTeams`

**Cost Target**: ~$0.30/month for 1000 Sources ingested (negligible compared to extraction pipeline costs)

---

## Memory Hierarchy

```
Macro (long-running themes, 30+ days, 2+ storylines)
  └─> groups
        └─> Storyline (coherent blocks, 5+ sources, 3+ days)
              └─> includes
                    └─> Source (individual conversations/events)
                          └─> mentions
                                └─> Person/Concept/Entity (semantic anchors)
```

**Retrieval Granularity**:
- **Granularity 1 (micro)**: Individual Sources with full content and neighbor context (current default)
- **Granularity 2 (meso)**: Storyline summaries with 5-20 Source metadata previews
- **Granularity 3 (macro)**: Macro overviews with Storyline metadata (no individual Sources)

---

## Meso-Level Memory: Storyline Nodes

**Storyline**: Represents a coherent block of activity around a specific entity or topic (5+ Sources across 3+ days).

### Properties

**Identity**:
- **storyline_id**: string (UUID - stable identifier)
- **user_id**: string (always set - identifies which user this Storyline belongs to)
- **team_id**: string | null (metadata inherited from Sources - null = personal arc visible only to owner, non-null = team arc visible to team members)
- **anchor_entity_key**: string (entity_key of the Person/Concept/Entity this storyline is about - references user's semantic node)

**Content**:
- **name**: string (derived from anchor name + " – storyline", can be updated)
- **description**: string (2-3 sentence LLM-generated summary of the storyline arc)
- **embedding**: vector (built from description using text-embedding-3-small)
- **is_dirty**: boolean (default false) - set to true when new Sources added, triggers nightly re-summarization

**Metadata**:
- **source_count**: int (number of Sources included in this storyline)
- **started_at**: ISO timestamp (earliest Source in storyline)
- **last_source_at**: ISO timestamp (most recent Source in storyline)

**Memory Management**:
- **salience**: float (0-1) - inherited from anchor node initially, then decays independently
- **state**: enum (candidate | active | core | archived) - starts as 'active'
- **ttl_policy**: enum (keep_forever | decay | ephemeral) - **default: decay** (Storylines can eventually archive when salience drops and they're no longer accessed)
- **access_count**: int
- **last_accessed_at**: ISO timestamp
- **recall_frequency**: int
- **last_recall_interval**: int (days)
- **decay_gradient**: float (default 1.0)

**Lifecycle**:
- **created_at**: ISO timestamp
- **updated_at**: ISO timestamp

### Relationships

- **(Storyline)-[:about]->(Person|Concept|Entity)** - anchored to semantic node (1:1 per user, set at creation)
- **(Storyline)-[:includes]->(Source)** - contains these Sources (1:many, accumulated over time)

### Lifecycle: Initial Promotion (Nightly Job)

**When**: Nightly at 3am, checks if any anchors have crossed promotion threshold

**Step 1: Find Candidates**

```cypher
// Find semantic nodes that have accumulated enough activity
MATCH (n)
WHERE (n:Person OR n:Concept OR n:Entity)
  AND n.source_count >= 5                              // At least 5 Sources
  AND n.state IN ['active', 'core']                     // Ignore archived/candidate junk
  AND n.distinct_source_days >= 3                       // Across at least 3 days
  AND datetime() - n.first_mentioned_at > duration('P3D') // Spanning at least 3 days
  AND coalesce(n.has_meso, false) = false               // No storyline yet
RETURN n
ORDER BY n.source_count DESC
LIMIT 100
```

**Tunable Thresholds** (start with these, adjust based on usage):
- `source_count >= 5`: Prevents one-off mentions from promoting
- `distinct_source_days >= 3`: Ensures activity isn't all in one afternoon
- `timespan >= 3 days`: Ensures longitudinal engagement
- `state IN ['active', 'core']`: Only promote nodes that have survived initial decay

**Step 2: Create Storyline Node**

```cypher
// For each candidate anchor n, create Storyline
CREATE (st:Storyline {
  storyline_id: randomUUID(),
  user_id: $userId,
  team_id: $teamId,
  anchor_entity_key: $anchorEntityKey,
  name: $anchorName + ' – storyline',
  description: '',  // To be filled by LLM
  embedding: null,  // To be filled after description

  source_count: 0,
  started_at: $firstMentionedAt,
  last_source_at: $lastMentionedAt,

  salience: $anchorSalience,
  state: 'active',
  ttl_policy: 'decay',
  access_count: 0,
  last_accessed_at: null,
  recall_frequency: 0,
  last_recall_interval: 0,
  decay_gradient: 1.0,

  created_at: datetime(),
  updated_at: datetime()
})

// Link to anchor
MATCH (n {entity_key: $anchorEntityKey})
CREATE (st)-[:about]->(n)
SET n.has_meso = true

RETURN st.storyline_id
```

**Step 3: Attach Existing Sources**

```cypher
// Link all Sources that mention this anchor to the new Storyline
MATCH (n {entity_key: $anchorEntityKey})<-[:mentions]-(s:Source)
MATCH (st:Storyline {storyline_id: $storylineId})
MERGE (st)-[:includes]->(s)
WITH st, s
ORDER BY s.started_at ASC

// Update Storyline metadata
WITH st, collect(s) AS sources
SET
  st.source_count = size(sources),
  st.started_at = sources[0].started_at,
  st.last_source_at = sources[-1].started_at,
  st.updated_at = datetime()
```

**Step 4: Generate LLM Summary**

```typescript
// Gather recent Source summaries (limit to 20 most recent for cost efficiency)
const sourceSummaries = await neo4j.run(`
  MATCH (st:Storyline {storyline_id: $storylineId})-[:includes]->(s:Source)
  RETURN s.summary AS summary, s.started_at AS date
  ORDER BY s.started_at DESC
  LIMIT 20
`, { storylineId });

// Generate 2-3 sentence storyline summary
const model = new ChatOpenAI({ modelName: 'gpt-4.1-mini' });
const storylineDescription = await model.invoke([
  new SystemMessage(
    "You are summarizing a storyline from conversation history. " +
    "Write 2-3 sentences describing the arc and current status. " +
    "Be specific and focus on the narrative thread connecting these events."
  ),
  new HumanMessage(`
    Entity: ${anchorName}
    Type: ${anchorType}

    Recent events (chronological):
    ${sourceSummaries.map(s => `- ${s.date}: ${s.summary}`).join('\n')}

    Summarize this storyline in 2-3 sentences.
  `)
]);

// Generate embedding
const embedding = await openai.embeddings.create({
  model: "text-embedding-3-small",
  input: storylineDescription
});

// Store description and embedding
await neo4j.run(`
  MATCH (st:Storyline {storyline_id: $storylineId})
  SET st.description = $description,
      st.embedding = $embedding,
      st.updated_at = datetime()
`, {
  storylineId,
  description: storylineDescription,
  embedding: embedding.data[0].embedding
});
```

**Cost Estimate**: ~100 storylines/night × 200 tokens/call = ~$0.01/night (one-time per storyline creation)

### Lifecycle: Incremental Attachment (Per-Source Ingestion)

**When**: During Phase 2 extraction, after creating `Source -[:mentions]-> anchor` relationships

**Purpose**: Attach new Sources to existing Storylines without waiting for nightly jobs

**Logic**:
```cypher
// For each anchor n mentioned in the new Source s
MATCH (n {entity_key: $anchorKey})
WHERE n.has_meso = true  // Storyline already exists

// Find active Storylines for this anchor (usually 0-3)
MATCH (n)<-[:about]-(st:Storyline)
WHERE st.state IN ['active', 'core']
  AND st.last_source_at > datetime() - duration('P90D')  // Only recent storylines
ORDER BY st.last_source_at DESC
LIMIT 3

// Return candidate storylines for matching in application layer
RETURN st
```

**Matching Logic** (application layer):
1. If no Storylines found → do nothing (nightly job will promote if thresholds met)
2. If 1 Storyline found → attach Source to it
3. If 2+ Storylines found:
   - Check temporal proximity: Source.started_at within 30 days of st.last_source_at?
   - Check semantic similarity: cos_sim(Source.embedding, st.embedding) > 0.7?
   - Attach to best match, or create no link if no good match

**Attachment**:
```cypher
// When match found, attach Source to Storyline
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
  st.is_dirty = true,          // Triggers nightly re-summarization
  st.updated_at = datetime()
```

**Cost**: Negligible (~$0.00001 per Source, no LLM calls)

**Note**: If Source doesn't attach to any existing Storyline, it still increments anchor counters and may trigger a new Storyline creation in the nightly promotion job.

### Lifecycle: Nightly Refresh (Re-Summarization)

**When**: Nightly at 3:30am (after initial promotion job), processes dirty storylines

**Purpose**: Update Storyline descriptions to reflect newly added Sources

**Logic**:
```cypher
// Find dirty storylines that need refresh
MATCH (st:Storyline)
WHERE st.is_dirty = true
  AND st.state IN ['active', 'core']
  AND st.last_source_at > datetime() - duration('P90D')  // Skip very old
RETURN st
ORDER BY st.source_count DESC  // Prioritize active storylines
LIMIT 100
```

**Process**:
```typescript
// For each dirty storyline
for (const storyline of dirtyStorylines) {
  // Gather recent Source summaries (sample of 10 most recent)
  const sources = await neo4j.run(`
    MATCH (st:Storyline {storyline_id: $storylineId})-[:includes]->(s:Source)
    RETURN s.summary AS summary, s.started_at AS date
    ORDER BY s.started_at DESC
    LIMIT 10
  `, { storylineId: storyline.storyline_id });

  // Generate updated summary
  const model = new ChatOpenAI({ modelName: 'gpt-4.1-mini' });
  const updatedDescription = await model.invoke([
    new SystemMessage(
      "You are updating a storyline summary with new events. " +
      "Keep it 2-3 sentences, incorporating the newest information while maintaining continuity."
    ),
    new HumanMessage(`
      ## Current Summary
      ${storyline.description}

      ## New Events (most recent first)
      ${sources.map(s => `- ${s.date}: ${s.summary}`).join('\n')}

      ## Task
      Update the storyline summary to reflect these new events. Keep it 2-3 sentences.
    `)
  ]);

  // Re-embed updated description
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: updatedDescription
  });

  // Update Storyline
  await neo4j.run(`
    MATCH (st:Storyline {storyline_id: $storylineId})
    SET st.description = $description,
        st.embedding = $embedding,
        st.is_dirty = false,
        st.updated_at = datetime()
  `, {
    storylineId: storyline.storyline_id,
    description: updatedDescription,
    embedding: embedding.data[0].embedding
  });
}
```

**Cost Estimate**: ~50 dirty storylines/night × 250 tokens/call = ~$0.006/night = ~$0.18/month

**Total Storyline Cost**: Initial creation (~$0.30/month) + nightly refresh (~$0.18/month) = **~$0.48/month**

---

## Macro-Level Memory: Macro Nodes

**Macro**: Represents a long-running theme or project spanning multiple Storylines (2+ Storylines, 30+ day span).

### Properties

**Identity**:
- **macro_id**: string (UUID - stable identifier)
- **user_id**: string (always set - identifies which user this Macro belongs to)
- **team_id**: string | null (metadata inherited from Sources - null = personal arc visible only to owner, non-null = team arc visible to team members)
- **anchor_entity_key**: string (entity_key of the Person/Concept/Entity this macro represents - references user's semantic node)

**Content**:
- **name**: string (derived from anchor name + " – macro", can be updated)
- **description**: string (2-4 sentence LLM-generated overview of the entire arc and current status)
- **embedding**: vector (built from description using text-embedding-3-small)
- **is_dirty**: boolean (default false) - set to true when new Sources/Storylines added, triggers weekly re-summarization

**Metadata**:
- **storyline_count**: int (number of Storylines grouped under this Macro)
- **total_source_count**: int (sum of source_count across all Storylines)
- **started_at**: ISO timestamp (earliest Storyline.started_at)
- **last_event_at**: ISO timestamp (latest Storyline.last_source_at)

**Memory Management**:
- **salience**: float (0-1) - inherited from anchor node initially
- **state**: enum (candidate | active | core | archived) - typically 'core' at creation
- **ttl_policy**: enum (keep_forever | decay | ephemeral) - **default: keep_forever** (Macros are long-lived and only archive if explicitly changed or manually archived)
- **access_count**: int
- **last_accessed_at**: ISO timestamp
- **recall_frequency**: int
- **last_recall_interval**: int (days)
- **decay_gradient**: float (default 1.0)

**Lifecycle**:
- **created_at**: ISO timestamp
- **updated_at**: ISO timestamp

### Relationships

- **(Macro)-[:rooted_in]->(Person|Concept|Entity)** - anchored to semantic node (1:1 per user, set at creation)
- **(Macro)-[:groups]->(Storyline)** - contains these Storylines (1:many)

### Lifecycle: Initial Promotion (Weekly Job)

**When**: Weekly on Sunday at 2am, checks if any anchors have multiple Storylines spanning 30+ days

**Step 1: Find Candidates**

```cypher
// Find semantic nodes with multiple active Storylines
MATCH (n)<-[:about]-(st:Storyline)
WHERE st.state IN ['active', 'core']
WITH n, collect(st) AS storylines, count(st) AS storylineCount
WHERE storylineCount >= 2                                       // At least 2 storylines
  AND datetime() - n.first_mentioned_at > duration('P30D')      // Spanning 30+ days
  AND coalesce(n.has_macro, false) = false                      // No macro yet
RETURN n, storylines
ORDER BY storylineCount DESC
LIMIT 50
```

**Step 2: Create Macro Node**

```cypher
// For each candidate anchor n with storylines sts
CREATE (m:Macro {
  macro_id: randomUUID(),
  user_id: $userId,
  team_id: $teamId,
  anchor_entity_key: $anchorEntityKey,
  name: $anchorName + ' – macro',
  description: '',  // To be filled by LLM
  embedding: null,  // To be filled after description

  storyline_count: size($storylineIds),
  total_source_count: $totalSourceCount,
  started_at: $earliestStorylineStart,
  last_event_at: $latestStorylineEnd,

  salience: $anchorSalience,
  state: 'core',
  ttl_policy: 'keep_forever',
  access_count: 0,
  last_accessed_at: null,
  recall_frequency: 0,
  last_recall_interval: 0,
  decay_gradient: 1.0,

  created_at: datetime(),
  updated_at: datetime()
})

// Link to anchor
MATCH (n {entity_key: $anchorEntityKey})
CREATE (m)-[:rooted_in]->(n)
SET n.has_macro = true

// Link to storylines
UNWIND $storylineIds AS storylineId
MATCH (st:Storyline {storyline_id: storylineId})
CREATE (m)-[:groups]->(st)

RETURN m.macro_id
```

**Step 3: Generate LLM Summary**

```typescript
// Gather Storyline descriptions (chronological order)
const storylineDescriptions = await neo4j.run(`
  MATCH (m:Macro {macro_id: $macroId})-[:groups]->(st:Storyline)
  RETURN st.description AS description,
         st.started_at AS start,
         st.last_source_at AS end,
         st.source_count AS sourceCount
  ORDER BY st.started_at ASC
`, { macroId });

// Generate 2-4 sentence macro overview
const model = new ChatOpenAI({ modelName: 'gpt-4.1-mini' });
const macroDescription = await model.invoke([
  new SystemMessage(
    "You are summarizing a long-running theme from conversation history. " +
    "Write 2-4 sentences describing the overall arc, key phases, and current status. " +
    "Focus on the big picture and how the storyline evolved over time."
  ),
  new HumanMessage(`
    Entity: ${anchorName}
    Type: ${anchorType}
    Time span: ${timeSpan}

    Storylines (chronological):
    ${storylineDescriptions.map(st =>
      `- ${st.start} to ${st.end} (${st.sourceCount} sources): ${st.description}`
    ).join('\n')}

    Write a 2-4 sentence overview of this macro-level arc.
  `)
]);

// Generate embedding
const embedding = await openai.embeddings.create({
  model: "text-embedding-3-small",
  input: macroDescription
});

// Store description and embedding
await neo4j.run(`
  MATCH (m:Macro {macro_id: $macroId})
  SET m.description = $description,
      m.embedding = $embedding,
      m.updated_at = datetime()
`, {
  macroId,
  description: macroDescription,
  embedding: embedding.data[0].embedding
});
```

**Cost Estimate**: ~20 macros/week × 300 tokens/call = ~$0.003/week (one-time per macro creation)

### Lifecycle: Incremental Update (Per-Source Ingestion)

**When**: During Phase 2 extraction, when new Sources attach to existing Storylines

**Purpose**: Keep Macro aggregate stats current without re-summarizing

**Logic**:
```cypher
// When Source s attaches to Storyline st, check if st belongs to a Macro
MATCH (st:Storyline {storyline_id: $storylineId})<-[:groups]-(m:Macro)
SET
  m.total_source_count = m.total_source_count + 1,
  m.last_event_at = CASE
    WHEN $sourceStartedAt > m.last_event_at
    THEN $sourceStartedAt
    ELSE m.last_event_at
  END,
  m.is_dirty = true,          // Triggers weekly re-summarization
  m.updated_at = datetime()
```

**Cost**: Negligible (~$0.00001 per Source, no LLM calls)

### Lifecycle: Weekly Refresh (Re-Summarization)

**When**: Weekly on Sunday at 2:30am (after initial promotion job), processes dirty macros

**Purpose**: Update Macro descriptions to reflect evolving storylines

**Logic**:
```cypher
// Find dirty macros that need refresh
MATCH (m:Macro)
WHERE m.is_dirty = true
  AND m.state IN ['active', 'core']
RETURN m
ORDER BY m.total_source_count DESC  // Prioritize active macros
LIMIT 50
```

**Process**:
```typescript
// For each dirty macro
for (const macro of dirtyMacros) {
  // Gather Storyline descriptions (chronological)
  const storylines = await neo4j.run(`
    MATCH (m:Macro {macro_id: $macroId})-[:groups]->(st:Storyline)
    WHERE st.state IN ['active', 'core']
    RETURN st.description AS description,
           st.started_at AS start,
           st.last_source_at AS end,
           st.source_count AS sourceCount
    ORDER BY st.started_at ASC
  `, { macroId: macro.macro_id });

  // Generate updated macro overview
  const model = new ChatOpenAI({ modelName: 'gpt-4.1-mini' });
  const updatedDescription = await model.invoke([
    new SystemMessage(
      "You are updating a macro-level summary of a long-running theme. " +
      "Keep it 2-4 sentences, describing the overall arc, key phases, and current status."
    ),
    new HumanMessage(`
      ## Current Overview
      ${macro.description}

      ## Storylines (chronological)
      ${storylines.map(st =>
        `- ${st.start} to ${st.end} (${st.sourceCount} sources): ${st.description}`
      ).join('\n')}

      ## Task
      Update the macro overview to reflect any new storyline developments. Keep it 2-4 sentences.
    `)
  ]);

  // Re-embed updated description
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: updatedDescription
  });

  // Update Macro
  await neo4j.run(`
    MATCH (m:Macro {macro_id: $macroId})
    SET m.description = $description,
        m.embedding = $embedding,
        m.storyline_count = $storylineCount,
        m.is_dirty = false,
        m.updated_at = datetime()
  `, {
    macroId: macro.macro_id,
    description: updatedDescription,
    embedding: embedding.data[0].embedding,
    storylineCount: storylines.length
  });
}
```

**Cost Estimate**: ~20 dirty macros/week × 350 tokens/call = ~$0.0035/week = ~$0.15/year

**Total Macro Cost**: Initial creation (~$0.15/year) + weekly refresh (~$0.15/year) = **~$0.30/year**

---

## Counter Properties on Semantic Nodes

To support promotion without per-Source LLM calls, the following lightweight counters are added to **Person**, **Concept**, and **Entity** nodes (see [nodes/person.md](./nodes/person.md), [nodes/concept.md](./nodes/concept.md), [nodes/entity.md](./nodes/entity.md) for full node definitions):

### Promotion Counters

Added during Source ingestion (Phase 2: Extraction):

- **source_count**: int (default 0) - number of Sources mentioning this node
- **first_mentioned_at**: ISO timestamp (first Source mentioning this node)
- **distinct_source_days**: int (number of distinct calendar days with at least one Source mention)
- **distinct_days**: [ISO date] (array of distinct dates for deduplication, internal use only)
- **has_meso**: boolean (default false) - set to true when Storyline created
- **has_macro**: boolean (default false) - set to true when Macro created

### Counter Update Logic

**During Source Ingestion** (Phase 2: Extraction, after entity resolution):

```cypher
// For each entity extracted from Source
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

**Cost**: Negligible (~$0.00001 per Source, no LLM calls)

**Optional Weighting**:

Fractional weights can be applied based on source_type to prevent certain sources from accumulating too quickly:

```cypher
// Apply fractional weight based on source_type
MATCH (s:Source {entity_key: $sourceKey})
MATCH (n {entity_key: $entityKey})
WITH n, s,
  CASE s.source_type
    WHEN 'slack-thread' THEN 0.25
    WHEN 'email' THEN 0.5
    WHEN 'voice-memo' THEN 1.0
    WHEN 'meeting' THEN 1.0
    ELSE 1.0
  END AS weight
SET n.source_count = coalesce(n.source_count, 0) + weight
```

---

## Database Constraints

```cypher
// Storyline: storyline_id must be globally unique
CREATE CONSTRAINT storyline_id_unique IF NOT EXISTS
FOR (st:Storyline) REQUIRE (st.storyline_id) IS UNIQUE;

// Macro: macro_id must be globally unique
CREATE CONSTRAINT macro_id_unique IF NOT EXISTS
FOR (m:Macro) REQUIRE (m.macro_id) IS UNIQUE;

// Storyline: Only one storyline per anchor per user
CREATE CONSTRAINT storyline_anchor_unique IF NOT EXISTS
FOR (st:Storyline) REQUIRE (st.anchor_entity_key, st.user_id) IS UNIQUE;

// Note: Macro anchor uniqueness enforced via application logic (not constraint)
// because Neo4j doesn't support unique constraints on relationship patterns
```

---

## Retrieval at Different Granularities

### Granularity 3: Macro-Level Retrieval

**Use Case**: Agent wants highest-level overview of major themes (e.g., "What are the main things happening in the user's life?")

**Query**:
```cypher
// Vector search over Macro embeddings
CALL db.index.vector.queryNodes('macro_embedding_index', $limit, $queryVector)
YIELD node AS m, score
WHERE m.team_id = $teamId
  AND m.state IN ['active', 'core']
MATCH (m)-[:rooted_in]->(anchor)
OPTIONAL MATCH (m)-[:groups]->(st:Storyline)
RETURN m {
  .macro_id,
  .name,
  .description,
  .total_source_count,
  .storyline_count,
  .started_at,
  .last_event_at,
  anchor: anchor {.entity_key, .name, .type},
  storylines: collect(st {
    .storyline_id,
    .name,
    .source_count,
    .started_at,
    .last_source_at,
    one_liner: split(st.description, '.')[0] + '.'  // First sentence only
  })
} AS macro,
score AS relevance_score
ORDER BY score DESC
LIMIT $limit
```

**Response Format**:
```json
{
  "level": "macro",
  "results": [
    {
      "macro_id": "...",
      "name": "Google – macro",
      "description": "User's relationship with Google started with a job offer in Jan 2025, evolved through negotiations and decision-making, culminated in accepting the role and preparing for start date. Currently focused on onboarding prep and team introductions.",
      "time_span": { "from": "2025-01-05", "to": "2025-03-20" },
      "total_source_count": 47,
      "storyline_count": 3,
      "anchor": { "entity_key": "...", "name": "Google", "type": "Entity" },
      "storylines": [
        {
          "storyline_id": "...",
          "name": "Google – storyline",
          "one_liner": "User received job offer from Google and spent two weeks evaluating fit and compensation.",
          "source_count": 17,
          "time_span": { "from": "2025-01-05", "to": "2025-01-18" }
        },
        // ... more storylines
      ],
      "relevance_score": 0.92
    }
  ]
}
```

**Agent Can Then Drill Down**: "Tell me more about the first storyline" → switch to granularity 2

---

### Granularity 2: Meso-Level Retrieval

**Use Case**: Agent wants detailed summary of a specific storyline (e.g., "Tell me about the Google job offer storyline")

**Query**:
```cypher
// Vector search over Storyline embeddings
CALL db.index.vector.queryNodes('storyline_embedding_index', $limit, $queryVector)
YIELD node AS st, score
WHERE st.team_id = $teamId
  AND st.state IN ['active', 'core']
MATCH (st)-[:about]->(anchor)
OPTIONAL MATCH (st)-[:includes]->(s:Source)
WITH st, anchor, score, collect(s) AS sources
RETURN st {
  .storyline_id,
  .name,
  .description,
  .source_count,
  .started_at,
  .last_source_at,
  anchor: anchor {.entity_key, .name, .type},
  sources: [s IN sources | s {
    .entity_key,
    .summary,
    .started_at,
    .context_type,
    .participants
  }]
} AS storyline,
score AS relevance_score
ORDER BY score DESC
LIMIT $limit
```

**Response Format**:
```json
{
  "level": "meso",
  "results": [
    {
      "storyline_id": "...",
      "name": "Google – storyline",
      "description": "User received job offer from Google and spent two weeks evaluating fit and compensation. Initial excitement mixed with concerns about team culture and work-life balance. Ultimately decided to accept after negotiating higher base salary.",
      "time_span": { "from": "2025-01-05", "to": "2025-01-18" },
      "source_count": 17,
      "anchor": { "entity_key": "...", "name": "Google", "type": "Entity" },
      "sources": [
        {
          "entity_key": "...",
          "summary": "User discussed receiving Google job offer, excited about compensation but worried about team fit.",
          "started_at": "2025-01-05T14:30:00Z",
          "context_type": "phone-call",
          "participants": ["user-123"]
        },
        // ... 16 more sources (summaries only, not full content)
      ],
      "relevance_score": 0.89
    }
  ]
}
```

**Agent Can Then Drill Down**: "Show me the conversation from Jan 5th" → switch to granularity 1 with specific entity_key

---

### Granularity 1: Micro-Level Retrieval

**Use Case**: Agent wants full content of specific conversations (existing behavior)

**Query**: (See existing `explore` tool implementation in [nodes/source.md](./nodes/source.md))

Returns individual Sources with full processed content + neighbor context (relationships, entities, artifacts).

---

## Integration with Existing Memory Management

### Decay Behavior

Storyline and Macro nodes use the same salience/decay mechanism as semantic nodes (see [memory-management.md](./memory-management.md)):

**Storyline Decay**:
- **Initial salience**: Inherited from anchor node (typically 0.5-0.8)
- **ttl_policy**: `decay` (default) - standard salience-based decay
- **Half-life**: ~35 days without access (same as semantic nodes)
- **Access boost**: +0.05-0.1 salience per retrieval
- **State transitions**: `active` → `core` (10+ accesses) → `archived` (salience < 0.01)

**Macro Decay**:
- **Initial salience**: Inherited from anchor node
- **ttl_policy**: `keep_forever` (default) - Macros represent significant long-running themes
- **Override**: Can manually set to `decay` for temporary themes
- **State**: Typically starts as `core` (high importance at creation)

**Archival**:
- When Storyline reaches `state: 'archived'`, excluded from granularity 2 searches
- When Macro reaches `state: 'archived'`, excluded from granularity 3 searches
- Archived nodes remain queryable via direct storyline_id/macro_id lookup

### Nightly Consolidation

Storyline and Macro descriptions are updated via `is_dirty` flag-based refresh jobs:
- **Storylines**: Nightly job re-summarizes when `is_dirty = true` (set when new Sources attached)
- **Macros**: Weekly job re-summarizes when `is_dirty = true` (set when new Sources/Storylines added)
- Both use incremental prompting: "Update this summary with new events: [recent additions]"
- Mimics memory consolidation during sleep (offline processing)
- See "Nightly Storyline Refresh Job" and "Weekly Macro Refresh Job" sections above for implementation details

