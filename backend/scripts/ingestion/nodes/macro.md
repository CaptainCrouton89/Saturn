# Macro Node

**Macro** represents macro-level memory - a long-running theme spanning multiple Storylines.

## Overview

- **Purpose**: Captures themes that span 2+ Storylines over 30+ days, rooted to a Person/Concept/Entity
- **Represents**: Long-running themes and patterns across conversational history
- **Anchor**: Points to Person, Concept, or Entity node that ties the macro together
- **Aggregation**: Groups related Storylines into coherent long-term patterns

## Node Properties

| Field | Type | Purpose |
|-------|------|---------|
| `macro_id` | string | Unique identifier |
| `user_id` | string | User who owns this memory |
| `team_id` | string | Team context (if applicable) |
| `anchor_entity_key` | string | Entity key of anchor (Person/Concept/Entity) |
| `name` | string | Human-readable name for the macro |
| `description` | string | Summary description of the theme |
| `embedding` | vector | Semantic embedding for similarity search |
| `is_dirty` | boolean | Flags macro for refresh/summarization |
| `storyline_count` | integer | Number of grouped Storylines |
| `total_source_count` | integer | Total Source nodes across all grouped Storylines |
| `started_at` | datetime | When macro was created/detected |
| `last_event_at` | datetime | Most recent update from included Storylines |
| `salience` | float | Importance/relevance score |
| `state` | string | State tracking (active, dormant, archived, etc.) |
| `ttl_policy` | string | Time-to-live retention policy |
| `access_count` | integer | How many times recalled/accessed |
| `recall_frequency` | float | How often accessed in recent period |
| `timestamps` | object | Created/modified/accessed timestamps |

## Relationships

| Relationship | Target | Purpose |
|--------------|--------|---------|
| `(Macro)-[:rooted_in]->(anchor)` | Person/Concept/Entity | Points to anchor entity |
| `(Macro)-[:groups]->(Storyline)` | Storyline | Groups related Storylines |

## Lifecycle

### Promotion (Weekly)
- **Trigger**: Anchor entity has multiple Storylines spanning 30+ days
- **Action**: Creates new Macro node or updates existing one
- **Conditions**:
  - 2+ Storylines present
  - Time span >= 30 days
  - Anchor has sufficient context

### Refresh (Weekly)
- **Trigger**: `is_dirty = true` flag on Macro
- **Action**: Re-summarizes grouped Storylines into updated description
- **Process**: Runs weekly job to maintain narrative coherence

## Related Documentation

For complete details on Macro node architecture, lifecycle management, and integration with the hierarchical memory system, see [hierarchical-memory.md](./hierarchical-memory.md).

## See Also

- [Source Node](./source.md)
- [Storyline Node](./storyline.md)
- [Anchor Patterns](./anchors.md)
- [Hierarchical Memory Architecture](./hierarchical-memory.md)
