# Agent Tools API Reference

This document describes the tools available to ingestion agents during the memory extraction pipeline (Phase 2: Extraction).

> **Related Documentation**:
> - [architecture.md](./architecture.md) - Memory architecture
> - [nodes/](./nodes/) - Node schemas
> - [relationships.md](./relationships.md) - Relationship types and properties
> - [ingestion-pipeline.md](./ingestion-pipeline.md) - How tools are used during extraction
> - [hierarchical-memory.md](./hierarchical-memory.md) - Automatic counter updates

## Automatic Context Properties

All note tools (`add_note_to_person`, `add_note_to_concept`, `add_note_to_entity`, `add_note_to_relationship`) automatically receive context from the ingestion framework:

**Automatic Properties** (agents do NOT specify these):
- `added_by`: Current `user_id` from ingestion context

**Automatic Relationships** (for Note nodes created by semantic node tools):
- `(Note)-[:ADDED_IN]->(Source)`: Links to current Source `entity_key` being processed

These are provided by the ingestion framework when tools are invoked and should NOT be specified by the agent in the tool call. The framework binds these values automatically based on the current extraction context.

All tools automatically track authorship, provenance, and timestamps. Tools are used by specialized agents (Person agent, Concept agent, Entity agent) to update the knowledge graph during batch processing.

> **Hierarchical Memory**: Counter updates for Storyline/Macro promotion happen automatically during entity resolution (not via agent tools). See [hierarchical-memory.md](./hierarchical-memory.md) for details on meso/macro aggregation.

---

## Node Tools

These tools create Note nodes and attach them to semantic nodes (Person, Concept, Entity) via `HAS_NOTE` relationships.

### `add_note_to_person`

Creates a Note node and attaches it to a Person node via `HAS_NOTE` relationship.

**Signature:**
```typescript
add_note_to_person({
  entity_key: string,
  note_content: string,
  lifetime?: "week" | "month" | "year" | "forever"
})
```

**Agent-Provided Parameters:**
- `entity_key`: UUID identifying the Person node
- `note_content`: Text content of the note
- `lifetime`: Optional retention policy (default: `"month"`)
  - `"week"` → `expires_at = added_at + 7 days`
  - `"month"` → `expires_at = added_at + 30 days`
  - `"year"` → `expires_at = added_at + 365 days`
  - `"forever"` → `expires_at = null` (never deleted)

**Automatic Properties (set by framework context - NOT specified by agent):**
- `added_by`: Current user_id (authorship tracking)

**Automatic Properties (set by tool implementation):**
- `note_id`: UUID for the Note node
- `user_id`: Inherited from Person node's `user_id`
- `added_at`: ISO timestamp when note was created
- `expires_at`: ISO timestamp or null based on lifetime
- `created_at`: ISO timestamp
- `updated_at`: ISO timestamp

**Relationships Created:**
- `(Person)-[:HAS_NOTE]->(Note)` - Parent entity owns this note
- `(Note)-[:ADDED_IN]->(Source)` - Links to originating Source (if from a Source)

**Example:**
```typescript
add_note_to_person({
  entity_key: "550e8400-e29b-41d4-a716-446655440000",
  note_content: "Mentioned planning a trip to Japan in March",
  lifetime: "year"
})
// Creates Note node with UUID, sets added_by from context, creates relationships
```

---

### `add_note_to_concept`

Creates a Note node and attaches it to a Concept node via `HAS_NOTE` relationship.

**Signature:**
```typescript
add_note_to_concept({
  entity_key: string,
  note_content: string,
  lifetime?: "week" | "month" | "year" | "forever"
})
```

**Agent-Provided Parameters:** Same as `add_note_to_person`

**Automatic Properties:** Same as `add_note_to_person`

**Relationships Created:**
- `(Concept)-[:HAS_NOTE]->(Note)` - Parent entity owns this note
- `(Note)-[:ADDED_IN]->(Source)` - Links to originating Source (if from a Source)

**Example:**
```typescript
add_note_to_concept({
  entity_key: "660e8400-e29b-41d4-a716-446655440001",
  note_content: "User is considering pivoting to B2B SaaS model",
  lifetime: "month"
})
// Creates Note node with UUID, sets added_by from context, creates relationships
```

---

### `add_note_to_entity`

Creates a Note node and attaches it to an Entity node via `HAS_NOTE` relationship.

**Signature:**
```typescript
add_note_to_entity({
  entity_key: string,
  note_content: string,
  lifetime?: "week" | "month" | "year" | "forever"
})
```

**Agent-Provided Parameters:** Same as `add_note_to_person`

**Automatic Properties:** Same as `add_note_to_person`

**Relationships Created:**
- `(Entity)-[:HAS_NOTE]->(Note)` - Parent entity owns this note
- `(Note)-[:ADDED_IN]->(Source)` - Links to originating Source (if from a Source)

**Example:**
```typescript
add_note_to_entity({
  entity_key: "770e8400-e29b-41d4-a716-446655440002",
  note_content: "Google declined to proceed to final interview round",
  lifetime: "forever"
})
// Creates Note node with UUID, sets added_by from context, creates relationships
```

---

## Relationship Tools

These tools create and update relationships between semantic nodes.

### `create_relationship`

Creates a typed bidirectional relationship between two nodes or updates an existing relationship.

**Signature:**
```typescript
create_relationship({
  from_entity_key: string,
  to_entity_key: string,
  relationship_type: string,
  description: string,
  attitude: 1 | 2 | 3 | 4 | 5,
  proximity: 1 | 2 | 3 | 4 | 5,
  confidence?: number  // 0-1, default: 0.8
})
```

**Parameters:**
- `from_entity_key`: UUID of source node
- `to_entity_key`: UUID of target node
- `relationship_type`: One-word descriptor (e.g., "friend", "colleague", "studies", "works-at", "part-of")
- `description`: 1-sentence overview of the relationship nature
- `attitude`: Sentiment/valence (1=negative, 3=neutral, 5=positive) - semantics vary by relationship type
- `proximity`: Depth of connection (1=distant, 5=close) - semantics vary by relationship type
- `confidence`: Optional confidence in this relationship (0-1), defaults to 0.8

**Automatic Properties (set by tool):**
- `relationship_embedding`: Unified embedding from description + relationship_type + attitude/proximity words + notes (see [Embedding Strategy](#embedding-strategy))
- `state`: `'candidate'` (default for new relationships)
- `salience`: `0.5` (default initial value)
- `recorded_by`: Current user_id
- `valid_from`: Current timestamp
- `valid_to`: `null` (currently valid)
- `created_at`: Current timestamp
- `updated_at`: Current timestamp
- `recall_frequency`: `0`
- `last_recall_interval`: `0`
- `decay_gradient`: `1.0`
- `access_count`: `0`
- `last_accessed_at`: `null`
- `is_dirty`: `false` (set to true when notes added)

**Relationship Type Selection (automatic based on node types):**

The tool automatically determines the correct relationship type based on the node types being connected:

| From Node | To Node | Relationship Type | Attitude Semantics | Proximity Semantics |
|-----------|---------|-------------------|-------------------|---------------------|
| Person | Person | `has_relationship_with` | 1=hostile → 5=close | 1=stranger → 5=intimate-knowledge |
| Person | Concept | `engages_with` | 1=dislikes → 5=passionate | 1=unfamiliar → 5=expert |
| Person | Entity | `associated_with` | 1=negative-view → 5=strongly-positive | 1=distant → 5=deeply-connected |
| Concept | Concept | `relates_to` | 1=contradicts → 5=integral | 1=loosely-related → 5=inseparable |
| Concept | Entity | `involves` | 1=peripheral → 5=central | 1=tangential → 5=essential |
| Entity | Entity | `connected_to` | 1=adversarial → 5=integrated | 1=distantly-connected → 5=tightly-coupled |

See [relationships.md](./relationships.md) for complete word mappings used in embedding generation.

**Example:**
```typescript
create_relationship({
  from_entity_key: "550e8400-e29b-41d4-a716-446655440000",  // Person: Sarah
  to_entity_key: "880e8400-e29b-41d4-a716-446655440003",  // Person: User (owner)
  relationship_type: "friend",
  description: "Close friend and former colleague from Google",
  attitude: 5,  // close
  proximity: 5,  // intimate-knowledge
  confidence: 0.95
})
// Automatically creates: has_relationship_with relationship
// relationship_embedding generated from unified text: description + relationship_type + attitude/proximity words + notes
```

---

### `add_note_to_relationship`

Appends a note to a relationship's `notes` array and regenerates the `relationship_embedding`.

**Signature:**
```typescript
add_note_to_relationship({
  from_entity_key: string,
  to_entity_key: string,
  note_content: string,
  lifetime?: "week" | "month" | "year" | "forever"
})
```

**Agent-Provided Parameters:**
- `from_entity_key`: UUID of source node (identifies the relationship)
- `to_entity_key`: UUID of target node (identifies the relationship)
- `note_content`: Text content of the note
- `lifetime`: Optional retention policy (same semantics as node notes, default: `"month"`)

**Automatic Properties (set by framework context - NOT specified by agent):**
- `added_by`: Current user_id (authorship tracking)
- `source_entity_key`: Current source entity_key (provenance tracking - links note to originating Source)

**Automatic Properties (set by tool implementation):**
- `date_added`: ISO timestamp
- `expires_at`: ISO timestamp or null based on lifetime
- Sets `is_dirty = true` on relationship (triggers nightly description consolidation)
- Regenerates `relationship_embedding` from unified text (description + relationship_type + attitude/proximity words + notes)

**Example:**
```typescript
add_note_to_relationship({
  from_entity_key: "550e8400-e29b-41d4-a716-446655440000",  // Sarah
  to_entity_key: "880e8400-e29b-41d4-a716-446655440003",  // User
  note_content: "Helped me prepare for Google interview in 2019",
  lifetime: "forever"
})
// added_by and source_entity_key are automatically added by the framework
```

---

## Word Mappings

These mappings are used in the unified `relationship_embedding` for semantic relationship search (combined with description and notes).

### Person ↔ Person (`has_relationship_with`)
- **Attitude**: 1=hostile | 2=unfriendly | 3=neutral | 4=friendly | 5=close
- **Proximity**: 1=stranger | 2=acquaintance | 3=familiar | 4=known-well | 5=intimate-knowledge

### Person ↔ Concept (`engages_with`)
- **Attitude**: 1=dislikes | 2=skeptical | 3=neutral | 4=interested | 5=passionate
- **Proximity**: 1=unfamiliar | 2=aware | 3=understands | 4=experienced | 5=expert

### Person ↔ Entity (`associated_with`)
- **Attitude**: 1=negative-view | 2=unfavorable | 3=neutral | 4=favorable | 5=strongly-positive
- **Proximity**: 1=distant | 2=aware-of | 3=familiar-with | 4=involved-with | 5=deeply-connected

### Concept ↔ Concept (`relates_to`)
- **Attitude**: 1=contradicts | 2=conflicts | 3=independent | 4=complementary | 5=integral
- **Proximity**: 1=loosely-related | 2=somewhat-related | 3=related | 4=closely-related | 5=inseparable

### Concept ↔ Entity (`involves`)
- **Attitude**: 1=peripheral | 2=minor | 3=relevant | 4=important | 5=central
- **Proximity**: 1=tangential | 2=mentioned | 3=involved | 4=key-component | 5=essential

### Entity ↔ Entity (`connected_to`)
- **Attitude**: 1=adversarial | 2=competing | 3=independent | 4=cooperative | 5=integrated
- **Proximity**: 1=distantly-connected | 2=indirectly-connected | 3=connected | 4=closely-linked | 5=tightly-coupled

---

## Embedding Strategy

Relationships use a unified embedding approach that combines all relationship information into a single vector for semantic search:

```typescript
// Unified relationship embedding (semantic search on all relationship aspects)
notes_text = concatenate(notes.map(n => n.content))  // Max 1000 chars
unified_text = `${description} ${relationship_type} ${attitude_word} ${proximity_word} ${notes_text}`
relationship_embedding = embed_small(unified_text)
```

**Example**:
```typescript
// Relationship: Person→Person, type="friend", attitude=5, proximity=5
// description: "Close friend and former colleague from Google"
// notes: ["Helped me prepare for Google interview in 2019"]
unified_text = "Close friend and former colleague from Google friend close intimate-knowledge Helped me prepare for Google interview in 2019"
relationship_embedding = embed_small(unified_text)
// Enables queries like: "show me close friendly relationships" or "find relationships involving Google"
```

This unified approach enables semantic search across all relationship aspects (description, type, sentiment, depth, and contextual notes) in a single vector space.

---

## Usage Pattern

Agents receive these tools during Phase 2: Extraction (Step 4):

```typescript
// Example: Person agent processing extracted entities
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
// Agent calls add_note_to_person, create_relationship, add_note_to_relationship
```

See [memory-management.md](./memory-management.md) for complete ingestion pipeline context.

---

## Automatic Counter Updates (Hierarchical Memory)

During Phase 2: Extraction, when `Source -[:mentions]-> {Person|Concept|Entity}` relationships are created, the system automatically updates promotion counters on semantic nodes. These counters enable batch promotion to Storyline/Macro nodes (see [hierarchical-memory.md](./hierarchical-memory.md)).

**Counters Updated Automatically**:
- `source_count`: Incremented by 1 (or fractional weight based on source_type)
- `first_mentioned_at`: Set to current timestamp if not already set
- `last_mentioned_at`: Updated to current timestamp
- `distinct_source_days`: Incremented if current date not in `distinct_days` array
- `distinct_days`: Current date appended if not already present

**No Agent Action Required**: These updates happen automatically during entity resolution/mention phase. Agents do not need to call any tools to maintain these counters.

**Promotion Jobs** (separate from agent tools):
- **Nightly job**: Checks counters and promotes eligible anchors to Storyline nodes
- **Weekly job**: Groups Storylines into Macro nodes
- **Cost**: Negligible per-Source counter updates (~$0.00001), batch promotion ~$0.30/month

**Example Counter Update** (automatic during extraction):
```cypher
// After creating Source -[:mentions]-> Entity relationship
MATCH (n:Entity {entity_key: $entityKey})
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

This counter update is **not exposed as an agent tool** - it happens automatically in the extraction pipeline after entity resolution.
