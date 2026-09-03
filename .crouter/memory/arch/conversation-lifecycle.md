---
kind: knowledge
when-and-why-to-read: When work touches conversation creation, transcript
  exchange, ending, onboarding, or the memory-processing handoff, this knowledge
  should be read because one PostgreSQL row spans synchronous model work and an
  asynchronous queue boundary with partial outcomes that still appear complete.
surfaces:
  - on: read
    match:
      - ./backend/src/routes/**
      - ./backend/src/controllers/**
      - ./backend/src/services/**
      - ./backend/src/agents/**
      - ./backend/src/queue/**
      - ./backend/src/worker.ts
      - ./backend/supabase/migrations/**
    at: preview
  - on: boot
    gate:
      kind:
        - explore
        - design
        - plan
        - advisor
    at: name
rationale: Existing conversation guidance described an active voice client,
  trigger-selected onboarding, memory retrieval during ordinary exchanges, and a
  reliable end-to-ingestion handoff, while the client is archived and the
  backend implements different state, agent, and failure boundaries.
last-updated: 2026-09-03T07:37:59.155Z
origin:
  created: 2026-09-03T07:12:15.730Z
  cwd: /Users/silasrhyneer/Code/Cosmo/Saturn
  node: 3zl47w7d-mtl6pwa1-9585a47c
---


# Conversation lifecycle

## Orientation

A conversation is a PostgreSQL Source whose JSON transcript grows through authenticated request/response turns and becomes eligible for asynchronous memory ingestion only after an explicit end request. Conversation completion (`ended_at`) and ingestion completion (`processing_status`) are separate durable facts: an ended conversation can still be queued, processing, completed, or failed for memory extraction.

## State space

| Axis | Values | Meaning |
|---|---|---|
| `ended_at` | null, timestamp | Null projects to active; timestamp projects to completed conversation capture. |
| `processing_status` | null, queued, processing, completed, failed | Separate downstream ingestion lifecycle. Active conversations are null until ending. |
| `attempt_count`, `error_message` | integer, nullable text | Durable ingestion execution detail; enqueue failure is attempt 0. |
| `content_raw` | stored-message JSON array | Complete durable transcript authority. |
| `summary` | null, text | Optional end metadata; summary generation failure still permits ending and queueing. |
| `entities_extracted`, `neo4j_synced_at` | boolean, timestamp | Ingestion completion latch and time, not conversation active/completed status. |

## Transitions

| Event | Durable transition | Result |
|---|---|---|
| Create | Insert Source with empty transcript, active timestamps, extraction latch false, ingestion status null | Return active conversation. |
| Exchange succeeds | Replace full transcript for the authenticated user's active conversation | Return assistant response and bounded history. |
| End summary succeeds or fails | Set `ended_at`, optional summary, and ingestion status queued | Attempt pg-boss submission. |
| Queue submission succeeds | External job exists; Source remains queued | Return completed conversation capture. |
| Queue submission fails | Source becomes failed with queue error and attempt count 0 | End endpoint throws and returns an error; it never reports a clean completed handoff. |
| Worker starts | Source becomes processing with attempt number | Ingestion semantics belong to [[saturn/arch/ingestion-pipeline]]. |
| Worker completes or exhausts retries | Source becomes ingestion completed or failed | Conversation capture remains ended in either case. |

## Invariants

- Every lookup and mutation is scoped by authenticated user ID and `source_type='conversation'` because the Source table also carries information dumps.
- Status derived from `ended_at` describes conversation capture only. Ingestion status must be read separately and never inferred from that timestamp.
- Summary generation is deliberately optional because the transcript remains authoritative evidence.
- End update commits before queue send. If send fails, the service persists failed ingestion state and propagates an error to the controller instead of returning success.
- The queued `userId` is trace context; downstream ownership comes from the Source row.
- Worker retries begin only after a job exists. Producer failure is durable attempt 0, not a hidden completed conversation; an admin retry of an exhausted job immediately returns its Source to queued and clears the old error before the next fetch.
- Transcript replacement and model/tool effects still have no transaction or compare-and-swap guard; concurrent exchanges can overwrite, and tool effects can survive a transcript-write failure.
- Repeat end currently recalculates duration and summary and attempts another job; there is no explicit already-ended idempotence guard.

## Onboarding and client state

The former iOS client is archived at `archive/ios-2026-09-03`; no checked-in client currently drives this contract. `trigger_method` is not persisted and projections return null. Agent onboarding mode remains hardcoded false in the conversation service, while explicit profile onboarding completion remains available through the auth route.

## Edges

- [[saturn/arch/ingestion-pipeline]] — post-end processing
- [[saturn/arch/auth-and-identity]] — user scope
- [[saturn/patterns/api-contracts]] — endpoint projection
- [[saturn/patterns/worker-and-queues]] — queue handoff and terminal failure
- [[saturn/patterns/postgres-schema-and-types]] — shared Source schema
