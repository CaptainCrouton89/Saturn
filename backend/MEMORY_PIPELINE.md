# Memory Extraction Pipeline - Implementation Summary

## Overview

The conversation memory extraction pipeline is now fully implemented! When a conversation ends, the system automatically extracts entities, resolves them to the knowledge graph, and updates Neo4j with structured memory.

## Architecture

### Queue System: pg-boss
- **Why pg-boss**: Uses existing PostgreSQL (Supabase), no Redis needed
- **Benefits**: Zero additional infrastructure cost, transactional guarantees, built-in retry logic
- **Job Queue**: `process-conversation-memory`

### Pipeline Phases

1. **Phase 1: Entity Identification** (`entityIdentificationService.ts`)
   - Extracts People, Projects, Ideas, Topics from transcript using GPT-4.1-mini
   - Generates stable `entity_key` for idempotent processing
   - Cost: ~$0.002 per conversation

2. **Phase 2: Entity Resolution** (`entityResolutionService.ts`)
   - Maps mentioned entities to existing Neo4j nodes
   - Multi-tier resolution: entity_key → canonical_name → alias → fuzzy match
   - LLM disambiguation for ambiguous cases
   - Creates Alias nodes for name variants

3. **Phase 3: Entity Updates** (`entityUpdateService.ts`)
   - Generates structured updates using GPT-4.1-nano
   - Update strategy: REPLACE (all fields replace existing values)
   - Arrays are bounded (MAX 8-15 items)
   - Provenance tracking on all updates

4. **Phase 4: Summary** (already exists in `summaryService.ts`)
   - Brief 1-2 sentence summary for archive view
   - Generated during `endConversation()`

5. **Phase 5: Relationship Scoring** (`relationshipUpdateService.ts`)
   - Scores sentiment, importance using GPT-4.1-nano
   - Creates User→Entity relationships (KNOWS, WORKING_ON, INTERESTED_IN)
   - Creates Conversation→Entity relationships (MENTIONED, DISCUSSED, EXPLORED)

6. **Phase 6: Embeddings** (SKIPPED IN MVP)
   - Will add vector embeddings for semantic search later

7. **Phase 7: Neo4j Transaction** (`neo4jTransactionService.ts`)
   - Executes all updates atomically in single transaction
   - Uses UNWIND for efficient batch updates
   - Rollback on any failure (all-or-nothing)
   - Marks conversation as processed in PostgreSQL

### Orchestrator: memoryExtractionService.ts
Coordinates all 7 phases for each conversation.

## How to Use

### Development Setup

**Terminal 1 - API Server:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Background Worker:**
```bash
cd backend
npm run worker
```

### Production Deployment

**Build:**
```bash
npm run build
```

**Run API Server:**
```bash
npm start
```

**Run Worker (separate process):**
```bash
npm run start:worker
```

### How It Works

1. **User ends conversation** → API calls `conversationService.endConversation()`
2. **Summary generated** → Saved to PostgreSQL
3. **Job enqueued** → `enqueueConversationProcessing()` adds job to pg-boss queue
4. **API returns immediately** (~200ms response time)
5. **Worker picks up job** → Processes conversation through 7-phase pipeline (5-15 seconds)
6. **Neo4j updated** → Entities and relationships created/updated
7. **PostgreSQL marked** → `entities_extracted = true`, `neo4j_synced_at` set

## Monitoring

### Queue Status
```bash
GET /admin/queue-status
```

Response:
```json
{
  "queue": "process-conversation-memory",
  "active": 2,
  "completed": 45,
  "failed": 1
}
```

### Extraction Status for Conversation
```bash
GET /admin/conversation/:id/extraction-status
```

Response:
```json
{
  "conversationId": "abc-123",
  "entitiesExtracted": true,
  "neo4jSyncedAt": "2025-11-09T10:30:00Z",
  "status": "completed"
}
```

### Failed Jobs

Query PostgreSQL directly:
```sql
SELECT * FROM pgboss.job
WHERE state = 'failed'
ORDER BY completedon DESC
LIMIT 20;
```

### Retry Failed Job
```bash
POST /admin/retry/:jobId
```

## Cost Estimation

**Per 10k word conversation (~13k tokens):**
- Phase 1 (entity identification): 1 call × $0.002 = $0.002
- Phase 2 (disambiguation): ~3 calls × $0.002 = $0.006
- Phase 3 (entity updates): ~10 entities × $0.002 = $0.020
- Phase 5 (relationship scoring): ~10 calls × $0.002 = $0.020
- **Total: ~$0.050 per conversation**

**For 100 conversations/day: ~$5/day or $150/month**

## Error Handling

### Retry Logic (pg-boss)
- **Retry limit**: 3 attempts
- **Retry delay**: 60s, 120s, 240s (exponential backoff)
- **Job expiration**: 24 hours

### Error States
- **Transient failures**: Automatically retried (LLM timeouts, Neo4j connection issues)
- **Persistent failures**: Move to failed queue after 3 attempts
- **Transaction rollback**: Any Neo4j error rolls back entire transaction

### Monitoring Failures
Check logs for errors:
```bash
# Worker logs show detailed pipeline progress
npm run worker

# Look for these log patterns:
# ❌ Memory extraction failed
# 💥 Uncaught exception
# ⚠️ Failed to score entity
```

## Database Schema

### PostgreSQL (Supabase)
```sql
conversation (
  id UUID PRIMARY KEY,
  transcript JSONB,  -- SerializedMessage[]
  summary TEXT,
  entities_extracted BOOLEAN DEFAULT false,
  neo4j_synced_at TIMESTAMP,
  ...
)
```

### Neo4j
See `neo4j.md` for full schema. Key nodes:
- `(:Person)` - People mentioned
- `(:Project)` - User's projects
- `(:Topic)` - Discussion topics
- `(:Idea)` - Ideas explored
- `(:Conversation)` - Lightweight conversation metadata

## Files Created

### Core Services
- `backend/src/services/entityIdentificationService.ts`
- `backend/src/services/entityResolutionService.ts`
- `backend/src/services/entityUpdateService.ts`
- `backend/src/services/relationshipUpdateService.ts`
- `backend/src/services/neo4jTransactionService.ts`
- `backend/src/services/memoryExtractionService.ts` (orchestrator)

### Queue Infrastructure
- `backend/src/queue/memoryQueue.ts` - pg-boss configuration
- `backend/src/worker.ts` - Background worker process

### Admin/Monitoring
- `backend/src/routes/admin.ts` - Queue monitoring endpoints

### Modified Files
- `backend/src/services/conversationService.ts` - Added queue enqueue
- `backend/src/index.ts` - Mounted admin routes
- `backend/package.json` - Added worker scripts

## Next Steps

### To Test Locally

1. **Start API and worker:**
   ```bash
   # Terminal 1
   npm run dev

   # Terminal 2
   npm run worker
   ```

2. **Create a test conversation** via API or iOS app

3. **End the conversation** → Job automatically enqueued

4. **Watch worker logs** → See pipeline progress

5. **Check Neo4j** → Verify entities created:
   ```cypher
   MATCH (c:Conversation)
   RETURN c
   ORDER BY c.date DESC
   LIMIT 1
   ```

### Future Enhancements

1. **Embeddings (Phase 6)**
   - Add vector embeddings for semantic search
   - Use OpenAI `text-embedding-3-small`

2. **Daily Batch Job**
   - Schedule daily batch processing for historical conversations
   - Use pg-boss `schedule()` API

3. **Better Monitoring**
   - Add metrics dashboard (Bull Board alternative for pg-boss)
   - Alert on error rate >5%
   - Track processing time per phase

4. **Field-Level Update Strategies**
   - Implement merge/append strategies (currently all REPLACE)
   - Track field evolution over time

## Troubleshooting

### Worker not picking up jobs
- Check `DATABASE_URL` environment variable
- Verify pg-boss tables created: `SELECT * FROM pgboss.version`
- Check worker logs for connection errors

### Jobs failing consistently
- Check Neo4j connection: `GET /api/neo4j/health`
- Verify OpenAI API key set
- Check worker logs for specific error messages

### Slow processing
- Normal: 5-15 seconds per conversation
- If >30 seconds: Check LLM API latency
- Consider increasing worker `teamSize` in `worker.ts`

### Jobs stuck in active state
- Check worker is running: `ps aux | grep worker`
- Restart worker process
- Jobs will auto-expire after 24 hours

## Success!

The memory extraction pipeline is fully implemented and ready for testing. The system will now automatically convert conversation transcripts into structured knowledge graph updates, building a rich memory of the user's conversations over time.
