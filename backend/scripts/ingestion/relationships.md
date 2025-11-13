# Relationships

> **Related Documentation**:
> - [architecture.md](./architecture.md) - Memory architecture
> - [nodes/](./nodes/) - Node schemas
> - [agent-tools.md](./agent-tools.md) - Relationship creation tools

## Overview

Relationships connect semantic nodes (Person, Concept, Entity) and capture structured knowledge about how people, topics, and things relate to each other. **Relationships are first-class entities** with their own lifecycle, salience tracking, and decay mechanisms similar to nodes.

## Shared Properties

All semantic relationships share these properties:

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

### Relationship Scoping

- **user_id must equal both connected nodes' user_ids**: When creating relationships between semantic nodes, set `rel.user_id = from.user_id` and assert `from.user_id = to.user_id`
- **Enables simple query guards**: Filter relationships with `WHERE rel.user_id = $userId` for user-scoped traversals
- **Rationale**: Since all semantic nodes are user-scoped, relationships between them are also user-scoped

## Relationship Types

### Semantic Knowledge Relationships

These relationships connect semantic nodes (Person, Concept, Entity) and represent how people, topics, and things relate to each other. Each relationship type has its own semantic dimensions captured through `attitude` and `proximity` properties. The `relationship_type` field provides a flexible one-word descriptor chosen by the agent at creation time.

**Relationship Type Summary**:

| Type | Direction | Purpose |
|------|-----------|---------|
| Person [has_relationship_with] Person | bidirectional | interpersonal connections |
| Person [engages_with] Concept | bidirectional | thinking/interest relationships |
| Person [associated_with] Entity | bidirectional | connections to organizations, places, things |
| Concept [relates_to] Concept | bidirectional | conceptual connections |
| Concept [involves] Entity | bidirectional | concept-entity involvement |
| Entity [connected_to] Entity | bidirectional | entity-to-entity connections |

#### Person ↔ Person (has_relationship_with)

Bidirectional interpersonal connections. Captures relationships between people with semantic dimensions (attitude, proximity) and flexible relationship types like "friend", "colleague", "sibling", etc.

#### Person ↔ Concept (engages_with)

Bidirectional thinking/interest relationships. Represents how a person engages with concepts, topics, and ideas they care about or study. Relationship types include "studies", "interested-in", "passionate-about", etc.

#### Person ↔ Entity (associated_with)

Bidirectional connections to organizations, places, things. Captures how people relate to entities in their world. Relationship types include "works-at", "owns", "located-at", "member-of", etc.

#### Concept ↔ Concept (relates_to)

Bidirectional conceptual connections. Represents how different concepts and topics relate to each other. Captures thematic and topical relationships in the user's knowledge space.

#### Concept ↔ Entity (involves)

Bidirectional concept-entity involvement. Represents how entities are involved in or relate to broader concepts. For example, a company entity involving a business concept, or a technology entity involving a programming concept.

#### Entity ↔ Entity (connected_to)

Bidirectional entity-to-entity connections. Represents relationships between entities (organizations, places, things). Relationship types capture the nature of connection: "subsidiary-of", "located-in", "partnered-with", etc.

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

## Word Mappings

See [agent-tools.md#word-mappings](./agent-tools.md#word-mappings) for complete attitude/proximity word mappings per relationship type and embedding generation strategy. This enables semantic search queries like "show me close friendly relationships" or "find concepts they're passionate about".

## Relationship Lifecycle

### Bi-Temporal Tracking

Relationships support bi-temporal tracking to handle real-world changes and contradictions:

- **valid_from** / **valid_to**: When the fact/relationship was TRUE in the real world (event time)
- **recorded_at**: When the system learned about this fact (system time)
- **Use temporal validity to handle contradictions**: Instead of marking nodes as conflicted, **invalidate old edges** (set `valid_to`) and create new edges with updated information
- **Preserves complete history**: Enables point-in-time queries: "What did the user think about Google in January?"

**Example**: User's employment status changes
- First edge: `description: "User accepted job offer", valid_from: Jan 1, valid_to: Jan 15, recorded_at: Jan 1`
- Second edge: `description: "User declined job offer", valid_from: Jan 15, valid_to: null, recorded_at: Jan 15`
- Query for current state: `WHERE valid_to IS NULL`
- Query for historical state: `WHERE valid_from <= $date AND (valid_to IS NULL OR valid_to > $date)`

### Note Management

- **Authorship is always tracked**: `added_by` enables audit trails and attribution in team contexts
- **Provenance is explicit**: `source_entity_key` links notes back to originating Sources for traceability
- **Note Lifetime**: Agent chooses lifetime when saving note
  - week → expires_at = date_added + 7 days
  - month → expires_at = date_added + 30 days
  - year → expires_at = date_added + 365 days
  - forever → expires_at = null (never deleted)
- **Notes accumulate over time** as new information is discovered from different sources

### Relationship State and Salience

- **Independent Lifecycle**: Relationships have their own `state` enum (candidate | active | core | archived) independent of connected nodes
- **Independent Salience**: Relationships have their own `salience` that decays independently based on access patterns
- **Dirty Flag Consolidation**: Relationships trigger nightly consolidation via `is_dirty` flag when notes are added or description updated
- **Relationship vs Entity Importance**: Allows tracking relationship importance separately from entity importance
  - Example: User frequently references their relationship with "Sarah" (high salience edge) even if Sarah entity has low salience
