# Plan: Parallel Entity Resolution Pipeline

## Summary
**Goal:** Reduce ingestion latency by running resolution decisions, node create/merge operations, and relationship generation in parallel batches while keeping existing sibling context guarantees and agent behaviors.

**Type:** Refactor

**Scope:** Large

## Relevant Context
- `EntityResolutionService.resolveEntities` currently mixes LLM decisions, MERGE/CREATE execution, and relationship creation sequentially to maintain the `sourceResolvedEntities` context.
- `runCreateAgent` Phase 2 and `runMergeAgent` both rely on that growing sibling list to create intra-source relationships; moving to naive parallelism would drop these links.
- Mentions linking already executes after resolution; we can mirror this staged approach for resolution + relationship work.

## Implementation Plan

### Task 1: Extract decision pass
- **Files:** `src/services/entityResolutionService.ts` (new helpers)
- **What:**
  - Define a `ResolutionDecision` structure with the entity payload, embedding, neighbors, and LLM verdict (MERGE target key or CREATE reason).
  - Keep existing sort order (type priority, confidence) but run the costly `findResolutionCandidates` + `resolveWithLLM` steps concurrently using `Promise.allSettled` with a small concurrency limit to respect rate limits.
  - Cache neighbor metadata needed for later phases to avoid re-querying Neo4j.
- **Risks/Gotchas:** Preserve deterministic logging order; failures should fall back to CREATE decisions per-entity without aborting batch; ensure tracing spans still wrap each entity’s work.
- **Depends on:** None

### Task 2: Batch MERGE/CREATE execution phase
- **Files:** `src/services/entityResolutionService.ts`, `src/agents/createAgent.ts`, `src/agents/mergeAgent.ts`
- **What:**
  - Consume Task 1 decisions to run MERGE updates and CREATE node insertions in controlled parallel batches.
  - Introduce options/flags so `createNewNode` and `updateExistingNode` can skip relationship work for now (only persist nodes/updates, regenerate embeddings, and return entity keys + summaries for the final pass).
  - Populate a shared `sourceResolvedEntities` array after each operation completes so subsequent phases know every resolved entity.
- **Risks/Gotchas:** Need to refactor agents carefully to avoid duplicating Phase 2 logic; enforce concurrency limits; capture partial failures and continue processing the rest of the batch.
- **Depends on:** Task 1

### Task 3: Dedicated relationship generation pass
- **Files:** `src/services/entityResolutionService.ts`, `src/agents/createAgent.ts`, `src/agents/mergeAgent.ts`, possibly new `src/services/relationshipBatchService.ts`
- **What:**
  - Extract the Phase 2 relationship creation portion from `runCreateAgent` (and any neighbor update logic from merge flows) into a reusable helper that operates on persisted nodes.
  - Run this helper after the MERGE/CREATE phase so it receives the full sibling set plus cached neighbor info; execute relationships for all nodes in parallel batches since they no longer mutate graph structure in ways that affect each other’s context.
  - Aggregate relationship counts per node and feed them back to the orchestrator.
- **Risks/Gotchas:** The relationship helper must distinguish between new nodes and existing targets for prompt context; ensure duplicate relationship prevention still works; handle tool failures gracefully without rolling back node creation.
- **Depends on:** Task 2

### Task 4: Update ingestion orchestrator + telemetry
- **Files:** `src/services/ingestionOrchestratorService.ts`, `src/types/ingestion.ts`
- **What:**
  - Adjust `runIngestionPipeline` to capture the new resolution workflow outputs (e.g., `decisions`, `createdNodes`, `relationshipStats`).
  - Expand timing metrics to include separate durations for the decision phase, node execution phase, and relationship phase.
  - Ensure `semanticRelationshipsCreated` sums the relationship counts from the final pass; keep `merges`/`creations` arrays backwards compatible for existing consumers.
- **Risks/Gotchas:** Trace spans and LangSmith tags need updating to reflect the new phases; guard against null data when resolution returns early.
- **Depends on:** Task 3

### Task 5: Testing & validation
- **Files:** `src/services/__tests__/entityResolutionService.test.ts` (new), existing integration scripts
- **What:**
  - Add unit tests for the parallel decision batching (mocking repositories + LLM) to verify concurrency limits and failure handling.
  - Create integration/regression tests (or manual script) to ingest sample payloads and confirm: same entities resolve as before, intra-source relationships appear, mentions count matches, and timing metrics populate.
  - Validate telemetry events for each new phase.
- **Risks/Gotchas:** Tests need deterministic fixtures despite concurrency; manual testing requires Neo4j + OpenAI access, so document prerequisites and provide mock toggles.
- **Depends on:** Tasks 1-4

## Open Questions
1. Should per-tenant throttles govern the new parallel batches to avoid exceeding OpenAI or Neo4j limits under load?
2. Is it acceptable to keep the relationship creation logic agent-based, or should we seize the opportunity to replace it with deterministic Cypher for better speed/control?
3. How should we surface partial failures (e.g., some relationship runs failing) back to clients—extend the `errors` array shape?
