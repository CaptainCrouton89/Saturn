# Ingestion Pipeline Architecture

## Overview

The ingestion pipeline transforms raw conversational data (voice memos, meetings, transcripts) into structured semantic knowledge for Cosmo's Neo4j graph. The pipeline is **parallel, resumable, and optimized for performance**.

## 6-Phase Architecture (with Parallelization)

```
Raw Input → Phase 1 → [Phase 1.5 ∥ Phase 3] → Phase 2 → Phase 4 → Phase 5 → Neo4j Graph
              ↓              ↓          ↓           ↓          ↓          ↓
         Normalize      Summary    Entities    Source    Resolution  Mentions
                        (parallel execution)
```

**Key Insight**: Phase 1.5 and Phase 3 execute in **parallel**. Wall-clock time = `max(summaryMs, extractionMs)`, not the sum.

### Phase 1: Content Normalization
- **Input**: Raw transcript (string or array)
- **Process**: Clean up transcript format, normalize to array of strings
- **Model**: None (deterministic string processing)
- **Output**: `string[]` - Normalized content chunks
- **Error Handling**: THROW (abort pipeline if fails)
- **Time**: <100ms
- **Cost**: Free

### Phase 1.5: Summary Generation ⚡ PARALLEL
- **Input**: Raw transcript (original format)
- **Process**: Generate high-level summary for Source node
- **Model**: `gpt-5-mini` with structured output
- **Output**: `string` - Conversation summary
- **Error Handling**: THROW (Source node requires summary)
- **Time**: 2-5s
- **Cost**: ~$0.005 per conversation
- **Note**: Runs in parallel with Phase 3

### Phase 3: Entity Extraction ⚡ PARALLEL
- **Input**: Normalized content from Phase 1
- **Process**: Extract People, Concepts, Entities with embeddings
- **Model**: `gpt-5-mini` with reasoning (medium effort)
- **Embedding**: Generated immediately after extraction (name + description)
- **Output**: `ExtractedEntity[]` with embeddings
- **Error Handling**: CONTINUE (empty array on failure, pipeline proceeds)
- **Time**: 5-15s (includes embedding generation)
- **Cost**: ~$0.01 per 10k words + embeddings
- **Note**: Runs in parallel with Phase 1.5

### Phase 2: Source Node Creation
- **Input**: Summary from Phase 1.5, normalized content from Phase 1
- **Process**: Create or update Source node (episodic memory)
- **Model**: None (deterministic Neo4j operations)
- **Output**: `sourceEntityKey` (string)
- **Error Handling**: THROW (cannot create mentions without Source)
- **Time**: 100-500ms
- **Cost**: Free
- **Note**: Waits for BOTH Phase 1.5 and Phase 3 to complete

### Phase 4: Entity Resolution
Multi-stage resolution process with parallel execution:

#### Stage 1: Parallel Decision Pass
- **Input**: Extracted entities with embeddings
- **Process**: For each entity, find candidates via RRF (embedding + exact + fuzzy match), LLM decides MERGE or CREATE
- **Model**: `gpt-5-nano` for LLM decisions
- **Execution**: Parallel processing (concurrency limit: 5)
- **Output**: Array of resolution decisions with cached neighbors
- **Time**: 5-20s (depends on entity count)
- **Cost**: ~$0.005 per entity

#### Stage 2: Execute CREATE Operations
- **Input**: CREATE decisions from Stage 1
- **Process**: Create new nodes in parallel using CREATE agent
- **Model**: `gpt-5-nano` for node structuring
- **Execution**: Parallel (node creation is independent)
- **Output**: New nodes with `entity_key`
- **Time**: 2-10s

#### Stage 3: Execute MERGE Operations
- **Input**: MERGE decisions from Stage 1
- **Process**: Update existing nodes in parallel using MERGE agent
- **Model**: `gpt-5-nano` for note updates
- **Execution**: Parallel (updates existing nodes)
- **Output**: Updated nodes
- **Time**: 2-10s

#### Stage 4: Generate Relationships
- **Input**: All resolved nodes (CREATE + MERGE) from Stages 2 & 3
- **Process**: Auto-generate semantic relationships between entities
- **Model**: `gpt-5-nano` for relationship reasoning
- **Execution**: Parallel (concurrency limit: 5)
- **Output**: Semantic relationships created
- **Time**: 5-15s
- **Cost**: ~$0.002 per relationship

**Phase 4 Total Time**: ~15-55s (depends on entity count and decisions)
**Phase 4 Error Handling**: CONTINUE (best-effort, empty results on failure)

### Phase 5: Linking Mentions
- **Input**: Source entity key, resolved entities
- **Process**: Create `MENTIONS` edges from Source to all resolved entities
- **Model**: None (deterministic Neo4j operations)
- **Output**: Number of mentions edges created
- **Error Handling**: CONTINUE (pipeline succeeds even if 0 edges created)
- **Time**: 100-500ms
- **Cost**: Free

## Key Features

### Parallel Execution
- **Phase 1.5 and Phase 3 run concurrently** to minimize wall-clock time
- **Phase 4 uses internal parallelization** for decision pass, CREATE, MERGE, and relationship generation
- **Result**: ~50% faster than sequential execution

### Embedding Strategy
- Embeddings generated **during extraction** (Phase 3), not post-processing
- Uses `name + description` for semantic similarity
- Regenerated after node updates in Phase 4 (includes notes)
- Enables **RRF-based candidate search** (embedding + exact + fuzzy)

### Error Resilience
- **THROW phases** (1, 1.5, 2): Critical failures abort pipeline
- **CONTINUE phases** (3, 4, 5): Best-effort, pipeline succeeds with partial results
- **Cascading best-effort**: Phase 3 failure → Phase 4 skipped → Phase 5 runs with 0 entities

### Resolution Strategy (Phase 4)
1. **Sort entities**: person → entity → concept, confidence DESC within type
2. **Parallel decision pass**: Find candidates (threshold 0.6, top-10) + LLM decides MERGE/CREATE
3. **Separate CREATE/MERGE execution**: CREATE runs first (so new nodes visible to relationships), MERGE updates existing
4. **Auto-generated relationships**: LLM analyzes entity pairs and creates semantic relationships

## State Evolution

```typescript
Phase 1: raw transcript → normalized content (string[])
Phase 1.5 (parallel): raw transcript → summary (string)
Phase 3 (parallel): normalized content → entities with embeddings (ExtractedEntity[])
Phase 2: summary + content → source node (sourceEntityKey)
Phase 4: entities + embeddings → resolved nodes + relationships
Phase 5: source + resolved entities → mentions edges (count)
```

## Timing Breakdown

| Phase | Time | Parallelization | Status |
|-------|------|-----------------|--------|
| 1 | <100ms | - | Sequential |
| 1.5 + 3 | max(2-5s, 5-15s) = **5-15s** | ⚡ Parallel | Concurrent |
| 2 | 100-500ms | - | Sequential |
| 4.1 | 5-20s | Batch parallel (concurrency: 5) | Decision pass |
| 4.2 + 4.3 | max(2-10s, 2-10s) | ⚡ Internal parallel | CREATE + MERGE |
| 4.4 | 5-15s | Batch parallel (concurrency: 5) | Relationships |
| 5 | 100-500ms | - | Sequential |
| **Total** | **~20-60s** | **Optimized** | **Per conversation** |

**Without parallelization**: ~35-80s (60% slower)

## Cost Breakdown

| Phase | Model | Cost |
|-------|-------|------|
| 1 | - | Free |
| 1.5 | gpt-5-mini | ~$0.005/conversation |
| 3 | gpt-5-mini + embeddings | ~$0.01/conversation |
| 2 | - | Free |
| 4.1 | gpt-5-nano | ~$0.005/entity |
| 4.2 + 4.3 | gpt-5-nano | ~$0.01/entity |
| 4.4 | gpt-5-nano | ~$0.002/relationship |
| 5 | - | Free |
| **Total** | - | **~$0.05-0.15/conversation** |

**Optimization**: Using `gpt-5-nano` for resolution (Phase 4) instead of `gpt-5-mini` saves ~70% on LLM costs.

## Integration

### From Background Worker (pg-boss)
```typescript
import { runIngestionPipeline } from './services/ingestionOrchestratorService.js';

const result = await runIngestionPipeline({
  sourceId: 'conv_abc123',
  userId: 'user_xyz',
  teamId: null,
  sourceType: 'conversation',
  summary: 'User discusses work project',
  transcriptRaw: 'Hey Cosmo, I had a great meeting today...',
  transcriptProcessed: undefined, // Phase 1 will normalize
  participants: ['User', 'Cosmo'],
  createdAt: new Date().toISOString(),
  sessionId: 'session_456', // For Langfuse grouping
});

console.log(`Processed ${result.extractedEntities.length} entities`);
console.log(`Created ${result.creations.length} new nodes, merged ${result.merges.length}`);
console.log(`Total time: ${result.timings.totalMs}ms`);
```

### From API Endpoint (Direct Call)
```typescript
import { processSource } from './services/ingestionService.js';

await processSource('source_id', 'user_id');
// Fetches source from PostgreSQL, runs pipeline, marks as processed
```

## Phase Dependencies

```
Phase 1 (normalization)
    ↓
┌───┴────────────────┐
│ Phase 1.5 (summary) │ ⚡ PARALLEL
│     ∥               │
│ Phase 3 (extraction)│ ⚡ PARALLEL
└───┬────────────────┘
    ↓ (wait for both)
Phase 2 (source) ← depends on Phase 1.5 summary
    ↓
Phase 4 (resolution)
├─ Stage 1: Decision Pass (parallel)
├─ Stage 2: CREATE (parallel)
├─ Stage 3: MERGE (parallel)
└─ Stage 4: Relationships (parallel)
    ↓
Phase 5 (mentions)
    ↓
Done
```

**Critical Path**: Phase 1 → Phase 3 (if slower than 1.5) → Phase 2 → Phase 4 → Phase 5

## Files Reference

**Orchestrator**: `src/services/ingestionOrchestratorService.ts`
**Phase Executor**: `src/utils/phaseExecutor.ts`
**Services**:
- Phase 1: Built-in normalization (line 181)
- Phase 1.5: `src/services/summaryGenerationService.ts`
- Phase 3: `src/services/entityExtractionService.ts`
- Phase 2: `src/services/sourceManagementService.ts`
- Phase 4: `src/services/entityResolutionService.ts`
- Phase 5: `src/services/mentionsLinkingService.ts`

**Investigation Docs**: `docs/investigations/` (phase naming conflicts, execution flow)

## Future Work

1. **Adaptive concurrency limits** based on entity count
2. **Phase 4 optimization**: Cache embeddings across batches
3. **Streaming entity output** for real-time UI updates
4. **Multi-source support** (email, Slack, docs)
5. **Relationship confidence scoring** (prioritize high-confidence relationships)
6. **Incremental graph updates** (detect unchanged entities, skip resolution)
7. **Phase 1.5 conditional execution** (skip if summary exists)

## Migration Notes

**Previous Architecture** (OUTDATED):
- Had Phase 0 (content cleaning) - **NOT IMPLEMENTED**
- Phase 1 was "Entity Extraction" - **NOW Phase 3**
- Phase 3 was "Entity Updates (agent-based)" - **NOW Phase 4 with auto-generated relationships**
- Phase 4 was "Relationship Agent" - **NOW Stage 4 within Phase 4**

**Current Architecture**: See phase numbering above (1, 1.5, 2, 3, 4, 5).
