# LoCoMo Evaluation Pipeline

Complete workflow for ingesting LoCoMo dialogue dataset with canonical user support.

## Overview

The LoCoMo evaluation pipeline processes conversational dialogues through the full ingestion stack (Phase 0-4), creating semantic knowledge graphs for evaluation and testing. All dialogues use a single canonical user for proper semantic consolidation.

## Features

- **Canonical User Support**: All dialogues share the same `user_id` for proper semantic consolidation
- **Provenance Tagging**: Sources tagged with `{origin: "locomo-eval"}` for easy filtering
- **Idempotent Setup**: Can re-run setup without errors
- **Clean Deletion**: Safe cleanup of evaluation data without affecting production

## Quick Start

### 1. Setup Canonical User

Create the evaluation user in Supabase and Neo4j:

```bash
pnpm tsx scripts/evaluation/setup-canonical-user.ts
```

This creates:
- Supabase auth user with device ID `locomo-eval-device-canonical`
- User profile entry
- Owner Person node in Neo4j with `is_owner=true`

**Output**: Returns the actual `user_id` (Supabase UUID) to use in ingestion.

### 2. Run Ingestion

Ingest LoCoMo dialogues using the canonical user:

```bash
# Use environment variables (recommended)
export LOCOMO_USER_ID=<user-id-from-step-1>
export LOCOMO_USER_DISPLAY_NAME="LoCoMo Evaluation User"
export LOCOMO_USER_NORMALIZED_NAME="locomo evaluation user"

pnpm tsx scripts/evaluation/run-locomo-ingestion.ts

# OR use CLI flags
pnpm tsx scripts/evaluation/run-locomo-ingestion.ts \
  --user-id <user-id-from-step-1> \
  --user-display-name "LoCoMo Evaluation User" \
  --user-normalized-name "locomo evaluation user"

# Test with limited dialogues
pnpm tsx scripts/evaluation/run-locomo-ingestion.ts --limit 2 --chunk-limit 1
```

**What it does**:
- Loads LoCoMo dataset from `backend/datasets/locomo_dataset.json`
- Chunks dialogues into ~4000 token segments
- Runs Phase 0-4 pipeline for each chunk:
  - Phase 0: Clean transcript
  - Phase 1: Extract entities
  - Phase 2: Create Source node (with provenance tag)
  - Phase 4: Create semantic nodes and relationships
- Tags all Sources with `provenance: {origin: "locomo-eval", dialogue_id: N, chunk_index: N}`

### 3. Cleanup (When Needed)

Delete all evaluation data:

```bash
# Delete by user_id (removes all user's data)
pnpm tsx scripts/evaluation/cleanup-locomo-data.ts --user-id <user-id>

# Delete by provenance.origin (removes all LoCoMo sources)
pnpm tsx scripts/evaluation/cleanup-locomo-data.ts --provenance-origin locomo-eval

# Delete everything (both methods)
pnpm tsx scripts/evaluation/cleanup-locomo-data.ts --all
```

**What it deletes** (in dependency order):
1. Macros → Storylines (hierarchical aggregations)
2. Artifacts → Sources (episodic memory)
3. Semantic relationships
4. Person → Concept → Entity nodes (semantic memory)
5. User node

## Scripts

### `setup-canonical-user.ts`

Creates canonical evaluation user for LoCoMo ingestion.

**Usage**:
```bash
pnpm tsx scripts/evaluation/setup-canonical-user.ts

# Custom configuration
pnpm tsx scripts/evaluation/setup-canonical-user.ts \
  --device-id custom-device \
  --display-name "Custom Eval User"
```

**Flags**:
- `--device-id`: Device ID for auth (default: `locomo-eval-device-canonical`)
- `--display-name`: User display name (default: `LoCoMo Evaluation User`)
- `--user-id`: Expected user ID (informational only, Supabase generates UUIDs)

**Output**:
```json
{
  "userId": "abc123...",
  "displayName": "LoCoMo Evaluation User",
  "normalizedName": "locomo evaluation user",
  "isNewUser": true,
  "accessToken": "eyJ..."
}
```

**Idempotency**: Safe to run multiple times. If device exists, verifies owner Person node and creates if missing.

### `run-locomo-ingestion.ts`

Main ingestion pipeline for LoCoMo dialogues.

**Usage**:
```bash
# Full ingestion
pnpm tsx scripts/evaluation/run-locomo-ingestion.ts

# Test mode (first 2 dialogues, 1 chunk each)
pnpm tsx scripts/evaluation/run-locomo-ingestion.ts --limit 2 --chunk-limit 1

# Custom user
pnpm tsx scripts/evaluation/run-locomo-ingestion.ts \
  --user-id <user-id> \
  --user-display-name "Custom Name"
```

**Flags**:
- `--limit N`: Process only first N dialogues (testing)
- `--chunk-limit N`: Process only first N chunks per dialogue (testing)
- `--user-id`: Canonical user ID (default: env `LOCOMO_USER_ID` or `locomo-eval-user`)
- `--user-display-name`: User display name (default: env `LOCOMO_USER_DISPLAY_NAME`)
- `--user-normalized-name`: Normalized name (default: env `LOCOMO_USER_NORMALIZED_NAME`)

**Environment Variables**:
- `LOCOMO_USER_ID`: Canonical user ID for all dialogues
- `LOCOMO_USER_DISPLAY_NAME`: Display name
- `LOCOMO_USER_NORMALIZED_NAME`: Normalized name (lowercase, trimmed)

**Output**: Creates per-dialogue and aggregate JSON files in `output/evaluation/`:
- `ingestion-dialogue-{id}.json`: Individual dialogue results
- `ingestion-aggregate.json`: Summary of all dialogues

### `cleanup-locomo-data.ts`

Delete evaluation data from Neo4j.

**Usage**:
```bash
# Delete by user_id
pnpm tsx scripts/evaluation/cleanup-locomo-data.ts --user-id <user-id>

# Delete by provenance tag
pnpm tsx scripts/evaluation/cleanup-locomo-data.ts --provenance-origin locomo-eval

# Delete everything (default user + default provenance)
pnpm tsx scripts/evaluation/cleanup-locomo-data.ts --all
```

**Flags**:
- `--user-id`: Delete all data for specific user
- `--provenance-origin`: Delete all Sources with matching `provenance.origin`
- `--all`: Delete both (uses defaults: `locomo-eval-user` and `locomo-eval`)

**Safety**:
- Deletes in dependency order (no orphaned relationships)
- Only deletes personal Sources (`team_id IS NULL`)
- Verifies cleanup completion with count queries

## Data Model

### Canonical User

- **User ID**: Supabase UUID (auto-generated during setup)
- **Device ID**: `locomo-eval-device-canonical` (deterministic)
- **Display Name**: `LoCoMo Evaluation User` (configurable)
- **Owner Person**: Neo4j Person node with `is_owner=true`

### Source Provenance

All LoCoMo Sources include provenance metadata:

```json
{
  "origin": "locomo-eval",
  "dialogue_id": 123,
  "chunk_index": 0
}
```

**Query Sources**:
```cypher
MATCH (s:Source)
WHERE s.provenance IS NOT NULL
AND s.provenance CONTAINS '"origin"'
AND s.provenance CONTAINS 'locomo-eval'
RETURN s
```

### User Scope

All semantic nodes share the same `user_id`:
- **Person nodes**: People mentioned across all dialogues
- **Concept nodes**: Ideas, goals, preferences
- **Entity nodes**: Organizations, places, projects

This enables proper semantic consolidation (e.g., "John" mentioned in dialogue 1 and dialogue 50 refers to the same Person node).

## Workflow Examples

### Complete Setup (First Time)

```bash
# 1. Create canonical user
pnpm tsx scripts/evaluation/setup-canonical-user.ts

# Output: {"userId": "abc123...", ...}

# 2. Set environment
export LOCOMO_USER_ID=abc123...

# 3. Run full ingestion
pnpm tsx scripts/evaluation/run-locomo-ingestion.ts
```

### Iterative Development

```bash
# 1. Test with small dataset
pnpm tsx scripts/evaluation/run-locomo-ingestion.ts --limit 2 --chunk-limit 1

# 2. Review results in Neo4j Browser
# http://localhost:7474

# 3. Clean up test data
pnpm tsx scripts/evaluation/cleanup-locomo-data.ts --all

# 4. Re-run with improvements
pnpm tsx scripts/evaluation/run-locomo-ingestion.ts --limit 5
```

### Re-running After Changes

```bash
# 1. Delete old data (preserves user, deletes all graph data)
pnpm tsx scripts/evaluation/cleanup-locomo-data.ts --user-id <user-id>

# 2. Re-run ingestion
pnpm tsx scripts/evaluation/run-locomo-ingestion.ts
```

## Troubleshooting

### "User not found" Error

**Cause**: User ID doesn't exist in Supabase.

**Fix**:
```bash
# Re-run setup to create user
pnpm tsx scripts/evaluation/setup-canonical-user.ts
```

### "Owner Person not found" Error

**Cause**: User exists but owner Person node missing.

**Fix**:
```bash
# Setup script will detect and create missing owner Person
pnpm tsx scripts/evaluation/setup-canonical-user.ts
```

### Orphaned Data from Old Runs

**Cause**: Previous runs used `generateDialogueUserId()` (one user per dialogue).

**Fix**:
```bash
# Find orphaned user_ids
# In Neo4j Browser:
MATCH (n)
WHERE n.user_id STARTS WITH 'locomo-dialogue-'
RETURN DISTINCT n.user_id

# Delete each orphaned user
pnpm tsx scripts/evaluation/cleanup-locomo-data.ts --user-id locomo-dialogue-123
```

### Cleanup Verification Failed

**Cause**: Some nodes remain after cleanup.

**Investigate**:
```cypher
// Check remaining nodes
MATCH (n)
WHERE n.user_id = 'your-user-id'
RETURN labels(n), count(*)

// Check remaining relationships
MATCH ()-[r {user_id: 'your-user-id'}]-()
RETURN type(r), count(*)
```

## Architecture Notes

### Why Canonical User?

The ingestion pipeline's semantic model requires user-scoped knowledge:
- Person nodes need `user_id` and `created_by`
- Source nodes require `user_id ∈ participants`
- Phase 4 auto-creates owner Person keyed by `user_id`

Without a canonical user, each dialogue creates a separate `user_id`, resulting in:
- Dozens of orphaned user_ids with no corresponding Supabase user
- Fragmented semantic knowledge (duplicate Person/Concept/Entity nodes)
- No semantic consolidation across dialogues
- Owner Person creation failures

### Provenance Tagging

Sources are tagged with `{origin: "locomo-eval"}` to:
- Filter evaluation data from production data
- Enable bulk deletion without affecting real conversations
- Track data lineage for analysis
- Support multi-dataset evaluation (future: add different origins)

### Deletion Order

Cleanup follows dependency order to avoid orphaned relationships:
1. **Hierarchical** (Macros, Storylines) - reference semantic nodes
2. **Episodic** (Sources, Artifacts) - reference semantic nodes
3. **Semantic relationships** - connect semantic nodes
4. **Semantic nodes** (Person, Concept, Entity) - foundational

Using `DETACH DELETE` ensures all relationships are removed atomically with nodes.

## Files

- `setup-canonical-user.ts`: Create evaluation user (Supabase + Neo4j)
- `run-locomo-ingestion.ts`: Main ingestion pipeline
- `cleanup-locomo-data.ts`: Delete evaluation data
- `locomo-adapter.ts`: Parse and chunk LoCoMo dialogues
- `types.ts`: TypeScript interfaces for LoCoMo data

## See Also

- `docs/features/locomo-canonical-user.md`: Feature specification
- `docs/investigations/supabase-user-creation.md`: User creation patterns
- `docs/investigations/user-scoped-deletion-patterns.md`: Deletion patterns
- `scripts/ingestion/schema.md`: Memory architecture documentation
3. **Evaluator Agent** (`evaluator-agent.ts`) - LangGraph agent for querying the resulting knowledge graph

## Setup

### Prerequisites

- Neo4j running locally or remotely (configured in `backend/src/db/neo4j.ts`)
- Supabase configured for embeddings
- LoCoMo dataset at `backend/datasets/locomo_dataset.json`

### Install Dependencies

```bash
cd backend
pnpm install
```

## Usage

### 1. Run Ingestion Pipeline

Process LoCoMo dialogues through the ingestion pipeline:

```bash
# Process all 35 dialogues (will take a long time!)
pnpm tsx scripts/evaluation/run-locomo-ingestion.ts

# Process only first dialogue (recommended for testing)
pnpm tsx scripts/evaluation/run-locomo-ingestion.ts --limit 1

# Process first 5 dialogues
pnpm tsx scripts/evaluation/run-locomo-ingestion.ts --limit 5
```

**What happens:**
- Each dialogue gets a unique user_id: `locomo-dialogue-{dialogue_id}`
- Dialogue is chunked into ~4k token segments with 200 token overlap
- Each chunk is processed through the official ingestionAgent:
  - Phase 0: Convert to structured notes (unified for all source types)
  - Phase 1: Extract entities (People, Concepts, Entities)
  - Phase 1.5: Resolve entities against knowledge graph (multi-tier matching)
  - Phase 2: Create Source node and link to all resolved entities
  - Phase 3: Relationship agent builds graph connections
- Results saved to `output/evaluation/ingestion-dialogue-{id}.json`
- Aggregate results saved to `output/evaluation/ingestion-aggregate.json`

### 2. Query with Evaluator Agent

After ingestion, use the evaluator agent to query the knowledge graph:

```typescript
import { runEvaluatorAgent } from './scripts/evaluation/evaluator-agent.js';

// Query dialogue 0's knowledge graph
const userId = 'locomo-dialogue-0';
const query = 'What hobbies does Speaker_1 mention?';

const { answer, messages } = await runEvaluatorAgent(userId, query);
console.log(answer);
```

**Evaluator capabilities:**
- Uses explore tool for semantic search
- Uses traverse tool for Cypher queries
- Powered by GPT-4.1-mini
- Returns factual answers grounded in the graph

### 3. Batch Evaluation (Coming Soon)

```typescript
import { batchEvaluate } from './scripts/evaluation/evaluator-agent.js';

const queries = [
  'What is Speaker_1\'s favorite hobby?',
  'Who does Speaker_2 work with?',
  'What events are mentioned in March?'
];

const results = await batchEvaluate('locomo-dialogue-0', queries);
// Returns array of { query, answer, latency_ms }
```

## Output Structure

### Individual Dialogue Results

`output/evaluation/ingestion-dialogue-{id}.json`:

```json
{
  "dialogue_id": 0,
  "user_id": "locomo-dialogue-0",
  "total_chunks": 5,
  "total_turns": 150,
  "chunks_processed": 5,
  "chunks_failed": 0,
  "total_entities_created": 23,
  "total_relationships_created": 47,
  "total_processing_time_ms": 125000,
  "chunk_results": [
    {
      "dialogue_id": 0,
      "chunk_index": 0,
      "source_id": "dialogue-0-chunk-0",
      "source_entity_key": "source:...",
      "entities_created": 8,
      "relationships_created": 12,
      "processing_time_ms": 25000
    }
  ]
}
```

### Aggregate Results

`output/evaluation/ingestion-aggregate.json`:

```json
{
  "timestamp": "2025-01-13T...",
  "total_dialogues": 35,
  "total_chunks": 175,
  "total_turns": 10500,
  "total_entities": 567,
  "total_relationships": 892,
  "total_processing_time_ms": 3600000,
  "dialogues": [...]
}
```

## Architecture

### Chunking Strategy

- **Max tokens**: 4000 (using cl100k_base encoding)
- **Overlap**: 200 tokens between chunks
- **Boundary preservation**: Never splits mid-utterance
- **Overlap handling**: If overlap enabled, backtracks N turns to include context

### Ingestion Pipeline

Each chunk is processed through the **official ingestionAgent** which orchestrates:

1. **Phase 0 (Cleanup)**: Converts raw transcript to structured bullet points (unified for all source types)
2. **Phase 1 (Extract & Disambiguate)**: Extracts entities from processed content with confidence scores
3. **Phase 1.5 (Resolve Entities)**: Multi-tier matching against knowledge graph:
   - Exact name + type match
   - Fuzzy matching (Levenshtein distance)
   - Embedding similarity (cosine > 0.75)
   - LLM arbitration to resolve ambiguities
4. **Phase 2 (Auto-Create Source Edges)**: Creates Source node and [:mentions] links to all resolved entities
5. **Phase 3 (Relationship Agent)**: LangGraph agent with tools to create/update nodes and relationships

**Reference**: `src/agents/ingestionAgent.ts` (production implementation)

### Evaluator Agent

LangGraph workflow:

```
START → agent → (tool calls?) → tools → agent → extract_answer → END
```

- **Tools**: explore (semantic search), traverse (Cypher queries)
- **Model**: GPT-4.1-mini
- **State**: user_id, query, results, messages, answer

## Development

### Type Checking

```bash
pnpm run type-check
```

### Adding Evaluation Questions

Questions are deferred to future work. To add:

1. Create `backend/datasets/locomo_questions.json`
2. Define question format (see `types.ts::EvaluationQuestion`)
3. Implement metrics calculation (precision, recall, F1)
4. Update evaluator-agent to compare against ground truth

### Debugging

- Check Neo4j Browser at `http://localhost:7474`
- View Source nodes: `MATCH (s:Source {user_id: "locomo-dialogue-0"}) RETURN s`
- View extracted entities: `MATCH (n {user_id: "locomo-dialogue-0"}) WHERE n:Person OR n:Concept OR n:Entity RETURN n`
- View relationships: `MATCH (a {user_id: "locomo-dialogue-0"})-[r]->(b {user_id: "locomo-dialogue-0"}) RETURN a, r, b LIMIT 25`

## Files

- **types.ts** - TypeScript interfaces for all pipeline components
- **locomo-adapter.ts** - Dataset parsing, chunking, token counting
- **run-locomo-ingestion.ts** - Main ingestion orchestration script
- **evaluator-agent.ts** - LangGraph agent for querying knowledge graph
- **README.md** - This file

## Next Steps

1. ✅ Infrastructure complete (adapter, ingestion, evaluator)
2. ⏳ Run pilot ingestion on 1-2 dialogues
3. ⏳ Create evaluation questions
4. ⏳ Implement metrics (precision, recall, F1)
5. ⏳ Run full evaluation on all 35 dialogues
6. ⏳ Generate evaluation report

## Notes

- Phase 5 (consolidation) is skipped during initial ingestion - it's a nightly batch job
- Each dialogue gets isolated user_id for clean evaluation
- Chunks are linked via sequential source_ids
- Graph builds progressively as chunks are processed
