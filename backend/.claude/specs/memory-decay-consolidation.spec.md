# Memory Decay & Consolidation System — Spec

## Summary

Three pg-boss scheduled jobs that run nightly to maintain knowledge graph health, plus a prerequisite fix to wire up the `is_dirty` flag during ingestion. Together they implement biologically-inspired memory dynamics: unused memories fade via salience decay, accumulated observations are synthesized into coherent descriptions, and expired ephemeral notes are cleaned up.

**Jobs**: Decay (pure math), Description Consolidation (LLM-based), Note Cleanup (pure Cypher).

**Out of scope**: Episodic-to-semantic consolidation (Source clustering/archival) — deferred to a separate spec.

---

## Behavior

### Prerequisite: `is_dirty` Flag Plumbing

`is_dirty` must be set to `true` in these code paths when notes are written to existing nodes/relationships:

| File | Location | Change |
|------|----------|--------|
| `edge.factory.ts` | `ON MATCH SET` clause (~line 327) | Add `r.is_dirty = true` |
| `edge.factory.ts` | `updateEdgeTool` SET clause (~line 409) | Add `r.is_dirty = true` |
| `edge.factory.ts` | `addEdgeAndNodeNotesTool` SET clause (~line 688) | Add `r.is_dirty = true` on relationship |
| `node.factory.ts` | `updateNodeTool` — wherever notes are set on nodes | Add `n.is_dirty = true` |

The `ON CREATE SET` path keeps `is_dirty = false` (new nodes don't need consolidation yet — their description was just generated).

### Job 1: Nightly Decay (3:00 AM UTC)

**Scope**: All nodes and relationships where `salience > 0` AND `state != 'archived'`, across all users.

**Per node/relationship**:
1. `days_unused = days_since(last_accessed_at ?? created_at)`
2. `base_decay_rate = 0.02 / (1 + recall_frequency ^ decay_gradient)`
3. Confidence modifier (candidates only):
   - `state = 'candidate'` AND `confidence >= 0.8`: skip (no decay)
   - `state = 'candidate'` AND `confidence < 0.8`: `decay_rate = base_decay_rate * (1 + (1 - confidence) * 2)`
   - Otherwise: `decay_rate = base_decay_rate`
4. `new_salience = salience * exp(-decay_rate * days_unused)`
5. TTL policy override:
   - `keep_forever`: force `salience = 1.0`, never archive
   - `ephemeral`: if age > deadline (30d Source/Artifact, 90d semantic), force `state = 'archived'`
   - `decay`: standard behavior
6. If `new_salience < 0.01` AND `ttl_policy != 'keep_forever'`: `state = 'archived'`
7. Spacing effect (applies whenever `last_accessed_at IS NOT NULL`):
   - `interval_days = days_since(last_accessed_at)`
   - `spacing_boost = 0.05 + 0.95 * min(1.0, (1 - exp(-interval_days / 20)) / (1 - exp(-90 / 20)))`
     - Exponential curve from 1d (~0.10) to 90d (1.0). Steep early gains, diminishing returns past 30d.
     - Reference values: 1d≈0.10, 7d≈0.35, 14d≈0.55, 30d≈0.80, 60d≈0.97, 90d≈1.0
   - If `interval_days > last_recall_interval`: `decay_gradient += 0.1 * spacing_boost` (spaced repetition strengthens memory)
   - If `interval_days < last_recall_interval`: `decay_gradient = max(0.5, decay_gradient - 0.05 * (1 - spacing_boost))` (cramming penalty, reduced for longer intervals)
   - `last_recall_interval = interval_days`

**Invariants**:
- `salience` always in `[0.0, 1.0]`
- `decay_gradient` floored at `0.5`
- Owner nodes (`is_owner = true`) always treated as `keep_forever`
- Archived nodes retain all data (soft archive)
- `days_unused = 0` produces `exp(0) = 1.0` — no decay on recently accessed nodes
- `spacing_boost` always in `[0.05, 1.0]` — never zero, even same-day access gets minimal benefit

**Batch strategy**: Cypher batches of 1000 via `SKIP/LIMIT` pagination. Nodes first, then relationships.

**Failure**: Weakly idempotent — double-running applies negligible extra decay since `days_unused` recomputes from same `last_accessed_at`. pg-boss retry: 2 attempts with backoff.

### Job 2: Description Consolidation (3:30 AM UTC)

**Scope**: All Person, Concept, Entity nodes AND all relationships where:
- `is_dirty = true`

**Per node**:
1. Load current `description`, `notes` array (sorted by `date_added`), structured properties
2. Call LLM (`gpt-5-mini`, `reasoningEffort: 'low'`) with the matching consolidation prompt
3. LLM returns updated description (and for Person: optional structured property updates)
4. If description changed: regenerate embedding via `embeddingGenerationService` (`text-embedding-3-small`)
5. Write updates + `is_dirty = false` + `updated_at = datetime()` in a single Cypher SET

**Per relationship**:
1. Load current `description`, `notes`, `attitude`, `proximity`, `relationship_type`
2. Call LLM with relationship-type-specific consolidation prompt
3. LLM returns updated description and optionally updated attitude/proximity/relationship_type
4. If notes changed: regenerate `notes_embedding` (concatenated notes, max 1000 chars)
5. Write updates + `is_dirty = false`

**Invariants**:
- `is_dirty = false` set atomically with description update (single Cypher SET)
- "No update needed" from LLM still clears `is_dirty` (notes were reviewed)
- Notes are NOT removed by this job
- Embedding regeneration only when description actually changed
- Empty notes array + `is_dirty = true`: clear flag, no LLM call

**Concurrency**: If ingestion sets `is_dirty = true` while consolidation writes `is_dirty = false`, the new notes are picked up next cycle.

**Failure**: Per-node granularity. If one LLM call fails, log and skip — leave `is_dirty = true` for next night. Per-call retry: 3 attempts with exponential backoff (1s, 2s, 4s).

### Job 3: Note Cleanup (4:00 AM UTC)

**Scope**: All nodes and relationships with `notes` arrays.

**Algorithm**: Single Cypher query per label/relationship type — filter notes where `expires_at IS NULL OR expires_at > datetime()`. If filtered array smaller than original, SET notes = filtered + update `updated_at`.

**Invariants**:
- Notes with `expires_at = null` are never removed
- Does NOT set `is_dirty = true` (expired notes already incorporated by consolidation)
- Does NOT regenerate embeddings
- Empty result: `notes = []`, not `null`

**Failure**: Pure Cypher. If it fails, expired notes persist one extra day.

---

## Architecture

### New Services

| Service | Responsibility | LLM? |
|---------|---------------|-------|
| `decayService.ts` | Decay formula, TTL enforcement, spacing effect | No |
| `consolidationService.ts` | Orchestrates LLM consolidation for dirty nodes/rels | Yes (gpt-5-mini) |
| `noteCleanupService.ts` | Removes expired notes via Cypher | No |

### Job Scheduling

Enable `schedule: true` in PgBoss constructor. Register schedules in worker startup:
- `queue.schedule('nightly-decay', '0 3 * * *', {}, { tz: 'UTC' })`
- `queue.schedule('nightly-consolidation', '30 3 * * *', {}, { tz: 'UTC' })`
- `queue.schedule('nightly-note-cleanup', '0 4 * * *', {}, { tz: 'UTC' })`

Each job uses `singletonKey` to prevent concurrent duplicate runs.

### Job Ordering

```
Decay (3:00) --> Consolidation (3:30) --> Note Cleanup (4:00)
```

- Decay before Consolidation: decay may archive nodes, avoiding wasted LLM calls
- Consolidation before Cleanup: consolidation reads all notes (including soon-to-expire) before cleanup removes them
- 30-minute gaps provide buffer; `singletonKey` prevents overlap

### Consolidation LLM Pattern

Use `generateText` with existing consolidation prompts + update tools (same two-phase pattern as ingestion agents). Each dirty node/relationship is an independent LLM call. Concurrency limit of 10.

Batch embedding regeneration at the end (collect all updated descriptions, single `batchEmbed()` call) rather than per-node.

---

## Observability

Each job logs structured JSON via the existing logger:

### Decay Job
- `nightly-decay:start` — timestamp
- `nightly-decay:batch` — every 1000-node page: `{ batch, nodesProcessed, relationshipsProcessed }`
- `nightly-decay:complete` — `{ durationMs, nodesProcessed, relationshipsProcessed, nodesArchived, relationshipsArchived }`
- `nightly-decay:error` — on failure: `{ batch, error }`

### Consolidation Job
- `nightly-consolidation:start` — timestamp, `{ dirtyNodes, dirtyRelationships }` (counts from scope query)
- `nightly-consolidation:progress` — every 100 items: `{ processed, total, llmCalls, llmFailures }`
- `nightly-consolidation:complete` — `{ durationMs, nodesConsolidated, relationshipsConsolidated, llmCalls, llmFailures, embeddingsRegenerated }`
- `nightly-consolidation:skip` — when a node has empty notes + `is_dirty`: `{ entityKey, nodeType }`
- `nightly-consolidation:error` — per-node LLM failure: `{ entityKey, nodeType, error, attempt }`

### Note Cleanup Job
- `nightly-note-cleanup:start` — timestamp
- `nightly-note-cleanup:complete` — `{ durationMs, nodesUpdated, relationshipsUpdated, notesExpired }`
- `nightly-note-cleanup:error` — on failure: `{ error }`

---

## Constraints

- **Performance budget**: Decay < 10 min (50K nodes + 30K rels). Consolidation < 60 min (all dirty nodes, no recency filter). Cleanup < 1 min.
- **No new tables**: All state on existing Neo4j properties. Spacing effect uses 24h heuristic, no Postgres meta table.
- **Model**: `gpt-5-mini` for consolidation. `text-embedding-3-small` for embeddings.
- **Concurrency**: Jobs share worker process with ingestion. pg-boss handles scheduling; no custom locking.

---

## Related Files

### To Modify
- `backend/src/queue/memoryQueue.ts` — enable scheduling, add queue names
- `backend/src/worker.ts` — register 3 new job handlers
- `backend/src/agents/tools/factories/edge.factory.ts` — `is_dirty = true` on note writes
- `backend/src/agents/tools/factories/node.factory.ts` — `is_dirty = true` on note writes

### To Create
- `backend/src/services/decayService.ts`
- `backend/src/services/consolidationService.ts`
- `backend/src/services/noteCleanupService.ts`

### Reference
- `backend/src/repositories/PersonRepository.ts` — `incrementAccess()` / batch Cypher patterns
- `backend/src/agents/prompts/consolidation/` — 9 consolidation prompts (3 nodes + 6 relationships)
- `backend/src/services/embeddingGenerationService.ts` — embedding generation
- `backend/src/services/ingestionService.ts` — job handler pattern
- `backend/src/types/graph.ts` — node type interfaces with decay fields
- `backend/src/db/neo4j.ts` — Neo4j query execution
- `backend/scripts/ingestion/decay.md` — authoritative design document
