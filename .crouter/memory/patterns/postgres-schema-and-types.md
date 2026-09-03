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
last-updated: 2026-09-03T07:37:46.524Z
origin:
  created: 2026-09-03T07:12:46.377Z
  cwd: /Users/silasrhyneer/Code/Cosmo/Saturn
  node: 3zl47w7d-mtl6pw0n-0a5b38c5
---


# PostgreSQL schema and generated types

## The principle

`backend/supabase/migrations/` is the only PostgreSQL schema authority. Backend and web `database.types.ts` files are generated projections of the running local Supabase stack, not editable models. Application code narrows those generated shapes into API and domain contracts.

## Source lifecycle schema

Conversations and information dumps share `source`. Content shape varies by intake, while lifecycle fields apply uniformly.

| Column | Contract |
|---|---|
| `id`, `user_id`, `source_type` | Stable intake identity, ownership, and discriminator. |
| `content_raw`, `content_processed`, `summary` | Raw JSONB evidence, normalized chunks, optional descriptive summary. |
| `ended_at` | Conversation-capture completion only; not ingestion completion. |
| `processing_status` | Nullable checked text: queued, processing, completed, or failed. Active conversations remain null until ending. |
| `attempt_count` | Non-negative integer, default 0. Counts worker executions including the initial attempt. |
| `error_message` | Nullable durable ingestion or enqueue failure cause. |
| `entities_extracted` | Completion latch, false until every required graph phase succeeds. |
| `neo4j_synced_at` | Completion timestamp written with the latch and completed status. |

`entities_extracted=false` no longer has to represent queued, processing, and failed by inference. Status APIs return the explicit lifecycle, error, and attempt count. PostgreSQL remains authoritative when Neo4j is down; the worker reconciles every non-null Source status into an existing graph Source every 60 seconds after reconnecting.

## Schema and type workflow

- Add application schema changes as ordered migrations under `backend/supabase/migrations/`.
- Apply migrations to the local stack before generation.
- Run `dev db supabase types` from the source checkout to overwrite both backend and web projections, then review the generated diff; never hand-edit either file.
- Generated nullable and optional fields are the database contract. Stronger requirements belong at service or DTO boundaries.
- pg-boss owns its own schema and types. Its configured database may differ from the public Source database, so queue submission and Source state cannot be one transaction.

## Trust and ownership

Backend Supabase queries use service-role authority and bypass row-level security, so every user operation must establish caller authority and include the intended `user_id` predicate. Generated types do not enforce tenancy. Browser/session clients use the anon key; the server-only waitlist client and backend service-role client must not cross into client bundles.

The `source.user_id` column still has no foreign key and PostgreSQL/Neo4j identity pairing remains application-owned. Semantic embeddings and graph structure stay out of the PostgreSQL Source schema.

## Intake and delivery boundaries

- Conversation creation inserts an active Source with null ingestion status. Ending sets queued before queue submission; enqueue failure updates failed with attempt 0 and propagates.
- Information-dump creation inserts queued because it submits immediately; enqueue failure likewise becomes durable failed.
- Worker fetch sets processing and the attempt number. A successful required path writes completed, clears error, sets the latch and sync timestamp. Exhausted retries write failed and preserve the final message; the worker also projects pg-boss timeout or supervisor failures found during periodic reconciliation.
- Admin retry moves a failed job to retry and projects its Source to queued while clearing the error before the next fetch. PostgreSQL and pg-boss are separate commits, so a projection-write failure remains visible and the next worker fetch still sets processing.
- A process crash between Source update and queue submission can still leave a queued row without a job because storage systems are independently configured; the explicit status makes the orphan visible but does not make the commits atomic.

## Other PostgreSQL boundaries

`user_profiles` pairs application identity with Supabase Auth; `user_api_keys` stores hashes and lookup prefixes; PostgreSQL Artifact rows are a relational read model not transactionally synchronized with graph Artifacts; preferences and waitlist remain relational. The migrations currently provide no broad application-table row-level-security policy fallback.

## Edges

- [[saturn/arch/information-dumps]] — immediate intake
- [[saturn/arch/conversation-lifecycle]] — conversation capture and enqueue
- [[saturn/arch/ingestion-pipeline]] — completion invariants
- [[saturn/patterns/worker-and-queues]] — separate queue persistence
- [[saturn/patterns/api-contracts]] — DTO projection
