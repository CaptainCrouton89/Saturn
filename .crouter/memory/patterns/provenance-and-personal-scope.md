---
kind: knowledge
when-and-why-to-read: When work changes graph ownership, Source links, notes,
  relationship creation, Artifact provenance, or retrieval filters, this
  knowledge should be read because a locally plausible query can cross a user
  boundary or detach an interpretation from its evidence.
surfaces:
  - on: read
    match:
      - ./backend/src/services/**
      - ./backend/src/repositories/**
      - ./backend/src/utils/**
      - ./backend/src/agents/tools/**
      - ./backend/src/db/**
    at: preview
  - on: boot
    gate:
      kind:
        - developer
        - design
        - plan
        - explore
    at: name
rationale: Repository guidance described shared team Sources, separate Note
  nodes, bidirectional semantic relationships, and relationship-level user IDs,
  while the executable graph is personal-only, stores notes inline,
  canonicalizes edge direction, and scopes relationships through endpoint
  ownership.
last-updated: 2026-09-03T07:32:17.398Z
origin:
  created: 2026-09-03T07:12:10.177Z
  cwd: /Users/silasrhyneer/Code/Cosmo/Saturn
  node: 3zl47w7d-mtl6pw7z-22af6484
---

# Provenance and personal scope

## The principle

Saturn keeps raw evidence in a Source and makes every semantic node, relationship interpretation, and Artifact personal to one user. The implemented tenant boundary is the `user_id` on graph nodes plus user-derived `entity_key` values; provenance is separate evidence metadata carried by Source links, inline notes, and relationship properties. These concerns must travel together because a record can have correct provenance while still being returned to the wrong user, or correct ownership while losing the Source that justifies it.

## Why this shape won

- PostgreSQL `source` is the durable intake record, while its Neo4j Source mirror retains raw and normalized content for graph drill-down; semantic nodes are interpretations derived from that evidence, not replacements for it.
- Semantic `entity_key` generation includes the user identity, and Neo4j constrains most keys globally, so two users can hold independent interpretations with the same visible name without sharing a node.
- The active ingestion contract supplies only personal Sources: it sets `team_id` to `null` and participants to the owner because PostgreSQL has no team or participant fields.
- Source creation requires the owner `user_id` to appear in `participants`; this is an integrity check, not an access algorithm, because retrieval uses `user_id` rather than participants.
- A mention is directed Source → semantic node. It records that extraction associated evidence with an interpretation; it does not assert that every raw statement became a node.
- Notes are serialized on semantic nodes and relationships rather than stored as Note nodes. Each note carries `added_by`, `source_entity_key`, the Source start time, and an expiry derived from its requested lifetime.
- Semantic relationships have one canonical direction chosen from endpoint labels. Creation records `recorded_by`, `source_entity_key`, and `last_update_source`, but does not write `r.user_id`; relationship retrieval therefore proves scope from both endpoint nodes.
- Artifact provenance has two incompatible live conventions: `SourceRepository` owns Source → Artifact `produced`, while `ArtifactRepository` owns Artifact → Source `sourced_from`. Both are executable helpers, and neither is the universal graph convention.
- The team/shared-memory model is unimplemented. No current write or retrieval path materializes team membership, shared Source access, or shared semantic nodes.

## The map

| Concern | Implemented representation | Owning sites | Non-obvious boundary |
|---|---|---|---|
| Durable evidence intake | PostgreSQL `source` row keyed by source UUID and `user_id` | `backend/src/services/ingestionService.ts`, `backend/supabase/migrations/` | The queued user value is not ownership authority; ingestion reads ownership from the row. |
| Graph evidence mirror | Neo4j Source with `source_id`, user, raw content, serialized normalized content, participants, and optional provenance | `backend/src/services/sourceManagementService.ts`, `backend/src/repositories/SourceRepository.ts` | `source_id` bridges the stores; Source `entity_key` is a hash that includes the user and creation time. |
| Personal semantic nodes | Person, Concept, Entity, and Event nodes with `user_id` and user-derived keys | `backend/src/repositories/PersonRepository.ts`, `ConceptRepository.ts`, `EntityRepository.ts`, `EventRepository.ts` | Most repository reads and mutations accept only `entity_key`, relying on global key uniqueness rather than repeating the tenant predicate. |
| Owner identity | Person with `is_owner=true`, the user's `user_id`, and owner-only `owner_key=user_id` | `backend/src/repositories/PersonRepository.ts`, `backend/src/db/schema.ts` | A Person `owner_key` uniqueness constraint plus one-statement `MERGE` enforce one owner Person per user; non-owners have no owner key. |
| Source attribution | Source → Person/Concept/Entity/Event `mentions` | semantic repositories, `backend/src/repositories/SourceRepository.ts`, `backend/src/services/mentionsLinkingService.ts` | Semantic-node creation can add the mention immediately; the final bulk mention pass covers Person, Concept, and Entity but not Event. |
| Node-note provenance | Serialized `notes` array on each semantic node | `backend/src/utils/nodeHelpers.ts`, semantic repositories | Applying notes loads the Source by key, uses its `started_at` as evidence time, then regenerates the node embedding. |
| Relationship provenance | Canonically directed semantic edge with inline notes and Source/author properties | `backend/src/agents/tools/factories/edge.factory.ts` | The edge has `recorded_by` but no `user_id`; its endpoint nodes carry tenant scope. |
| Relationship reads | Both endpoints filtered to the requested `user_id` for relationship search | `backend/src/services/retrievalService.ts` | The relationship itself is not the scope authority. |
| Node retrieval | Vector and fuzzy searches match node label plus `user_id` | `backend/src/services/retrievalService.ts` | `calculateSalience` matches only `entity_key`; scope is not centralized across all retrieval queries. |
| Graph expansion | Hit-node edges, owner edges, and one-hop neighbors | `backend/src/services/retrievalService.ts` | Neighbor queries filter `neighbor.user_id`; the edges-between-hits query relies on the already selected keys and has no user predicate of its own. |
| Personal work products | Neo4j Artifact with `user_id`; separate PostgreSQL Artifact read model | `backend/src/repositories/ArtifactRepository.ts`, `backend/src/services/artifactService.ts` | Graph and PostgreSQL Artifact representations have no synchronization path. |
| Artifact evidence links | Source → Artifact `produced` and Artifact → Source `sourced_from` helpers | `backend/src/repositories/SourceRepository.ts`, `backend/src/repositories/ArtifactRepository.ts` | Direction and relationship name depend on which repository is called. |
| Team/shared memory | None | no executable owner | Team-capable fields and former design guidance do not constitute an access path. |

## Current boundaries

### Scope is distributed

- Graph tenant scoping is not centralized in one repository or query builder. Repositories, retrieval services, utility helpers, and bound agent tools all issue reads or writes that depend on `entity_key`, `user_id`, or both.
- `entity_key` is globally constrained for Person, Concept, Entity, Event, Source, and Artifact. Event also has a `user_id` index, so its deterministic key no longer permits duplicate or label-scan lookups.
- Source and Artifact keys include the user, while Source's external `source_id` is globally unique. Source lookup by external id does not also test `user_id`.
- Bound edge tools receive the user and Source key from ingestion context, but their endpoint-label lookup matches keys only. Their safety depends on callers providing keys already resolved inside the same user's graph.
- Single-cardinality maintained provenance and semantic edges are enforced by repository and bound-tool `MERGE` operations. Repository relationship properties are set only on creation, so a retry preserves the original interpretation and updates its timestamp; legacy Artifact provenance is pending feature deletion.

### Provenance has four forms

| Form | Answers | Stored as |
|---|---|---|
| Source identity | Which intake record contained the evidence? | PostgreSQL Source UUID mirrored as Neo4j `source_id`, plus graph Source `entity_key`. |
| Mention | Which semantic node was extracted from the Source? | Source → semantic node `mentions`. |
| Inline note | Which evidence added this particular detail and when does it expire? | `source_entity_key`, `added_by`, `date_added`, and `expires_at` inside serialized node or edge notes. |
| Relationship attribution | Which Source and user recorded the interpretation? | `source_entity_key`, `last_update_source`, and `recorded_by` on the semantic edge. |

The absence of a mention, note, or relationship is not evidence that the subject is absent from the user's life; it means the ingested evidence did not produce that graph record.

## Compliance

### When writing evidence or interpretations

- Persist or resolve the Source before creating semantic nodes, notes, or semantic relationships so every derived write can carry a real Source `entity_key`.
- Keep raw Source content intact; normalized content, summaries, notes, embeddings, and relationships are derived interpretations.
- Generate personal semantic identity with both the normalized subject and the owning user. Do not reuse another user's semantic node because its name matches.
- Keep the owner in Source participants on every personal Source. Do not treat participants or `team_id` as implemented authorization.
- Store note provenance in the existing inline note shape. Do not create Note nodes or `HAS_NOTE`/`ADDED_IN` edges without changing the whole representation and its cleanup path.
- Use the canonical semantic relationship direction from `backend/src/agents/tools/factories/edge.factory.ts`; caller-requested direction is normalized before persistence.
- Do not add a third Artifact provenance convention. A change that settles Source/Artifact direction must update both repositories and [[saturn/arch/artifacts]] in the same pass.

### When reading personal memory

- Take the user from the authenticated or job-owned context, not a request-selected graph identity.
- Apply `user_id` to every node-selection boundary even when the current key generator or uniqueness constraint makes a collision unlikely; key uniqueness and tenant authorization are different guarantees.
- For a semantic relationship search, scope both endpoint nodes. Do not infer ownership from `recorded_by`, note authorship, or the absence of `r.user_id`.
- Treat Source drill-down and note provenance as evidence pointers, not permission to cross from a scoped semantic result into an unscoped Source lookup.
- Do not implement team/shared retrieval by loosening personal filters. Team memory requires a separate approved ownership and access design.

## Edges

- [[saturn/arch/ingestion-pipeline]] — evidence derivation
- [[saturn/arch/retrieval]] — scoped graph reads
- [[saturn/patterns/neo4j-repositories]] — persistence boundaries
- [[saturn/arch/artifacts]] — work-product provenance
- [[saturn/arch/auth-and-identity]] — identity authority
- [[saturn/patterns/memory-hierarchy-and-lifecycle]] — retention and access
