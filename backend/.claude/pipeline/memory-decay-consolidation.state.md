# Pipeline State: memory-decay-consolidation

## Specification Phase

### Alternatives Considered
- Store `last_decay_run_at` in Postgres for spacing effect: Rejected — 24h heuristic simpler, spacing adjustments are small (±0.1)
- Episodic-to-semantic consolidation in same spec: Deferred — architecturally distinct (clustering, cross-doc LLM), deserves own spec
- Switch note writes to append-only (COALESCE + concat): Rejected — agent already builds full merged array, overwrite is fine. Revisit if ingestion parallelized per-user
- Consolidation as lazy (on-access) vs nightly batch: Nightly chosen — matches "sleep consolidation" metaphor, avoids latency on retrieval path

### Key Discoveries
- `is_dirty` is NEVER set to `true` anywhere in codebase — initialized `false` on create, read during retrieval, but no code path flips it
- pg-boss has `schedule: false` explicitly with comment "Keep disabled - not using scheduled jobs in MVP"
- Consolidation prompts exist for all 9 types (3 node + 6 relationship) in `src/agents/prompts/consolidation/`
- `edge.factory.ts` ON MATCH SET overwrites `r.notes = $notes` (full replace, not append) — agent builds merged array
- `incrementAccess()` uses α = 0.075 (midpoint of spec's [0.05, 0.1] range)
- Embedding generation only for Concept/Entity (not Person) — consolidation should match this pattern
- `embeddingGenerationService` uses `text-embedding-3-small` at 1536 dims
- Worker uses `withSpan()` for OpenTelemetry tracing — new job handlers should follow same pattern

### Handoff Notes
- The `schedule: true` flag in pg-boss also requires `clockMonitorIntervalSeconds`, `cronWorkerIntervalSeconds`, `cronMonitorIntervalSeconds` — check pg-boss types for defaults
- Decay job Cypher should use `exp()` function — verify Neo4j has native `exp()` (it does, in APOC or native math)
- Node factory `updateNodeTool` needs investigation — grep found it in `node.factory.ts` but exact Cypher for note SET needs reading during implementation
- Cost model from decay.md uses outdated pricing — update mental model to gpt-5-mini pricing
