# Concept Node Documentation

## Overview

A **Concept** node represents important concepts, topics, projects, or ideas that have gained significance to a specific user. These are user-scoped semantic memory nodes that capture structured knowledge with rich metadata for memory management.

## Schema

### Core Identity
- **entity_key**: string (UUID - stable, immutable identifier for relationships)
  - Unique identifier that never changes, used as primary foreign key
  - Enables safe relationship creation and idempotent updates

- **user_id**: string (always set - identifies which user this Concept belongs to)
  - User-scoped: every Concept is owned by a specific user
  - Used for all access control and filtering queries

- **created_by**: string (user_id of who created this node, usually same as user_id)
  - Tracks authorship when concepts are shared/suggested by others
  - Typically matches user_id but can differ in team scenarios

### Semantic Content
- **name**: string (normalized name for lookup - UNIQUE per user, can be updated)
  - Primary identifier for human reference
  - Must be unique within user's concept space
  - Normalized for case-insensitive matching

- **description**: string (1 sentence overview of most important information)
  - Concise summary of the concept
  - Regenerated nightly when is_dirty flag is set
  - Used as basis for embeddings

- **notes**: array of note objects
  - Structure: `{content: string, added_by: string, date_added: ISO timestamp, source_entity_key: string | null, expires_at: ISO timestamp | null}`
  - Rich text information that doesn't fit elsewhere
  - `source_entity_key`: references the Source node this note was derived from (null if not from a specific Source)
  - `added_by`: tracks who added each note (important for collaborative scenarios)
  - `expires_at`: optional expiration for time-sensitive notes
  - Avoid bloat—use only for information that doesn't fit structured fields

- **is_dirty**: boolean (default false - set to true when notes are added)
  - Triggers nightly description regeneration
  - Optimization flag: only regenerate descriptions when content changes

### Vector Embedding
- **embedding**: vector (built from description + notes)
  - Generated from semantic content for similarity search
  - Enables semantic retrieval across the knowledge graph
  - Updated when description or notes change significantly

### Memory Management Flags
- **confidence**: float (0-1)
  - Confidence that this entity should exist
  - Set at extraction time based on information quality
  - Affects decay rate for candidate concepts
  - Higher confidence → slower decay

- **salience**: float (0-1)
  - Graph centrality measure, reflects importance to user
  - Boosted on access (whenever concept is retrieved or mentioned)
  - Decays over time if not accessed
  - Determines ranking in search results

- **recall_frequency**: int (number of times retrieved)
  - Tracks how often user accesses this concept
  - Used for spacing effect calculation (helps learning)
  - Higher frequency → more resistant to decay

- **last_recall_interval**: int (days between last two recalls)
  - Spacing effect metric: larger intervals → stronger memory
  - Used to adjust decay_gradient

- **decay_gradient**: float (default 1.0)
  - Multiplier on decay rate, increases with spacing effect
  - Enables slower forgetting for well-spaced recalls
  - Higher value = more resistant to decay

### State & Lifecycle
- **state**: enum (candidate | active | core | archived)
  - **candidate**: new concept, low confidence, not yet regularly accessed
  - **active**: established concept with moderate access/mentions
  - **core**: central to user's knowledge graph, frequently accessed/mentioned
  - **archived**: concept user has explicitly deprioritized (kept for history, not surfaced)
  - Used for filtering in retrieval and decay policies

- **ttl_policy**: enum (keep_forever | decay | ephemeral)
  - Governance: retention policy for this concept
  - **keep_forever**: never decay (e.g., important projects, lifetime relationships)
  - **ephemeral**: rapid decay (e.g., temporary ideas, time-bound contexts)
  - **decay**: standard decay based on access patterns (default)
  - Precedence order: keep_forever > ephemeral > decay

- **access_count**: int
  - Total number of times concept has been accessed/retrieved
  - Used for frequency-based ranking

- **last_accessed_at**: ISO timestamp
  - When concept was last retrieved
  - Used for decay calculation and recency ranking

### Timestamps
- **created_at**: ISO timestamp (when concept was first created)
- **updated_at**: ISO timestamp (last modification to any field)

### Hierarchical Memory Counters
These counters determine when a Concept should be promoted to Storyline (meso-level) or Macro (macro-level) nodes. See [hierarchical-memory.md](../hierarchical-memory.md) for promotion logic.

- **source_count**: int (default 0)
  - Number of Sources mentioning this concept
  - Used to assess how frequently concept appears across conversations

- **first_mentioned_at**: ISO timestamp
  - First Source mentioning this concept
  - Used to calculate time span for promotion eligibility

- **distinct_source_days**: int (default 0)
  - Number of distinct calendar days with at least one Source mention
  - Measure of breadth: how spread out are mentions over time
  - Used for Storyline promotion (requires 3+ days minimum)

- **distinct_days**: [ISO date]
  - Array of distinct dates for deduplication (internal use only)
  - Used to calculate distinct_source_days without recounting

- **has_meso**: boolean (default false)
  - Set to true when Storyline created for this concept
  - Prevents duplicate Storyline creation

- **has_macro**: boolean (default false)
  - Set to true when Macro created for this concept
  - Prevents duplicate Macro creation

## Relationships

### Incoming Relationships
- `(Person)-[:thinks_about]->(Concept)`
  - Person is thinking about or focused on this concept
  - Properties: mood, frequency, last_mentioned_at

- `(Concept)-[:relates_to]->(Concept)`
  - Connection to other related concepts
  - Properties: notes, relevance

- `(Concept)-[:involves]->(Person)`
  - Person is involved in or connected to this concept
  - Properties: notes, relevance

- `(Concept)-[:involves]->(Entity)`
  - Entity (place, object, organization) involved in this concept
  - Properties: notes, relevance

- `(Source)-[:mentions]->(Concept)`
  - Source mentions this concept
  - Properties: id only (just the mention relationship)

- `(Artifact)-[:sourced_from]->(Source)`
  - Artifact generated from this source

### Outgoing Relationships
- `(Concept)-[:produced]->(Artifact)`
  - Artifact generated from work on this concept
  - Properties: notes, relevance

## Usage Examples

### Creating a Concept
```json
{
  "entity_key": "uuid-here",
  "user_id": "user-123",
  "created_by": "user-123",
  "name": "Project Aurora",
  "description": "A machine learning pipeline for sentiment analysis in product reviews.",
  "notes": [
    {
      "content": "Started in Q3 2024, tech stack is Python + PyTorch",
      "added_by": "user-123",
      "date_added": "2024-11-13T10:00:00Z",
      "source_entity_key": "source-456",
      "expires_at": null
    }
  ],
  "is_dirty": false,
  "embedding": [0.1, 0.2, 0.3],
  "confidence": 0.85,
  "salience": 0.7,
  "recall_frequency": 5,
  "last_recall_interval": 3,
  "decay_gradient": 1.2,
  "state": "active",
  "ttl_policy": "keep_forever",
  "access_count": 5,
  "last_accessed_at": "2024-11-13T09:30:00Z",
  "created_at": "2024-10-15T08:00:00Z",
  "updated_at": "2024-11-13T09:30:00Z",
  "source_count": 3,
  "first_mentioned_at": "2024-10-15T08:00:00Z",
  "distinct_source_days": 2,
  "distinct_days": ["2024-10-15", "2024-11-10"],
  "has_meso": false,
  "has_macro": false
}
```

### Updating Notes
When adding a note to a concept:
1. Append to notes array with new entry
2. Set `is_dirty` to true (triggers nightly description regeneration)
3. Update `updated_at` to current timestamp
4. If note expires, set `expires_at` to future date

### Promoting to Storyline
When a Concept reaches promotion threshold (source_count ≥ 5, distinct_source_days ≥ 3):
1. Create Storyline node linked to this Concept
2. Set `has_meso` to true on Concept node
3. Link relevant Sources to Storyline with `:groups` relationship

## Field Validation Rules

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| entity_key | string | Yes | UUID, immutable |
| user_id | string | Yes | Must exist in users table |
| created_by | string | Yes | Usually same as user_id |
| name | string | Yes | Unique per user, normalized |
| description | string | Yes | Max ~250 chars, 1 sentence |
| notes | array | No | Max 100 notes per concept |
| is_dirty | boolean | No | Default: false |
| embedding | vector | No | 1536 dimensions (OpenAI) |
| confidence | float | No | Range [0, 1], default: 0.5 |
| salience | float | No | Range [0, 1], default: 0.3 |
| recall_frequency | int | No | Default: 0 |
| last_recall_interval | int | No | Default: 0 |
| decay_gradient | float | No | Default: 1.0, min: 0.5 |
| state | enum | No | One of: candidate, active, core, archived |
| ttl_policy | enum | No | One of: keep_forever, decay, ephemeral |
| access_count | int | No | Default: 0, auto-incremented |
| last_accessed_at | timestamp | No | Updated on each access |
| created_at | timestamp | Yes | ISO 8601 |
| updated_at | timestamp | Yes | ISO 8601 |
| source_count | int | No | Default: 0 |
| first_mentioned_at | timestamp | No | Set on first source mention |
| distinct_source_days | int | No | Default: 0 |
| distinct_days | array | No | Internal use, deduplicated |
| has_meso | boolean | No | Default: false |
| has_macro | boolean | No | Default: false |

## See Also

- [schema.md](../schema.md) - Complete schema documentation for all node types
- [hierarchical-memory.md](../hierarchical-memory.md) - Storyline/Macro promotion logic
- [memory-management.md](../memory-management.md) - Data lifecycle (add/update/delete operations)
- [agent-tools.md](../agent-tools.md) - Tool signatures for creating/updating concepts
