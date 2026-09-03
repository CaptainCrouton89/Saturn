---
kind: knowledge
when-and-why-to-read: When you add or change an HTTP route, a DTO, or a web call
  to the backend, this knowledge should be read because the wire shapes are
  hand-written in three unlinked places, so a change that type-checks can still
  break a consumer that is never compiled against it.
short-form: Three response envelopes, hand-written DTOs, one web adapter, and
  the drift between them
surfaces:
  - on: read
    match:
      - ./backend/src/routes/**
      - ./backend/src/controllers/**
      - ./backend/src/types/dto.ts
      - ./backend/src/index.ts
      - ./web/src/lib/api.ts
      - ./web/src/app/api/**
    at: preview
  - on: boot
    gate:
      kind:
        - developer
        - design
        - plan
        - explore
    at: name
rationale: The architecture-memory round found the API conventions were
  documented only in the deleted CLAUDE.md files, and the audit found web pages
  calling contracts the backend no longer exposes plus three response envelopes
  across nine routers — agents changing a route had no statement of which
  envelope, casing, or client mirror applied.
last-updated: 2026-09-03T07:23:48.387Z
origin:
  created: 2026-09-03T07:13:42.422Z
  cwd: /Users/silasrhyneer/Code/Cosmo/Saturn
  node: 3zl47w7d-mtl6pw6o-fe25c8ae
---

# API contracts

## The principle

Saturn's HTTP surface is hand-written end to end: every handler validates its own body, chooses its own response envelope, and formats its own errors — there is no shared request schema, no serializer, and no wrapper around the async handlers. `snake_case` is the response convention and the default request convention; the wire shapes are declared in `backend/src/types/dto.ts`, which no client imports, so every consumer redeclares them. Three envelopes and four error shapes coexist across the nine routers, and the only place backend and client shapes are reconciled is the web adapter `web/src/lib/api.ts`.

## Why this shape won

The generated Postgres types (`backend/src/types/database.types.ts`, `web/src/types/database.types.ts`, both produced by `dev db supabase types`) are row types, not wire types, and the API deliberately reshapes rows: `ConversationDTO` derives `status` from `ended_at`, exposes `transcript` where the row stores `content_raw`, and keeps `trigger_method` as an always-null field with no backing column. That reshaping has to live somewhere, and it lives in the controllers. Because backend and web share no package, the same shape is written three times — the DTO, the controller literal, and the web interface — and nothing fails at build time when one of the three moves. Regenerating the database types therefore never updates a contract, and the drift only appears at runtime in the browser.

## The map

### Surfaces and envelopes

Envelope A is `{success: true, data: {...}}`. Envelope B is the bare resource object. Envelope C is a bare payload object keyed by resource name.

| Mount | Auth at HEAD | Response envelope | Entry files |
|---|---|---|---|
| `/api/auth` | `authenticateToken` except register/refresh | A | `backend/src/routes/auth.ts` (handlers live in the route file, not a controller) |
| `/api/init`, `/api/preferences` | `authenticateToken` | A | `backend/src/controllers/initController.ts`, `preferenceController.ts` |
| `/api/conversations` | `authenticateToken` | A | `backend/src/routes/conversations.ts` → `controllers/conversationController.ts` |
| `/api/artifacts` | `authenticateToken` | A | `backend/src/controllers/artifactController.ts` |
| `/api/information-dumps` | `authenticateToken` (admin key or bearer) | B | `backend/src/controllers/informationDumpController.ts` |
| `/api/graph` | `authenticateToken`; `/query` additionally requires the admin key | C | `backend/src/routes/graph.ts` → `controllers/graphController.ts` |
| `/admin` | its own `requireAdminKey` router middleware, not `authenticateToken` | C, with camelCase fields | `backend/src/routes/admin.ts` |
| `/api/chat/stream-memory` | none | SSE frames | `backend/src/routes/chat.ts` → `controllers/chatController.ts` |
| `/mcp` | none | MCP SSE transport | `backend/src/mcp.ts` |

`/api/chat` and `/mcp` are slated for removal by the agent-layer rework; the retrieval surface becomes the Saturn crtr plugin.

### Request conventions

- Request bodies are `snake_case` with three exceptions in the tree: `POST /api/auth/register` takes `{deviceId}`, `POST /api/auth/refresh` takes `{refreshToken}`, and `POST /api/chat/stream-memory` takes `{message, userId, conversationId}`.
- Validation is per-handler `typeof` checks; no Zod schema guards any HTTP body, though the agent tools use Zod internally.
- Pagination is `parseInt(req.query.limit as string) || <default>` with no upper bound and no rejection of a non-numeric value — default 10 on conversations and artifacts, 20 on information dumps.
- `POST /api/graph/query` accepts raw Cypher only from the admin key and binds its required body `user_id` as `$user_id`; `GraphService.executeQuery` uses a Neo4j read transaction so writes are rejected by the database. Other graph controllers derive an ordinary caller's subject from `req.user.id` and reject a conflicting path or body user ID; only the admin key may select a foreign subject.
- The admin-key branch of `POST /api/information-dumps` requires a UUID `user_id` in the body; the bearer branch ignores any body `user_id` and uses the token's user.

### Error shapes

| Shape | Where | Note |
|---|---|---|
| `{error, message, details?}` | auth, conversations, artifacts, preferences, init, information dumps | `details` carries the raw error only when `NODE_ENV=development` |
| Raw caught exception text | `graphController` puts it in `error`; `admin` puts it in `message` | internal error text reaches the client verbatim |
| `{error: 'Validation failed', details: [{field, message}]}` | information-dump create | the only field-level error shape |
| `{error: 'Route not found'}` / `{error: 'Internal server error', message?}` | `backend/src/index.ts` 404 and error middleware | the error middleware is effectively dead: every controller catches its own errors, and Express 4 does not route async rejections to it |

`ApiSuccessResponse`, `ApiErrorResponse`, and `ValidationErrorResponse` exist in `backend/src/types/dto.ts` but no handler constructs them; every envelope is an object literal.

### SSE frames

`/api/chat/stream-memory` sets `text/event-stream` with `X-Accel-Buffering: no`, writes `data: {"type":"connected"}` immediately, one `data: {"type":"text-delta","delta":"…"}` per model delta, and closes with `data: [DONE]`. A mid-stream model error is logged and no error frame is emitted, so the client sees a truncated stream with no terminator.

### Where shapes are declared and reconciled

| Artifact | Role |
|---|---|
| `backend/src/types/dto.ts` | the only written statement of the wire shapes; backend-only, hand-maintained, and several DTOs have no producer |
| `web/src/lib/api.ts` | the web adapter: `apiFetch` owns base URL, opt-in bearer, and error extraction (`data.error`); `transformGraphData` renames graph node `properties` to `details`; envelope A is unwrapped per function |
| `web/src/components/graph/types.ts` | the web's own graph node/link types, lowercase node types plus arbitrary `string` |
| `backend/src/types/database.types.ts`, `web/src/types/database.types.ts` | Postgres row types, never the wire contract |

The web bypasses its own adapter in four places: `web/src/app/upload/page.tsx` posts to the Next proxy `web/src/app/api/upload/route.ts` (which forwards the signed-in caller's Supabase bearer token and has no target-user field), `web/src/app/upload/status/[id]/page.tsx` fetches the backend directly, `web/src/app/signup/page.tsx` calls `/api/auth/me` and `/api/auth/profile` directly, and the landing waitlist posts to a web-local route.

### Contract drift present at HEAD

| Consumer expectation | What the backend emits |
|---|---|
| Upload page reads `data.job_id` and routes to `/upload/status/<id>` | create returns `{source_id, processing_status: 'queued', message, created_at}`, so the link resolves to `undefined` |
| Status page types `title`, `label`, `processing_status`, `error_message` and reads `NEXT_PUBLIC_API_BASE_URL` without a bearer token | `GET /api/information-dumps/:id` returns raw source columns (`id`, `user_id`, `content`, `content_processed`, `summary`, `created_at`, `entities_extracted`, `neo4j_synced_at`), the env var is undeclared, and the route requires authentication |
| `streamChat` posts `/api/chat/stream` with `{message, userId, sessionId}` and expects wrapped SDK events | only `/api/chat/stream-memory` exists, it reads `conversationId`, and it emits the flat `text-delta` frame |
| Viewer filters and the color map in `web/src/lib/graphUtils.ts` key on lowercase node types | `GET /api/graph/users/:userId/full-graph` emits the Neo4j label verbatim (`Person`, `Concept`), while Explore lowercases it in `backend/src/services/retrievalService.ts` — one API, two casings |
| Web information-dump helpers in `web/src/lib/api.ts` model an `information_dump` row with `job_id` | the backend models the unified `source` row |

The archived iOS client (git tag `archive/ios-2026-09-03`) decoded `trigger_method` as a non-optional string and conversation-history turns keyed `text`, neither of which the current backend emits; no client drives the conversation routes today.

## Compliance

- Adding a route: mount it in `backend/src/index.ts`, put `authenticateToken` on the router line, keep the controller thin, and use envelope A. Envelopes B and C exist only on the information-dump, graph, and admin surfaces; do not add a fourth.
- Every response field is `snake_case`, including nested objects and anything a service hands back — `/admin` and `/api/graph/users/:userId/context` currently leak camelCase and are the exception, not the pattern.
- Changing a shape is a three-file change: `backend/src/types/dto.ts`, the controller literal, and the matching interface in `web/src/lib/api.ts`. Nothing enforces this; a missed third file fails only in the browser.
- Never return a caught exception's `message` as `error`. Return a fixed string and gate the detail on `NODE_ENV`, as the envelope-A controllers do.
- New web calls go through `web/src/lib/api.ts` with `NEXT_PUBLIC_API_URL`; a page-level `fetch` is how the drift above accumulated.
- Regenerating `database.types.ts` with `dev db supabase types` changes no contract. A column rename that must reach a client is a DTO change as well.
- When a route's flow or ownership changes, revise the owning slice memory in the same pass.

## Edges

- [[saturn/arch/conversation-lifecycle]] — conversation route contract
- [[saturn/arch/information-dumps]] — upload and status seam
- [[saturn/arch/auth-and-identity]] — token, admin key, ownership
- [[saturn/patterns/postgres-schema-and-types]] — row types versus DTOs
- [[saturn/arch/retrieval]] — Explore and Traverse surfaces
