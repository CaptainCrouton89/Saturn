# LoCoMo Evaluation Pipeline

This directory contains scripts for evaluating the Cosmo ingestion pipeline using the LoCoMo (Long-Context Modeling) dataset.

## Overview

The pipeline consists of three main components:

1. **Adapter** (`locomo-adapter.ts`) - Parses LoCoMo dialogues and chunks them into 4k token segments
2. **Ingestion Runner** (`run-locomo-ingestion.ts`) - Processes chunks through the orchestrator pipeline
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
- Each chunk is processed through:
  - Phase 0: Convert to structured notes
  - Phase 1: Extract entities (People, Concepts, Entities)
  - Phase 2: Create Source node and link to entities
  - Phase 4: Relationship agent builds graph connections
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

Each chunk flows through 4 phases:

1. **Phase 0 (Cleanup)**: Converts raw transcript to bullet points
2. **Phase 1 (Extraction)**: Extracts entities with confidence scores, filters ≥7
3. **Phase 2 (Source)**: Creates Source node, links to mentioned entities
4. **Phase 4 (Relationships)**: LangGraph agent builds graph using 10 tools

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
