---
kind: knowledge
when-and-why-to-read: When work changes PostgreSQL-backed state, Supabase
  access, generated database types, or the queue connection, this knowledge
  should be read because those surfaces share a local schema without sharing one
  trust or transaction boundary.
surfaces:
  - on: read
    match:
      - ./backend/supabase/**
      - ./backend/src/db/supabase.ts
      - ./backend/src/types/database.types.ts
      - ./backend/src/controllers/**
      - ./backend/src/services/**
      - ./backend/src/repositories/**
      - ./backend/src/queue/**
      - ./backend/src/worker.ts
      - ./backend/package.json
      - ./web/src/lib/supabase/**
      - ./web/src/lib/supabase-server.ts
      - ./web/src/types/database.types.ts
      - ./web/src/app/api/**
      - ./web/package.json
      - ./.grove/dev.ts
    at: preview
  - on: boot
    gate:
      kind:
        - explore
        - design
        - plan
        - advisor
    at: name
rationale: Repository guidance and audit artifacts repeatedly treated a retired
  migration root, historical web table types, PostgreSQL embeddings, and an
  always-shared queue database as current, sending readers toward contracts that
  the executable checkout does not have.
last-updated: 2026-09-03T07:12:46.377Z
origin:
  created: 2026-09-03T07:12:46.377Z
  cwd: /Users/silasrhyneer/Code/Cosmo/Saturn
  node: 3zl47w7d-mtl6pw0n-0a5b38c5
---

# PostgreSQL schema and generated types

## The principle

`backend/supabase/migrations/` is the only PostgreSQL schema authority. The backend and web `database.types.ts` files are generated projections of the running local Supabase stack, not editable models or substitutes for migrations; application code then narrows that database shape into API and domain contracts.

## Why this shape won

- One ordered migration root keeps Supabase Auth-adjacent tables, application data, and local CLI state on the same schema history; a second root can apply only part of the contract while still producing plausible types.
- Conversation transcripts and information dumps share the `source` table because ingestion needs one Source identifier, ownership field, content envelope, and completion latch regardless of intake path. `source_type` selects the application path; separate historical `conversation` and `information_dump` tables are not part of the schema.
- PostgreSQL owns durable intake, identity support, API keys, preferences, and relational Artifact reads, while Neo4j owns semantic nodes, graph embeddings, and graph Artifact writes. The SQL Source has no embedding column.
- Client privilege follows the process boundary rather than the generated type: backend operations use one service-role client, browser and cookie-aware web clients use the anon key, and the web has a separate server-only service-role client for the waitlist route.
- pg-boss owns its `pgboss` schema through its library lifecycle and selects its connection independently. Local configuration points it at the local Supabase Postgres server, but deployment configuration can point it at another PostgreSQL database.

## The map

| Concern | Owning files | Non-obvious contract |
|---|---|---|
| Migration history and local project | `backend/supabase/migrations/`, `backend/supabase/config.toml` | Migrations are enabled against the local Postgres 17 stack; there is no second repository migration root. |
| Backend generated schema | `backend/src/types/database.types.ts` | Types PostgREST rows, inserts, updates, relationships, JSON, and nullable database defaults for backend queries. |
| Web generated schema | `web/src/types/database.types.ts` | Models the same unified `source` schema, but is a separate generated snapshot rather than an import from the backend. |
| Regeneration workflow | `.grove/dev.ts`, `backend/package.json`, `web/package.json` | `dev db supabase types` overwrites both type files from the running local stack; it does not apply pending migrations first. |
| Backend Supabase access | `backend/src/db/supabase.ts` | A lazy singleton uses `SUPABASE_SERVICE_ROLE_KEY`, disables token refresh and persistence, and therefore bypasses row-level security. |
| Web session access | `web/src/lib/supabase/` | Browser, server, and middleware clients use the anon key; server variants carry the Supabase session in cookies. |
| Web privileged access | `web/src/lib/supabase-server.ts`, `web/src/app/api/waitlist/route.ts` | A distinct server-only service-role client writes waitlist rows; it is not the logged-in user's database session. |
| Unified Source writers | `backend/src/services/conversationService.ts`, `backend/src/controllers/informationDumpController.ts` | Conversations store message arrays and information dumps store text in the same JSONB `content_raw` column. |
| Unified Source processor | `backend/src/services/ingestionService.ts` | `entities_extracted` admits or skips ingestion; `neo4j_synced_at` and normalized `content_processed` are written after graph processing. |
| Identity and API keys | `backend/src/services/authService.ts` | Supabase Auth users are paired with `user_profiles` by application code; API keys retain only a hash and lookup prefix. |
| Relational read models | `backend/src/services/artifactService.ts`, `backend/src/services/preferenceService.ts`, `backend/src/repositories/SupabaseConversationRepository.ts` | These user-facing projections remain PostgreSQL-backed even though memory interpretation lives in Neo4j. |
| Queue persistence | `backend/src/queue/memoryQueue.ts` | `PGBOSS_DATABASE_URL` wins over `DATABASE_URL`; pg-boss creates and maintains tables outside the generated `public` schema types. |

### Schema boundaries that code relies on

| Table | Role | Boundary not enforced by the checked-in SQL |
|---|---|---|
| `source` | Shared durable intake and completion record for conversations and each information dump | `user_id` has no foreign key; there is no durable processing status, attempt count, failure message, or embedding. |
| `user_profiles` | Application profile paired to a Supabase Auth user and later to an owner Person | The SQL comment says it is linked to `auth.users`, but the migration declares no foreign key and does not make `device_id` unique. |
| `user_api_keys` | Hashed per-user API credentials with usage and revocation timestamps | Ownership cascades from `user_profiles`, but authorization still occurs in backend service code. |
| `artifact` | PostgreSQL Artifact list/detail read model | `conversation_id` is an unconstrained UUID, and no database mechanism synchronizes this row with a Neo4j Artifact. |
| `user_preference` | Explicit user instructions and confidence/strength values | The schema permits nullable policy fields that services reject when mapping responses. |
| `audio_file` | Declared audio metadata | `conversation_id` is unconstrained and no active backend or web path writes this table. |
| `waitlist` | Landing-page signup rows | Email is not unique in the migration, so duplicate handling in the route is not a schema guarantee. |

### Type-generation boundary

- Both generated files expose `source`, not separate `conversation` or `information_dump` tables, and represent `content_raw` as `Json`; services use explicit casts because the same column contains stored-message arrays and plain text.
- The two generated files currently differ in generator metadata, declaration order, and whether `user_api_keys.label` is optional on insert. Their agreement on table names does not make either one authoritative over the migration or the live local database.
- Generation reads the running local database. A migration file that has not been applied cannot appear in generated types, while an unrecorded local database change can appear even though a clean checkout cannot reproduce it.
- The generated public-schema view intentionally does not type Supabase Auth internals or pg-boss tables; Auth operations use the Supabase SDK's own types and queue operations use pg-boss types.

### Trust and ownership boundary

- The checked-in migrations declare no row-level-security policies. The anon-key web clients currently establish and refresh identity, but the repository does not provide SQL policy enforcement for application-table access.
- Every backend Supabase query runs with service-role authority. User isolation therefore depends on controllers, services, and repositories deriving or validating the user and adding the matching `user_id` predicate; possession of a generated type supplies no authorization.
- Supabase Auth user creation and lookup also run through the backend service-role client. The `user_profiles.id` pairing and owner Person creation are multi-store application operations rather than a PostgreSQL foreign-key or trigger invariant.

### Source lifecycle boundary

- `ended_at` distinguishes an active conversation from a completed conversation, while `entities_extracted` and `neo4j_synced_at` describe ingestion separately; there is no single stored Source status.
- `entities_extracted=false` cannot distinguish a newly created Source, a Source whose enqueue failed, an active or retrying pg-boss job, and a terminally failed job. Status surfaces can only project pending versus completed from the existing fields.
- A successful information-dump insert followed by enqueue failure leaves the Source row present. A conversation-end enqueue failure leaves `ended_at` set, because ending and queue submission are separate operations.
- PostgreSQL, pg-boss, and Neo4j do not share a transaction. Even when local pg-boss tables occupy the same physical PostgreSQL server as `public.source`, queue submission and Source updates are separate commits.

## Compliance

- Add every application schema change as a new ordered SQL migration under `backend/supabase/migrations/`; do not recreate a root `supabase/` migration tree or rely on a dashboard-only change.
- Apply the migration to the local stack before type generation, then run `dev db supabase types`; review both generated files and never hand-edit either one.
- Treat a generated nullable or optional field as the database contract. Validate stronger domain requirements at the mapping boundary instead of falsifying the generated type.
- Keep service-role clients server-only. Before every backend or privileged web operation, establish the caller's authority and include the intended ownership predicate because the key bypasses row-level security and the migrations supply no policy fallback.
- Keep conversations and information dumps in `source`; add discriminator-specific metadata or lifecycle fields there rather than introducing parallel intake tables that bypass the shared worker path.
- When adding durable failure state, update the migration, both generated types, worker write path, Source status projection, and API contract together; `entities_extracted=false` is not a failure state.
- Configure queue storage explicitly. Do not assume an application-row update can be atomic with pg-boss, because `PGBOSS_DATABASE_URL` may select another database even though local development shares the server.
- Leave semantic embeddings and graph state out of the PostgreSQL generated types unless the storage architecture itself changes; current embedding generation and retrieval belong to Neo4j.

## Edges

- [[saturn/arch/information-dumps]] — Source intake
- [[saturn/arch/auth-and-identity]] — profile ownership
- [[saturn/patterns/worker-and-queues]] — queue database
- [[saturn/patterns/api-contracts]] — DTO projections
- [[saturn/arch/conversation-lifecycle]] — transcript state
