# Schema Documentation Index

This directory contains comprehensive documentation for Cosmo's memory architecture and knowledge graph schema.

## Quick Start

**New to the system?** Start here:
1. [architecture.md](./architecture.md) - Overview of memory architecture (semantic vs episodic)
2. [nodes/](./nodes/) - Detailed node schemas (Person, Concept, Entity, Source, etc.)
3. [ingestion-pipeline.md](./ingestion-pipeline.md) - How data flows into the system

## Core Documentation

### Architecture & Design

| Document | Description |
|----------|-------------|
| [architecture.md](./architecture.md) | Memory architecture overview, semantic vs episodic memory, hierarchical aggregation |

### Node Schemas

| Document | Description |
|----------|-------------|
| [nodes/person.md](./nodes/person.md) | Person node schema (user-scoped, represents people user knows) |
| [nodes/concept.md](./nodes/concept.md) | Concept node schema (abstract ideas, goals, preferences) |
| [nodes/entity.md](./nodes/entity.md) | Entity node schema (organizations, places, projects, events) |
| [nodes/source.md](./nodes/source.md) | Source node schema (conversations, emails, meetings - episodic memory) |
| [nodes/artifact.md](./nodes/artifact.md) | Artifact node schema (generated outputs, actions, files) |
| [nodes/storyline.md](./nodes/storyline.md) | Storyline node schema (meso-level aggregations, 5+ sources) |
| [nodes/macro.md](./nodes/macro.md) | Macro node schema (macro-level themes, 2+ storylines) |

### Relationships

| Document | Description |
|----------|-------------|
| [relationships.md](./relationships.md) | All relationship types, properties, attitude/proximity semantics |

### Data Lifecycle

| Document | Description |
|----------|-------------|
| [ingestion-pipeline.md](./ingestion-pipeline.md) | 3-phase ingestion (raw upload → processing → extraction) |
| [decay.md](./decay.md) | Memory lifecycle, state transitions, salience decay, consolidation |
| [hierarchical-memory.md](./hierarchical-memory.md) | Storyline/Macro promotion, meso/macro aggregation layers |

### Retrieval & Context

| Document | Description |
|----------|-------------|
| [retrieval.md](./retrieval.md) | Retrieval implementation (scoring, query expansion, ranking) |
| [agent-context.md](./agent-context.md) | Context loading at conversation start |
| [agent-tools.md](./agent-tools.md) | Agent tools API for graph manipulation |

### Team & Access Control

| Document | Description |
|----------|-------------|
| [team-management.md](./team-management.md) | Team collaboration, access control, authorship tracking |

### Memory Management

| Document | Description |
|----------|-------------|
| [memory-management.md](./memory-management.md) | **DEPRECATED** - Content split into ingestion-pipeline.md and decay.md |

## Common Tasks

### Adding a New Node Type
1. Review [architecture.md](./architecture.md) for node type guidelines
2. Create `nodes/[new-type].md` following existing node patterns
3. Add relationships in [relationships.md](./relationships.md)
4. Update [ingestion-pipeline.md](./ingestion-pipeline.md) Phase 2 extraction
5. Create tools in [agent-tools.md](./agent-tools.md)

### Understanding Data Flow
1. [ingestion-pipeline.md](./ingestion-pipeline.md) - How raw data becomes semantic knowledge
2. [decay.md](./decay.md) - How memories age and consolidate
3. [hierarchical-memory.md](./hierarchical-memory.md) - How Sources promote to Storylines/Macros

### Implementing Retrieval
1. [retrieval.md](./retrieval.md) - Scoring and ranking algorithms
2. [agent-context.md](./agent-context.md) - What to load at conversation start
3. [hierarchical-memory.md](./hierarchical-memory.md) - Multi-granularity retrieval patterns

## Design Principles

**User-Scoped Semantics**: Every user maintains their own personal knowledge graph. Semantic nodes (Person, Concept, Entity) are always scoped by `user_id`.

**Shared Episodic Sources**: Sources (conversations, meetings) can be team-scoped and shared across users, but each user extracts their own semantic interpretation.

**Hierarchical Memory**: Sources aggregate into Storylines (meso-level), which aggregate into Macros (macro-level) for efficient multi-granularity retrieval.

**Salience-Based Decay**: Memories fade over time unless accessed, mimicking human memory consolidation.

**Authorship Tracking**: Every contribution (node creation, note addition, relationship creation) tracks `added_by` for audit trails.

## See Also

- `../../docs/transcript-to-neo4j-pipeline.md` - Original pipeline design document
- `../../tech.md` - Full technical specification (comprehensive reference)
- `../../db.md` - PostgreSQL schema (Supabase tables)
