# Requirements: Information Dump Processing

## Overview
**Purpose:** Enable users to submit unstructured text information (notes, journal entries, meeting summaries, etc.) that gets processed and integrated into their knowledge graph without requiring conversational back-and-forth.

**User Benefit:** Users can quickly offload information from external sources (emails, notes apps, books, meetings) into their Cosmo knowledge base without having to format it as a conversation or answer questions about it.

**Problem:** Currently, all knowledge must be extracted from live conversations. Users may have existing notes, meeting summaries, or journal entries they want to add to their graph without having a conversation about them.

**Related Documentation:**
- Investigation: `docs/plans/information-dump/investigations/conversation-pipeline.md` - Existing 7-phase pipeline analysis
- Investigation: `docs/plans/information-dump/investigations/entity-management.md` - Repository patterns and Neo4j operations
- Schema: `neo4j.md` - Full graph schema with node types and relationships
- Architecture: `docs/transcript-to-neo4j-pipeline.md` - Batch processing pipeline design
- Database: `db.md` - PostgreSQL schema (will add information_dump table)

### Edge Cases
- **Empty state:** User submits empty text or whitespace-only → Return 400 validation error
- **Error state:**
  - Entity extraction fails → Retry job up to 3 times, mark dump as failed if all retries exhausted
  - Neo4j transaction fails → Retry with exponential backoff, preserve job in queue
  - Text too long (>50k chars) → Return 400 validation error before enqueueing
- **Loading state:** Not applicable (async processing, no user-facing loading state)
- **Large dataset/performance:**
  - High entity density (50+ entities) → Process in batches during Phase 3 to avoid LLM context limits
  - Long text (10k+ words) → May take 30-60s to process, acceptable for background job

## Functional Requirements

### User Interactions
- **Submit information dump via API:**
  - User POSTs to `/api/information-dumps` with JWT token, title, optional label, and text content
  - Receives immediate response with dump ID and queued status
  - No UI for MVP - API only

- **No status checking initially:**
  - Processing happens silently in background
  - No polling endpoint or push notifications for MVP
  - User assumes success unless they check entities later

### Data Requirements

#### PostgreSQL Table: `information_dump`
**Fields:**
- `id` (uuid, primary key, default gen_random_uuid())
- `user_id` (uuid, foreign key → users.id, required)
- `title` (text, required, max 200 chars)
- `label` (text, nullable, max 200 chars) - Short description/summary
- `content` (text, required, max 50,000 chars)
- `created_at` (timestamp with time zone, default now())
- `processing_status` (text, enum: 'queued', 'processing', 'completed', 'failed')
- `entities_extracted` (boolean, default false)
- `neo4j_synced_at` (timestamp with time zone, nullable)
- `error_message` (text, nullable) - Capture failure reason

**Validation:**
- `title`: Required, 1-200 characters
- `label`: Optional, max 200 characters
- `content`: Required, 1-50,000 characters (trimmed)
- `user_id`: Must reference existing authenticated user

**Relationships:**
- Belongs to one User
- Referenced by Neo4j entities via `last_update_source` (information_dump_id)

### API Requirements

#### POST /api/information-dumps

**Authentication:** Required (JWT via `Authorization: Bearer <token>`)

**Request:**
```json
{
  "title": "Meeting notes with Sarah",
  "label": "Work planning session",
  "content": "Met with Sarah today to discuss the Q1 roadmap. She's excited about the new authentication feature. We decided to prioritize the mobile app redesign. John will join the project next week. Sarah mentioned she's moving to Austin in March."
}
```

**Response (Success - 202 Accepted):**
```json
{
  "information_dump_id": "550e8400-e29b-41d4-a716-446655440000",
  "processing_status": "queued",
  "message": "Information dump queued for processing",
  "created_at": "2025-01-15T10:30:00Z"
}
```

**Response (Validation Error - 400):**
```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "content",
      "message": "Content exceeds maximum length of 50,000 characters"
    }
  ]
}
```

**Response (Unauthorized - 401):**
```json
{
  "error": "Unauthorized",
  "message": "Valid JWT token required"
}
```

**Response (Rate Limited - 429):**
```json
{
  "error": "Rate limit exceeded",
  "message": "Maximum 10 information dumps per hour",
  "retry_after": 1800
}
```

**Errors:**
- 400: Validation error (missing/invalid fields)
- 401: Unauthorized (missing/invalid JWT)
- 429: Rate limit exceeded (>10 per hour per user)
- 500: Internal server error (database/queue failure)

### UI Requirements
**Not applicable** - API only for MVP. Future UI considerations:
- iOS: New tab/screen for submitting dumps
- Web: Admin panel for viewing dump history

## Technical Requirements

### Performance
- **API endpoint response:** <200ms (just validates, saves to DB, enqueues job)
- **Background processing:** 30-90s for typical dump (500-2000 words, 5-15 entities)
- **Large dumps:** Up to 3 minutes for max-size dumps (10k words, 50+ entities)
- **Database writes:** Batch Neo4j writes using UNWIND (single transaction per dump)

### Security
- **Authentication:** JWT-based device authentication (same as conversations)
- **Authorization:** Users can only submit dumps for themselves (userId from JWT)
- **Data protection:**
  - Text content sanitized (trim whitespace, validate encoding)
  - No executable code or SQL injection possible (parameterized queries)
  - Sensitive info warning (future: detect PII, warn user)
- **Rate limiting:** 10 dumps per hour per user (prevent abuse)

### Integration Points

1. **PostgreSQL/Supabase:**
   - Create `information_dump` table with schema above
   - Store full dump content, metadata, processing status
   - Track `entities_extracted` and `neo4j_synced_at` flags (same as conversations)

2. **pg-boss Queue:**
   - Enqueue `process-information-dump` job after successful submission
   - Job payload: `{ informationDumpId, userId }`
   - Worker picks up jobs, processes via InformationDumpService
   - Retry policy: 3 attempts with exponential backoff (same as conversations)

3. **Neo4j Knowledge Graph:**
   - Update entities (Person, Project, Idea, Topic) with extracted information
   - Create/update relationships: User→Entity, InformationDump→Entity
   - Use `information_dump_id` as `last_update_source` for provenance
   - Add `source_type: 'information_dump'` property on all relationships

4. **Entity Extraction Service:**
   - Reuse existing `entityIdentificationService` with **modified prompt**
   - Prompt differences: No turn-by-turn structure, handle arbitrary unstructured text
   - Extract all entities (no limit on count)

5. **Entity Resolution Service:**
   - Reuse existing `entityResolutionService` (no changes needed)
   - 5-tier matching: entity_key → canonical_name → alias → vector search → LLM disambiguation

6. **Entity Update Service:**
   - Reuse existing `entityUpdateService` with **critical modification**
   - **Pass existing entity data to LLM agent** alongside new information
   - Agent intelligently merges old + new (doesn't blindly replace)
   - Example prompt addition: "Here is the current information about {entity}. Here is new information from a dump. Intelligently combine them, preserving important existing details."

7. **Relationship Scoring:**
   - Create InformationDump→Entity MENTIONED relationships
   - Use LLM to **infer importance from content** (how much detail/emphasis)
   - Default sentiment: neutral (0.0)
   - Add `source_type: 'information_dump'` property

8. **Embedding Generation:**
   - **Skip embedding dump text** (entities only for MVP)
   - Embed extracted entities (Projects, Topics, Ideas) as usual
   - Reuse existing `embeddingGenerationService`

9. **Neo4j Transaction Service:**
   - Reuse existing atomic transaction pattern (UNWIND batch writes)
   - Update `information_dump` record: `entities_extracted = true`, `neo4j_synced_at = now()`

## Implementation Notes

### Existing Patterns to Follow

**Service Layer Pattern:**
- Create `backend/src/services/informationDumpService.ts`
- Follow structure of `conversationService.ts:1-500` (job enqueueing, status updates)
- Implement `processInformationDump(informationDumpId)` similar to `memoryExtractionService.processConversation()`

**Repository Pattern:**
- Create `backend/src/repositories/InformationDumpRepository.ts` (if needed for complex queries)
- Or use direct Supabase queries in service (simpler for MVP)

**Controller Pattern:**
- Create `backend/src/controllers/informationDumpController.ts`
- Implement `createInformationDump` handler
- Follow `conversationController.ts:50-150` for validation, auth, response structure

**Route Pattern:**
- Create `backend/src/routes/informationDumps.ts`
- Mount at `/api/information-dumps` in `backend/src/index.ts`
- Apply `authenticateToken` middleware

**Queue Pattern:**
- Register `process-information-dump` job in `backend/src/queue/index.ts`
- Add handler in `backend/src/worker.ts` following `process-conversation-memory` pattern

### Technology Choices

**Why reuse conversation pipeline?**
- 80% code overlap: entity identification, resolution, updates, embeddings
- Proven reliability: pipeline already handles complex entity extraction
- Cost-effective: Same LLM prompts, just adapted for unstructured text

**Why PostgreSQL + Neo4j?**
- PostgreSQL: Store full dump content for audit trail, debugging
- Neo4j: Structured entity updates, same graph as conversations
- Consistent with existing architecture

**Why pg-boss for async processing?**
- Already in use for conversations
- PostgreSQL-backed (no additional infrastructure)
- Built-in retries, error handling

**Why skip embeddings for dump text?**
- MVP simplification: entities are searchable, dump text less useful
- Cost reduction: Embedding 50k chars = ~$0.01 per dump
- Future enhancement: Add chunking + embedding if users request search

### Modified Pipeline Phases

Based on existing 7-phase conversation pipeline, adapt as follows:

**Phase 1: Entity Identification** ✅ **MODIFIED**
- **Existing:** `entityIdentificationService.identifyEntities(conversation.turns)`
- **Modified:** `entityIdentificationService.identifyEntitiesFromText(dump.content)`
- **Changes:**
  - Different prompt: No speaker turns, handle unstructured text
  - Extract all entities (no limit)
  - Same Zod schemas for validation

**Phase 2: Entity Resolution** ✅ **REUSE AS-IS**
- No changes needed
- `entityResolutionService.resolveEntities(identifiedEntities, userId)`

**Phase 3: Entity Updates** ✅ **MODIFIED**
- **Existing:** `entityUpdateService.generateUpdates(resolvedEntities, conversationId)`
- **Modified:** `entityUpdateService.generateUpdates(resolvedEntities, informationDumpId, existingEntityData)`
- **Changes:**
  - **Pass existing entity data** to LLM agent (fetch from Neo4j first)
  - Agent prompt: "Intelligently merge old + new information"
  - Use `information_dump_id` as `last_update_source`

**Phase 4: Conversation Summary** ❌ **SKIP**
- Not applicable to information dumps

**Phase 5: Relationship Scoring** ✅ **MODIFIED**
- **Existing:** Uses conversational context to judge sentiment/importance
- **Modified:** Infer importance from content (LLM judges based on detail/emphasis)
- Add `source_type: 'information_dump'` property to all relationships
- Default sentiment: 0.0 (neutral)

**Phase 6: Embedding Generation** ✅ **MODIFIED**
- **Existing:** Embeds conversation excerpts + entities
- **Modified:** Embed entities only (skip dump text for MVP)

**Phase 7: Neo4j Transaction** ✅ **REUSE AS-IS**
- Same UNWIND batch write pattern
- Update `information_dump` record instead of `conversation` record

### Error Handling

**Validation Errors (400):**
- Return immediately before enqueueing job
- Validate: title/label length, content length, required fields

**Authentication Errors (401):**
- Standard JWT middleware handles this
- Return before processing request

**Rate Limit Errors (429):**
- Check recent dump count for user (query information_dump table)
- Return with `retry_after` header (seconds until limit resets)

**Processing Errors (background job):**
- Retry 3 times with exponential backoff (5s, 25s, 125s)
- After 3 failures:
  - Set `processing_status = 'failed'`
  - Set `error_message` with failure reason
  - Log error with informationDumpId for debugging

**Neo4j Transaction Errors:**
- Rollback entire transaction (atomic)
- Retry job from beginning
- If persists after 3 retries, mark as failed

## Out of Scope (Future Enhancements)

- **Status checking endpoint:** `GET /api/information-dumps/:id` to poll processing status
- **Push notifications:** Notify user when processing completes (iOS push)
- **File upload support:** PDF, images, voice recordings (requires OCR/transcription)
- **Dump history UI:** View past dumps, reprocess, delete
- **Chunk embeddings:** Embed dump text for semantic search retrieval
- **Incremental updates:** Edit existing dumps, reprocess changes only
- **Bulk import:** Upload multiple dumps at once
- **Export dumps:** Download original text for backup
- **Duplicate detection:** Warn if similar dump already exists (vector similarity)
- **Smart categorization:** Auto-suggest labels based on content
- **Web UI:** Landing page form for submitting dumps via browser

## Success Criteria

- [ ] User can submit information dump via API with title, label, and text content
- [ ] API returns 202 Accepted with dump ID and queued status within 200ms
- [ ] Background job processes dump within 90s (average case: 500-2000 words)
- [ ] Entities extracted from dump are visible in Neo4j graph with correct provenance (`last_update_source = information_dump_id`)
- [ ] Relationships include `source_type: 'information_dump'` property
- [ ] Entity updates intelligently merge old + new information (not blind replace)
- [ ] Failed jobs retry 3 times before marking dump as failed
- [ ] Rate limiting prevents abuse (max 10 dumps/hour per user)
- [ ] Processing cost <$0.05 per dump (using gpt-4.1-mini/nano)
- [ ] No duplicate entities created (idempotent via entity_key)

## Relevant Files

### New Files to Create
- `backend/src/services/informationDumpService.ts` - Main processing service
- `backend/src/controllers/informationDumpController.ts` - API request handler
- `backend/src/routes/informationDumps.ts` - Express route definitions
- `backend/src/types/informationDump.ts` - TypeScript types and DTOs
- `backend/migrations/YYYYMMDDHHMMSS_create_information_dump_table.sql` - PostgreSQL schema

### Existing Files to Modify
- `backend/src/index.ts` - Mount informationDumps router
- `backend/src/queue/index.ts` - Register `process-information-dump` job
- `backend/src/worker.ts` - Add job handler for information dumps
- `backend/src/services/entityIdentificationService.ts` - Add `identifyEntitiesFromText()` method with modified prompt
- `backend/src/services/entityUpdateService.ts` - Modify `generateUpdates()` to accept existing entity data, pass to LLM
- `backend/src/services/relationshipScoringService.ts` - Add `source_type` property to relationships
- `backend/src/db/supabase.ts` - May need type generation after migration (`pnpm run db:pull`)

### Existing Files to Reference (No Changes)
- `backend/src/services/memoryExtractionService.ts` - 7-phase pipeline template
- `backend/src/services/entityResolutionService.ts` - Reuse as-is
- `backend/src/services/embeddingGenerationService.ts` - Reuse with entity-only mode
- `backend/src/services/neo4jTransactionService.ts` - Reuse UNWIND pattern
- `backend/src/repositories/PersonRepository.ts` - Entity repository pattern reference
- `backend/src/repositories/ProjectRepository.ts` - Entity repository pattern reference
- `backend/src/repositories/IdeaRepository.ts` - Entity repository pattern reference
- `backend/src/repositories/TopicRepository.ts` - Entity repository pattern reference
- `backend/src/controllers/conversationController.ts` - Controller pattern reference
- `backend/src/routes/conversations.ts` - Route pattern reference
- `backend/src/middleware/auth.ts` - JWT authentication middleware
- `backend/src/types/dto.ts` - DTO pattern reference (snake_case)
- `neo4j.md` - Graph schema documentation
- `db.md` - PostgreSQL schema documentation
- `docs/transcript-to-neo4j-pipeline.md` - Pipeline architecture documentation
- `docs/plans/information-dump/investigations/conversation-pipeline.md` - Existing pipeline investigation
- `docs/plans/information-dump/investigations/entity-management.md` - Entity management investigation
