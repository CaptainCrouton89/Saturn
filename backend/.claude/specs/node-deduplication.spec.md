# Node Deduplication — Spec

## Summary

A nightly pg-boss job that detects and merges duplicate nodes in the knowledge graph. Algorithmically finds candidate pairs via embedding cosine similarity + name similarity, then uses an LLM to triage each pair (merge, keep separate, or reclassify). Merge execution transfers relationships, combines notes, and deletes the secondary node in a single transaction.

Runs after the decay/consolidation/cleanup jobs at **4:30 AM UTC**.

**Out of scope**: Garbage node cleanup (archiving low-quality generic nodes like "the app", "Browser"). That's a rule-based quality filter, not deduplication.

---

## Behavior

### Phase 1: Candidate Detection (Pure Cypher)

**Scope**: All non-archived semantic nodes (Person, Concept, Entity, Event) with embeddings, grouped by `(label, user_id)`.

**Same-label pairs** (primary detection path):
1. Block by `(label, user_id)` — only compare Person↔Person, etc.
2. For each pair within a block where `id(a) < id(b)`:
   - `cosine_sim = gds.similarity.cosine(a.embedding, b.embedding)`
   - `name_sim = apoc.text.jaroWinklerDistance(toLower(a.name), toLower(b.name))`
   - `combined_score = 0.6 * cosine_sim + 0.4 * name_sim`
3. Keep pairs where `combined_score > 0.75` OR `cosine_sim > 0.85` OR `name_sim > 0.92`

**Cross-label pairs** (misclassification detection):
1. Find pairs where `toLower(a.name) = toLower(b.name)` AND `labels(a)[0] <> labels(b)[0]` AND `a.user_id = b.user_id`
2. All exact name matches across labels are candidates (no threshold — always review)

**Review filtering**: Skip pairs that have already been reviewed and haven't changed since:
- A `DEDUP_REVIEWED` relationship exists between the two nodes with a `reviewed_at` timestamp
- Filter condition: exclude pairs where `reviewed_at > max(a.updated_at, b.updated_at)` — meaning neither node has changed since the last review
- If either node has been updated (new notes, description change, etc.), the pair is re-evaluated
- `DEDUP_REVIEWED` relationships are created for `keep_separate` decisions only (merged pairs don't need them — the secondary is deleted)
- `DEDUP_REVIEWED` relationships are also created for `reclassify` decisions after execution, to avoid re-evaluating the same cross-label pair

**Output**: Array of `CandidatePair` objects sorted by `combined_score` descending:
```typescript
interface CandidatePair {
  nodeA: { entityKey: string; name: string; label: string; description: string; notes: NoteObject[]; relationshipCount: number; salience: number; createdAt: string };
  nodeB: { /* same shape */ };
  cosineSimilarity: number;
  nameSimilarity: number;
  combinedScore: number;
  isCrossLabel: boolean;
}
```

**Performance**: O(n²) within each `(label, user_id)` block. With current graph (~100 nodes per label per user), this is ~5K comparisons per user. Acceptable up to ~1K nodes per block. If blocks exceed 1K nodes, switch to top-K approximate nearest neighbors via `gds.similarity.cosine` projection (future optimization, not in v1).

### Phase 2: LLM Triage (Per candidate pair)

**Model**: `gpt-5-mini`, `reasoningEffort: 'low'`

**Per pair**, call LLM with:
- Both nodes' `name`, `description`, `notes` (last 10), `label`, `relationship_count`, `salience`, `created_at`
- Whether this is a same-label or cross-label pair
- The similarity scores

**LLM returns** (structured output via `generateObject`):
```typescript
interface DeduplicationDecision {
  action: 'merge' | 'keep_separate' | 'reclassify';
  // For merge:
  primaryEntityKey: string;      // which node survives
  mergedDescription: string;     // new description combining both
  // For reclassify:
  reclassifyEntityKey?: string;  // which node to reclassify
  newLabel?: string;             // target label
  // For all:
  reasoning: string;             // 1-sentence explanation
}
```

**Primary selection heuristic** (provided to LLM as guidance, not hard rule):
- Prefer the node with more relationships
- Break ties by higher salience, then older `created_at`
- If cross-label reclassify: the correctly-labeled node is always primary

**Concurrency**: 10 parallel LLM calls (same as consolidation).

**Invariants**:
- `keep_separate` is the safe default — LLM should merge only when confident
- Cross-label pairs with different real-world referents → `keep_separate` (e.g., Entity "Omi" the device vs Person "Omi" if they were actually different things)
- On `keep_separate`: create `(a)-[:DEDUP_REVIEWED {reviewed_at: datetime(), reasoning: $reasoning}]->(b)` (undirected semantically, but Neo4j requires a direction — always use lower entity_key → higher entity_key for consistency)
- On `reclassify`: create `DEDUP_REVIEWED` after execution completes

### Phase 3: Merge Execution (Per merge decision)

**Transitive chain guard**: Before executing merges, sort decisions by `combinedScore` descending. Track a `consumed: Set<string>`. For each merge decision, if either node's `entityKey` is in `consumed`, skip it (will be caught next nightly run). Add both keys to `consumed` after execution.

**Per merge, in a single Neo4j transaction**:

#### Step 1: Transfer relationships from secondary → primary
```
MATCH (secondary {entity_key: $secondaryKey})-[r]->(target)
WHERE target.entity_key <> $primaryKey
```
For each relationship `r`:
- Check if primary already has a relationship of the same type to the same target
- **If yes**: Merge notes arrays (append secondary's notes to primary's), keep higher attitude/proximity, set `is_dirty = true`
- **If no**: Create new relationship from primary → target with all of secondary's properties

Repeat for inbound relationships:
```
MATCH (source)-[r]->(secondary {entity_key: $secondaryKey})
WHERE source.entity_key <> $primaryKey
```
Same merge-or-create logic.

#### Step 2: Transfer secondary's `mentions` relationships
Sources that `mentions` the secondary should now `mentions` the primary. Same merge-or-create pattern.

#### Step 3: Merge node properties
- Append secondary's notes to primary's notes (deduplicate by `content + date_added`)
- SET primary's `description` to the LLM-provided `mergedDescription`
- SET `is_dirty = true` (consolidation will re-synthesize next night)
- SET `updated_at = datetime()`

#### Step 4: Delete secondary node
`DETACH DELETE` removes the secondary and all its relationships (including any `DEDUP_REVIEWED` edges).
```
MATCH (secondary {entity_key: $secondaryKey})
DETACH DELETE secondary
```
Any `DEDUP_REVIEWED` relationships the primary had with the secondary are automatically cleaned up. `DEDUP_REVIEWED` relationships the secondary had with *other* nodes are also deleted — those other nodes will be re-evaluated against the primary in the next cycle if they still meet the candidate threshold.

#### Step 5: Regenerate primary's embedding
- Recompute embedding from `name + description + notes` via `text-embedding-3-small`

### Phase 3b: Reclassify Execution (Per reclassify decision)

For cross-label reclassifications (e.g., Person "Omi" should be Entity "Omi"):

1. If a node with the correct label already exists (same name, same user): treat as a merge — run Phase 3 merge logic with the correctly-labeled node as primary
2. If no target node exists: Change the label in-place:
   ```
   MATCH (n {entity_key: $entityKey})
   REMOVE n:Person
   SET n:Entity
   SET n.updated_at = datetime()
   ```
   Note: Entity key should be regenerated since it encodes the type, but this creates a breaking reference. For v1, just change the label and leave the key. Flag with `is_dirty = true`.

---

## Architecture

### New Service

| Service | Responsibility | LLM? |
|---------|---------------|-------|
| `deduplicationService.ts` | Candidate detection, LLM triage, merge execution | Yes (gpt-5-mini) |

### New Prompt

| File | Purpose |
|------|---------|
| `agents/prompts/deduplication/triage.ts` | System prompt for dedup LLM triage decisions |

### Job Scheduling

```typescript
queue.schedule('nightly-deduplication', '30 4 * * *', {}, { tz: 'UTC' });
```

Runs at 4:30 AM UTC, after all decay/consolidation/cleanup jobs complete.

### Job Ordering

```
Decay (3:00) → Consolidation (3:30) → Cleanup (4:00) → Deduplication (4:30)
```

- After consolidation: dirty nodes have fresh descriptions, improving embedding quality for similarity comparison
- After cleanup: expired notes removed, reducing noise in note comparison
- 30-minute gap provides buffer

---

## Observability

| Event | Payload |
|-------|---------|
| `nightly-dedup:start` | `{ timestamp }` |
| `nightly-dedup:candidates` | `{ sameLabelPairs, crossLabelPairs, totalCandidates }` |
| `nightly-dedup:progress` | Every 10 pairs: `{ processed, total, merges, keepSeparate, reclassify, llmFailures }` |
| `nightly-dedup:merge` | Per merge: `{ primaryKey, secondaryKey, relationshipsTransferred, notesAppended }` |
| `nightly-dedup:complete` | `{ durationMs, candidatesEvaluated, mergesExecuted, reclassifications, skippedTransitive, llmCalls, llmFailures }` |
| `nightly-dedup:error` | Per-pair failure: `{ nodeAKey, nodeBKey, error, phase }` |

---

## Constraints

- **Performance budget**: Phase 1 < 2 min (pairwise within blocks). Phase 2 < 15 min (bounded by LLM concurrency × candidate count). Phase 3 < 5 min (sequential transactions). Total < 25 min.
- **Safety**: `keep_separate` is the default. Merges are destructive — the secondary node is deleted. No undo mechanism (but all data transfers to primary first).
- **Concurrency**: `singletonKey` prevents concurrent runs. Ingestion jobs running simultaneously may create new nodes that match existing ones — caught next nightly cycle.
- **Model**: `gpt-5-mini` for triage. `text-embedding-3-small` for embedding regeneration.
- **No new tables**: All state on existing Neo4j properties. No merge history table (rely on logs).
- **Idempotency**: Double-running is safe — Phase 1 re-detects candidates, but merged nodes from first run are gone, so no duplicates in Phase 3.

---

## LLM Triage Prompt Design

The triage prompt should emphasize:

1. **Semantic identity**: Do these two nodes refer to the same real-world thing? Not just "are they similar."
2. **Description evidence**: Compare descriptions — do they describe the same entity from different angles, or genuinely different things?
3. **Name evidence**: "Chaz" vs "Chad" with identical descriptions → likely same person (transcription error). "Mac" vs "APC" → different things despite both being tech.
4. **Cross-label nuance**: A Person "Omi" and Entity "Omi" might both exist legitimately (a person named Omi vs a product called Omi). Only reclassify when one is clearly wrong.
5. **Conservative default**: When uncertain, `keep_separate`. False merges destroy data; false negatives just delay merging by one cycle.

---

## Edge Cases

| Case | Handling |
|------|----------|
| A↔B and B↔C both candidates | Transitive guard: merge highest-score pair first, skip pairs involving consumed nodes |
| Primary and secondary both have relationship to same target | Merge relationship properties: combine notes, keep max(attitude), keep max(proximity), set `is_dirty = true` |
| Secondary has no relationships | Simple delete after note transfer |
| Candidate pair where one node is `is_owner = true` | Owner node is always primary. Never delete owner nodes. |
| Candidate pair where one is `state = 'core'` and other is `state = 'candidate'` | Core node is always primary |
| Cross-label pair where both are valid | `keep_separate` — both exist legitimately |
| Empty notes on both nodes | Still valid for merge if descriptions overlap |
| Reclassify with entity_key mismatch | v1: change label only, leave key. Flag `is_dirty`. Future: regenerate key + update all references |
| Previously reviewed pair, neither node changed | Skip — `DEDUP_REVIEWED` relationship with `reviewed_at > max(updated_at)` filters it out |
| Previously reviewed pair, one node updated | Re-evaluate — new notes/description may change the decision |
| Node deleted between candidate detection and merge | Transaction fails gracefully, logged, skipped |

---

## Related Files

### To Modify
- `backend/src/queue/memoryQueue.ts` — add `NIGHTLY_DEDUPLICATION` queue name
- `backend/src/worker.ts` — register dedup job handler

### To Create
- `backend/src/services/deduplicationService.ts`
- `backend/src/agents/prompts/deduplication/triage.ts`

### Reference
- `backend/src/services/decayService.ts` — sibling nightly job pattern
- `backend/src/services/consolidationService.ts` — LLM call pattern, concurrency
- `backend/src/repositories/PersonRepository.ts` — batch Cypher patterns
- `backend/src/services/embeddingGenerationService.ts` — embedding regeneration
- `backend/src/agents/tools/factories/edge.factory.ts` — relationship creation/update Cypher
- `backend/src/types/graph.ts` — node type interfaces
- `backend/src/db/neo4j.ts` — `neo4jService.executeQuery()`
- `backend/src/constants/graph.ts` — relationship type constants
