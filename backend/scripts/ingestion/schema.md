# Final Schema

> **Memory Management Details**: For information on how data gets added/updated/deleted in the system, see [memory-management.md](./memory-management.md).
>
> **Hierarchical Memory**: For meso/macro aggregation layers (Storyline/Macro nodes), see [hierarchical-memory.md](./hierarchical-memory.md).
>
> **Agent Tools API**: For tool signatures used during ingestion, see [agent-tools.md](./agent-tools.md).
>
> **Agent Context Loading**: For information on how to load working context at conversation start, see [agent-context.md](./agent-context.md).

## Memory Architecture

**Core Principle**: Semantic nodes (Person, Concept, Entity, relationships) are always user-scoped; Sources can be personal or team-scoped, and multiple users derive their own semantic graphs from the same Sources.

This schema implements a **personal knowledge graph with shared episodic sources** architecture inspired by human cognition:

**Semantic Memory** - Personal, structured knowledge that persists long-term:
- **Person**, **Concept**, **Entity** nodes represent each user's extracted knowledge about people, topics, and things
- **User-scoped**: Every user maintains their own personal semantic graph (filtered by `user_id`)
- **Personal interpretation**: Multiple users can extract different semantic knowledge from the same shared Source
- Rich relationships between semantic nodes capture how knowledge connects in each user's mental model
- Salience and decay mechanisms determine what stays in active memory
- User-specific information that wouldn't be inferrable by an LLM alone

**Episodic Memory** - Shared experiences and raw source material:
- **Source** nodes are the primary episodic unit, storing both raw and processed content with full processing pipeline tracking
- **Team-scoped or personal**: Sources can be shared across team members (`team_id` set) or private (`team_id` = null)
- **Artifact** nodes capture user-specific generated outputs from conversations (user-scoped like semantic nodes)
- Sources provide temporal context and can be consolidated into semantic knowledge over time

**Memory Consolidation**: Over time, frequently accessed episodic content gets extracted into personal semantic knowledge, while less relevant sources can be archived. This mimics human memory consolidation during sleep.

**Hierarchical Aggregation** (meso/macro layers): Sources that frequently mention the same entities are automatically promoted into **Storyline** nodes (meso-level, 5+ sources, 3+ days), and long-running storylines are grouped into **Macro** nodes (macro-level, 2+ storylines, 30+ days). This enables retrieval at different granularities without expensive clustering. See [hierarchical-memory.md](./hierarchical-memory.md) for details.

**Team Collaboration**: Multiple users share Sources (conversations, meetings, documents) and each builds their own semantic interpretation. Authorship is tracked at note level and relationship level. Each user maintains personal perspectives (e.g., "my relationship with Sarah") derived from shared episodic experiences.

---

## Nodes

### Team Management Nodes

**Team:**
- team_id: string (UUID - primary identifier)
- name: string (team display name)
- created_at: ISO timestamp
- created_by: string (user_id of team creator)
- settings: json (team-level preferences, retention policies, etc.)

**Team Membership** (stored in Supabase PostgreSQL, not Neo4j):
- Supabase table: `team_members (team_id, user_id, role, joined_at)`
- Roles: `owner | admin | member`
- Used for access control and permission checks

### Semantic Knowledge Nodes

**Person:**
- entity_key: string (UUID - stable, immutable identifier for relationships)
- user_id: string (always set - identifies which user this Person belongs to)
- created_by: string (user_id of who created this node - always tracked for audit)
- name: string
- description: string - a short description of who this person is (not their relationship, just who they are)
- canonical_name: string (normalized name for lookup - UNIQUE per user)
- is_owner: boolean (optional - only set to true for the Person node representing the user themselves)

**Invariants:**
- **Owner node**: `is_owner=true`, `user_id` set (one owner Person per user)
- **Regular person**: `is_owner=false` (or not set), `user_id` set
- **All Person nodes are user-scoped**: Each user maintains their own Person nodes, even if multiple users know the same real-world person
- notes: [{content: string, added_by: string, date_added: ISO timestamp, source_entity_key: string | null, expires_at: ISO timestamp | null}] - information that doesn't fit elsewhere. expires_at = null means never expires, source_entity_key = entity_key of Source this note was derived from (null if not from a specific Source). **added_by tracks authorship**
- is_dirty: boolean - set to true when notes are added, triggers nightly description regeneration
- embedding: vector - built from description + notes
- confidence: float (0-1) - confidence that this entity should exist (set at extraction, affects decay rate for candidates)
- salience: float (0-1) - graph centrality, boosted on access, decays over time
- recall_frequency: int (number of times retrieved, for spacing effect calculation)
- last_recall_interval: int (days between last two recalls)
- decay_gradient: float (default 1.0, increases with spacing effect for slower forgetting)
- state: enum (candidate | active | core | archived)
- ttl_policy: enum (keep_forever | decay | ephemeral) - governance: retention policy (precedence order: keep_forever > ephemeral > decay, default: decay)
- access_count: int
- last_accessed_at: ISO timestamp
- created_at: ISO timestamp
- updated_at: ISO timestamp

**Hierarchical Memory Counters** (for Storyline/Macro promotion, see [hierarchical-memory.md](./hierarchical-memory.md)):
- source_count: int (default 0) - number of Sources mentioning this node
- first_mentioned_at: ISO timestamp - first Source mentioning this node
- distinct_source_days: int (default 0) - number of distinct calendar days with at least one Source mention
- distinct_days: [ISO date] - array of distinct dates for deduplication (internal use only)
- has_meso: boolean (default false) - set to true when Storyline created for this anchor
- has_macro: boolean (default false) - set to true when Macro created for this anchor

**Concept:**
- entity_key: string (UUID - stable, immutable identifier for relationships)
- user_id: string (always set - identifies which user this Concept belongs to)
- created_by: string (user_id of who created this node, usually same as user_id)
- name: string (normalized name for lookup - UNIQUE per user, can be updated)
- description: string - a 1 sentence overview of most important information
- notes: [{content: string, added_by: string, date_added: ISO timestamp, source_entity_key: string | null, expires_at: ISO timestamp | null}] - information that doesn't fit elsewhere. source_entity_key = entity_key of Source this note was derived from (null if not from a specific Source). **added_by tracks authorship**
- is_dirty: boolean - set to true when notes are added, triggers nightly description regeneration
- embedding: vector - built from description + notes
- confidence: float (0-1) - confidence that this entity should exist (set at extraction, affects decay rate for candidates)
- salience: float (0-1) - graph centrality, boosted on access, decays over time
- recall_frequency: int (number of times retrieved, for spacing effect calculation)
- last_recall_interval: int (days between last two recalls)
- decay_gradient: float (default 1.0, increases with spacing effect for slower forgetting)
- state: enum (candidate | active | core | archived)
- ttl_policy: enum (keep_forever | decay | ephemeral) - governance: retention policy (precedence order: keep_forever > ephemeral > decay, default: decay)
- access_count: int
- last_accessed_at: ISO timestamp
- created_at: ISO timestamp
- updated_at: ISO timestamp

**Hierarchical Memory Counters** (for Storyline/Macro promotion, see [hierarchical-memory.md](./hierarchical-memory.md)):
- source_count: int (default 0) - number of Sources mentioning this node
- first_mentioned_at: ISO timestamp - first Source mentioning this node
- distinct_source_days: int (default 0) - number of distinct calendar days with at least one Source mention
- distinct_days: [ISO date] - array of distinct dates for deduplication (internal use only)
- has_meso: boolean (default false) - set to true when Storyline created for this anchor
- has_macro: boolean (default false) - set to true when Macro created for this anchor

**Entity:**
- entity_key: string (UUID - stable, immutable identifier for relationships)
- user_id: string (always set - identifies which user this Entity belongs to)
- created_by: string (user_id of who created this node, usually same as user_id)
- name: string (normalized name for lookup - can be updated)
- type: string (organization, location, project, event, etc. - part of UNIQUE constraint with name + type + user_id)
- description: string - a short overview of most important information
- notes: [{content: string, added_by: string, date_added: ISO timestamp, source_entity_key: string | null, expires_at: ISO timestamp | null}] - information that doesn't fit elsewhere. source_entity_key = entity_key of Source this note was derived from (null if not from a specific Source). **added_by tracks authorship**
- is_dirty: boolean - set to true when notes are added, triggers nightly description regeneration
- embedding: vector - built from description
- confidence: float (0-1) - confidence that this entity should exist (set at extraction, affects decay rate for candidates)
- salience: float (0-1) - graph centrality, boosted on access, decays over time
- recall_frequency: int (number of times retrieved, for spacing effect calculation)
- last_recall_interval: int (days between last two recalls)
- decay_gradient: float (default 1.0, increases with spacing effect for slower forgetting)
- state: enum (candidate | active | core | archived)
- ttl_policy: enum (keep_forever | decay | ephemeral) - governance: retention policy (precedence order: keep_forever > ephemeral > decay, default: decay)
- access_count: int
- last_accessed_at: ISO timestamp
- created_at: ISO timestamp
- updated_at: ISO timestamp

**Hierarchical Memory Counters** (for Storyline/Macro promotion, see [hierarchical-memory.md](./hierarchical-memory.md)):
- source_count: int (default 0) - number of Sources mentioning this node
- first_mentioned_at: ISO timestamp - first Source mentioning this node
- distinct_source_days: int (default 0) - number of distinct calendar days with at least one Source mention
- distinct_days: [ISO date] - array of distinct dates for deduplication (internal use only)
- has_meso: boolean (default false) - set to true when Storyline created for this anchor
- has_macro: boolean (default false) - set to true when Macro created for this anchor

### Episodic Memory Nodes

**Source** (First-class episodic memory - combines conversation, email, Slack message, meeting, etc.):
- entity_key: string (UUID - stable identifier)
- user_id: string (who contributed this source - always set)
- team_id: string | null (set for team sources, null for personal)

- raw_content: json - **Original unprocessed data** stored in flexible structure (varies by source_type)
- content: {type: conversation | email | slack-thread | meeting | text-note | etc, content: string | json} - **Processed/refined content** (cleaned, structured)

- source_type: string - **Technical ingestion origin**: "voice-memo", "meeting", "email", "slack-thread", "text-import" (where the data came from)
- context_type: string - **Human-purpose label** from controlled vocabulary: "work-session", "phone-call", "team-meeting", "personal-reflection", "planning", "brainstorming" (what the interaction was for)
- provenance: json - metadata about origin (e.g., {origin: "assemblyai", confidence: 0.95, channel_id: "..."})

- started_at: ISO timestamp (when source began - for point-in-time sources like emails, same as created_at)
- ended_at: ISO timestamp | null (when source ended - NULL for point-in-time sources or ongoing)
- participants: [string] (array of user_ids involved - for personal sources, single user; for team sources, multiple users)
- summary: string (1-2 sentence summary generated during processing phase)
- keywords: [string] (searchable keywords extracted from content - key terms, topics, names)
- tags: [string] (unstructured metadata tags - useful for filtering, not quite keywords but searchable context)
- embedding: vector - built from summary

- processing_status: enum (raw | processed | extracted) - tracks pipeline progress
- processing_started_at: ISO timestamp | null
- processing_completed_at: ISO timestamp | null
- extraction_started_at: ISO timestamp | null
- extraction_completed_at: ISO timestamp | null

- salience: float (0-1) - graph centrality, boosted on access, decays over time
- last_accessed_at: ISO timestamp
- access_count: int
- recall_frequency: int (number of times retrieved, for spacing effect calculation)
- last_recall_interval: int (days between last two recalls)
- decay_gradient: float (default 1.0, increases with spacing effect for slower forgetting)
- state: enum (candidate | active | core | archived)
- sensitivity: enum (low | normal | high) - governance flag for permissions/access control (default: normal, does NOT affect decay)
- ttl_policy: enum (keep_forever | decay | ephemeral) - governance: retention policy (precedence order: keep_forever > ephemeral > decay)

- created_at: ISO timestamp
- updated_at: ISO timestamp

**Field Semantics Clarification**:

Three fields describe the source's nature, each serving a different purpose:

1. **source_type**: Technical ingestion origin (where the data came from)
   - Values: "voice-memo", "email", "slack-thread", "meeting", "text-import"
   - Immutable after creation
   - Used for pipeline routing and format handling

2. **content.type**: Normalized representation after processing
   - Values: "conversation", "email", "slack-thread", "meeting", "text-note"
   - Often matches source_type, but can differ if formats are unified
   - Example: source_type="voice-memo" → content.type="conversation" (both are conversational)

3. **context_type**: Human-purpose label (what the interaction was for)
   - Controlled vocabulary: "work-session", "team-meeting", "phone-call", "personal-reflection", "planning", "brainstorming", "email-thread", "slack-discussion"
   - NOT freeform - ingestion layer maps raw events to this predefined set
   - Used for contextual retrieval and semantic grouping
   - Can be updated if the purpose is better understood later

**Raw Content Structure** (varies by source_type):
```json
// Conversation
{type: "conversation", content: "<JSONL transcript>"}

// Email
{type: "email", from: "...", subject: "...", body: "...", headers: {...}}

// Slack
{type: "slack-thread", channel: "...", messages: [...]}

// Text
{type: "text-note", content: "..."}
```

**Field Semantics Summary**:

| Field | Meaning | Example (team meeting) | Example (personal voice memo) |
|-------|---------|------------------------|-------------------------------|
| `user_id` | Who created/contributed this Source | `"alice-123"` (Alice recorded) | `"alice-123"` (Alice recorded) |
| `participants` | All user_ids involved in the experience | `["alice-123", "bob-456", "charlie-789"]` | `["alice-123"]` |
| `team_id` | Which team context this Source belongs to | `"team-001"` (team context) | `null` (personal) |

**Key Invariants**:
- `user_id` is always present (never null)
- `user_id IN participants` (creator must be participant)
- `team_id = null` → personal Source, `team_id != null` → team Source

**user_id vs participants Detailed Semantics**:

The distinction between `user_id` and `participants` enables proper access control and attribution:

- **user_id**: Always the creator/contributor of the Source
  - For voice memos: The person who recorded
  - For emails: The person who sent or imported it
  - For meetings: The person who initiated or recorded
  - For Slack threads: The person who initiated or imported
  - **Always present** (never null)
  - **Always included in participants** array

- **participants**: All user_ids involved in the experience
  - For personal sources: `[user_id]` (single participant)
  - For team meetings: `[user1, user2, user3, ...]` (all attendees)
  - For email threads: All senders/receivers in the thread
  - For Slack discussions: All users who contributed
  - **Invariant**: `user_id IN participants` (creator must be participant)

**Access Control Pattern**:
```cypher
// Users can access Sources where they are participants OR it's their team
MATCH (s:Source)
WHERE s.user_id = $userId                // Created by them
  OR $userId IN s.participants           // They participated
  OR s.team_id IN $userTeamIds           // Team-scoped and they're members
RETURN s
```

**Examples**:

1. **Personal voice memo**:
   - `user_id: "alice-123"` (Alice recorded it)
   - `participants: ["alice-123"]` (only Alice)
   - `team_id: null` (personal)

2. **Team meeting**:
   - `user_id: "alice-123"` (Alice initiated/recorded)
   - `participants: ["alice-123", "bob-456", "charlie-789"]` (all attendees)
   - `team_id: "team-001"` (team context)

3. **Imported email thread**:
   - `user_id: "alice-123"` (Alice imported it)
   - `participants: ["alice-123", "bob-456"]` (sender + receivers)
   - `team_id: "team-001"` (team email account)

**Artifact:**
- entity_key: string (UUID - stable identifier)
- user_id: string (who created this artifact - user-scoped like all semantic nodes)
- name: string - short human label (e.g., "YC – competitors draft v2", "Meeting notes Jan 15")
- description: string - 1 sentence overview
- content: {type: action | md_file | etc, output: text | json}
- sensitivity: enum (low | normal | high) - governance flag for permissions/access control (default: normal, does NOT affect decay)
- ttl_policy: enum (keep_forever | decay | ephemeral) - governance: retention policy (precedence order: keep_forever > ephemeral > decay)
- created_at: ISO timestamp
- updated_at: ISO timestamp

**Artifact Scoping**:
- **Always personal** (no `team_id` field)
- Artifacts are user-generated outputs (actions, files, summaries) tied to individual users
- Even if generated from team Sources, Artifacts belong to the user who created them
- **Rationale**: Artifacts represent personal work products and interpretations, not shared episodic experiences
- **Access**: Artifacts are only accessible to their creator (`user_id`)
- **Example**: Alice generates a summary from a team meeting Source → Artifact has `user_id: "alice-123"`, only Alice can access it

### Hierarchical Memory Nodes

> **Complete Documentation**: See [hierarchical-memory.md](./hierarchical-memory.md) for full field definitions, promotion logic, refresh jobs, retrieval patterns, and cost analysis.

These nodes provide aggregated views over collections of Sources, enabling retrieval at different granularities (micro/meso/macro) without expensive clustering operations. Promotion is threshold-based and happens in nightly/weekly batch jobs.

**Storyline** (Meso-level memory - coherent block of activity around a specific entity):
- Represents 5+ Sources across 3+ days anchored to a Person/Concept/Entity
- Fields: storyline_id, user_id, team_id, anchor_entity_key, name, description, embedding, is_dirty, source_count, started_at, last_source_at, salience, state, ttl_policy, access_count, recall_frequency, timestamps
- Relationships: `(Storyline)-[:about]->(anchor)`, `(Storyline)-[:includes]->(Source)`
- Promotion: Nightly job when anchor meets thresholds (source_count >= 5, distinct_source_days >= 3)
- Refresh: Nightly job re-summarizes when `is_dirty = true`
- See [hierarchical-memory.md](./hierarchical-memory.md) for complete details

**Macro** (Macro-level memory - long-running theme spanning multiple Storylines):
- Represents 2+ Storylines spanning 30+ days anchored to a Person/Concept/Entity
- Fields: macro_id, user_id, team_id, anchor_entity_key, name, description, embedding, is_dirty, storyline_count, total_source_count, started_at, last_event_at, salience, state, ttl_policy, access_count, recall_frequency, timestamps
- Relationships: `(Macro)-[:rooted_in]->(anchor)`, `(Macro)-[:groups]->(Storyline)`
- Promotion: Weekly job when anchor has multiple Storylines spanning 30+ days
- Refresh: Weekly job re-summarizes when `is_dirty = true`
- See [hierarchical-memory.md](./hierarchical-memory.md) for complete details

---

## Entity Type Guidelines

Clear distinctions between node types prevent ambiguity during extraction:

**Person**: Always individuals, never groups or teams
- Examples: "Sarah", "John", "my manager"
- NOT: "engineering team", "the board", "my family" (use Entity for groups)

**Concept**: Abstract ideas, nebulous topics, preferences, values, goals
- Use for:
  - Abstract topics: "AI safety as a field", "career transition", "work stress"
  - Goals: "hit $1M ARR", "learn to code"
  - Preferences: "prefer async communication", "value work-life balance"
  - Beliefs/values: "importance of transparency"
- NOT used for: Companies, people, concrete projects, tangible things

**Entity**: Tangible, nameable things with stable identities
- Use for:
  - Organizations: Companies, institutions, teams ("Google", "Y Combinator", "engineering team")
  - Locations: Cities, countries, offices ("Chicago office", "Bay Area")
  - Projects: Concrete initiatives ("Q4 launch", "website redesign")
  - Products: Software, tools, physical products ("iPhone", "Slack")
  - Events: Meetings, conferences, milestones ("YC interview", "team offsite")
- Entity vs Concept distinction:
  - "YC application" as Entity: tracking an actual submission with deadline, status
  - "YC applications" as Concept: generic topic/discussion about the application process

**Rule of thumb**: If it has a proper name or specific instance you're tracking, it's likely an Entity. If it's abstract or a general topic, it's a Concept.

## Enum Reference

All enum values used throughout the schema for consistency:

**processing_status** (Source nodes only):
- `"raw"` - Original data uploaded, not yet processed
- `"processed"` - Content cleaned/structured, summary generated
- `"extracted"` - Semantic entities extracted and linked

**state** (All nodes and relationships):
- `"candidate"` - Newly created, not yet retrieved
- `"active"` - Retrieved 1-9 times
- `"core"` - Retrieved 10+ times, highly important
- `"archived"` - Salience < 0.01 or ttl_policy expired

**ttl_policy** (All nodes):
- `"keep_forever"` - No decay, never archived
- `"decay"` - Salience-based decay (default)
- `"ephemeral"` - Hard expiry (30d episodic / 90d semantic)

**sensitivity** (Episodic nodes only: Source, Artifact):
- `"low"` - Low sensitivity
- `"normal"` - Normal sensitivity (default)
- `"high"` - High sensitivity

**source_type** (Source nodes only - technical ingestion origin):
- `"voice-memo"` - Voice recording via STT
- `"meeting"` - Meeting transcript
- `"email"` - Email import
- `"slack-thread"` - Slack conversation
- `"text-import"` - Manual text entry

**content.type** (Source nodes only - normalized representation):
- `"conversation"` - Conversational format
- `"email"` - Email format
- `"slack-thread"` - Slack thread format
- `"meeting"` - Meeting transcript format
- `"text-note"` - Plain text note

**context_type** (Source nodes only - human-purpose label, controlled vocabulary):
- `"work-session"` - Work-related conversation
- `"team-meeting"` - Team meeting
- `"phone-call"` - Phone conversation
- `"personal-reflection"` - Personal thinking session
- `"planning"` - Planning/strategy session
- `"brainstorming"` - Idea generation
- `"email-thread"` - Email discussion
- `"slack-discussion"` - Slack discussion

---

## Database Constraints

**Neo4j Unique Constraints** (enforced at database level):

```cypher
// Team: team_id must be globally unique
CREATE CONSTRAINT team_id_unique IF NOT EXISTS
FOR (t:Team) REQUIRE (t.team_id) IS UNIQUE;

// Person: entity_key must be globally unique (user-scoped via entity_key = hash(canonical_name + user_id))
CREATE CONSTRAINT person_entity_key_unique IF NOT EXISTS
FOR (p:Person) REQUIRE (p.entity_key) IS UNIQUE;

// Person: canonical_name must be unique per user
CREATE CONSTRAINT person_canonical_name_user IF NOT EXISTS
FOR (p:Person) REQUIRE (p.canonical_name, p.user_id) IS UNIQUE;

// Person (owner nodes): user_id must be unique for owner nodes (one owner per user)
CREATE CONSTRAINT person_owner_unique IF NOT EXISTS
FOR (p:Person) REQUIRE (p.user_id, p.is_owner) IS UNIQUE;

// Concept: name must be unique per user
CREATE CONSTRAINT concept_name_user IF NOT EXISTS
FOR (c:Concept) REQUIRE (c.name, c.user_id) IS UNIQUE;

// Entity: (name, type) must be unique per user
CREATE CONSTRAINT entity_name_type_user IF NOT EXISTS
FOR (e:Entity) REQUIRE (e.name, e.type, e.user_id) IS UNIQUE;

// Source: entity_key must be globally unique (matches PostgreSQL)
CREATE CONSTRAINT source_entity_key_unique IF NOT EXISTS
FOR (s:Source) REQUIRE (s.entity_key) IS UNIQUE;

// Storyline: storyline_id must be globally unique
CREATE CONSTRAINT storyline_id_unique IF NOT EXISTS
FOR (st:Storyline) REQUIRE (st.storyline_id) IS UNIQUE;

// Storyline: Only one storyline per anchor per user
CREATE CONSTRAINT storyline_anchor_unique IF NOT EXISTS
FOR (st:Storyline) REQUIRE (st.anchor_entity_key, st.user_id) IS UNIQUE;

// Macro: macro_id must be globally unique
CREATE CONSTRAINT macro_id_unique IF NOT EXISTS
FOR (m:Macro) REQUIRE (m.macro_id) IS UNIQUE;

// Macro: Only one macro per anchor per user
CREATE CONSTRAINT macro_anchor_unique IF NOT EXISTS
FOR (m:Macro) REQUIRE (m.anchor_entity_key, m.user_id) IS UNIQUE;
```

**Purpose**: These constraints enable:
- **User-scoped entity resolution**: Personal semantic knowledge is unique within each user's graph, different users can have entities with same names
- **Personal owner isolation**: Each user has exactly one owner Person node (is_owner=true) unique to their user_id
- **Deterministic lookups**: `MERGE` operations use indexed fields for fast, idempotent entity resolution
- **Duplicate prevention**: Database rejects duplicate entities at write time within a user's scope
- **Mutable names**: entity_key (UUID) provides stable identity even when canonical_name/name changes
- **Hierarchical aggregation uniqueness**: One Storyline per anchor per user, one Macro per anchor per user (enforced via database constraints and application logic)
- **Fast queries**: Constraints automatically create indexes for efficient lookups

**Entity Resolution Flow**:
1. Extract entities from content with normalized names
2. **For Person nodes**: `MERGE` on (canonical_name, user_id) OR entity_key → user-scoped, each user has their own Person nodes
3. **For owner Person nodes**: `MERGE` on (user_id, is_owner=true) → exactly one per user
4. **For Concept nodes**: `MERGE` on (name, user_id) → user-scoped, each user has their own Concept nodes
5. **For Entity nodes**: `MERGE` on (name, type, user_id) → user-scoped, each user has their own Entity nodes
6. On creation: generate entity_key (UUID), set user_id and created_by to current user
7. On match: return existing entity_key (created_by stays as originally set)
8. All relationships use entity_key (stable across name changes)

## Relationships

### Semantic Knowledge Relationships

These relationships connect semantic nodes (Person, Concept, Entity) and capture structured knowledge about how people, topics, and things relate to each other. **Relationships are first-class entities** with their own lifecycle, salience tracking, and decay mechanisms similar to nodes.

**All semantic relationships share these properties:**

- **user_id**: string (always set - identifies which user this relationship belongs to)
- **description**: string - 1 sentence overview of the relationship nature
- **notes**: [{content: string, added_by: string, date_added: ISO timestamp, source_entity_key: string | null, expires_at: ISO timestamp | null}] - relationship details and context. source_entity_key = entity_key of Source this note was derived from (null if not from a specific Source). **added_by tracks authorship**
- **is_dirty**: boolean - set to true when notes are added, triggers nightly description regeneration

- **attitude**: int (1-5) - sentiment/valence of this relationship (1=negative, 3=neutral, 5=positive)
- **proximity**: int (1-5) - depth of connection/knowledge (1=distant/unfamiliar, 5=close/intimate)
- **relationship_type**: string - flexible one-word descriptor chosen by agent (e.g., "friend", "colleague", "sibling", "uses", "studies", "located-at", "part-of")
- **relation_embedding**: vector - small embedding generated from relationship_type + attitude/proximity word mappings (enables semantic relationship search)
- **notes_embedding**: vector - small embedding from concatenated notes (max 1000 chars, enables semantic note search within relationships)

- **state**: enum (candidate | active | core | archived) - relationship lifecycle state
- **salience**: float (0-1) - relationship importance, boosted on access, decays over time
- **recall_frequency**: int (number of times retrieved, for spacing effect calculation)
- **last_recall_interval**: int (days between last two recalls)
- **decay_gradient**: float (default 1.0, increases with spacing effect for slower forgetting)
- **access_count**: int
- **last_accessed_at**: ISO timestamp
- **recorded_by**: string (user_id who recorded this relationship)
- **valid_from**: ISO timestamp (when this relationship became true in the real world)
- **valid_to**: ISO timestamp (when invalidated, null if currently valid)
- **recorded_at**: ISO timestamp (when system learned this)
- **confidence**: float (0-1, confidence in this relationship)
- **created_at**: ISO timestamp
- **updated_at**: ISO timestamp

**Relationship Scoping**:
- **user_id must equal both connected nodes' user_ids**: When creating relationships between semantic nodes, set `rel.user_id = from.user_id` and assert `from.user_id = to.user_id`
- **Enables simple query guards**: Filter relationships with `WHERE rel.user_id = $userId` for user-scoped traversals
- **Rationale**: Since all semantic nodes are user-scoped, relationships between them are also user-scoped

**Relationship Types:**

- **Person [has_relationship_with] Person** - bidirectional interpersonal connections
- **Person [engages_with] Concept** - bidirectional thinking/interest relationships
- **Person [associated_with] Entity** - bidirectional connections to organizations, places, things
- **Concept [relates_to] Concept** - bidirectional conceptual connections
- **Concept [involves] Entity** - bidirectional concept-entity involvement
- **Entity [connected_to] Entity** - bidirectional entity-to-entity connections

Each relationship type has its own semantic dimensions captured through `attitude` and `proximity` properties. The `relationship_type` field provides a flexible one-word descriptor chosen by the agent at creation time (e.g., "friend", "colleague", "sibling" for Person↔Person; "studies", "interested-in" for Person↔Concept; "works-at", "owns" for Person↔Entity).

**Word Mappings for Embedding Generation**: See [agent-tools.md](./agent-tools.md#word-mappings) for complete attitude/proximity word mappings per relationship type and embedding generation strategy. This enables semantic search queries like "show me close friendly relationships" or "find concepts they're passionate about".

### Episodic Memory Relationships

These relationships connect episodic nodes (Source, Artifact) to semantic knowledge. They provide provenance tracking (which sources mentioned which entities) and enable traversal from semantic knowledge back to original context.

**Source [mentions] Person**
- No properties (simple provenance link - created during extraction phase)

**Source [mentions] Entity**
- No properties (simple provenance link - created during extraction phase)

**Source [mentions] Concept**
- No properties (simple provenance link - created during extraction phase)

**Source [produced] Artifact**
- No properties (simple provenance link - Artifacts are outputs from Sources)

### Hierarchical Memory Relationships

These relationships connect hierarchical aggregation nodes (Storyline, Macro) to their anchors and constituent parts.

**Storyline [about] Person|Concept|Entity**
- No properties (simple anchor link - identifies which semantic node this storyline aggregates around)
- Cardinality: 1:1 (one storyline per anchor per user)

**Storyline [includes] Source**
- No properties (simple provenance link - identifies which Sources are grouped in this storyline)
- Cardinality: 1:many (one storyline contains multiple Sources)

**Macro [rooted_in] Person|Concept|Entity**
- No properties (simple anchor link - identifies which semantic node this macro represents)
- Cardinality: 1:1 (one macro per anchor per user)

**Macro [groups] Storyline**
- No properties (simple aggregation link - identifies which Storylines are grouped in this macro)
- Cardinality: 1:many (one macro groups multiple Storylines)


---

## Notes:

### Semantic vs Episodic Memory

**Semantic nodes (Person, Concept, Entity)** represent extracted, structured knowledge:
- **All semantic nodes are user-scoped**: Each user maintains their own personal knowledge graph
  - Owner Person node (`is_owner: true`) represents the user themselves (one per user)
  - Other Person nodes represent people the user knows (unique per user via canonical_name + user_id)
  - Concept nodes represent topics/projects/ideas as the user understands them (unique per user via name + user_id)
  - Entity nodes represent organizations/places/things with the user's personal context (unique per user via name + type + user_id)
- Multiple users can extract different semantic nodes from the same shared Source
- Created through ingestion pipeline from episodic sources
- Contain user-specific information not inferrable by an LLM alone
- Persist long-term with salience-based decay
- Rich relationships capture how knowledge connects in each user's mental model
- Updated/merged when new information arrives within the user's graph
- `created_by` field tracks who added the entity (typically same as `user_id`)
- Notes within entities track `added_by` for each contribution

**Episodic nodes (Source, Artifact)** represent experiences and raw source material:
- **Source nodes are first-class episodic memory**: Each Source represents a distinct experience (conversation, email, Slack thread, meeting, text import, etc.)
- **User attribution**: Sources always have `user_id` (who spoke/contributed)
- **Scoping flexibility**: Sources can be personal (`team_id: null`) or team-scoped (`team_id: set`)
- **Complete data lifecycle in Neo4j**:
  - **raw_content**: Original unprocessed data (flexible JSON structure)
  - **content**: Refined/processed content after cleanup
  - **processing_status**: Tracks pipeline progress (raw → processed → extracted)
- **Temporal/contextual metadata**: Sources have `context_type`, `started_at`, `ended_at`, `participants`, `summary` to provide rich context
- **Artifacts** capture generated outputs (actions, files, etc.)
- Sources provide provenance for semantic knowledge via `[mentions]` relationships
- Sources can be consolidated and archived over time based on salience decay

**When to create semantic nodes:**
- Person: Someone mentioned with specific context (relationship, situation, personality)
  - **Always user-scoped**: Each user has their own Person nodes
  - Owner node (is_owner=true): The user themselves, one per user
  - Other Person nodes: People the user knows, unique per user
  - Example: User A and User B can both have "Sarah" nodes, representing their own relationships with Sarah
- Concept: Topic/project/idea with user-specific importance and details
  - Examples: Goals ("I want to hit $1M ARR"), Preferences ("I prefer async communication"), Problems/Concerns ("I'm worried about runway"), Beliefs/Values ("I value work-life balance"), Topics of interest ("I'm interested in AI safety")
  - **User-scoped**: Each user has their own Concept nodes reflecting their personal understanding
- Entity: Thing/place/company with user-specific context beyond general knowledge
  - Examples: Organization (company, institution, team), Location (city, country, venue, office), Project (initiatives, endeavors), Event (meeting, conference, milestone)
  - **User-scoped**: Each user has their own Entity nodes with personal context
- Example: "Chicago" in passing → NO semantic entity (just a city)
- Example: "Chicago" with user plans/context → YES, create Entity (user-specific context)

**Memory flow:**
1. Raw data → Neo4j Source node (raw_content, processing_status: "raw")
2. Processing phase → Update Source node with refined content (processing_status: "processed")
3. Extraction phase → Create semantic nodes + relationships + provenance links (processing_status: "extracted")

See [memory-management.md](./memory-management.md) for detailed ingestion pipeline and memory lifecycle details.

### Field Usage

- **Confidence + State Interaction**: See [memory-management.md](./memory-management.md#candidate-semantics-confidence--state-interaction) for how `confidence` affects decay for candidates (high-confidence candidates don't decay, low-confidence candidates decay faster). Once a node becomes `active`, confidence no longer affects decay.

- The `notes` field on both nodes and relationships is an array of structured objects tracking information that doesn't fit other properties:
  - Each note has: `content` (the actual note), `added_by` (user_id who added), `date_added` (when added), `source_entity_key` (entity_key of Source this note was derived from, null if not from a specific Source), `expires_at` (ISO timestamp after which the note is deleted, null = never expires)
  - **Authorship is always tracked**: `added_by` enables audit trails and attribution in team contexts
  - **Provenance is explicit**: `source_entity_key` links notes back to originating Sources for traceability
  - Agent chooses lifetime when saving note: "week | month | year | forever"
    - week → expires_at = date_added + 7 days
    - month → expires_at = date_added + 30 days
    - year → expires_at = date_added + 365 days
    - forever → expires_at = null (never deleted)
  - Notes accumulate over time as new information is discovered from different sources and team members

- **Bi-Temporal Tracking on Relationships:**
  - `valid_from` / `valid_to`: When the fact/relationship was TRUE in the real world (event time)
  - `recorded_at`: When the system learned about this fact (system time)
  - Use temporal validity to handle contradictions: Instead of marking nodes as conflicted, **invalidate old edges** (set `valid_to`) and create new edges with updated information
  - This preserves complete history and enables point-in-time queries: "What did the user think about Google in January?"
  - Example: "I accepted Google job" (Jan 1) → "I declined Google job" (Jan 15)
    - First edge: `description: "User accepted job offer", valid_from: Jan 1, valid_to: Jan 15, recorded_at: Jan 1`
    - Second edge: `description: "User declined job offer", valid_from: Jan 15, valid_to: null, recorded_at: Jan 15`
  - Query for current state: `WHERE valid_to IS NULL`
  - Query for historical state: `WHERE valid_from <= $date AND (valid_to IS NULL OR valid_to > $date)`

- **Relationship Lifecycle:**
  - Relationships have their own `state` enum (candidate | active | core | archived) independent of connected nodes
  - Relationships have their own `salience` that decays independently based on access patterns
  - Relationships trigger nightly consolidation via `is_dirty` flag when notes are added or description updated
  - This allows tracking relationship importance separately from entity importance
  - Example: User frequently references their relationship with "Sarah" (high salience edge) even if Sarah entity has low salience


## Retrieval

The agent should know about the last few days of conversations. Beyond that, it uses a combination of **semantic similarity**, **salience**, **temporal recency**, **team scoping**, and **granularity control** to retrieve information from semantic, episodic, and hierarchical memory:

**Semantic memory retrieval** (fast, structured):
- Primary source for answering "what do we know about X?"
- Person/Concept/Entity nodes with rich relationships
- **All semantic queries filter by user_id**: Each user accesses only their own personal knowledge graph
- **Personal context**: User's owner Person node (is_owner=true) provides individual perspective
- **Independent interpretations**: Multiple users can have different semantic nodes extracted from the same shared Sources
- Optimized for quick fact lookup and relationship traversal

**Episodic memory retrieval** (detailed, contextual):
- Used when specific conversation/source context is needed
- Source nodes contain both raw and processed content with temporal metadata
- **Access control**: Users can access personal sources (team_id=null) + team sources (filtered by team_id)
- **Attribution**: Source nodes track who contributed (user_id), enabling "who said what" queries
- **Temporal context**: `started_at`, `ended_at`, `context_type`, `participants` fields provide rich temporal framing
- **Raw data access**: `raw_content` field preserves unprocessed content when needed

**Hierarchical memory retrieval** (multi-granularity aggregation):
- Enables agent to retrieve at different levels of detail: micro (Sources), meso (Storylines), macro (Macros)
- **Granularity 1 (micro)**: Individual Sources with full content (default)
- **Granularity 2 (meso)**: Storyline summaries with Source metadata (reduced detail, broader coverage)
- **Granularity 3 (macro)**: Macro overviews with Storyline metadata (highest-level themes)
- **Agent-directed drilling**: Start at macro, drill to meso or micro as needed for detail
- **Use case examples**:
  - "What's happening lately?" → granularity 3 (macro themes)
  - "How's the Google job going?" → granularity 2 (storyline summary)
  - "What did I say about compensation?" → granularity 1 (specific Sources)
- See [hierarchical-memory.md](./hierarchical-memory.md) and [memory-management.md](./memory-management.md#retrieval-granularity-controls) for complete retrieval patterns

**Access filtering**: All queries automatically scope results to:
- **Person/Concept/Entity nodes**: Filter by `user_id = current_user` (user-scoped, each user has their own semantic graph)
- **Artifact nodes**: Filter by `user_id = current_user` (user-scoped outputs)
- **Source nodes**: Filter by team access (`team_id IN user_teams`) AND user participation (`user_id IN participants` OR `user_id = creator`)
- **Storyline/Macro nodes**: Filter by `WHERE (n.team_id IS NULL AND n.user_id = $userId) OR n.team_id IN $userTeams` (personal arcs when team_id=null, team arcs when team_id is set)

Most queries use hybrid retrieval: semantic nodes for structured knowledge + episodic/hierarchical context when needed.

### Retrieval Flow

1. **User submits message**

2. **A lightweight classifier (gpt-4.1-nano, 1-2 sentences) decides if search is needed**, using a simple rubric:
   - **Needed for**: References to past events, people, decisions, ongoing projects, or "remember when..." queries
   - **Not needed for**: Generic factual questions, coding help, one-off email drafts, brainstorming
   - **Output**: `{ needs_search: boolean, reasons: string[] }`

   Examples where search is NOT necessary:
   1.  "Explain quantum entanglement simply."
   2.  "Write a Python script to scrape headlines."
   3.  "Help me draft a polite resignation email."
   4.  "Summarize this PDF in bullet points."
   5.  "Debug this TypeScript function."
   6.  "Give me 5 startup ideas in the AI space."
   7.  "Rewrite my dating profile to sound more natural."
   8.  "Design a morning routine for productivity."
   9.  "What's the difference between gpt-4.1 and gpt-5?"
   10. "Brainstorm fantasy names for a coastal kingdom."

3. **If search is necessary, transform query first** to improve retrieval accuracy:

   **Fast heuristics** (applied immediately, no LLM call):
   - Detect follow-up questions: inject conversation context
     - "in chicago" → "What does user know about chicago"
     - "what about sarah?" → "What does user know about sarah"
   - Expand known abbreviations from terminology database
     - "YC app" → "Y Combinator application"
     - "ML model" → "machine learning model"

   **LLM-based transformations** (when query is ambiguous or complex):
   - **Multi-query generation**: Create 3-5 alternative phrasings
     - Original: "google job offer"
     - Alternatives: ["google job offer", "job offers tech companies", "career decisions google"]
   - **Step-back prompting**: Generate higher-level conceptual question
     - Original: "Should I take google job?"
     - Step-back: "What factors matter in job decisions?"
   - **Query rewriting**: Restructure poorly worded questions
     - Original: "that thing we talked about with the startup"
     - Rewritten: "startup discussion topics"

   **Caching**: Store common transformations (greetings, abbreviations) to avoid repeated LLM calls.

   Examples:
   1. "in chicago" → Heuristic adds context → "What information does user have about chicago"
   2. "YC deadline" → Expand abbreviation → "Y Combinator application deadline"
   3. "google job" → Multi-query → ["google job offer", "job offers at tech companies", "google career opportunity"]
   4. "should I do it?" → Context injection → "should I take the google job offer" (from conversation history)

4. **Execute transformed queries via candidate searches**. Begins by immediately acknowledging while beginning search in parallel. See [Search Tools](#search-tools)
   1. "I'm not sure if I should take the google job offer." → Transform: ["google job offer", "job decision factors", "career choices tech"] → `explore({queries: [{query: "google job offer", threshold: 0.8}, {query: "job decision factors", threshold: 0.75}, {query: "career choices tech", threshold: 0.75}], text_matches: ["google"], mode: "fast"})`
   2. "I think I messed up with andrew—we fought pretty bad last night." → Transform: detect name → `explore({text_matches: ["andrew"], mode: "fast"})`
   3. "Okay, what do you think about this idea..." → Transform: step-back query → `explore({queries: [{query: "startup ideas brainstorming", threshold: 0.75}, {query: "user's previous ideas and feedback", threshold: 0.75}], mode: "deep", multi_query: true})`
   4. "How am I going to actually make headway on my startup—YC apps are due tomorrow." → Transform: expand YC → `explore({queries: [{query: "Y Combinator application startup progress", threshold: 0.8}], text_matches: ["startup", "Y Combinator", "YC"], mode: "deep"})`
   5. "I don't know how I feel about this girl—I used to have a crush, but now she has a kid" -> `explore({queries: [{query: "romantic feelings crush relationship", threshold: 0.75}], mode: "fast"})` then `traverse({mode: "cypher", cypher: "MATCH (u:Person {is_owner: true})-[r:has_relationship_with]-(p:Person) WHERE p.name CONTAINS 'girl' RETURN p, r"})`
   6. "If I don't submit my report by end of today, am I screwed?" -> `explore({queries: [{query: "report deadline submission", threshold: 0.8}], text_matches: ["report"], mode: "fast"})`
  

### Search Tools

These tools allow the agent to retrieve arbitrary content from the db.

Two tools exist: an `explore` tool which allows rapid investigation into the graph, and `traverse` which allows graph operations once promising nodes have been discovered.

#### Explore

Explore searches across semantic memory (nodes + relationships), episodic memory (sources), and hierarchical memory (storylines, macros) using a multi-signal scoring approach with granularity control.

**Salience Updates**: Storylines and Macros participate in salience updates like any other node - when retrieved via `explore()` or `traverse()`, their `access_count`, `last_accessed_at`, `recall_frequency`, and `salience` are updated following the same spacing effect mechanics as semantic nodes.

**Searched Entities:**
- **Semantic Nodes**: Person, Concept, Entity (via `embedding` + text matching on `name`/`canonical_name`)
- **Semantic Relationships**: All relationship types (via `relation_embedding`, `notes_embedding`, and text matching on `relationship_type`, `description`, notes contents)
- **Episodic (Micro)**: Source (via `embedding` from summary + text matching on `keywords`, `tags`)
- **Episodic (Meso)**: Storyline (via `embedding` from description + text matching on `name`)
- **Episodic (Macro)**: Macro (via `embedding` from description + text matching on `name`)
- **Artifacts**: (via text matching on `name`, `description`, and optionally `content` for text-based artifacts)

**Search strategy:** Multi-signal scoring across all entity types, then filter/rank based on granularity level to return appropriate detail.

**Signature:**
```typescript
explore({
    // Embedding search across all entity types (nodes, edges, sources, storylines, macros)
    queries?: {query: string, threshold: float}[],

    // Text matching across:
    // - Person.canonical_name, Concept.name, Entity.name
    // - Source.keywords, Source.tags
    // - Storyline.name, Macro.name
    // - Relationship.relationship_type, Relationship.description, Relationship.notes[].content
    text_matches?: string[],

    // Relationship filtering (hard filter before scoring)
    relationship_filters?: {
        min_attitude?: 1 | 2 | 3 | 4 | 5,         // Include only relationships with attitude >= this
        max_attitude?: 1 | 2 | 3 | 4 | 5,         // Include only relationships with attitude <= this
        min_proximity?: 1 | 2 | 3 | 4 | 5,        // Include only relationships with proximity >= this
        max_proximity?: 1 | 2 | 3 | 4 | 5,        // Include only relationships with proximity <= this
        relationship_types?: string[],             // Include only these types (e.g., ["friend", "colleague"])
        exclude_relationship_types?: string[]      // Exclude these types (e.g., ["enemy", "competitor"])
    },

    // Granularity control (what level of episodic detail to return)
    granularity: 1 | 2 | 3,  // REQUIRED - 1=micro (sources), 2=meso (storylines), 3=macro

    // Query expansion
    multi_query?: boolean,    // if true, LLM generates 2-3 complementary queries
    mode?: "fast" | "deep",   // fast skips multi-query expansion, deep enables it

    // Scoring weights
    time_weight?: float,      // 0-1, how much to weight recency (default: 0.3)
    salience_weight?: float,  // 0-1, how much to weight graph centrality (default: 0.4)
    semantic_weight?: float,  // 0-1, how much to weight embedding similarity (default: 0.3)

    // Debugging
    return_explanations?: boolean // if true, expose match features (similarity scores, match types, etc.)
});
```

**Multi-Query Expansion** (when `multi_query: true` or `mode: "deep"`):
- LLM generates 2-3 complementary queries targeting different aspects:
  - One aimed at sources/storylines/macros ("all conversations about: google job offer, offer negotiation")
  - One aimed at people/relationships ("user ↔ John work relationship, attitudes / closeness")
  - One aimed at concepts ("career decision-making, risk tolerance, long-term goals")
- Runs in parallel and fuses with RRF (Reciprocal Rank Fusion)

**Scoring Model:**
```
final_score = (semantic_weight * cosine_similarity) +
              (time_weight * recency_score) +
              (salience_weight * salience)

where:
- cosine_similarity: embedding similarity (0-1)
- recency_score: exp(-λ * days_since_update) where λ = 0.02 (half-life ~35 days)
- salience: graph centrality (0-1), boosted on access, decays over time
```

**Granularity Behavior:**
- **Granularity 1 (micro)**: Prioritize Sources, include Storylines/Macros as minimal context
- **Granularity 2 (meso)**: Prioritize Storylines with aggregated metadata, include Sources as previews only
- **Granularity 3 (macro)**: Prioritize Macros with Storyline children, minimal/no Source detail

##### Gather Phase

Combines all results from search queries (embeddings) and text matches (fuzzy matching). Searches across:

**Semantic Layer:**
- **Person nodes** - via `embedding` OR text match on `canonical_name`
- **Concept nodes** - via `embedding` OR text match on `name`
- **Entity nodes** - via `embedding` OR text match on `name`
- **Relationships** - via `relation_embedding`, `notes_embedding` OR text match on `relationship_type`, `description`, notes contents

**Episodic Layer (granularity-dependent):**
- **Sources (granularity 1)** - via `embedding` (from summary) OR text match on `keywords`, `tags`
- **Storylines (granularity 2)** - via `embedding` (from description) OR text match on `name`
- **Macros (granularity 3)** - via `embedding` (from description) OR text match on `name`

**Artifacts:**
- Text match on `name`, `description`

**Relationship Filtering (hard filter applied BEFORE scoring):**
- If `relationship_filters` provided, apply as hard filter to exclude unwanted relationships
- Relationships failing filter criteria are removed from candidate set entirely (never scored)
- Enables queries like "exclude hostile relationships" or "only show close connections"
- Example: `min_attitude: 3` removes all relationships with attitude < 3 before any scoring occurs

**Scoring normalization:**
- Embedding search: cosine similarity already 0-1
- Exact text matches: score as 1.0 (perfect match)
- Fuzzy text matches: normalize to 0-1 using string similarity metric (e.g., Jaro-Winkler, token-based similarity, or Levenshtein-based: `1 - (distance / max_length)`)
- All scores must be in 0-1 range to be comparable when ranking/combining results

##### Rerank and Expand Phase

1. **Score and rank** all entities using the multi-signal scoring model (semantic + time + salience)
2. **Filter top hits by granularity**:
   - **Granularity 1 (micro)**:
     - Top 5 Sources (full detail)
     - Top 5 semantic nodes (Person, Concept, Entity combined)
     - Top 10 relationships touching returned nodes
     - Top 3 Storylines (minimal context - entity_key, name only)
     - Top 2 Macros (minimal context - entity_key, name only)
   - **Granularity 2 (meso)**:
     - Top 5 Storylines (full detail with preview_sources)
     - Top 5 semantic nodes
     - Top 10 relationships touching returned nodes
     - Top 10 Sources mentioned in Storylines (as previews only)
     - Top 2 Macros (minimal context)
   - **Granularity 3 (macro)**:
     - Top 5 Macros (full detail with child Storylines)
     - Top 5 semantic nodes (anchor nodes from Macros)
     - Top 10 relationships touching returned nodes
     - No Sources returned (drill down with separate call if needed)
3. **Expand context** - For returned nodes, fetch:
   - Connected nodes (neighbors) with summary info only
   - Relationships between returned nodes
   - For Storylines: top mentioned nodes from child Sources
   - For Macros: child Storylines with summaries

##### Return Format (Granularity-Aware)

Results have a consistent shape regardless of granularity, but different sections are populated based on `granularity` level:

```typescript
type ExploreResult = {
  meta: {
    granularity: 1 | 2 | 3;           // Which granularity level was used
    query_used: string[];              // Actual queries executed (after expansion)
  };

  semantic: {
    people: SemanticNodeHit[];         // Person nodes
    concepts: SemanticNodeHit[];       // Concept nodes
    entities: SemanticNodeHit[];       // Entity nodes
    relationships: RelationshipHit[];  // Semantic relationships between nodes
  };

  episodic: {
    sources: SourceHit[];              // Micro-level (full at granularity 1, previews at granularity 2)
    storylines: StorylineHit[];        // Meso-level (full at granularity 2, minimal at 1/3)
    macros: MacroHit[];                // Macro-level (full at granularity 3, minimal at 1/2)
    artifacts: ArtifactHit[];          // Generated outputs
  };
};

// Semantic node hit (Person, Concept, Entity)
type SemanticNodeHit = {
  entity_key: string;
  node_type: "Person" | "Concept" | "Entity";
  name: string;
  description: string;              // Current description field
  notes_snippets: string[];         // Non-expired notes, truncated at retrieval time (500 chars/note, 5000 total, 10 max notes)
  salience: number;                 // 0-1
  state: "candidate" | "active" | "core" | "archived";
  last_accessed_at: string | null;
};

// Semantic relationship hit
type RelationshipHit = {
  from_entity_key: string;
  to_entity_key: string;
  relationship_kind:
    | "has_relationship_with"
    | "engages_with"
    | "associated_with"
    | "relates_to"
    | "involves"
    | "connected_to";
  relationship_type: string;         // "friend", "works-at", "studies", etc.
  description: string;               // 1-sentence summary
  attitude: 1 | 2 | 3 | 4 | 5;
  proximity: 1 | 2 | 3 | 4 | 5;
  notes_snippets: string[];          // Non-expired notes, truncated at retrieval time (same limits as nodes)
  salience: number;
  state: "candidate" | "active" | "core" | "archived";
};

// Source hit (episodic micro-level)
type SourceHit = {
  entity_key: string;
  summary: string;                   // 1-2 sentence summary
  context_type: string;              // "work-session", "meeting", "slack-thread", etc.
  source_type: string;               // "conversation", "email", etc.
  started_at: string;
  ended_at: string | null;
  relevance_score: number;           // Final scoring from explore()

  // Top nodes mentioned in this Source (sorted by recency or salience)
  mentioned_nodes: Array<{
    entity_key: string;
    node_type: "Person" | "Concept" | "Entity";
    name: string;
    description: string;             // 1 sentence
  }>;                                // Limited to 5-10 nodes

  // References to parent aggregations (if this Source is part of Storyline/Macro)
  storyline_refs?: Array<{
    storyline_id: string;
    name: string;
  }>;
  macro_refs?: Array<{
    macro_id: string;
    name: string;
  }>;
};

// Storyline hit (episodic meso-level)
type StorylineHit = {
  storyline_id: string;
  name: string;
  description: string;               // 2-3 sentence storyline summary
  relevance_score: number;

  // Scope/size
  source_count: number;
  started_at: string;
  last_source_at: string;

  // Anchor node this Storyline is about
  anchor: {
    entity_key: string;
    node_type: "Person" | "Concept" | "Entity";
    name: string;
    description: string;
  };

  // Key nodes aggregated from included Sources (top N)
  top_people: Array<{
    entity_key: string;
    name: string;
    description: string;
  }>;
  top_entities: Array<{
    entity_key: string;
    name: string;
    type: string;
    description: string;
  }>;
  top_concepts: Array<{
    entity_key: string;
    name: string;
    description: string;
  }>;

  // Preview of recent Sources (not full content, 2-5 examples)
  preview_sources: Array<{
    entity_key: string;
    summary: string;
    started_at: string;
    context_type: string;
  }>;
};

// Macro hit (episodic macro-level)
type MacroHit = {
  macro_id: string;
  name: string;
  description: string;               // 3-4 sentence macro summary
  relevance_score: number;

  // Scope
  storyline_count: number;
  total_source_count: number;
  started_at: string;
  last_event_at: string;

  // Root anchor (project/topic/person/entity)
  anchor: {
    entity_key: string;
    node_type: "Person" | "Concept" | "Entity";
    name: string;
    description: string;
  };

  // Child Storylines with summaries & stats
  storylines: Array<{
    storyline_id: string;
    name: string;
    one_liner: string;               // First sentence of description
    source_count: number;
    started_at: string;
    last_source_at: string;
  }>;
};

// Artifact hit
type ArtifactHit = {
  entity_key: string;
  name: string;
  description: string;               // 1 sentence
  content_type: string;              // "action", "md_file", etc.
  created_at: string;
  related_nodes: Array<{
    entity_key: string;
    node_type: "Person" | "Concept" | "Entity";
    name: string;
  }>;
};
```

**Population by Granularity:**

**Granularity 1 (micro) - Source-level detail:**
- `episodic.sources`: Full SourceHit objects (top 5)
- `episodic.storylines`: Minimal (entity_key, name only) for context (top 3)
- `episodic.macros`: Minimal (entity_key, name only) for context (top 2)
- `semantic.*`: Fully populated (top 5 nodes, top 10 relationships)

**Granularity 2 (meso) - Storyline-level aggregation:**
- `episodic.storylines`: Full StorylineHit objects with preview_sources (top 5)
- `episodic.sources`: Only those in preview_sources (not independent results)
- `episodic.macros`: Minimal (entity_key, name only) for context (top 2)
- `semantic.*`: Fully populated (anchor nodes + related entities)

**Granularity 3 (macro) - Macro-level themes:**
- `episodic.macros`: Full MacroHit objects with child storylines (top 5)
- `episodic.storylines`: Only those in macros.storylines (not independent results)
- `episodic.sources`: Empty (drill down with separate call if needed)
- `semantic.*`: Anchor nodes from Macros + key related entities

**Interpretation:**
- **Same shape, different detail**: Agent always receives the same structure, making consumption consistent
- **Sources**: "when, where, and who" for specific experiences (temporal + contextual framing)
- **Storylines**: Aggregated narratives around specific anchors (meso-level themes)
- **Macros**: Highest-level thematic groupings spanning weeks/months
- **Semantic nodes**: Structured knowledge extracted from episodic memory
- **Relationships**: How knowledge connects (semantic links between entities)
- **notes_snippets**: Computed at retrieval time by:
  1. Filtering to non-expired notes only (expires_at = null OR expires_at > now)
  2. Taking up to 10 most recent notes (sorted by date_added DESC)
  3. Truncating each note to 500 chars max
  4. Capping total characters at 5000 across all snippets
  5. Full notes available via `traverse` if agent needs more detail

#### Traverse

Traversal allows the agent to navigate the graph directly and gather more specific information. Two modes available:

**1. Personalized PageRank (PPR) Mode** - Graph walking for connected context discovery:
```typescript
traverse({
    mode: "ppr",  // personalized pagerank
    seed_nodes: string[], // entity_keys from explore() hits
    max_depth?: number, // default: 3
    damping?: float, // default: 0.85
    top_k?: number // default: 20
});
```

**How PPR Works:**
- Start from seed nodes (typically high-scoring hits from `explore()`)
- Walk the graph weighted by relevance + edge strength
- Surfaces connected context that pure embedding search misses
- 20% improvement over standard RAG, 10-30x cheaper than iterative retrieval (per HippoRAG, NeurIPS 2024)

**2. Cypher Mode** - Direct graph queries for specific patterns:
```typescript
traverse({
    mode: "cypher",  // direct cypher query
    cypher: string,  // cypher query
    verbose?: boolean // if false, automatically shortens content
});
```

**Use PPR mode for**: "Tell me everything related to my Google job decision" (broad context gathering)

**Use Cypher mode for**: "Show me all people I've talked about in the last week" (specific structural queries)

---

## Team Management & Access Control

### Team Structure

**Team Creation**:
```cypher
CREATE (t:Team {
  team_id: randomUUID(),
  name: $teamName,
  created_at: datetime(),
  created_by: $userId,
  settings: $settingsJson
})
```

**Team Membership** (stored in Supabase PostgreSQL):
```sql
CREATE TABLE team_members (
  team_id UUID REFERENCES teams(id),
  user_id UUID REFERENCES users(id),
  role TEXT CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);
```

**Roles**:
- `owner`: Can delete team, manage all settings, invite/remove members
- `admin`: Can invite/remove members, manage settings
- `member`: Can access team knowledge, contribute to conversations

### Access Patterns

**Reading Personal Semantic Knowledge** (any query):
```typescript
// All semantic nodes are user-scoped
const query = `
  MATCH (c:Concept)
  WHERE c.user_id = $userId
  RETURN c
`;
```

**Reading Team Sources** (episodic memory):
```typescript
// Get user's team IDs from Supabase
const userTeams = await getTeamIdsForUser(userId);

// Query Neo4j with team filter for Sources only
const query = `
  MATCH (s:Source)
  WHERE s.team_id IN $teamIds
    OR s.user_id = $userId
    OR $userId IN s.participants
  RETURN s
`;
```

**Creating Entities** (ingestion pipeline):
```typescript
// All semantic entities are user-scoped
await personRepository.create({
  canonical_name: normalizedName,
  user_id: userId,
  created_by: userId,
  ...entityData
});

// Sources can be team-scoped
const teamId = conversation.team_id || null;  // null = personal source
await sourceRepository.create({
  entity_key: uuid(),
  user_id: userId,
  team_id: teamId,
  ...sourceData
});
```

**Personal vs Team Sources**:
```typescript
// Personal conversation
const source = {
  entity_key: uuid(),
  user_id: userId,
  team_id: null,              // Null = personal
  participants: [userId],     // Single participant
  context_type: "personal-reflection"
};

// Team meeting
const source = {
  entity_key: uuid(),
  user_id: userId,            // Who initiated/contributed
  team_id: teamId,            // Team context
  participants: [user1, user2, user3],  // Multiple participants
  context_type: "team-meeting"
};
```

### Multi-Team Support

Users can belong to multiple teams. Implementation considerations:

**Primary Team**: Each user has a `primary_team_id` (default context for team Sources)

**Team Switching**:
```typescript
// UI allows user to switch active team
setActiveTeam(teamId: string) {
  // Changes which team Sources are visible
  // Semantic graph (user_id scoped) stays the same
}
```

**Cross-Team Source Queries**:
```cypher
// User can access Sources from any of their teams
MATCH (s:Source)
WHERE s.team_id IN $userTeamIds
RETURN s
```

**Semantic Graph Isolation**: User's personal semantic graph is always filtered by `user_id`, regardless of active team. Team membership only affects Source visibility.

### Authorship & Attribution

**Node-Level Tracking**:
- `created_by`: User who first created the entity
- Can be updated if entity is merged from multiple sources

**Note-Level Tracking**:
- `added_by`: User who added each note
- Enables "who said what" queries and audit trails

**Relationship-Level Tracking**:
- `recorded_by`: User who created/updated the relationship
- For personal relationships (from owner node), this is always the owner

**Example Query - Show Contributions**:
```cypher
// Find all semantic entities for user (all are user-scoped)
MATCH (e:Entity {user_id: $userId})
RETURN e

// Find all notes added by user (in their own graph)
MATCH (n)
WHERE n.user_id = $userId
UNWIND n.notes AS note
WITH n, note
WHERE note.added_by = $userId
RETURN n.name, note.content, note.date_added
```

### Access Control Implementation

**Query-Time Filtering** (applied to all reads):
```typescript
// Repository base class
interface QueryFilters {
  [key: string]: string | number | boolean | null;
}

class BaseSemanticRepository {
  async find(filters: QueryFilters) {
    // Semantic nodes always filter by user_id only
    const query = `
      MATCH (n:${this.label})
      WHERE n.user_id = $userId
      AND ${this.buildFilterClause(filters)}
      RETURN n
    `;

    return this.neo4j.run(query, { userId: this.userId, ...filters });
  }

  private buildFilterClause(filters: QueryFilters): string {
    // Convert filters object to Cypher WHERE clauses
    return Object.keys(filters).map(key => `n.${key} = $${key}`).join(' AND ');
  }
}

class SourceRepository {
  async find(filters: QueryFilters) {
    // Sources filter by team_id AND user participation
    const userTeams = await this.getUserTeams(this.userId);

    const query = `
      MATCH (s:Source)
      WHERE (s.team_id IN $teamIds OR s.user_id = $userId OR $userId IN s.participants)
      AND ${this.buildFilterClause(filters)}
      RETURN s
    `;

    return this.neo4j.run(query, { teamIds: userTeams, userId: this.userId, ...filters });
  }
}
```

**Write-Time Validation**:
```typescript
// Ensure user can write to team
async validateTeamAccess(userId: string, teamId: string): Promise<boolean> {
  const membership = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .single();

  return membership !== null;
}

// Before creating entity
if (teamId && !(await validateTeamAccess(userId, teamId))) {
  throw new Error('User does not have access to this team');
}
```

### Edge Cases & Conflict Resolution

**Same Entity, Different Users**:
- Multiple users can have entities with identical names (e.g., User A and User B both have "Google" entity)
- Scoped by user_id, no conflicts
- Each user's "Google" node reflects their personal context and relationships

**User Leaves Team**:
- User loses access to team Sources (team_id-scoped episodic memory)
- User's personal semantic graph (user_id-scoped) remains fully accessible
- User's personal Sources (team_id=null) remain accessible
- User's contributions (created_by, added_by) in their graph remain attributed

**Entity Merging** (not applicable):
- Semantic nodes are personal, not shared
- No need to merge entities between users
- Each user maintains independent semantic interpretations

**Personal Relationships - Multiple Users, Same Real-World Person**:
```cypher
// Alice's personal view of "Sarah"
(alice:Person {is_owner: true, user_id: 'alice-123'})
  -[:has_relationship_with {
    description: 'Close friend and former colleague',
    relationship_type: 'friend',
    attitude: 5,  // close
    proximity: 5,  // intimate-knowledge
    notes: [
      {content: 'We worked together at Google from 2019-2021', added_by: 'alice-123', ...},
      {content: 'She helped me through a difficult time', added_by: 'alice-123', ...}
    ],
    relation_embedding: [...],  // embedded from "friend close intimate-knowledge"
    notes_embedding: [...],  // embedded from concatenated notes
    recorded_by: 'alice-123',
    state: 'core',
    salience: 0.85
  }]-
(aliceSarah:Person {user_id: 'alice-123', canonical_name: 'sarah'})

// Bob's personal view of "Sarah" (separate node, different context)
(bob:Person {is_owner: true, user_id: 'bob-456'})
  -[:has_relationship_with {
    description: 'Coworker in marketing department',
    relationship_type: 'colleague',
    attitude: 3,  // neutral
    proximity: 3,  // familiar
    notes: [
      {content: 'Works on campaign strategy', added_by: 'bob-456', ...}
    ],
    relation_embedding: [...],  // embedded from "colleague neutral familiar"
    notes_embedding: [...],
    recorded_by: 'bob-456',
    state: 'active',
    salience: 0.35
  }]-
(bobSarah:Person {user_id: 'bob-456', canonical_name: 'sarah'})

// Both Alice and Bob may have learned about Sarah from the same team Source,
// but each maintains their own Person node with personal context
```

---

## Design Notes

**Personal Knowledge Graphs with Shared Sources**: This schema prioritizes individual interpretation over shared consensus. Each user builds their own semantic understanding from shared episodic experiences (team Sources).

**Clean Separation of Concerns**:
- **Episodic layer** (Sources): Team-scoped, shared across members
- **Semantic layer** (Person/Concept/Entity/relationships): User-scoped, personal interpretation
- **Artifacts**: User-scoped outputs

**Full Authorship**: Every contribution is attributed (`created_by`, `added_by`, `recorded_by`). Enables audit trails and "who contributed what" queries within personal graphs.

**Multi-Team Support**: Users can belong to multiple teams, affecting which Sources they see. Their semantic graph stays consistent (always filtered by `user_id`), regardless of active team context.

**Simpler Access Control**: No complex team-scoped entity resolution or merging logic. All semantic queries simply filter by `user_id`. Only Sources need team-based access checks.

