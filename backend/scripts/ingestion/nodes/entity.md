# Entity Node

**Entity** represents tangible, nameable things with stable identities in the user's knowledge graph.

## Overview

- **Purpose**: Captures concrete things, places, organizations, projects, products, and events
- **Represents**: Specific instances with proper names or identifiable boundaries
- **Scope**: User-scoped (each user has their own Entity nodes)
- **Unique**: (name, type, user_id) constraint ensures no duplicates per user
- **Use When**: Thing has a proper name or specific instance being tracked (vs. abstract topics = Concept)

## Entity Types

Valid values for the `type` field:

| Type | Examples | Notes |
|------|----------|-------|
| `organization` | "Google", "Y Combinator", "engineering team" | Companies, institutions, teams |
| `location` | "Chicago", "Bay Area", "engineering office" | Cities, countries, offices, places |
| `project` | "Q4 launch", "website redesign" | Concrete initiatives and milestones |
| `product` | "iPhone", "Slack", "Claude API" | Software, tools, physical products |
| `event` | "YC interview", "team offsite", "product launch" | Meetings, conferences, milestones |
| `concept_instance` | "career transition plan", "side project idea" | Specific instances of abstract concepts |

## Node Properties

| Field | Type | Purpose |
|-------|------|---------|
| `entity_key` | string (UUID) | Stable, immutable identifier for relationships |
| `user_id` | string | User who owns this Entity |
| `created_by` | string | user_id of who created this node (usually same as user_id) |
| `name` | string | Normalized name for lookup (can be updated) |
| `type` | string | Entity classification (organization, location, project, product, event, etc.) |
| `description` | string | Short overview of most important information |
| `notes` | array | Information that doesn't fit elsewhere. Each note has: `{content, added_by, date_added, source_entity_key, expires_at}` |
| `is_dirty` | boolean | Flags Entity for refresh/summarization when notes added |
| `embedding` | vector | Semantic embedding built from description |
| `confidence` | float (0-1) | Confidence that this Entity should exist (affects decay rate) |
| `salience` | float (0-1) | Graph centrality score, boosted on access, decays over time |
| `recall_frequency` | int | Number of times retrieved (for spacing effect calculation) |
| `last_recall_interval` | int | Days between last two recalls |
| `decay_gradient` | float | Default 1.0, increases with spacing effect for slower forgetting |
| `state` | string | State tracking: `candidate`, `active`, `core`, `archived` |
| `ttl_policy` | string | Retention policy: `keep_forever`, `decay`, `ephemeral` |
| `access_count` | int | How many times recalled/accessed |
| `last_accessed_at` | datetime | Last access timestamp |
| `created_at` | datetime | Creation timestamp |
| `updated_at` | datetime | Last modification timestamp |

## Hierarchical Memory Counters

| Field | Type | Purpose |
|-------|------|---------|
| `source_count` | int | Number of Sources mentioning this Entity |
| `first_mentioned_at` | datetime | First Source mentioning this Entity |
| `distinct_source_days` | int | Number of distinct calendar days with Source mentions |
| `distinct_days` | array (ISO dates) | Array of distinct dates (internal deduplication) |
| `has_meso` | boolean | Set to true when Storyline created for this anchor |
| `has_macro` | boolean | Set to true when Macro created for this anchor |

## Relationships

| Relationship | Target | Purpose |
|--------------|--------|---------|
| `(Source)-[:mentions]->(Entity)` | Source | Links Source to mentioned Entities |
| `(Person)-[:associated_with]->(Entity)` | Person | Bidirectional connections to organizations, places, things |
| `(Concept)-[:involves]->(Entity)` | Concept | Concept-entity involvement |
| `(Entity)-[:connected_to]->(Entity)` | Entity | Bidirectional entity-to-entity connections |
| `(Artifact)-[:sourced_from]->(Source)` | Source | Links artifacts to their source |

## Entity vs. Concept Distinction

**Use Entity when**:
- Thing has a proper name: "Google", "Chicago", "iPhone"
- Tracking a specific instance: "Q4 launch" (concrete initiative)
- Has identifiable boundaries: "engineering team", "Bay Area office"
- Multiple people might reference the same entity: "Slack" is shared across team

**Use Concept when**:
- Abstract topic: "career transition" (general life theme)
- Generic discussion: "YC applications" (process, not specific submission)
- Preferences/values: "work-life balance"
- Goals: "hit $1M ARR"

**Example**:
- "YC application" as Entity: tracking actual submission with deadline, status, outcome
- "YC applications" as Concept: generic discussion about application process, success rates

## Lifecycle

### Creation
- **Trigger**: LLM extraction identifies tangible thing with user-specific context
- **Resolution**: Matched to existing Entity via entity_key, or created as new node
- **State**: Initially `candidate`, promoted to `active` on sustained recall

### Update
- **Trigger**: New note added or description needs refresh
- **Process**: Sets `is_dirty = true`, queued for nightly description regeneration
- **Note Metadata**: Added_by tracks authorship, source_entity_key links to Source if derived from specific conversation

### Decay & Retention
- **Default Policy**: `decay` - gradual salience decrease over time
- **Spacing Effect**: `decay_gradient` increases with recall, leading to slower forgetting
- **Override Policies**: `keep_forever` (important entities), `ephemeral` (temporary entities)

### Promotion to Storyline/Macro
- **Storyline**: Created when Entity has 5+ Sources across 3+ days
- **Macro**: Created when Entity has 2+ Storylines spanning 30+ days
- **Flags**: `has_meso`, `has_macro` track promotion status

## Related Documentation

For complete details on Entity lifecycle, decay mechanisms, and integration with hierarchical memory, see:

- [hierarchical-memory.md](./hierarchical-memory.md) - Storyline/Macro promotion
- [schema.md](./schema.md) - Full graph schema with constraints
- [agent-tools.md](./agent-tools.md) - Entity creation/update tools

## See Also

- [Person Node](./person.md)
- [Concept Node](./concept.md)
- [Source Node](./source.md)
- [Storyline Node](./storyline.md)
- [Macro Node](./macro.md)
- [Entity Type Guidelines](./schema.md#entity-type-guidelines)
