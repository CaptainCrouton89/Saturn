# Services Layer - CLAUDE.md

Core business logic and data pipeline orchestration for memory extraction, graph operations, and conversation context.

## Service Inventory

**Conversation & Context**:
- `conversationService.ts` - Conversation lifecycle, enqueues ingestion jobs
- `retrievalService.ts` - Semantic search, fuzzy matching, salience, graph expansion for agent tools

**Memory Extraction Pipeline** (5 phases, with Phase 2 parallelization):
- `ingestionOrchestratorService.ts` - Single orchestration point coordinating all phases (1, 2a, 2b, 3, 4, 5)
- `summaryService.ts` - Phase 2a: Generate source summaries (runs parallel with Phase 2b)
- `entityExtractionService.ts` - Phase 2b: Extract entities + generate embeddings (runs parallel with Phase 2a)
- `sourceManagementService.ts` - Phase 3: Create/update source nodes (depends on Phase 2a summary)
- `entityResolutionService.ts` - Phase 4: Match extracted entities to graph nodes (4 internal stages)
- `mentionsLinkingService.ts` - Phase 5: Wire entity mention edges
- `ingestionService.ts` - Legacy pipeline entry point (delegates to orchestrator)

**Graph & Visualization**:
- `graphService.ts` - Graph visualization queries, user/node/relationship loading

**Other**:
- `authService.ts` - JWT device authentication
- `embeddingGenerationService.ts` - Vector embeddings for semantic search (used by retrieval/resolution)
- `artifactService.ts`, `preferenceService.ts` - Domain-specific utilities
- `queryGeneratorService.ts`, `relationshipGenerationService.ts` - Support services
- `consolidationService.ts` - Post-pipeline node consolidation/deduplication (LLM-guided merging)
- `initService.ts` - Initialization logic

## Ingestion Pipeline Phases

Five-phase process with Phase 2 parallelization, orchestrated by `ingestionOrchestratorService`:

| Phase | Service | Notes |
|-------|---------|-------|
| 1 | Orchestrator | Content normalization (cleanup/formatting) |
| 2a | `summaryService` | Generate source summaries **runs in PARALLEL with Phase 2b** |
| 2b | `entityExtractionService` | Extract entities + generate embeddings **runs in PARALLEL with Phase 2a** |
| 3 | `sourceManagementService` | Create/find source nodes (depends on Phase 2a summary) |
| 4 | `entityResolutionService` | Matching (4 internal stages: Decision → CREATE ops → MERGE ops → Relationships) |
| 5 | `mentionsLinkingService` | Wire entity mention edges |

**Parallelization**: Phase 2a + 2b run concurrently. Wall-clock time = max(summaryMs, extractionMs).

## Key Patterns

**Embedding Consistency**: Entity extraction generates embeddings immediately (before resolution). Never extract without embedding.

**Single-Tier Matching**: Entity resolution uses embedding similarity (threshold 0.6, top-10) + LLM decision pass—no cascading fallbacks.

**Repository Pattern**: Services delegate Neo4j operations to dedicated repositories (PersonRepository, ConceptRepository, EntityRepository).

**Tracing/Observability**: Use `withSpan()` wrapper and langsmith `traceable()` for all multi-step operations. Attach structured attributes with `buildEntityAttributes()`.

## Local Conventions

- **Do not modify Phase ordering** without updating orchestrator timing calculations
- **Embedding generation** must happen immediately after entity extraction
- **Parallel phase completion** must be awaited before proceeding to dependent phases
- **Error handling** preserves partial results (e.g., summary succeeds but extraction fails)
- Service methods throw early on validation errors (no silent failures)
