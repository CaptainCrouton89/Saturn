# PostgreSQL Database Schema

**Database**: Supabase PostgreSQL with pgvector extension

**Purpose**: Store raw conversation transcripts, derived artifacts, and user preferences. Neo4j handles entity/relationship graphs, PostgreSQL handles full-text search, semantic search via embeddings, and conversation state.

---

## Core Tables

### conversation

**Purpose**: Full conversation transcripts for resumption and analysis. Source of truth for conversation state.

```sql
CREATE TABLE conversation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,

  -- Full conversation state (messages, tool calls, context)
  -- This is the complete conversation export that allows resumption
  transcript JSONB NOT NULL,

  -- Batch-generated compressed version (end-of-day job via gpt-4.1-nano)
  -- Strips tool calls, removes filler words, compacts sentences by ~50%
  abbreviated_transcript JSONB,

  -- Metadata
  summary TEXT,
  status VARCHAR NOT NULL DEFAULT 'active', -- 'active', 'completed'
  trigger_method VARCHAR, -- 'cron', 'manual', 'event_based'

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP, -- Set when status becomes 'completed'
  last_message_at TIMESTAMP DEFAULT NOW(),

  -- Search & sync
  embedding VECTOR(1536), -- OpenAI ada-002 dimensions for semantic search
  neo4j_synced_at TIMESTAMP, -- NULL = not synced, timestamp = last sync
  neo4j_sync_error TEXT, -- Error message if sync failed (manual fix required)
  entities_extracted BOOLEAN DEFAULT FALSE
);

-- Indexes
CREATE INDEX idx_conversation_user_status ON conversation(user_id, status);
CREATE INDEX idx_conversation_last_message ON conversation(last_message_at DESC);
CREATE INDEX idx_conversation_needs_sync ON conversation(user_id)
  WHERE neo4j_synced_at IS NULL AND entities_extracted = TRUE;
```

**Conversation lifecycle**:
- Created with `status = 'active'`
- Auto-completed after 10 minutes of inactivity (background job sets `status = 'completed'`, `ended_at = NOW()`)
- Starting new conversation also completes any active conversation
- Only one active conversation per user at a time

**Resumption flow**:
1. Query Neo4j for relevant past conversations by topic/entity
2. Load `conversation.transcript` from PostgreSQL
3. Deserialize JSONB and feed to AI to restore full context
4. Continue conversation, update `last_message_at`

---

### artifact

**Purpose**: Synthesized outputs generated during or after conversations (journal entries, reflections, summaries, etc.)

```sql
CREATE TABLE artifact (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  conversation_id UUID REFERENCES conversation(id), -- Can be NULL for standalone artifacts

  type VARCHAR NOT NULL, -- 'journal_entry', 'reflection', 'summary', 'insight'
  content TEXT NOT NULL,

  created_at TIMESTAMP DEFAULT NOW(),

  -- Semantic search
  embedding VECTOR(1536)
);

-- Indexes
CREATE INDEX idx_artifact_user ON artifact(user_id);
CREATE INDEX idx_artifact_conversation ON artifact(conversation_id);
CREATE INDEX idx_artifact_type ON artifact(user_id, type);
```

---

### user_preference

**Purpose**: User configuration combining AI-learned patterns and explicit settings.

```sql
CREATE TABLE user_preference (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),

  -- AI-learned conversation patterns (tone, topics, preferred response style)
  learned_rules JSONB,

  -- Explicit user settings
  timezone VARCHAR NOT NULL DEFAULT 'UTC', -- e.g., 'America/Los_Angeles'
  notification_preferences JSONB, -- Placeholder for future use
  voice_settings JSONB, -- ElevenLabs TTS configuration

  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Structure of `learned_rules` JSONB** (AI-learned):
```json
{
  "tone": "casual, warm, slightly playful",
  "topics_to_avoid": ["work stress", "politics"],
  "preferred_question_style": "open-ended, gentle probing",
  "response_preferences": {
    "length": "medium",
    "follow_up_frequency": "high"
  }
}
```

**Structure of `voice_settings` JSONB** (user-configured):
```json
{
  "voice_id": "21m00Tcm4TlvDq8ikWAM",
  "model_id": "eleven_monolingual_v1",
  "stability": 0.5,
  "similarity_boost": 0.75,
  "speed": 1.0,
  "style": 0,
  "use_speaker_boost": true
}
```

**Structure of `notification_preferences` JSONB** (placeholder):
```json
{
  "push": true,
  "email": false,
  "sms": false
}
```

---

### batch_job

**Purpose**: Track batch processing jobs (transcript abbreviation, Neo4j sync retries, daily summaries, etc.)

```sql
CREATE TABLE batch_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  job_type VARCHAR NOT NULL, -- 'abbreviate_transcripts', 'sync_neo4j', 'daily_summary'

  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,

  -- Metrics
  conversations_processed INT,
  errors JSONB, -- Array of {conversation_id, error_message}

  -- Job-specific metadata
  metadata JSONB
);

-- Indexes
CREATE INDEX idx_batch_job_type ON batch_job(job_type, started_at DESC);
```

**Scheduled jobs**:
- **End-of-day abbreviation**: Finds conversations with `abbreviated_transcript IS NULL`, runs gpt-4.1-nano compression
- **Inactivity completion**: Finds conversations with `status = 'active'` and `last_message_at < NOW() - INTERVAL '10 minutes'`, sets to completed
- **Neo4j sync**: Finds conversations with `neo4j_synced_at IS NULL` and `entities_extracted = TRUE`, attempts sync

---

## Authentication

Uses **Supabase built-in auth** (`auth.users` table).

All user-facing tables reference `auth.users(id)` via foreign keys.

---

## Storage Strategy

### What lives in PostgreSQL:
- ✅ Raw conversation transcripts (full state for resumption)
- ✅ Compressed/abbreviated transcripts (UI display)
- ✅ Embeddings for semantic search (conversations and artifacts)
- ✅ Synthesized artifacts (journal entries, reflections)
- ✅ User preferences (AI-learned rules, timezone, voice/TTS settings, notifications)

### What lives in Neo4j:
- ✅ Entity graph (Person, Event, Topic nodes)
- ✅ Relationships (MENTIONED_IN, DISCUSSED, RELATED_TO, FOLLOWED_UP)
- ✅ Conversation metadata for entity-based retrieval

### What we DON'T store:
- ❌ Audio files (voice input is transcribed immediately, audio discarded)
- ❌ Individual message rows (transcript JSONB is queryable enough)
- ❌ Conversation threading/forking (not needed for MVP)

---

## Query Patterns

**Find user's active conversation**:
```sql
SELECT * FROM conversation
WHERE user_id = $1 AND status = 'active'
LIMIT 1;
```

**Semantic search for relevant past conversations**:
```sql
SELECT id, summary, created_at
FROM conversation
WHERE user_id = $1
ORDER BY embedding <-> $2 -- pgvector cosine similarity
LIMIT 5;
```

**Find conversations needing Neo4j sync**:
```sql
SELECT id, transcript FROM conversation
WHERE user_id = $1
  AND entities_extracted = TRUE
  AND neo4j_synced_at IS NULL
  AND neo4j_sync_error IS NULL;
```

**Get recent conversations for UI**:
```sql
SELECT id, summary, last_message_at
FROM conversation
WHERE user_id = $1 AND status = 'completed'
ORDER BY last_message_at DESC
LIMIT 20;
```

---

## Decisions Log

**2025-01-08**:
- Transcript is source of truth for resumption (includes all tool calls, messages, context)
- No audio storage - transcripts only
- Use Supabase built-in auth
- Conversation auto-completes after 10 minutes inactivity
- Only one active conversation per user at a time
- Abbreviated transcripts generated via end-of-day batch job (gpt-4.1-nano compression)
- Neo4j sync failures flagged for manual fix (no auto-retry)
- No conversation forking/threading for MVP
- No separate messages table (transcript JSONB sufficient)
- Merged user_settings into user_preference table (AI-learned + explicit config in one place)
- user_preference includes: timezone, voice_settings (ElevenLabs), notification_preferences (placeholder)
- Conversation speed lives in voice_settings.speed (TTS playback speed)
