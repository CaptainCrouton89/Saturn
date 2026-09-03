---
kind: knowledge
when-and-why-to-read: When you start work anywhere in the Saturn repository,
  this knowledge should be read because it names the one lifecycle CLI, the
  layer boundaries, and the conventions that differ from defaults so a change
  lands where the rest of the code expects it.
short-form: "Saturn front door: dev CLI, where to work, gotchas, done gate"
surfaces:
  - on: workspace-open
    at: content
  - on: read
    match: ./**
    at: content
last-updated: 2026-09-03T07:16:44.191Z
origin:
  created: 2026-09-03T06:37:35.301Z
  cwd: /Users/silasrhyneer/Code/Cosmo/Saturn
  node: 3zl47w7d-mtl4fq6m-b9f71632
namespace: saturn
---

# Saturn (Cosmo)

Voice-first AI companion that asks the user questions and remembers what they say. Two live components, dependency direction top to bottom: the Express API (`backend/src/index.ts`) and the pg-boss worker (`backend/src/worker.ts`) share the `backend/src/` services, agents, and repositories; those write to two databases — Supabase Postgres (transcripts, embeddings, users, the pg-boss queue) and Neo4j (the per-user knowledge graph). `web/` is a Next.js landing page, upload form, and graph visualizer that reads the API. The iOS app is archived at git tag `archive/ios-2026-09-03` (not in the tree). Production is intentionally down: both cloud Supabase projects are paused and the Railway API is not to be redeployed; everything runs locally until the Cloudflare move. Architecture memories live under `saturn/arch` (end-to-end slices) and `saturn/patterns` (cross-cutting rules); `saturn/product` and `saturn/glossary` are still to be written. The old `backend/scripts/ingestion/*.md` design docs and `docs/api-endpoints.md` are deleted — the memories replaced them.

## Common commands

Run from the repository root; `dev` is Grove's dispatcher into `.grove/dev.ts` (run `dev -h`).

- `dev start` / `dev stop` / `dev status` — api (3001), worker, web (3000); brings up local Neo4j (docker) and Supabase when `.env` points at localhost.
- `dev doctor` — read-only env, deps, database, and port checks.
- `dev check` — backend `tsc --noEmit` then `vitest run`.
- `dev logs --service api` — recent output; pids and logs live in `.grove/run/`.
- `dev db neo4j reset` — wipe the local graph (refuses a remote URI without `--force`).
- `dev db supabase types` — regenerate `database.types.ts` in backend and web from the local stack.
- `cd backend && pnpm run type-check` — the pre-push hook runs exactly this.

## Where to work

| Task | Path |
|---|---|
| HTTP surface | `backend/src/routes/` → `controllers/` → `services/` |
| Conversation agent, prompts, tools | `backend/src/agents/` (`orchestrator.ts`, `createAgent.ts`, `tools/`, `prompts/`) |
| Ingestion, consolidation, decay, retrieval | `backend/src/services/*Service.ts`; jobs in `backend/src/queue/memoryQueue.ts` |
| Neo4j access | `backend/src/repositories/` only; schema in `backend/src/db/schema.ts` |
| Postgres schema | `backend/supabase/migrations/`; generated types `backend/src/types/database.types.ts` and `web/src/types/database.types.ts` (do not hand-edit) |
| Landing, upload, graph visualizer | `web/src/`; `web/src/components/graph/` |

## Non-default rules and gotchas

- API responses are `snake_case`; web maps at its API adapter. Neo4j property names follow the same convention.
- Never use `any`; throw early, no silent fallbacks. Pre-production: no backwards-compatibility shims.
- The API must boot when Neo4j is down (`index.ts` catches the connect failure); keep that.
- Backend `.env` is the only env file the api and worker read. `.env.production` is for Railway. `dev doctor` lists the required keys.
- Local Neo4j is the `neo4j` docker container from `backend/docker-compose.yml` (`neo4j`/`testpassword`); Neo4j and Supabase are shared across Grove instances — only api and web ports are per-slot.
- `.gitignore` uses recursive globs (`test-*.ts`, `query*.ts`); a real source file matching one is silently excluded from builds.
- Both cloud Supabase projects are paused; `db:pull` generates from `--local`.
- Tracing is OpenTelemetry only; do not add a second tracing backend.

## Done

`dev check` passes; if the change touches a route or the worker, `dev start` then hit the path and read `dev logs`; `git status` shows no stray files. If the change alters a flow, ownership, or invariant described by an `arch/`, `patterns/`, or `product/` memory, revise that memory in the same change (see [[dev/arch-memories/maintenance]]).

## Pointers

- [[saturn/dev]] — before touching the running environment or starting new work: which checkout and data state to use.
- [[saturn/memo]] — to push a memo or information dump into the local API.
- [[saturn/arch]] — architecture slices, starting with `saturn/arch/ingestion-pipeline`.
- [[saturn/patterns]] — cross-cutting rules: repositories, schema and types, worker and queues, memory lifecycle, provenance, API contracts.
