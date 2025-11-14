# Speaker Name Identification

## Overview

The LoCoMo ingestion pipeline now identifies real speaker names from dialogue content before chunking transcripts. This replaces abstract labels (`Speaker_1`, `Speaker_2`) with actual names extracted from the conversation.

## Implementation

### Flow

```
Raw Dialogue → Parse → Identify Names → Chunk with Real Names → Ingest
```

### Key Components

**1. `identifySpeakerNames()` - Name Extraction**
- Location: `/backend/scripts/evaluation/locomo-adapter.ts`
- Uses GPT-4.1-mini to analyze first 4 utterances from each speaker
- Identifies names by analyzing:
  - Greetings ("Hey Carol!" → other person is Carol)
  - Self-references ("I'm John")
  - Context clues from personal stories
- Throws error if names cannot be identified (fail-fast, no fallbacks)

**2. `ParsedDialogue` Type Update**
- Location: `/backend/scripts/evaluation/types.ts`
- Added `speaker_names` field to track identified names:
  ```typescript
  speaker_names?: {
    Speaker_1: string;
    Speaker_2: string;
  }
  ```

**3. `formatTurn()` Function**
- Updated to use real names from speaker mapping
- Throws error if speaker role is unknown

**4. `chunkDialogue()` Function**
- Now requires `speaker_names` to be set before chunking
- Throws error if names are missing (enforces identification step)

**5. `processDialogue()` Integration**
- Location: `/backend/scripts/evaluation/run-locomo-ingestion.ts`
- Calls `identifySpeakerNames()` immediately after parsing
- Assigns names to `parsed.speaker_names`
- Logs identified names for visibility

## Example Output

### Before
```
Speaker_1: Hey Carol! Nice to see you again.
Speaker_2: Hey Roy! Nice to see you too!
```

### After
```
Roy: Hey Carol! Nice to see you again.
Carol: Hey Roy! Nice to see you too!
```

## Model Selection

**Model**: `gpt-4.1-mini`

**Why not gpt-4.1-nano?**
- Testing showed nano sometimes misidentified speakers
- Mini provides more reliable name extraction
- Cost difference is negligible for one call per dialogue

## Error Handling

The implementation follows fail-fast principles:

1. **Insufficient Utterances**: Throws if less than 1 utterance per speaker
2. **Invalid Response**: Throws if JSON parsing fails or structure is invalid
3. **Fallback Detection**: Throws if model returns "Speaker_1" or "Speaker_2" as names
4. **Missing Names Before Chunking**: Throws if chunking is attempted without identification

## Testing

Run test script:
```bash
tsx scripts/evaluation/test-speaker-identification.ts
```

This will:
- Load first dialogue from dataset
- Show sample utterances analyzed
- Display identified names
- Print sample chunk with real names

## Performance

- **Timing**: ~1-2 seconds per dialogue (one GPT call)
- **Cost**: Minimal (analyzing <1000 tokens per dialogue)
- **Accuracy**: High with gpt-4.1-mini (verified on multiple dialogues)

## Integration with Pipeline

The speaker identification step runs **before chunking** in the pipeline:

```typescript
// Parse dialogue
const parsed = parseDialogue(dialogue);

// Identify speaker names (NEW)
const speakerNames = await identifySpeakerNames(parsed);
parsed.speaker_names = speakerNames;

// Chunk dialogue (now uses real names)
const chunks = chunkDialogue(parsed, config);

// Process chunks through ingestion pipeline
// ...
```

All chunks inherit the identified names, ensuring consistent labeling throughout the entire dialogue.
