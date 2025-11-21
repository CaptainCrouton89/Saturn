# LoCoMo 1.0 Evaluation - Trace Structure Analysis

## Overview

The LoCoMo 1.0 evaluation pipeline processes 10 multi-session conversations and evaluates memory system performance through Q&A accuracy. **Tracing is currently partial** - only ingestion operations are traced, not individual Q&A evaluations.

---

## File Locations

### LoCoMo 1.0 Dataset
- **Dataset**: `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/datasets/locomo10.json`
  - Contains 10 conversations (`conv-0` through `conv-9`)
  - Each conversation has 2-5 sessions (e.g., `session_1`, `session_2`, etc.)
  - Each session has a date/time field (e.g., `session_1_date_time`)
  - Each session contains dialogue turns with speaker and text

### Evaluation Scripts
Located in `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/scripts/evaluation/`:
- **`run-locomo10-eval.ts`** - Main evaluation pipeline orchestrator
- **`locomo10-ingestion.ts`** - Ingests all sessions from a conversation
- **`locomo10-adapter.ts`** - Parses JSON dataset and extracts sessions
- **`chat-caller.ts`** - Calls chat controller for each Q&A pair
- **`answer-comparison.ts`** - LLM-as-judge for answer evaluation
- **`types.ts`** - Type definitions for evaluation data structures

### Output Directory
- **Path**: `/Users/silasrhyneer/Code/Cosmo/Saturn/output/locomo10-eval/`
- **Format**: `eval-{sample_id}-{ISO-timestamp}.json`
- **Contains**: Question results, scores, latency metrics, category breakdowns

---

## JSON Session Structure

### Sample Conversation Object
```json
{
  "sample_id": "conv-26",
  "conversation": {
    "speaker_a": "Caroline",
    "speaker_b": "Melanie",
    "session_1_date_time": "2023-05-07T14:30:00Z",
    "session_1": [
      {
        "speaker": "Caroline",
        "dia_id": "D1:3",
        "text": "I attended an LGBTQ support group session last week.",
        "img_url": [],
        "blip_caption": null,
        "query": null
      },
      ...
    ],
    "session_2_date_time": "2023-05-15T10:00:00Z",
    "session_2": [...]
  },
  "qa": [
    {
      "question": "When did Caroline go to the LGBTQ support group?",
      "answer": "7 May 2023",
      "evidence": ["D1:3"],
      "category": 2  // 1=factual, 2=temporal, 3=reasoning, 4=other
    },
    ...
  ]
}
```

### Session ID Pattern
Sessions are named:
- `session_1`, `session_2`, `session_3`, etc.
- Extracted as `sessionId: "session_N"` in code
- Date/time in `session_N_date_time` field

---

## Current Trace Structure

### Ingestion Pipeline Traces

**Function**: `runIngestionPipeline()` in `src/services/ingestionOrchestratorService.ts:260`

Uses **LangSmith `traceable`** wrapper:
```typescript
export const runIngestionPipeline = traceable(
  async function runIngestionPipelineImpl(payload: IngestionPayload): Promise<IngestionResult> {
    // ...
  },
  {
    name: 'ingestion_orchestrator',
    tags: ['ingestion', 'orchestrator'],
  }
);
```

**Current Trace Metadata**:
- No trace run_id or session_id is set
- No correlation between sessions
- Each ingestion call is isolated in LangFuse/LangSmith

**Input Payload** (`src/services/ingestionOrchestratorService.ts:31-42`):
```typescript
export interface IngestionPayload {
  sourceId: string;              // e.g., "locomo10-conv-26-eval-session_1"
  userId: string;                // "locomo10-eval-user"
  teamId?: string | null;
  sourceType: string;            // "conversation"
  summary: string;               // AI-generated
  transcriptRaw: string | string[];
  transcriptProcessed?: string[];
  participants: string[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}
```

### Ingestion Call Site
**File**: `scripts/evaluation/locomo10-ingestion.ts:75`

```typescript
const payload = {
  sourceId,
  userId,
  teamId: null,
  sourceType: 'conversation',
  summary: `Session ${session.sessionId} on ${session.dateTime}`,
  transcriptRaw: transcript,
  participants: [userId],
  createdAt: new Date().toISOString(),
  metadata: {
    sample_id: conversation.sample_id,
    conversation_id: conversationId,
    session_id: session.sessionId,        // <-- Extracted here
    session_date_time: session.dateTime,
    session_index: i,
  },
};
```

**Note**: Session ID is stored in `metadata.session_id` but NOT in the trace run_id or name.

---

## Where Session IDs Should Be Added

### Option 1: Add to `traceable` metadata (Current Location)
**File**: `src/services/ingestionOrchestratorService.ts:498-502`

The second argument to `traceable()`:
```typescript
{
  name: 'ingestion_orchestrator',
  tags: ['ingestion', 'orchestrator'],
  // ADD HERE:
  // metadata: { session_id: payload.metadata?.session_id },
  // run_id: ...,
}
```

**Issue**: LangSmith `traceable` doesn't support `run_id` or `session_id` in config directly.

### Option 2: Use LangSmith `runTree` API (Recommended)
Wrap the ingestion call in a run context:

```typescript
import { RunTree } from 'langsmith';

export async function ingestLoCoMo10Conversation(...) {
  const allSessions = extractSessions(conversation);
  const runTree = new RunTree({
    name: 'locomo10_ingestion',
    run_type: 'chain',
    inputs: { conversation_id: conversationId },
    metadata: {
      conversation_id: conversationId,
      total_sessions: allSessions.length,
    },
  });

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const sessionRun = new RunTree({
      name: `session_ingestion`,
      run_type: 'chain',
      parent_run_id: runTree.id,
      inputs: { session_id: session.sessionId },
      metadata: {
        session_id: session.sessionId,
        session_index: i,
        sample_id: conversation.sample_id,
      },
    });

    try {
      const result = await runIngestionPipeline(payload);
      sessionRun.end(outputs: result);
    } catch (error) {
      sessionRun.end(error: error);
    } finally {
      await sessionRun.postRun();
    }
  }

  runTree.end();
  await runTree.postRun();
}
```

### Option 3: Extract session_id to function parameter
Modify `runIngestionPipeline` to accept optional `sessionId`:

```typescript
export interface IngestionPayload {
  // ... existing fields
  sessionId?: string;  // Add this
}

export const runIngestionPipeline = traceable(
  async function runIngestionPipelineImpl(
    payload: IngestionPayload
  ): Promise<IngestionResult> {
    console.log(`Session ID: ${payload.sessionId}`);
    // ... rest of function
  },
  {
    name: 'ingestion_orchestrator',
    tags: ['ingestion', 'orchestrator'],
    // Can access payload.sessionId here in some tracer implementations
  }
);
```

---

## Evaluation Pipeline Flow

### Step 1: Load Dataset
**Function**: `loadLoCoMo10Dataset()` → parses JSON

**Step 2: Ingest Sessions
**Function**: `ingestLoCoMo10Conversation()`
- Extracts all sessions from conversation
- Calls `runIngestionPipeline()` for each session
- **Current state**: Each ingestion is traced but isolated, no session correlation

### Step 3: Evaluate Q&A Pairs
**Function**: `runEvaluation()` → calls `callChatController()` for each question
- **Current state**: NO TRACING for individual Q&A evaluations
- Calls chat endpoint with user, conversation, question
- **This is where session ID should be added for correlation**

### Step 4: Generate Report
**Function**: Saves evaluation results to output JSON
- Contains question/answer pairs, scores, latency

---

## Key IDs to Correlate Traces

### 1. Sample ID (Conversation)
- **Format**: `conv-26`
- **Source**: Dataset file
- **Used in**: Output filename, metadata

### 2. Conversation ID (Ingestion)
- **Format**: `locomo10-conv-26-eval`
- **Generated in**: `locomo10-ingestion.ts:40`
- **Used in**: Source IDs for all sessions in this conversation

### 3. Session ID
- **Format**: `session_1`, `session_2`, etc.
- **Source**: Extracted from JSON keys
- **Currently stored in**: `metadata.session_id` of ingestion payload

### 4. Source ID (Session)
- **Format**: `locomo10-conv-26-eval-session_1`
- **Generated in**: `locomo10-ingestion.ts:52`
- **Passed to**: `runIngestionPipeline()`

### 5. User ID (Evaluation)
- **Format**: `locomo10-eval-user`
- **Used throughout**: Chat controller, retrieval

---

## Recommended Implementation

To properly add session IDs to traces:

### 1. **Add to IngestionPayload**
```typescript
// File: src/services/ingestionOrchestratorService.ts
export interface IngestionPayload {
  // ... existing
  sessionId?: string;  // NEW: for trace correlation
}
```

### 2. **Pass sessionId in locomo10-ingestion.ts**
```typescript
// File: scripts/evaluation/locomo10-ingestion.ts
const payload = {
  // ... existing fields
  sessionId: session.sessionId,  // NEW
};
```

### 3. **Use in traceable wrapper**
```typescript
// File: src/services/ingestionOrchestratorService.ts
console.log(`Session: ${payload.sessionId}`);  // Use in logging

// Could be used by OpenTelemetry if needed:
import { getTracer } from '../utils/tracing.js';
const tracer = getTracer();
tracer.startActiveSpan('ingestion', {
  attributes: {
    session_id: payload.sessionId
  }
}, ...);
```

### 4. **Add to Q&A evaluation traces** (MISSING)
```typescript
// File: scripts/evaluation/run-locomo10-eval.ts
// In the QA loop, add span:
const sessionId = conversationId;  // Use same conversation ID
for (let i = 0; i < questions.length; i++) {
  await withSpan(
    'qa_evaluation',
    {
      conversation_id: conversationId,
      question_id: i,
      category: qa.category,
      sample_id: conversation.sample_id,
    },
    async () => {
      const ourAnswer = await callChatController(qa.question, config.userId, conversationId);
      const { score, reasoning } = await compareAnswers(qa.question, qa.answer, ourAnswer);
      // ...
    }
  );
}
```

---

## Summary Table

| Component | Location | Session ID Field | Trace Status |
|-----------|----------|------------------|--------------|
| Dataset | `datasets/locomo10.json` | Key: `session_N` | N/A |
| Ingestion | `scripts/evaluation/locomo10-ingestion.ts` | `metadata.session_id` | ✓ Traced (isolated) |
| Ingestion Pipeline | `src/services/ingestionOrchestratorService.ts` | Not accessible in `traceable` | ✓ Traced (needs update) |
| Q&A Evaluation | `scripts/evaluation/run-locomo10-eval.ts` | N/A | ✗ NOT traced |
| Output | `output/locomo10-eval/eval-*.json` | N/A (file-based) | ✓ Timestamped |

---

## Files to Modify

1. **`src/services/ingestionOrchestratorService.ts`**
   - Add `sessionId?: string` to `IngestionPayload`
   - Log sessionId in pipeline

2. **`scripts/evaluation/locomo10-ingestion.ts`**
   - Pass `sessionId: session.sessionId` in payload

3. **`scripts/evaluation/run-locomo10-eval.ts`** (PRIORITY)
   - Add `withSpan()` wrapper around QA evaluation loop
   - Include `sessionId`/`conversationId` in span attributes

4. **`src/utils/tracing.ts`** (Optional)
   - Add `SESSION_ID` to `TraceAttributes` constant
   - Create `buildEvaluationAttributes()` helper function

---

## Testing

Run evaluation with tracing enabled:
```bash
cd backend
TRACING_MODE=console pnpm tsx scripts/evaluation/run-locomo10-eval.ts 0 --session-limit 2 --question-limit 5
```

This will output OpenTelemetry spans to console, showing session/question correlation.
