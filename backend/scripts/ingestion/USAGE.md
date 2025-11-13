# Ingestion Pipeline - Usage Guide

This directory contains the complete 5-phase ingestion pipeline for processing conversations into structured semantic knowledge.

## Quick Start

```bash
# From backend directory
cd backend

# Run the complete pipeline (phases 0-4)
tsx scripts/ingestion/orchestrator.ts

# Run specific phases
# Edit orchestrator.ts CONFIG and set startPhase/maxPhase
# startPhase: 0 (start here)
# maxPhase: 4 (stop after this phase)
```

## Phase Descriptions

### Phase 0: Convert to Structured Notes (`phase0.ts`)
- **Input**: Raw transcript (voice memo, meeting, etc.)
- **Output**: Cleaned, structured bullet points
- **Model**: `gpt-5-nano` with `reasoning: { effort: 'medium' }`
- **Cost**: ~$0.01 per 10k words
- **Runs for**: STT sources only (voice-memo, meeting, phone-call, voice-note)
- **Skips for**: conversation, document, etc.

### Phase 1: Extract Entities (`phase1.ts`)
- **Input**: Structured notes from Phase 0
- **Output**: Extracted People, Concepts, Entities with confidence scores
- **Model**: `gpt-4.1-mini` with structured output
- **Cost**: ~$0.02-0.03 per 10k words
- **Filters**: Confidence ≥7/10 AND subpoints >2
- **Output file**: `pipeline-phase1-entities.json`

### Phase 2: Create Nodes (`phase2.ts`)
- **Input**: Extracted entities + metadata
- **Output**: Source and Episode node creation (mocked in scripts)
- **Cost**: Free (no LLM)
- **Output file**: `pipeline-phase2-source.json`

### Phase 3: Collect Updates (`phase3.ts`)
- **Input**: Entities + transcript
- **Output**: Rich textual updates for each node
- **Model**: `gpt-4.1-mini` with tools
- **Cost**: ~$0.02-0.05 per 10k words
- **Output file**: `pipeline-phase3-updates.json`

### Phase 4: Relationship Agent (`phase4.ts`)
- **Input**: Entities + updates from Phase 3
- **Output**: Relationship data and consolidated node state
- **Model**: `gpt-4.1-mini` with tools
- **Cost**: ~$0.02-0.05 per 10k words
- **Output file**: `pipeline-phase4-final.json`

## Configuration

Edit `orchestrator.ts` CONFIG section:

```typescript
const CONFIG: PipelineConfig = {
  conversationId: 'test-conversation-123',  // Unique ID
  userId: 'test-user-456',                  // User scope
  sourceType: 'voice-memo',                 // Type of source
  sampleDataPath: path.join(__dirname, '../../../sample-memo.txt'),  // Input file
  outputDir: path.join(__dirname, '../..'),  // Where to save outputs
  startPhase: 0,                             // Start from phase N
  maxPhase: 4,                               // Stop after phase N
};
```

## Source Types

- `voice-memo` - Personal voice memo
- `voice-note` - Quick voice note
- `meeting` - Meeting transcript
- `phone-call` - Phone call transcript
- `conversation` - Text conversation (skips Phase 0)

## Output Files

After running, outputs are saved to the configured `outputDir`:

- `pipeline-phase0-notes.txt` - Structured notes
- `pipeline-phase1-entities.json` - Extracted entities (filtered + all)
- `pipeline-phase2-source.json` - Source and Episode nodes
- `pipeline-phase3-updates.json` - Entity updates
- `pipeline-phase4-final.json` - Final relationship data

## Cost Estimate

**Total cost per 10k words**: ~$0.08-$0.15 (all phases)

- Phase 0: ~$0.01 (reasoning enabled)
- Phase 1: ~$0.02-0.03
- Phase 2: Free
- Phase 3: ~$0.02-0.05
- Phase 4: ~$0.02-0.05

## Performance

- Phase 0: 5-15 seconds
- Phase 1: 5-10 seconds
- Phase 2: <1 second
- Phase 3: 10-20 seconds
- Phase 4: 10-30 seconds

**Total**: ~40-90 seconds for full pipeline on 10k word input

## Resume from Previous Run

If a phase fails, you can resume:

1. Fix the issue
2. Edit `CONFIG.startPhase` to the failed phase
3. Run orchestrator again
4. It will automatically load outputs from previous phases

Example:
```typescript
// If Phase 3 failed, restart from there:
startPhase: 3,  // Will load Phase 0-2 outputs automatically
maxPhase: 4,
```

## Integration with API

To call from API endpoints:

```typescript
import { runPhase0 } from '../scripts/ingestion/phase0.js';
import { runPhase1 } from '../scripts/ingestion/phase1.js';

const notes = await runPhase0(state, config);
const entities = await runPhase1(notes, config);
// ... etc
```

## Testing with Sample Data

The default config uses `/backend/../../sample-memo.txt` (provided in repo):

```bash
# To test with custom transcript:
# 1. Update CONFIG.sampleDataPath in orchestrator.ts
# 2. Run: tsx scripts/ingestion/orchestrator.ts
```

## Troubleshooting

**Phase 0 takes too long?**
- It's using medium reasoning - this is normal
- Use `reasoning: { effort: 'low' }` to speed up (less quality)

**Phase 1 extracts too many entities?**
- Lower confidence threshold in `phase1.ts` (currently 7/10)
- Increase subpoints requirement (currently >2)

**Models seem outdated?**
- Update model names in each phase file
- Always use `-mini` models for cost efficiency
- Use `gpt-5-nano` for Phase 0 when available

## Next Steps

1. Integrate phases into API endpoints
2. Add database persistence (currently uses mocks)
3. Add email/Slack integration sources
4. Implement streaming responses for long conversations
