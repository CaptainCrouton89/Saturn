# Memory Architecture

> **Related Documentation**:
> - [nodes/](./nodes/) - Detailed node schemas (Person, Concept, Entity, Source, Artifact, Storyline, Macro)
> - [relationships.md](./relationships.md) - Relationship types and properties
> - [hierarchical-memory.md](./hierarchical-memory.md) - Storyline/Macro aggregation layers
> - [memory-management.md](./memory-management.md) - Ingestion pipeline and lifecycle
> - [team-management.md](./team-management.md) - Team collaboration and access control

## Core Principle

**Semantic nodes (Person, Concept, Entity, relationships) are always user-scoped; Sources can be personal or team-scoped, and multiple users derive their own semantic graphs from the same Sources.**

This schema implements a **personal knowledge graph with shared episodic sources** architecture inspired by human cognition:

## Semantic Memory

**Personal, structured knowledge that persists long-term:**

- **Person**, **Concept**, **Entity** nodes represent each user's extracted knowledge about people, topics, and things
- **User-scoped**: Every user maintains their own personal semantic graph (filtered by `user_id`)
- **Personal interpretation**: Multiple users can extract different semantic knowledge from the same shared Source
- Rich relationships between semantic nodes capture how knowledge connects in each user's mental model
- Salience and decay mechanisms determine what stays in active memory
- User-specific information that wouldn't be inferrable by an LLM alone

**See**: [nodes/person.md](./nodes/person.md), [nodes/concept.md](./nodes/concept.md), [nodes/entity.md](./nodes/entity.md)

## Episodic Memory

**Shared experiences and raw source material:**

- **Source** nodes are the primary episodic unit, storing both raw and processed content with full processing pipeline tracking
- **Team-scoped or personal**: Sources can be shared across team members (`team_id` set) or private (`team_id` = null)
- **Artifact** nodes capture user-specific generated outputs from conversations (user-scoped like semantic nodes)
- Sources provide temporal context and can be consolidated into semantic knowledge over time

**See**: [nodes/source.md](./nodes/source.md), [nodes/artifact.md](./nodes/artifact.md)

## Memory Consolidation

Over time, frequently accessed episodic content gets extracted into personal semantic knowledge, while less relevant sources can be archived. This mimics human memory consolidation during sleep.

**See**: [memory-management.md#memory-consolidation](./memory-management.md#memory-consolidation-episodic--semantic)

## Hierarchical Aggregation

Sources that frequently mention the same entities are automatically promoted into **Storyline** nodes (meso-level, 5+ sources, 3+ days), and long-running storylines are grouped into **Macro** nodes (macro-level, 2+ storylines, 30+ days). This enables retrieval at different granularities without expensive clustering.

**See**: [hierarchical-memory.md](./hierarchical-memory.md), [nodes/storyline.md](./nodes/storyline.md), [nodes/macro.md](./nodes/macro.md)

## Team Collaboration

Multiple users share Sources (conversations, meetings, documents) and each builds their own semantic interpretation. Authorship is tracked at note level and relationship level. Each user maintains personal perspectives (e.g., "my relationship with Sarah") derived from shared episodic experiences.

**See**: [team-management.md](./team-management.md)

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
- **Granularity 1 (micro)**: Individual Sources with full content and neighbor context
- **Granularity 2 (meso)**: Storyline summaries with 5-20 Source metadata previews
- **Granularity 3 (macro)**: Macro overviews with Storyline metadata (no individual Sources)

**See**: [retrieval.md](./retrieval.md)

## Node Types

### Semantic Knowledge Nodes

| Node Type | Description | Scope | See |
|-----------|-------------|-------|-----|
| **Person** | Individual people the user knows | User-scoped | [nodes/person.md](./nodes/person.md) |
| **Concept** | Abstract ideas, topics, goals, values | User-scoped | [nodes/concept.md](./nodes/concept.md) |
| **Entity** | Organizations, places, projects, events | User-scoped | [nodes/entity.md](./nodes/entity.md) |

### Episodic Memory Nodes

| Node Type | Description | Scope | See |
|-----------|-------------|-------|-----|
| **Source** | Conversations, emails, meetings, documents | Personal or team-scoped | [nodes/source.md](./nodes/source.md) |
| **Artifact** | Generated outputs (actions, files, summaries) | User-scoped | [nodes/artifact.md](./nodes/artifact.md) |

### Hierarchical Aggregation Nodes

| Node Type | Description | Scope | See |
|-----------|-------------|-------|-----|
| **Storyline** | Coherent blocks of 5+ sources across 3+ days | Personal or team-scoped | [nodes/storyline.md](./nodes/storyline.md) |
| **Macro** | Long-running themes grouping 2+ storylines | Personal or team-scoped | [nodes/macro.md](./nodes/macro.md) |

### Team Management Nodes

| Node Type | Description | Scope | See |
|-----------|-------------|-------|-----|
| **Team** | Team metadata and settings | Global | [team-management.md](./team-management.md) |

## Relationship Types

All semantic relationships connect user-scoped nodes and track authorship, provenance, and lifecycle independently of connected nodes.

**See**: [relationships.md](./relationships.md) for complete relationship schema

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
