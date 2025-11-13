# Storyline Node

**Storyline** (Meso-level memory - coherent block of activity around a specific entity):

## Overview

Represents 5+ Sources across 3+ days anchored to a Person/Concept/Entity

## Fields

- `storyline_id` - Unique identifier
- `user_id` - User ownership
- `team_id` - Team ownership
- `anchor_entity_key` - Reference to anchoring entity (Person/Concept/Entity)
- `name` - Storyline name
- `description` - Narrative description
- `embedding` - Vector embedding for semantic search
- `is_dirty` - Flag for refresh triggering
- `source_count` - Number of included sources
- `started_at` - Timeline start
- `last_source_at` - Most recent source
- `salience` - Importance/relevance score
- `state` - Current state tracking
- `ttl_policy` - Time-to-live retention policy
- `access_count` - Access frequency tracking
- `recall_frequency` - Recall pattern tracking
- `timestamps` - Audit trail

## Relationships

- `(Storyline)-[:about]->(anchor)` - Links to anchoring Person/Concept/Entity
- `(Storyline)-[:includes]->(Source)` - References included Source nodes

## Lifecycle Management

### Promotion
Nightly job when anchor meets thresholds:
- `source_count >= 5`
- `distinct_source_days >= 3`

### Refresh
Nightly job re-summarizes when `is_dirty = true`

## Complete Documentation

See [hierarchical-memory.md](./hierarchical-memory.md) for complete details on Storyline lifecycle, promotion criteria, refresh mechanisms, and integration with the hierarchical memory system.
