# Ingestion Schema & Documentation

Comprehensive documentation for memory architecture, Neo4j graph schema, and ingestion pipeline.

## Directory Purpose

This directory contains **specification and design docs** for Cosmo's semantic/episodic memory system—not executable code. Acts as single source of truth for:
- Graph node schemas (Person, Concept, Entity, Source, Artifact, Note, Storyline, Macro)
- Relationship types and semantics
- 3-phase ingestion pipeline architecture
- Memory lifecycle (decay, consolidation, hierarchical aggregation)
- Retrieval and context-loading strategies

## Key Conventions

- **`nodes/`** - Individual node type schemas (one .md per type)
- **`schema.md`** - Index/entry point with navigation (start here for overview)
- **Markdown-first**: Docs drive implementation, not the reverse
- **User-scoped semantics**: Every semantic node (Person, Concept, Entity) belongs to one user
- **Hierarchical aggregation**: Sources → Storylines (5+) → Macros (2+)
- **Salience-based decay**: Memories fade unless accessed/consolidated

## Key Documents

**Architecture & Pipeline**:
- `schema.md` - Entry point with full document index and navigation
- `ingestion-pipeline.md` - 3-phase ingestion flow (normalization → extraction → linking)
- `decay.md` - Memory lifecycle and consolidation

**Context & Retrieval**:
- `agent-context.md` - Context loading at conversation start (layered loading strategy)
- `retrieval.md` - Semantic search and traversal implementation
- `hierarchical-memory.md` - Multi-granularity retrieval (Sources/Storylines/Macros)

**Graph Design**:
- `nodes/` - Individual node type schemas
- `relationships.md` - All relationship types and edge semantics
- `agent-tools.md` - Agent tools API for graph manipulation

## Important Boundaries

- **Do NOT modify schemas without updating** linked pipeline/agent-tools docs
- **Node additions** require entries in: nodes/, relationships.md, ingestion-pipeline.md, agent-tools.md
- **Relationship changes** need updates to relationships.md AND Phase 4.4 relationship generation logic
- **Read schema.md first** when adding features—it's the authoritative design doc

## Common Tasks

- Adding node type: Start in `schema.md` → create `nodes/[type].md` → update relationships.md & ingestion-pipeline.md
- Understanding pipeline flow: ingestion-pipeline.md → trace phases 1-3
- Loading agent context: agent-context.md → implements layered loading (user identity → relationships → episodic memory → temporal)
- Retrieving memory: retrieval.md → agent-context.md → hierarchical-memory.md
