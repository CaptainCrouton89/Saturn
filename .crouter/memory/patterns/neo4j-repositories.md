---
kind: knowledge
when-and-why-to-read: When work adds or changes graph persistence, Cypher, node
  identity, relationship mutation, or Neo4j-backed retrieval, this knowledge
  should be read because Saturn's intended repository boundary is only partially
  enforced and several entry points carry different retry, scope, and mapping
  semantics.
surfaces:
  - on: read
    match:
      - ./backend/src/db/**
      - ./backend/src/repositories/**
      - ./backend/src/services/**
      - ./backend/src/agents/**
      - ./backend/src/utils/**
      - ./backend/src/controllers/graphController.ts
    at: preview
  - on: boot
    gate:
      kind:
        - developer
        - design
        - plan
        - explore
    at: name
rationale: "The architecture audit found that the repository-only graph rule in
  Saturn's front door does not describe HEAD: Cypher, tenancy assumptions,
  mapping, mutation cardinality, and lifecycle policy are split across
  repositories, services, utilities, agent factories, and a controller
  shortcut."
last-updated: 2026-09-03T07:13:08.386Z
origin:
  created: 2026-09-03T07:13:08.386Z
  cwd: /Users/silasrhyneer/Code/Cosmo/Saturn
  node: 3zl47w7d-mtl6pvyp-220d1cbb
---

# Neo4j repositories

## The principle

`backend/src/repositories/` is the intended persistence boundary for Saturn's per-user knowledge graph: code above it should express domain operations, while repositories own parameterized Cypher, `entity_key` identity, `user_id` scope, serialization, and the CREATE/MERGE decision. HEAD does not yet preserve that boundary; graph policy and raw Cypher also live in services, utilities, agent code, and one controller-to-repository shortcut, so changing a graph invariant currently requires auditing every layer.

## Why this shape won

- Neo4j sessions are deliberately short-lived: `backend/src/db/neo4j.ts` opens and closes one session for each `executeQuery` or `executeRaw` call. A repository method composed from several calls therefore has no implicit transaction, which makes the method—not a shared session—the visible unit of intent but not the atomicity boundary.
- `executeQuery<T>` recursively flattens Neo4j nodes and relationships to their properties and converts integers and temporal values before asserting the result as `T`. This keeps driver types out of callers, but it does not validate persisted shapes; repositories compensate with several different result mappers.
- Neo4j is the interpreted memory store, while PostgreSQL remains authoritative for intake and product records. The repository directory includes `PreferenceRepository.ts` and `SupabaseConversationRepository.ts`, but those are PostgreSQL adapters and do not establish a second path into the graph.
- Semantic meaning is personal even when the originating Source is evidence: graph nodes carry `user_id`, and semantic relationship queries usually establish scope through their endpoints rather than a relationship `user_id`. That is why scoping must travel with every repository operation rather than be inferred from the caller.
- Node labels have materially different identity rules, so one generic CRUD repository would erase real behavior: Person permits same-name people, Concept and Entity constrain a name per user, Event derives a deterministic key without a constraint, and Source has both an external `source_id` and an internal key.
- CREATE/MERGE is a retry contract rather than a stylistic Cypher choice because pg-boss can replay ingestion after earlier graph writes have committed.

## The map

### Driver and schema boundary

| Concern | Owner | Current behavior |
|---|---|---|
| Driver lifecycle and query execution | `backend/src/db/neo4j.ts` | A singleton driver verifies connectivity; each query filters out undefined parameters, opens a new session, and closes it in `finally`. `executeRaw` exists for callers that must retain Neo4j records. |
| Constraints and ordinary indexes | `backend/src/db/schema.ts` | API bootstrap creates them serially; conflicts are repaired only for a recognized conflicting index, while other failures stop initialization. |
| Vector indexes | `backend/src/db/schema.ts` | Initialization declares 1,536-dimension cosine indexes for six node labels and six semantic relationship types, but any vector-index creation error becomes a warning. Event and Artifact have no declared vector index. |
| Runtime vector search | `backend/src/repositories/`, `backend/src/services/retrievalService.ts` | Repository similarity methods use `gds.similarity.cosine`; Explore uses a label-scoped `MATCH` plus cosine arithmetic. No runtime query calls `db.index.vector.queryNodes`, so declared vector indexes do not serve current retrieval. |
| Graph visualization read model | `backend/src/repositories/GraphRepository.ts` | The one graph-wide repository selects user-scoped semantic nodes with embeddings; full graph and manual Cypher still live in `backend/src/services/graphService.ts`. |

### Repository ownership

| Repository | Store and responsibility | Non-obvious boundary |
|---|---|---|
| `PersonRepository.ts` | Neo4j Person CRUD, owner Person lookup, candidate search, access updates, and several semantic edges | Person uses a UUID `entity_key`; owner creation is a find/clear/CREATE sequence across separate sessions. |
| `ConceptRepository.ts` | Neo4j Concept CRUD, search, mentions, semantic edges, and access updates | Its key hashes lowercase name + the literal `concept` + user ID, unlike the shared normalization used by Event. |
| `EntityRepository.ts` | Neo4j Entity CRUD, search, mentions, semantic edges, and access updates | Its key hashes lowercase name + user ID; relationship helpers mix MERGE with bare CREATE. |
| `EventRepository.ts` | Neo4j Event CRUD, search, mentions, and access updates | It alone generates embeddings inside the repository, and schema initialization creates neither an Event uniqueness constraint nor an Event index. |
| `SourceRepository.ts` | Neo4j Source CRUD, Source lookup by PostgreSQL ID, mentions, and Artifact provenance edges | `content` and `provenance` are JSON strings in Neo4j; the repository returns some results without parsing them back to their declared object types. |
| `ArtifactRepository.ts` | Neo4j Artifact CRUD and graph provenance edges | Its Source edge direction is Artifact→Source `sourced_from`, while `SourceRepository.ts` also owns Source→Artifact `produced`. |
| `GraphRepository.ts` | Neo4j cross-label visualization projection | It is not the general retrieval boundary; Explore and maintenance issue their own Cypher elsewhere. |
| `PreferenceRepository.ts`, `SupabaseConversationRepository.ts` | PostgreSQL user preferences and Source summaries/statistics | Their location reflects repository naming, not Neo4j ownership; PostgreSQL schema and generated types have a separate authority. |

### Identity and scope

| Node | `entity_key` rule | Enforced uniqueness and lookup consequence |
|---|---|---|
| Person | random UUID | Person key is unique within the Person label; duplicate names are intentional. |
| Concept | SHA-256 of lowercase name + `concept` + user ID | Both key and `(name,user_id)` have Concept-label constraints. |
| Entity | SHA-256 of lowercase name + user ID | Both key and `(name,user_id)` have Entity-label constraints. |
| Event | SHA-256 of normalized, stemmed name + user ID | No Event constraint or index prevents a repeated CREATE from producing duplicate keys. |
| Source | SHA-256 of description + user ID + creation timestamp | Both key and external `source_id` have Source-label constraints; re-entry uses `source_id`, not recomputation. |
| Artifact | SHA-256 of lowercase description + user ID + creation timestamp | The key has an Artifact-label constraint, so every creation time produces a new identity. |

- Neo4j uniqueness constraints are label-local, but multiple services and utilities perform unlabeled `MATCH` operations by `entity_key` and treat the result as graph-wide identity. The key algorithms and constraints do not establish that stronger invariant across labels.
- Tenancy scope is not centralized: many repository reads bind `user_id`, while other reads and mutations rely only on `entity_key`; retrieval salience calculation is one such key-only query. Relationship search instead scopes both endpoint nodes because semantic edges do not persist `r.user_id`.
- Semantic node creation carries provenance through `last_update_source`, normally a Source `entity_key`; serialized notes carry `source_entity_key`, author, date, and expiry. Source `mentions` edges are the separate graph-level evidence link.

### Mutation and mapping behavior

| Operation | HEAD behavior | Consequence for callers |
|---|---|---|
| Semantic node creation | Repositories use CREATE. Concept first checks for a key; Entity relies on its constraint; Event has no matching constraint; Person always allocates a UUID. | “CREATE” is not one uniform duplicate policy across labels. |
| Ingestion semantic edges | `backend/src/agents/tools/factories/edge.factory.ts` canonicalizes direction and MERGEs one typed edge between endpoints. | Repeating this factory call updates the existing edge rather than preserving parallel assertions. |
| Repository edge helpers | Person and Entity include bare CREATE paths; Concept, Source, and Artifact include check-then-CREATE paths; Source mentions also use MERGE. | Single-cardinality edge uniqueness depends on the entry point, and checks are not atomic with creation. |
| Owner Person creation | `findOwner`, clearing existing flags, Person CREATE, and reread are separate queries. | The “one owner Person per user” rule is application policy without a database constraint or transaction. |
| Notes | Person, Concept, Entity, and Event repositories serialize arrays to strings and parse them at many return sites. | Mapping is repeated rather than owned by one persisted-record mapper per label. |
| Driver results | `executeQuery<T>` asserts serialized records; Person, Concept, Entity, and Event repair notes differently, while Source and Artifact often return asserted raw properties. | TypeScript success does not prove JSON, temporal, or required-field shape; graph domain interfaces require `id`, but CREATE stores `entity_key` and the serializer drops Neo4j internal IDs. |
| Access and lifecycle policy | Person, Concept, Entity, and Event repositories each copy candidate ranking plus the access boost, counter updates, and state promotion rules. | A policy change is a four-repository edit and current behavior can drift by label. |
| Compound agent mutations | Node and edge factories sometimes update an embedding, relationship, and node in separate direct queries. | A later failure leaves prior graph writes committed because each call owns a separate session. |

### Boundary departures on HEAD

| Layer outside `backend/src/repositories/` | Current graph access | Why the repository boundary is incomplete |
|---|---|---|
| `backend/src/services/` | Six service files contain 28 direct `executeQuery`/`executeRaw` calls for retrieval, resolution, graph views, decay, consolidation, and note cleanup. | Read models, maintenance policy, and mutation policy remain coupled to Cypher. |
| `backend/src/utils/` | Two utility files contain four direct graph calls and also import repositories. | Node notes and neighbor context are service operations presented as helpers. |
| `backend/src/agents/` | Four agent files contain 14 direct graph calls, concentrated in node/edge factories plus merge execution. | Factories own canonical edge direction, label discovery, embeddings, and persistence; there is no relationship repository or shared transaction boundary. |
| `backend/src/controllers/graphController.ts` | The controller imports repositories directly for owner and visualization reads. | This bypasses the route→controller→service→repository layering used as Saturn's HTTP contract. |

## Compliance

When adding or changing Neo4j behavior:

- Put every new `neo4jService` consumer in `backend/src/repositories/`; services and tools call domain methods rather than accepting Cypher or driver records.
- Require `userId` on every personal-graph repository method and include `user_id` in node matches. A key-only lookup is valid only after graph-wide uniqueness is separately enforced; HEAD's label-local constraints do not provide it.
- Decide CREATE versus MERGE from cardinality: use CREATE when parallel facts are valid; use MERGE for one edge or node per modeled identity. Do not implement uniqueness as check-then-CREATE when retries or concurrent requests can enter the method.
- Keep a compound invariant in one explicit Neo4j transaction. Multiple `executeQuery` calls are independent commits even when wrapped by one repository method.
- Map persisted records once per node or relationship type. The mapper owns serialized JSON, Neo4j temporal conversion, notes, and the choice between `entity_key` and an application `id`; callers do not repair asserted shapes.
- Reserve `executeRaw` for a repository read model that genuinely needs Neo4j nodes or paths; ordinary domain methods return mapped values.
- Keep embedding generation and access/decay policy above persistence. Repositories accept values and perform atomic storage operations so Event and the other semantic labels cannot acquire different orchestration rules by accident.
- Add constraints and ordinary indexes in `backend/src/db/schema.ts` with the mutation that depends on them. A declared vector index does not count as adoption until the query path uses it.
- Use the lowercase canonical semantic relationship vocabulary in `backend/src/constants/graph.ts`; the historical uppercase relationship properties in `backend/src/types/graph.ts` are a second vocabulary, not aliases for edges created by ingestion.
- Preserve Source-based provenance on node notes and relationships, but delegate its user-access rules to the personal-scope pattern rather than inventing a repository-local team policy.

## Edges

- [[saturn/arch/ingestion-pipeline]] — graph mutation path
- [[saturn/arch/retrieval]] — graph read path
- [[saturn/patterns/provenance-and-personal-scope]] — evidence and tenancy
- [[saturn/patterns/memory-hierarchy-and-lifecycle]] — access and decay
- [[saturn/patterns/postgres-schema-and-types]] — store boundary
- [[saturn/arch/artifacts]] — dual-store artifacts
