# Person Node

> **Related Documentation**:
> - [../architecture.md](../architecture.md) - Overall memory architecture
> - [../relationships.md](../relationships.md) - Person relationships
> - [../memory-management.md](../memory-management.md) - Lifecycle and decay
> - [../hierarchical-memory.md](../hierarchical-memory.md) - Storyline/Macro promotion

## Overview

Person nodes represent individual people the user knows. All Person nodes are user-scoped - each user maintains their own Person nodes, even if multiple users know the same real-world person.

## Properties

### Identity Properties

- **entity_key**: string (UUID - stable, immutable identifier for relationships)
- **user_id**: string (always set - identifies which user this Person belongs to)
- **created_by**: string (user_id of who created this node - always tracked for audit)
- **name**: string
- **canonical_name**: string (normalized name for lookup - UNIQUE per user)
- **is_owner**: boolean (optional - only set to true for the Person node representing the user themselves)

### Content Properties

- **description**: string - a short description of who this person is (not their relationship, just who they are)
- **notes**: [{content: string, added_by: string, date_added: ISO timestamp, source_entity_key: string | null, expires_at: ISO timestamp | null}] - information that doesn't fit elsewhere. expires_at = null means never expires, source_entity_key = entity_key of Source this note was derived from (null if not from a specific Source). **added_by tracks authorship**
- **is_dirty**: boolean - set to true when notes are added, triggers nightly description regeneration
- **embedding**: vector - built from description + notes

### Memory Management Properties

- **confidence**: float (0-1) - confidence that this entity should exist (set at extraction, affects decay rate for candidates)
- **salience**: float (0-1) - graph centrality, boosted on access, decays over time
- **recall_frequency**: int (number of times retrieved, for spacing effect calculation)
- **last_recall_interval**: int (days between last two recalls)
- **decay_gradient**: float (default 1.0, increases with spacing effect for slower forgetting)
- **state**: enum (candidate | active | core | archived)
- **ttl_policy**: enum (keep_forever | decay | ephemeral) - governance: retention policy (precedence order: keep_forever > ephemeral > decay, default: decay)
- **access_count**: int
- **last_accessed_at**: ISO timestamp

### Hierarchical Memory Counters

For Storyline/Macro promotion (see [../hierarchical-memory.md](../hierarchical-memory.md)):

- **source_count**: int (default 0) - number of Sources mentioning this node
- **first_mentioned_at**: ISO timestamp - first Source mentioning this node
- **distinct_source_days**: int (default 0) - number of distinct calendar days with at least one Source mention
- **distinct_days**: [ISO date] - array of distinct dates for deduplication (internal use only)
- **has_meso**: boolean (default false) - set to true when Storyline created for this anchor
- **has_macro**: boolean (default false) - set to true when Macro created for this anchor

### Lifecycle Timestamps

- **created_at**: ISO timestamp
- **updated_at**: ISO timestamp

## Owner Node

A Person node with `is_owner=true` represents the user themselves. Each user has exactly one owner Person node:

- **is_owner**: true (set to true for the owner node, false or unset for other people)
- **user_id**: Set to the owner's user_id
- **canonical_name**: The owner's canonical name
- **Uniqueness**: Constraint enforces one owner Person per user via (user_id, is_owner=true)

**Invariants**:
- **Owner node**: `is_owner=true`, `user_id` set (one owner Person per user)
- **Regular person**: `is_owner=false` (or not set), `user_id` set
- **All Person nodes are user-scoped**: Each user maintains their own Person nodes, even if multiple users know the same real-world person

## Relationships

Person nodes can have the following relationships:

- `(Person)-[:has_relationship_with]->(Person)` - Bidirectional interpersonal connections (see [../relationships.md](../relationships.md#person--person))
- `(Person)-[:engages_with]->(Concept)` - Bidirectional thinking/interest relationships (see [../relationships.md](../relationships.md#person--concept))
- `(Person)-[:associated_with]->(Entity)` - Bidirectional connections to organizations, places, things (see [../relationships.md](../relationships.md#person--entity))
- `(Source)-[:mentions]->(Person)` - Simple provenance link showing which Sources mention this Person (see [../relationships.md](../relationships.md#source--person))

## Database Constraints

```cypher
// Person: entity_key must be globally unique
CREATE CONSTRAINT person_entity_key_unique IF NOT EXISTS
FOR (p:Person) REQUIRE (p.entity_key) IS UNIQUE;

// Person: canonical_name must be unique per user
CREATE CONSTRAINT person_canonical_name_user IF NOT EXISTS
FOR (p:Person) REQUIRE (p.canonical_name, p.user_id) IS UNIQUE;

// Person (owner nodes): user_id must be unique for owner nodes
CREATE CONSTRAINT person_owner_unique IF NOT EXISTS
FOR (p:Person) REQUIRE (p.user_id, p.is_owner) IS UNIQUE;
```

**Purpose**: These constraints enable:
- **User-scoped entity resolution**: Personal semantic knowledge is unique within each user's graph
- **Personal owner isolation**: Each user has exactly one owner Person node (is_owner=true) unique to their user_id
- **Deterministic lookups**: `MERGE` operations use indexed fields for fast, idempotent entity resolution
- **Duplicate prevention**: Database rejects duplicate entities at write time within a user's scope
- **Mutable names**: entity_key (UUID) provides stable identity even when canonical_name changes

## See Also

- [concept.md](./concept.md) - Concept node schema
- [entity.md](./entity.md) - Entity node schema
- [../relationships.md](../relationships.md) - All relationship types
