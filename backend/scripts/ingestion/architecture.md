# Ingestion Pipeline Architecture

## Overview

The ingestion pipeline transforms raw conversational data (voice memos, meetings, transcripts) into structured semantic knowledge for Cosmo's Neo4j graph. The pipeline is **modular, resumable, and optimized for cost**.

## 5-Phase Architecture

```
Raw Input → Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Neo4j Graph
              ↓          ↓          ↓          ↓          ↓
           Notes     Entities   Nodes    Updates   Relationships
```

### Phase 0: Content Cleaning (STT only)
- **Input**: Raw transcript with disfluencies, overlaps
- **Process**: LLM converts to structured bullet points
- **Model**: `gpt-5-nano` + medium reasoning (cost-optimized)
- **Output**: Cleaned notes
- **Runs for**: voice-memo, meeting, phone-call, voice-note
- **Cost**: ~$0.01 per 10k words

### Phase 1: Entity Extraction
- **Input**: Structured notes from Phase 0
- **Process**: Extract People, Concepts, Entities with confidence
- **Model**: `gpt-4.1-mini` with structured output
- **Filtering**: confidence ≥7/10 AND subpoints >2
- **Output**: Filtered entity list
- **Cost**: ~$0.02 per 10k words

### Phase 2: Node Creation
- **Input**: Extracted entities + metadata
- **Process**: Create Source (episodic) and Episode (context) nodes
- **Model**: None (deterministic)
- **Output**: Source/Episode nodes
- **Cost**: Free

### Phase 3: Entity Updates
- **Input**: Transcript + extracted entities
- **Process**: Agent writes rich updates for each entity
- **Model**: `gpt-4.1-mini` with tools
- **Output**: Node updates with context
- **Cost**: ~$0.03 per 10k words

### Phase 4: Relationship Agent
- **Input**: Entities + updates from Phase 3
- **Process**: Agent creates relationships between nodes
- **Model**: `gpt-4.1-mini` with relationship tools
- **Output**: Relationship data
- **Cost**: ~$0.04 per 10k words

## Key Features

### Modularity
- Each phase independent and testable
- Outputs saved to files (resumability)
- No phase dependencies beyond data flow

### Cost Optimization
- Phase 0: Reasoning enabled (helps with cleanup)
- Phases 1-4: No reasoning (sufficient for structured tasks)
- **Total**: ~$0.10 per conversation (target: $0.05-0.10)

### Error Resilience
- File-based outputs enable resumption
- IDEMPOTENT operations (safe to re-run)
- Fail fast on errors

### Filtering Strategy
Phase 1 aggressively filters to keep quality high:
- Confidence ≥7/10 (meaningful mentions only)
- >2 subpoints (substance, not surface mentions)

## State Evolution

```typescript
Phase 0: transcript → cleaned notes
Phase 1: notes → extracted entities
Phase 2: entities → source/episode nodes
Phase 3: entities + transcript → node updates
Phase 4: updates → relationships
```

## Integration

### From API Endpoint
```typescript
const entities = await runPhase1(transcript);
const source = await runPhase2({ entities, userId });
```

### From Background Worker
```typescript
const state = await runOrchestrator({ transcript, userId });
await persistToNeo4j(state);
```

## Performance

| Phase | Time | Status |
|-------|------|--------|
| 0 | 5-15s | Reasoning enabled |
| 1 | 5-10s | Filtered output |
| 2 | <1s | Deterministic |
| 3 | 10-20s | Multi-turn agent |
| 4 | 10-30s | Relationship creation |
| **Total** | **~1 min** | **Per conversation** |

## Future Work

1. Direct Neo4j persistence (currently mocked)
2. Streaming entity output
3. Multi-source support (email, Slack, docs)
4. Relationship weighting/confidence
5. Incremental graph updates
