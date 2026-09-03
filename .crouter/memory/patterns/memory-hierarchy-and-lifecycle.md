---
kind: knowledge
when-and-why-to-read: When work touches salience, decay, retention, note expiry,
  or the Storyline/Macro hierarchy, this knowledge should be read because memory
  policy is enforced by copied repository code and three nightly jobs whose
  coverage is narrower than the schema, so a change verified in one place leaves
  the rest of the graph on the old behaviour.
surfaces:
  - on: read
    match:
      - ./backend/src/services/decayService.ts
      - ./backend/src/services/consolidationService.ts
      - ./backend/src/services/noteCleanupService.ts
      - ./backend/src/repositories/**
      - ./backend/src/utils/nodeHelpers.ts
      - ./backend/src/db/schema.ts
      - ./backend/src/types/graph.ts
    at: preview
  - on: boot
    gate:
      kind:
        - developer
        - design
        - plan
        - explore
    at: name
rationale: Retired ingestion design documents describe active Storyline/Macro
  promotion, universal access updates on retrieval, and separate Note nodes;
  agents reading them implemented against lifecycle behaviour the code never
  had, and the audit found the access policy copied across four repositories
  with Source and Artifact silently outside decay.
last-updated: 2026-09-03T07:13:54.191Z
origin:
  created: 2026-09-03T07:13:54.191Z
  cwd: /Users/silasrhyneer/Code/Cosmo/Saturn
  node: 3zl47w7d-mtl6pw20-38b9a05b
---

# Memory hierarchy and lifecycle

## The principle

Every semantic node and semantic relationship in the graph carries the same lifecycle field set — `salience`, `state`, `access_count`, `recall_frequency`, `last_recall_interval`, `decay_gradient`, `last_accessed_at`, `ttl_policy`, `is_dirty` — and three nightly pg-boss jobs act on it: decay reduces salience and archives, consolidation rewrites descriptions flagged dirty, note cleanup drops expired serialized notes. The field set is uniform; the machinery that drives it is not. Access policy is copied per repository, the retrieval path writes access counters for three labels only, `Source` and `Artifact` never receive the salience the decay query requires, and the Source → Storyline → Macro hierarchy exists as labels, TypeScript interfaces, constraints, and indexes with no code that creates, attaches to, refreshes, or retrieves a Storyline or Macro.

## Why this shape won

Lifecycle state lives on the graph rather than in a policy table because decay is a bulk Cypher pass: one query per label rewrites salience, decay gradient, and state in batches of 1000 without loading nodes into the process. That choice puts the policy constants inside Cypher and inside each repository's access method, which is why the same rule now exists in several copies and why coverage is per-label rather than global — adding a node class to the schema does not add it to any lifecycle path.

## The map

### Where lifecycle values are written

| Site | Files | What it writes |
|---|---|---|
| Semantic node creation | `backend/src/repositories/` (`PersonRepository.ts`, `ConceptRepository.ts`, `EntityRepository.ts`, `EventRepository.ts`) | `salience: 0.5`, `state: 'candidate'`, `decay_gradient: 1.0`, zeroed counters, `is_dirty: false`. Concept and Entity additionally initialize the hierarchy counters (`source_count`, `first_mentioned_at`, `distinct_source_days`, `distinct_days`, `has_meso`, `has_macro`); Person and Event do not. |
| Semantic relationship creation | `backend/src/agents/tools/factories/edge.factory.ts` | The same defaults in `ON CREATE SET`, plus `valid_from`/`valid_to`; `ON MATCH SET` sets `is_dirty = true`. |
| Source creation | `backend/src/services/sourceManagementService.ts`, `backend/src/repositories/SourceRepository.ts` | No lifecycle values: the repository writes `salience`, `state`, `access_count`, and `ttl_policy` only when the payload carries them, and the ingestion payload carries none. |
| Artifact creation | `backend/src/repositories/ArtifactRepository.ts` | `ttl_policy` only (default `decay`); no salience, state, or access counters. |
| Access on retrieval | `backend/src/services/retrievalService.ts` (`expandGraph`), `backend/src/agents/tools/retrieval/traverse.tool.ts` | Batch increment for Person, Concept, and Entity keys only. |
| Access during ingestion | `backend/src/utils/nodeHelpers.ts` (`bumpSalienceForNode`), called from `backend/src/agents/createAgent.ts`, `mergeAgent.ts`, `edge.factory.ts` | Same repository methods for person/concept/event, with every other type falling through to the Entity repository; failures are logged and swallowed. |
| Note expiry stamps | `backend/src/utils/nodeHelpers.ts` (`applyNotesToNode`, `getExpiresAt`) | `date_added` and `expires_at` computed from the **Source's `started_at`**, not wall clock, with lifetimes week / month / year / forever. |
| Hierarchy schema | `backend/src/db/schema.ts`, `backend/src/constants/graph.ts`, `backend/src/types/graph.ts` | Storyline and Macro uniqueness on `(user_id, anchor_entity_key)`, label/state/anchor indexes, embedding vector indexes, and the interfaces. |

### The access policy, four times over

Person, Concept, Entity, and Event each own an identical `incrementAccess` and `batchIncrementAccess`: `+0.075` salience capped at 1.0, `access_count` and `recall_frequency` `+1`, `last_accessed_at = datetime()`, and `state` recomputed as `core` at 10 accesses or `active` at 1. There is no access-policy service, so a change to the boost, the cap, or the promotion thresholds is a four-file edit and the four copies can drift apart. Because `state` is recomputed from `access_count`, an access is also the only path that lifts a node back out of `archived` — and it exists only for the classes those repositories cover.

### The three nightly jobs

Scheduled in `backend/src/worker.ts` with `singletonKey` per job, all UTC.

| Job | Time | Scope | Behaviour |
|---|---|---|---|
| `runNightlyDecay` — `backend/src/services/decayService.ts` | 03:00 | Labels Person, Concept, Entity, Event, Source, Artifact, Storyline, Macro; relationship types `has_relationship_with`, `engages_with`, `associated_with`, `relates_to`, `involves`, `connected_to` | Skips anything with `salience` null or ≤ 0 and anything already `archived`. |
| `runNightlyConsolidation` — `backend/src/services/consolidationService.ts` | 03:30 | Dirty Person, Concept, Entity nodes and the six semantic relationship types | A `gpt-5.4-mini` tool call rewrites the description (Person also appearance, situation, history, personality, expertise, interests) or the relationship's description/type/attitude/proximity, clears `is_dirty`, and regenerates the node embedding or the relationship notes embedding. Event, Source, Artifact, Storyline, and Macro are never consolidated even though `EventRepository` sets `is_dirty` on update. |
| `runNightlyNoteCleanup` — `backend/src/services/noteCleanupService.ts` | 04:00 | Person, Concept, Entity, Event nodes; six **uppercase** relationship types | Parses `n.notes` / `r.notes`, drops entries whose `expires_at` has passed, and rewrites the array. The uppercase relationship names (`HAS_RELATIONSHIP_WITH` …) do not match the lowercase types the edge factory creates, so relationship notes are never actually swept. |

### What decay computes

- Effective retention is `is_owner = true` → `keep_forever`, otherwise `coalesce(ttl_policy, 'decay')`; nothing but the Artifact tool and an optional Source payload ever sets `ttl_policy`, so every semantic node and edge decays under the default.
- `days_unused` counts from `last_accessed_at` falling back to `created_at`; the rate is `0.02 / (1 + recall_frequency ^ decay_gradient)` and salience becomes `salience * exp(-rate * days_unused)`.
- A `candidate` with `confidence >= 0.8` does not decay at all; a `candidate` below that decays at `rate * (1 + (1 - confidence) * 2)`. Confidence stops mattering once a node reaches `active`.
- The spacing effect adjusts `decay_gradient` up when the recall interval exceeds `last_recall_interval` and down otherwise, with a hard floor of 0.5.
- `keep_forever` pins salience to 1.0 and leaves state untouched. Archival happens at `salience < 0.01`, or for `ephemeral` past 30 days for Source and Artifact, 90 days for every other label and for all relationships.
- Batching pages with `SKIP`/`LIMIT` over the same predicate the query mutates: rows that become `archived` leave the match set, so the window shifts and some nodes are only reached on a later nightly run. The relationship query matches undirected, so each edge is visited from both endpoints within one run.

### Coverage today

| Class | Gets lifecycle defaults | Access updates | Decayed | Consolidated | Notes swept |
|---|---|---|---|---|---|
| Person, Concept, Entity | yes | retrieval and ingestion | yes | yes | yes |
| Event | yes | ingestion only | yes | no | yes |
| Source | no | no | not reachable — no `salience` written | no | n/a (no notes) |
| Artifact | no (`ttl_policy` only) | no | not reachable — no `salience` written | no | n/a (no notes) |
| Semantic relationships | yes | no | yes | yes | no — label-case mismatch |
| Storyline, Macro | no instances exist | — | listed, never populated | no | n/a |

### Stored salience is not retrieval's salience

`retrievalService.calculateSalience` computes a completely separate quantity — distinct relationship count multiplied by `max(0.1, exp(-recency_days / 30))` derived from `updated_at` — and never reads the stored `salience`. Explore stores `combined_score = RRF score + that computed salience` on each hit and then sorts by the RRF score alone (`backend/src/agents/tools/retrieval/explore.tool.ts`). Nothing that decay, consolidation, or the access boost writes influences retrieval ranking today.

### Dormant: named in the schema, absent from the code

| Design element | What exists at HEAD |
|---|---|
| Storyline promotion from anchor counters, incremental attachment, nightly refresh | Nothing. `has_meso` and `source_count` are initialized on Concept and Entity and never read or incremented. |
| Macro promotion from Storylines, weekly refresh | Nothing; `has_macro` likewise. |
| Hierarchy-aware retrieval (granularity, drill-down) | Explore's node-type enum has no Storyline or Macro member and no granularity input. |
| Episodic → semantic consolidation (clustering and archiving old Sources) | Nothing; consolidation is description rewriting only. |
| Bi-temporal invalidation | The edge factory sets `valid_from`/`valid_to` at creation; no path ever closes an edge. |
| Separate `Note` nodes with `HAS_NOTE` / `ADDED_IN` | Notes are serialized JSON arrays on `n.notes` and `r.notes`; no Note node or edge is created anywhere. |

## Compliance

- Adding a node label to the graph adds it to nothing: wire it into `decayService`'s label list, `consolidationService`'s `NODE_CONFIG`, `noteCleanupService`'s label list, and an access method, or state deliberately that it is outside the lifecycle.
- A node class only decays if its creation path writes a positive `salience`; writing lifecycle fields as "optional when supplied" reproduces the Source and Artifact gap.
- Relationship type names are lowercase everywhere they are created; any job or query enumerating them must use the lowercase constants in `backend/src/constants/graph.ts`.
- Changing the boost, cap, or promotion thresholds means editing all four repository access methods until an access-policy service exists; changing decay constants means editing the Cypher in `decayService.ts`.
- Note lifetimes are anchored to the Source's `started_at`, so ingesting old material writes notes that are already expired and the next cleanup run removes them; treat backfill lifetimes as `forever` if the notes must survive.
- Do not describe Storyline or Macro behaviour as current in code, prompts, or tests; the retired design documents under `backend/scripts/ingestion/` specified promotion, refresh, and granularity that were never implemented.

## Edges

- [[saturn/arch/ingestion-pipeline]] — writes lifecycle defaults
- [[saturn/arch/retrieval]] — reads and boosts nodes
- [[saturn/patterns/neo4j-repositories]] — graph access rules
- [[saturn/patterns/provenance-and-personal-scope]] — notes and evidence
- [[saturn/patterns/worker-and-queues]] — nightly job scheduling
