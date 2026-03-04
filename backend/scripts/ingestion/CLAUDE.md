# Ingestion Schema & Documentation

Comprehensive documentation for memory architecture, Neo4j graph schema, and ingestion pipeline.

## Directory Purpose

This directory contains **specification and design docs** for Cosmo's semantic/episodic memory system—not executable code. Acts as single source of truth for:
- Graph node schemas (Person, Concept, Entity, Source, Artifact, Note, Storyline, Macro)
- Relationship types and semantics
- 6-phase ingestion pipeline architecture
- Memory lifecycle (decay, consolidation, hierarchical aggregation)
- Retrieval and context-loading strategies

## Key Conventions

- **`nodes/`** - Individual node type schemas (one .md per type)
- **`schema.md`** - Index/entry point (linked from parent docs)
- **Markdown-first**: Docs drive implementation, not the reverse
- **User-scoped semantics**: Every semantic node (Person, Concept, Entity) belongs to one user
- **Hierarchical aggregation**: Sources → Storylines (5+) → Macros (2+)
- **Salience-based decay**: Memories fade unless accessed/consolidated

## Architecture Highlights

**6-Phase Pipeline** (ingestion-pipeline.md):
1. Content normalization
2. **[1.5 ∥ 3]** Summary + Entity extraction (parallel)
3. Source node creation
4. Entity resolution (4 internal stages, parallel)
5. Mention linking

**Key Design**: Phase 1.5 & 3 run concurrently; Phase 4 has internal parallelization. Total: ~20-60s per conversation.

## Important Boundaries

- **Do NOT modify schemas without updating** linked pipeline/agent-tools docs
- **Node additions** require entries in: nodes/, relationships.md, ingestion-pipeline.md Phase 2, agent-tools.md
- **Relationship changes** need updates to relationships.md AND Phase 4.4 relationship generation logic
- **Read schema.md first** when adding features—it's the authoritative design doc

## Common Tasks

- Adding node type: Start in `architecture.md` → create `nodes/[type].md` → update relationships.md & ingestion-pipeline.md
- Understanding pipeline flow: ingestion-pipeline.md → trace Phase 1 through Phase 5
- Retrieving memory: retrieval.md → agent-context.md → hierarchical-memory.md
