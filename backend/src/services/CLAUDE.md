# Services Layer - CLAUDE.md

Core business logic and data pipeline orchestration for memory extraction, graph operations, and conversation context.

## Service Inventory

**Conversation & Context**:
- `conversationService.ts` - Conversation lifecycle, enqueues ingestion jobs
- `retrievalService.ts` - Semantic search, fuzzy matching, salience, graph expansion for agent tools

**Memory Extraction Pipeline** (6 phases, multi-stage):
- `ingestionOrchestratorService.ts` - Single orchestration point coordinating all phases (1, 1.5, 2, 3, 4, 5)
- `entityExtractionService.ts` - Phase 3: Extract entities + generate embeddings (runs parallel with Phase 1.5)
- `entityResolutionService.ts` - Phase 4: Match extracted entities to graph nodes (4 internal stages)
- `summaryGenerationService.ts` - Phase 1.5: Generate source summaries (runs parallel with Phase 3)
- `sourceManagementService.ts` - Phase 2: Create/update source nodes
- `mentionsLinkingService.ts` - Phase 5: Wire entity mention edges
- `ingestionService.ts` - Legacy pipeline entry point (delegates to orchestrator)

**Graph & Visualization**:
- `graphService.ts` - Graph visualization queries, user/node/relationship loading

**Other**:
- `authService.ts` - JWT device authentication
- `embeddingGenerationService.ts` - Vector embeddings for semantic search (used by retrieval/resolution)
- `artifactService.ts`, `preferenceService.ts`, `summaryService.ts` - Domain-specific utilities
- `queryGeneratorService.ts`, `relationshipGenerationService.ts` - Support services
- `initService.ts` - Initialization logic

## Ingestion Pipeline Phases

Six-phase multi-stage process orchestrated by `ingestionOrchestratorService`:

| Phase | Service | Notes |
|-------|---------|-------|
| 1 | Orchestrator | Content normalization (cleanup/formatting) |
| 1.5 | `summaryGenerationService` | Generate source summaries **runs in PARALLEL with Phase 3** |
| 2 | `sourceManagementService` | Create/find source nodes (depends on Phase 1.5 summary) |
| 3 | `entityExtractionService` | Extract entities + generate embeddings **runs in PARALLEL with Phase 1.5** |
| 4 | `entityResolutionService` | Matching (4 internal stages: Decision → CREATE ops → MERGE ops → Relationships) |
| 5 | `mentionsLinkingService` | Wire entity mention edges |

**Parallelization**: Phase 1.5 + 3 run concurrently. Wall-clock time = max(summaryMs, extractionMs).

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
