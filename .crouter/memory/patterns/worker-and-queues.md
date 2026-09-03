---
kind: knowledge
when-and-why-to-read: When work touches background processing, source
  enqueueing, worker startup, job retries, or scheduled graph maintenance, this
  knowledge should be read because queue durability and source state diverge at
  failures and process boundaries.
surfaces:
  - on: read
    match:
      - ./backend/src/queue/**
      - ./backend/src/worker.ts
      - ./backend/src/index.ts
      - ./backend/src/routes/admin.ts
      - ./backend/src/services/conversationService.ts
      - ./backend/src/controllers/informationDumpController.ts
      - ./backend/src/services/ingestionService.ts
      - ./backend/src/services/decayService.ts
      - ./backend/src/services/consolidationService.ts
      - ./backend/src/services/noteCleanupService.ts
      - ./backend/package.json
    at: preview
  - on: boot
    gate:
      kind:
        - developer
        - design
        - plan
        - explore
    at: name
rationale: The architecture audit found that repository guidance treats enqueue
  success, source completion, pg-boss failure, and nightly maintenance as one
  background-processing lifecycle, while the executable system gives them
  different durable records, retry boundaries, visibility, and process
  ownership.
last-updated: 2026-09-03T08:41:44.330Z
origin:
  created: 2026-09-03T07:14:43.363Z
  cwd: /Users/silasrhyneer/Code/Cosmo/Saturn
  node: 3zl47w7d-mtl6pvzy-3e1e6552
---

# Worker and queues

## The principle

pg-boss is the durable execution boundary between HTTP intake and model-plus-Neo4j work. The API persists a PostgreSQL Source and submits its stable ID; the separate worker owns consumers and maintenance. Queue state and Source state remain separate commits, so the Source row carries the durable user-facing lifecycle while pg-boss carries delivery and retry mechanics.

## State boundaries

| Axis | Values | Authority | Meaning |
|---|---|---|---|
| pg-boss job | created, retry, active, completed, cancelled, failed | pg-boss | Delivery and retry state retained for 30 days for ingestion queues. |
| Source processing status | null, queued, processing, completed, failed | producers and worker | Durable user-facing ingestion state that outlives job deletion. |
| Source attempt count and error | integer, nullable text | worker lifecycle reconciliation | Attempt number comes from job metadata; the final pg-boss failure becomes durable when retries exhaust. |
| Source extraction latch | false, true | ingestion service | Re-entry guard set by the authoritative PostgreSQL completion write after every required semantic phase succeeds. |
| queue singleton and consumers | process-local | queue module and worker | API and worker hold separate singletons against the configured pg-boss schema. |

## Queue declarations

| Queue | Producer | Consumer | Retry and retention |
|---|---|---|---|
| `process-conversation-memory` | conversation end | batches of 5, metadata included | 3 retries, exponential delay from 60 seconds, one-hour active expiry, 30-day deletion |
| `process-information-dump` | information-dump creation | batches of 5, metadata included | same ingestion policy |
| `nightly-decay` | schedule at 03:00 UTC | maintenance worker | 2 retries; 24-hour deletion |
| `nightly-consolidation` | schedule at 03:30 UTC | maintenance worker | 2 retries; 24-hour deletion |
| `nightly-note-cleanup` | schedule at 04:00 UTC | maintenance worker | 2 retries; 24-hour deletion |

`createQueue` does not revise an existing durable policy, so startup calls `updateQueue` for both ingestion queues after creation. `PGBOSS_DATABASE_URL` wins over `DATABASE_URL`; queue persistence may be in a different PostgreSQL database from the public Source table.

## Delivery and re-entry

| Event | Durable result | Recovery |
|---|---|---|
| Source write then send succeeds | Source queued plus pg-boss job | Worker fetch sets processing and attempt count. |
| Producer send fails | Source failed with attempt count 0 and queue error | Caller receives an error; an operator may retry the intake rather than being told it completed. |
| Required ingestion failure | Source remains processing during retry window | Worker rethrows; pg-boss performs three retries. |
| Final attempt fails before durable completion | Source failed with error and attempt count 4; pg-boss job failed | Callback failures persist directly; timeout and supervisor failures are discovered by lifecycle reconciliation. A completion-projection retry preserves the already completed Source. |
| Admin retries job | pg-boss failed job moves to retry; an unlatched Source becomes queued and clears its error, while a latched Source remains completed | The next worker fetch sets processing for unlatched work or reprojects Neo4j completion for latched work. |
| Required semantic pipeline succeeds | Source completed, extraction latch true, graph sync timestamp set | Re-delivery uses the latch to reapply only the idempotent Neo4j completion projection. |
| Neo4j is unavailable during a status update | PostgreSQL remains authoritative | The worker retries every non-null Source status in Neo4j every 60 seconds after connectivity returns. |
| One job in a batch throws | pg-boss fails the whole fetched callback batch | Successfully completed siblings may redeliver and stop on their completion latch. |

## Operations

`GET /admin/queue-status` returns statistics for both ingestion queues. `GET /admin/failed-jobs` queries failed records across both queues and returns job ID, queue, payload, retries, completion timestamp, and error. `POST /admin/retry/:jobId` resolves the job's actual ingestion queue before retrying; it never assumes conversation memory.

The worker requests pg-boss metadata so `retry_count` and `retry_limit` are authoritative. On a catch, it persists terminal failure only when the fetched job's retry count has reached its retry limit, then rethrows so pg-boss records the same failure. Every 60 seconds it also reads failed ingestion jobs from pg-boss, covering handler timeouts and supervisor failures that bypass the callback, then reconciles every non-null PostgreSQL Source status into Neo4j. The initial attempt is attempt 1; retry counts 1, 2, and 3 map to Source attempts 2, 3, and 4.

## Compliance

- Use the exported queue singleton; another `PgBoss` instance creates another pool, supervisor, and policy surface.
- Persist Source state before send and treat Source and job as separate commits.
- Throw every failure pg-boss must retry; logging is not failure handling.
- Read ownership and content from the Source row, not queued user metadata.
- Keep handlers re-entry-safe because partial graph commits, active expiry, batch failure, and completion-write failure can all redeliver work.
- Update durable queue policy as well as creation defaults when changing existing queues.
- Persist terminal state outside pg-boss because job retention is operational history, not the user-facing lifecycle authority; reconcile failed operational jobs because pg-boss can fail a handler outside its callback.

## Edges

- [[saturn/arch/ingestion-pipeline]] — required phases and completion
- [[saturn/arch/information-dumps]] — alternate producer
- [[saturn/arch/conversation-lifecycle]] — conversation handoff
- [[saturn/patterns/postgres-schema-and-types]] — Source persistence
