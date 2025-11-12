# Plan: Manual Content Upload Interface

## Summary
**Goal:** Allow users to manually upload text content (transcripts, notes, documents) via web app for ingestion into their knowledge graph

**Type:** Feature

**Scope:** Medium

## Relevant Context

### Existing Infrastructure (Already Built)
- **PostgreSQL**: `information_dump` table exists with status tracking (`/Users/silasrhyneer/Code/Cosmo/Saturn/backend/migrations/20251110_create_information_dump_table.sql`)
- **Queue System**: `PROCESS_INFORMATION_DUMP` queue configured in pg-boss (`/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/queue/memoryQueue.ts:13-14, 74-80`)
- **Ingestion Agent**: LangGraph-based 3-phase pipeline (`/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/services/ingestionService.ts`)
- **Types**: TypeScript types defined (`/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/types/informationDump.ts`)

### Architecture Documents
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/CLAUDE.md` - Backend architecture patterns
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/routes/CLAUDE.md` - Route conventions
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/controllers/CLAUDE.md` - Controller patterns (if exists)
- `/Users/silasrhyneer/Code/Cosmo/Saturn/db.md` - Database schema

## Investigation Artifacts
None required - infrastructure analysis complete from existing codebase

## Current System Overview

### Backend
- **Ingestion Pipeline**: 3-phase LangGraph agent extracts entities/relationships from text
  - Phase 1: Extract and disambiguate entities
  - Phase 2: Create Source node with mentions edges
  - Phase 3: Update nodes/relationships using validated tools
- **Queue Processing**: pg-boss worker processes jobs asynchronously (`/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/worker.ts`)
- **Conversation Flow**: iOS app creates conversation → transcript saved → job enqueued → worker processes → Neo4j updated
- **Auth**: JWT-based device authentication via `authenticateToken` middleware

### Web App
- **Framework**: Next.js 16 with App Router
- **Existing Pages**: Landing page (`/`), viewer page (`/viewer`)
- **API Routes**: Waitlist endpoint exists as pattern (`/Users/silasrhyneer/Code/Cosmo/Saturn/web/src/app/api/waitlist/route.ts`)
- **Supabase**: Server-side client configured with service role key

### Missing Components
1. Backend API endpoints for creating/managing information dumps
2. Backend worker handler for PROCESS_INFORMATION_DUMP jobs
3. Frontend upload page UI
4. Frontend API client for submissions
5. Status polling/display logic

## Implementation Plan

### Tasks

**Task 1: Implement information dump processing service**
- Files:
  - `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/services/informationDumpService.ts` (new)
- Depends on: none
- What: Create `processInformationDump(dumpId, userId)` function that:
  - Fetches dump from PostgreSQL
  - Checks `processing_status` (skip if already completed)
  - Converts content to text format for ingestion agent
  - Calls `runIngestionAgent()` with dump content
  - Generates embeddings for new entities
  - Updates dump status to 'completed' and sets `entities_extracted: true`
- Pattern: Mirror `processConversation()` in `ingestionService.ts:36-233`
- Risks/Gotchas:
  - Must handle status transitions (queued → processing → completed/failed)
  - Error handling should update `error_message` field and set status to 'failed'
  - Idempotency: skip if `entities_extracted: true`
- Agent: programmer

**Task 2: Register information dump worker handler**
- Files:
  - `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/worker.ts`
- Depends on: 1
- What: Add queue.work() handler for `QUEUE_NAMES.PROCESS_INFORMATION_DUMP` that calls `processInformationDump()`
- Pattern: Mirror conversation handler at `worker.ts:36-64`
- Risks/Gotchas:
  - Must import `ProcessInformationDumpJobData` type
  - Include proper error logging and rethrowing for pg-boss retry
- Agent: junior-engineer

**Task 3: Create information dump controller**
- Files:
  - `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/controllers/informationDumpController.ts` (new)
- Depends on: 1
- What: Implement controller functions:
  - `create(req, res)`: Validate input, insert to DB, enqueue job, return dump + jobId
  - `getStatus(req, res)`: Fetch dump by ID, return status + error_message
  - `list(req, res)`: List user's dumps with pagination (limit 20, ordered by created_at DESC)
- Input validation:
  - title: 1-200 chars
  - label: 0-200 chars (optional)
  - content: 1-50,000 chars
- Response format: snake_case JSON per API convention
- Risks/Gotchas:
  - Must validate userId from JWT matches request
  - Return 400 for validation errors with field-specific messages
  - Return 404 if dump not found or belongs to different user
- Agent: programmer

**Task 4: Create information dump routes**
- Files:
  - `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/routes/informationDump.ts` (new)
  - `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/index.ts`
- Depends on: 3
- What:
  - Define routes with `authenticateToken` middleware:
    - `POST /api/information-dumps` → create
    - `GET /api/information-dumps/:id` → getStatus
    - `GET /api/information-dumps` → list
  - Mount router in `index.ts` under `/api/information-dumps`
- Pattern: Follow `admin.ts` route structure
- Risks/Gotchas: Must apply auth middleware to all routes
- Agent: junior-engineer

**Task 5: Create web app upload page**
- Files:
  - `/Users/silasrhyneer/Code/Cosmo/Saturn/web/src/app/upload/page.tsx` (new)
- Depends on: none (can develop in parallel)
- What: Create upload form with:
  - Title input (required, 200 char limit with counter)
  - Label input (optional, 200 char limit with counter)
  - Content textarea (required, 50,000 char limit with counter)
  - Submit button → POST to API route
  - Loading state during submission
  - Success state: Show job ID + link to status page
  - Error state: Display validation errors inline
- UI Components: Use shadcn/ui (Button, Input, Textarea, Card)
- Styling: Match landing page theme (cream/beige colors, responsive)
- Risks/Gotchas:
  - Character counters must update in real-time
  - Form validation before submission (client-side)
  - Clear form on successful submission
- Agent: programmer

**Task 6: Create web app API route for submissions**
- Files:
  - `/Users/silasrhyneer/Code/Cosmo/Saturn/web/src/app/api/upload/route.ts` (new)
- Depends on: 4
- What: Next.js API route that:
  - Receives POST with `{ title, label, content, user_id }`
  - Validates input (field lengths)
  - Forwards to backend `POST /api/information-dumps`
  - Returns backend response (dump ID, job ID, status)
- Auth: For MVP, accept `user_id` in request body (no auth yet)
- Error handling: Return proper status codes with error messages
- Pattern: Mirror waitlist route structure (`/Users/silasrhyneer/Code/Cosmo/Saturn/web/src/app/api/waitlist/route.ts`)
- Risks/Gotchas:
  - Must handle backend API errors gracefully
  - Environment variable for backend URL (NEXT_PUBLIC_BACKEND_URL)
- Agent: junior-engineer

**Task 7: Create status display page**
- Files:
  - `/Users/silasrhyneer/Code/Cosmo/Saturn/web/src/app/upload/status/[id]/page.tsx` (new)
- Depends on: 4, 5
- What: Status page that:
  - Takes dump ID from URL params
  - Polls backend `GET /api/information-dumps/:id` every 3 seconds
  - Displays status badge (queued/processing/completed/failed)
  - Shows title, label, content preview (first 500 chars)
  - Shows created_at timestamp
  - Shows error_message if failed
  - On completion: Shows "View Graph" button (links to `/viewer`)
  - Auto-stops polling when status is completed/failed
- UI States:
  - Loading: Spinner
  - Queued: Blue badge "Queued for processing"
  - Processing: Yellow badge "Processing..." with spinner
  - Completed: Green badge "Complete" with entity count (if available)
  - Failed: Red badge "Failed" with error message
- Risks/Gotchas:
  - Must cleanup polling interval on unmount
  - Handle 404 if dump ID invalid
  - Consider WebSocket upgrade in future (start with polling)
- Agent: programmer

**Task 8: Add navigation links**
- Files:
  - `/Users/silasrhyneer/Code/Cosmo/Saturn/web/src/app/page.tsx`
- Depends on: 5
- What: Add "Upload Content" link/button in landing page header or as CTA section
- Placement: Consider adding to footer or as additional CTA after graph section
- Styling: Match existing button styles
- Risks/Gotchas: Minimal - simple link addition
- Agent: junior-engineer

**Task 9: Add uploads list page (optional enhancement)**
- Files:
  - `/Users/silasrhyneer/Code/Cosmo/Saturn/web/src/app/upload/history/page.tsx` (new)
- Depends on: 4, 7
- What: List all user's uploads with:
  - Table/list view of dumps (title, status, created_at)
  - Click to view status page
  - Filter by status (queued/processing/completed/failed)
  - Pagination (20 per page)
- Risks/Gotchas: Requires user authentication to be fully functional
- Agent: programmer
- **Note**: Optional - can defer to post-MVP

### Data/Schema Impacts

**No schema changes required** - `information_dump` table already exists with all necessary fields

**Existing Schema**:
```sql
CREATE TABLE information_dump (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL (1-200 chars),
  label TEXT (0-200 chars, optional),
  content TEXT NOT NULL (1-50,000 chars),
  created_at TIMESTAMPTZ DEFAULT now(),
  processing_status TEXT ('queued'|'processing'|'completed'|'failed'),
  entities_extracted BOOLEAN DEFAULT false,
  neo4j_synced_at TIMESTAMPTZ,
  error_message TEXT
);
```

### API Specification

**Backend Endpoints**:

1. **POST /api/information-dumps**
   - Auth: Required (JWT token)
   - Body: `{ title: string, label?: string, content: string }`
   - Response: `{ information_dump_id: string, job_id: string, status: 'queued' }`
   - Status Codes: 201 (created), 400 (validation error), 401 (unauthorized)

2. **GET /api/information-dumps/:id**
   - Auth: Required (JWT token)
   - Response: `{ id, title, label, content, created_at, processing_status, entities_extracted, neo4j_synced_at, error_message }`
   - Status Codes: 200 (ok), 404 (not found), 401 (unauthorized)

3. **GET /api/information-dumps**
   - Auth: Required (JWT token)
   - Query Params: `?limit=20&offset=0&status=completed`
   - Response: `{ dumps: Array<InformationDump>, total: number }`
   - Status Codes: 200 (ok), 401 (unauthorized)

**Web App API Route**:

1. **POST /api/upload**
   - Body: `{ title: string, label?: string, content: string, user_id: string }`
   - Forwards to backend POST /api/information-dumps
   - Response: Backend response passthrough
   - Status Codes: Same as backend

### Integration Points

**Backend**:
- `ingestionService.ts:36` - Pattern to follow for processInformationDump
- `memoryQueue.ts:138-170` - enqueueInformationDumpProcessing (already exists)
- `worker.ts:36-64` - Pattern for worker handler registration
- `routes/admin.ts` - Pattern for authenticated routes

**Web App**:
- `api/waitlist/route.ts` - Pattern for Next.js API routes with Supabase
- `page.tsx` - Landing page for navigation link addition
- `components/ui/*` - shadcn/ui components for form UI

**Database**:
- Supabase PostgreSQL - information_dump table (already exists)
- Neo4j - Entity extraction via existing ingestion agent

### Testing Strategy

**Backend**:
- Unit tests: Not required for MVP (pre-production mindset)
- Manual testing:
  1. POST to /api/information-dumps with valid data → verify DB insert + queue job
  2. Worker processes job → verify Neo4j entities created
  3. GET status endpoint → verify status updates (queued → processing → completed)
  4. Test error handling: invalid input, missing fields, too-long content

**Web App**:
- Manual testing:
  1. Submit form with valid data → verify redirect to status page
  2. Status page polls and updates → verify UI state changes
  3. Character counters → verify real-time updates
  4. Form validation → verify client-side error messages
  5. Test with various content lengths (short, long, edge cases)

**Integration**:
- End-to-end flow: Upload → Processing → Neo4j → View in graph viewer

### Impact Analysis

**New Files**:
- Backend:
  - `src/services/informationDumpService.ts` - Processing logic
  - `src/controllers/informationDumpController.ts` - Request handlers
  - `src/routes/informationDump.ts` - Route definitions
- Web:
  - `app/upload/page.tsx` - Upload form
  - `app/upload/status/[id]/page.tsx` - Status display
  - `app/upload/history/page.tsx` - History list (optional)
  - `app/api/upload/route.ts` - API route

**Modified Files**:
- `backend/src/worker.ts` - Add PROCESS_INFORMATION_DUMP handler
- `backend/src/index.ts` - Mount information dump routes
- `web/src/app/page.tsx` - Add navigation link

**Dependencies**:
- No new package installations required
- Uses existing: Express, pg-boss, Supabase, Next.js, shadcn/ui

**Affected Systems**:
- PostgreSQL: New records in information_dump table
- Neo4j: New Source nodes + entity relationships from dumps
- pg-boss queue: New job type being processed
- Web app: New pages and routes

**Breaking Changes**: None - purely additive feature

**Backwards Compatibility**: N/A - new feature

### Rollout and Ops

**Configuration**:
- Backend: No new env vars required (uses existing DATABASE_URL, NEO4J_URI, etc.)
- Web: Add `NEXT_PUBLIC_BACKEND_URL` to `.env.example` and deployment env

**Deployment**:
1. Deploy backend first (API + worker must run together)
2. Run migration (if not already applied): `20251110_create_information_dump_table.sql`
3. Restart worker process to register new handler
4. Deploy web app
5. Verify end-to-end flow with test upload

**Migration/Rollback**:
- Migration: Already exists (`20251110_create_information_dump_table.sql`)
- Rollback: Drop information_dump routes from backend, remove web pages

**Monitoring**:
- Backend logs: Watch for job processing errors in worker
- pg-boss queue: Monitor `information_dump` queue stats via admin endpoint
- Database: Check information_dump table for failed jobs (processing_status='failed')
- Neo4j: Verify Source nodes created with correct provenance

**Error Recovery**:
- Failed jobs: Use existing admin retry endpoint (`POST /admin/retry/:jobId`)
- Stuck jobs: pg-boss auto-expires after 1 hour (configured in memoryQueue.ts:79)
- Manual reprocessing: Update processing_status to 'queued' and worker will retry

### Appendix

**Key Decisions Made**:

1. **No New Queue Type**: Reuse existing `PROCESS_INFORMATION_DUMP` queue (already configured)
2. **Auth Strategy**: Use existing JWT device authentication for backend API
3. **Web Auth (MVP)**: Accept user_id in request body (no web auth yet) - will add proper auth later
4. **Status Updates**: Polling (3-second interval) instead of WebSocket for MVP simplicity
5. **UI Location**: Dedicated `/upload` page (not admin-only) - user-facing feature
6. **Source Type Distinction**: Not needed - Source nodes from dumps distinguishable by checking `last_update_source` format (conversation_id vs dump_id)

**Open Questions**:
- None - all infrastructure exists, clear implementation path

**Assumptions**:
- Worker process runs continuously in production (already required for conversation processing)
- Users have valid JWT tokens from iOS app authentication
- Neo4j ingestion agent works identically for dumps as it does for conversations (text input only)

**Conventions to Follow**:
- Backend API responses: snake_case field names
- Route naming: kebab-case URLs (`/information-dumps`)
- Error handling: Throw errors early, no silent fallbacks
- File naming: camelCase for TS files, kebab-case for route directories
- TypeScript: No `any` types - use proper type definitions from `types/informationDump.ts`

**Related Patterns**:
- Conversation processing pipeline (`ingestionService.ts`)
- Waitlist API route pattern (`api/waitlist/route.ts`)
- Admin routes structure (`routes/admin.ts`)
- Worker job handlers (`worker.ts`)

**Future Enhancements** (Post-MVP):
- WebSocket for real-time status updates
- File upload support (PDF, DOCX, etc.)
- Batch upload (multiple files at once)
- Upload from URL (fetch content)
- Rich text editor instead of plain textarea
- User authentication for web app (currently relies on iOS JWT)
- Export/download uploaded content
- Delete uploaded content
- Edit/reprocess uploaded content
