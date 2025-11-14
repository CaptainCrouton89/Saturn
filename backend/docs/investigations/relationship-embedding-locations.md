# Investigation: Relationship Embedding Refactoring - All Locations Where relation_embedding and notes_embedding Are Generated/Updated

> Context bundle for refactoring relationship embeddings to a single unified embedding. All file references, data flows, and patterns needed for implementation.

## Goal

Document ALL code locations where `relation_embedding` and `notes_embedding` are currently generated or updated. This investigation supports refactoring to a single unified relationship embedding that combines both semantic dimensions.

## Key Files

### Entry Points

#### Relationship Creation
- `src/agents/tools/relationships/relationship.tool.ts:124-146` – Initial `relation_embedding` and `notes_embedding` generation on relationship creation
- `src/agents/tools/relationships/relationship.tool.ts:290-309` – `notes_embedding` regeneration when notes are added

#### Relationship Updates
- `src/agents/tools/ingestion/generic.tool.ts:580-592` – `relation_embedding` regeneration when relationship properties change
- `src/agents/tools/relationships/update-relationship-types.tool.ts:137-148` – `relation_embedding` regeneration for Phase 5 consolidation

#### Batch Processing
- `scripts/ingestion/phase5.ts:408-475` – Batch `notes_embedding` regeneration during consolidation phase

### Core Logic

#### Embedding Generation Service
- `src/services/embeddingGenerationService.ts:177-194` – `generateEmbedding()` helper function used by all relationship tools
- `src/services/embeddingGenerationService.ts:48-50` – Uses OpenAI `text-embedding-3-small` model (1536 dimensions)

#### Semantic Word Mappings
- `src/utils/relationshipSemantics.ts:28-59` – Word mappings for attitude/proximity scores (1-5) per relationship type
- `src/utils/relationshipSemantics.ts:70-94` – `getAttitudeProximityWords()` function converts numeric scores to semantic words

### Query/Retrieval Logic

#### Retrieval Service
- `src/services/retrievalService.ts:485-486` – Queries select `relation_embedding` and `notes_embedding` but remove them from response
- `src/services/retrievalService.ts:534-535` – Same pattern for edges to user
- `src/services/retrievalService.ts:609-610` – Same pattern for neighbor edges

### Schema Documentation
- `scripts/ingestion/relationships.md:24-25` – Schema documentation for both embedding fields
- `src/agents/schemas/ingestion.ts:186-187` – Zod schema comments describing embedding fields

### Testing/Debugging
- `check-embeddings-notes.ts:16-17, 42-43` – Script to check relationship embeddings in Neo4j
- `check-relationships.ts:28, 48` – Script to inspect relationship embeddings

## Detailed Location Analysis

### 1. Initial Relationship Creation

**File**: `src/agents/tools/relationships/relationship.tool.ts`

**Location**: Lines 124-146

**What triggers**: `create_relationship` tool called by ingestion agent

**relation_embedding generation**:
```typescript
// Line 124-126: Generate relation_embedding
const relationText = `${relationship_type} ${attitudeWord} ${proximityWord}`;
const relationEmbedding = await generateEmbedding(relationText);
```

**Text being embedded**: 
- Format: `"{relationship_type} {attitudeWord} {proximityWord}"`
- Example: `"friend close intimate-knowledge"` (for Person→Person with attitude=5, proximity=5)
- Source: `relationship_type` (user-provided) + attitude/proximity words from `getAttitudeProximityWords()` (lines 98-102)

**notes_embedding initialization**:
```typescript
// Line 146: Initialize as empty array
r.notes_embedding = [],
```

**Neo4j SET clause**: Lines 144-146
- Sets `relation_embedding` to generated vector
- Sets `notes_embedding` to empty array `[]`

### 2. Adding Notes to Relationship

**File**: `src/agents/tools/relationships/relationship.tool.ts`

**Location**: Lines 290-309

**What triggers**: `add_note_to_relationship` tool called when agent wants to add context notes

**notes_embedding regeneration**:
```typescript
// Lines 290-296: Concatenate notes and generate embedding
const notes = addResult[0].notes;
const notesText = notes
  .map((n) => n.content)
  .join(' ')
  .substring(0, 1000);
const notesEmbedding = notesText.length > 0 ? await generateEmbedding(notesText) : [];
```

**Text being embedded**:
- Format: Concatenated note contents joined by spaces, truncated to 1000 characters
- Example: `"Met at conference last week. Discussed project collaboration. Planning follow-up meeting."`
- Source: `r.notes` array, extracting `content` field from each note object

**Neo4j UPDATE query**: Lines 299-303
- Updates `notes_embedding` with regenerated vector

### 3. Updating Relationship Properties (Generic Tool)

**File**: `src/agents/tools/ingestion/generic.tool.ts`

**Location**: Lines 580-592

**What triggers**: `update_relationship` tool called when relationship properties change

**relation_embedding regeneration**:
```typescript
// Lines 580-592: Regenerate if relationship_type, attitude, or proximity changed
if (propertiesChanged) {
  const finalRelType = relationship_type ?? current[0].current_relationship_type;
  const finalAttitude = attitude ?? current[0].current_attitude;
  const finalProximity = proximity ?? current[0].current_proximity;

  const { attitudeWord, proximityWord } = getWords(cypherRelType, finalAttitude, finalProximity);
  const relationText = `${finalRelType} ${attitudeWord} ${proximityWord}`;
  const relationEmbedding = await generateEmbedding(relationText);

  updates.push('r.relation_embedding = $relation_embedding');
  params.relation_embedding = relationEmbedding;
}
```

**Text being embedded**: Same format as initial creation (`relationship_type + attitudeWord + proximityWord`)

**Condition**: Only regenerates if `relationship_type`, `attitude`, or `proximity` changed (line 545-548)

**Note**: This tool also handles `description_embedding` regeneration (lines 594-603) but does NOT regenerate `notes_embedding`

### 4. Updating Relationship Properties (Phase 5 Consolidation)

**File**: `src/agents/tools/relationships/update-relationship-types.tool.ts`

**Location**: Lines 137-148

**What triggers**: Phase 5 consolidation tools (`update_has_relationship_with`, `update_engages_with`, etc.) called during nightly consolidation

**relation_embedding regeneration**:
```typescript
// Lines 137-148: Same logic as generic tool
if (propertiesChanged) {
  const finalRelType = relationship_type ?? current[0].current_relationship_type;
  const finalAttitude = attitude ?? current[0].current_attitude;
  const finalProximity = proximity ?? current[0].current_proximity;

  const { attitudeWord, proximityWord } = getWords(cypherRelType, finalAttitude, finalProximity);
  const relationText = `${finalRelType} ${attitudeWord} ${proximityWord}`;
  const relationEmbedding = await generateEmbedding(relationText);

  updates.push('r.relation_embedding = $relation_embedding');
  params.relation_embedding = relationEmbedding;
}
```

**Text being embedded**: Same format as initial creation

**Condition**: Only regenerates if properties changed

**Note**: This tool does NOT regenerate `notes_embedding` (that's handled separately in Phase 5 batch processing)

### 5. Batch notes_embedding Regeneration (Phase 5)

**File**: `scripts/ingestion/phase5.ts`

**Location**: Lines 408-475

**What triggers**: Nightly consolidation phase processes all dirty relationships

**notes_embedding regeneration**:
```typescript
// Lines 408-409: Always regenerate notes_embedding for dirty relationships
await regenerateRelationshipNotesEmbedding(rel.from_entity_key, rel.to_entity_key, rel.type);

// Lines 426-475: Implementation
async function regenerateRelationshipNotesEmbedding(...) {
  // Fetch relationship notes
  // Parse notes and concatenate (max 1000 chars)
  const notesText = notesArray
    .map((n: { content: string }) => n.content)
    .join(' ')
    .substring(0, 1000);
  const notesEmbedding = await generateEmbedding(notesText);
  // Update relationship
  SET r.notes_embedding = $notes_embedding
}
```

**Text being embedded**: Same format as `add_note_to_relationship` (concatenated notes, max 1000 chars)

**Condition**: Always regenerates for all dirty relationships (line 408), regardless of whether notes changed

**Context**: Part of Phase 5 consolidation pipeline that processes relationships with `is_dirty = true`

## Embedding Generation Helper

### generateEmbedding() Function

**File**: `src/services/embeddingGenerationService.ts`

**Location**: Lines 177-194

**Implementation**:
```typescript
async embedSingle(text: string): Promise<number[]> {
  if (!text || text.length === 0) {
    return [];
  }
  const embeddings = await this.embeddings.embedDocuments([text]);
  return embeddings[0];
}

export async function generateEmbedding(text: string): Promise<number[]> {
  return embeddingGenerationService.embedSingle(text);
}
```

**Model**: OpenAI `text-embedding-3-small` (1536 dimensions) - configured at line 49

**Usage**: All relationship tools import and use `generateEmbedding()` from this service

## Semantic Word Mappings

### Word Mappings Source

**File**: `src/utils/relationshipSemantics.ts`

**Location**: Lines 28-59

**Purpose**: Maps numeric attitude/proximity scores (1-5) to semantic words per relationship type

**Example mappings**:
- `has_relationship_with`: attitude=['hostile', 'unfriendly', 'neutral', 'friendly', 'close'], proximity=['stranger', 'acquaintance', 'familiar', 'known-well', 'intimate-knowledge']
- `engages_with`: attitude=['dislikes', 'skeptical', 'neutral', 'interested', 'passionate'], proximity=['unfamiliar', 'aware', 'understands', 'experienced', 'expert']
- (See file for all 6 relationship types)

**Function**: `getAttitudeProximityWords()` (lines 70-94) converts scores to words

**Note**: Duplicate mappings exist in:
- `src/agents/tools/ingestion/generic.tool.ts:438-463` (local WORD_MAPPINGS constant)
- `src/agents/tools/relationships/update-relationship-types.tool.ts:22-47` (local WORD_MAPPINGS constant)

**Recommendation**: Consolidate to use single source from `relationshipSemantics.ts`

## Queries That Reference Embedding Fields

### Retrieval Service

**File**: `src/services/retrievalService.ts`

**Locations**: Lines 485-486, 534-535, 609-610

**Pattern**: Queries SELECT `relation_embedding` and `notes_embedding` but immediately remove them from response

**Example** (lines 483-506):
```typescript
const cleanEdgesBetween = edgesBetween.map((edge) => {
  const {
    relation_embedding,  // Selected but removed
    notes_embedding,     // Selected but removed
    is_dirty,
    decay_gradient,
    recall_frequency,
    last_recall_interval,
    created_by,
    last_update_source,
    ...cleanProps
  } = edge.properties;
  // ... returns cleaned properties without embeddings
});
```

**Purpose**: Embeddings are excluded from API responses (too large, not needed by clients)

**Impact**: These queries don't need to change for refactoring (they already exclude embeddings)

## Vector Index Configuration

### Current State

**File**: `src/db/schema.ts`

**Location**: Lines 221-295

**Finding**: **NO vector indexes exist for relationship embeddings**

**Existing indexes**: Only node embeddings have vector indexes:
- `person_embedding` (Person nodes)
- `concept_embedding` (Concept nodes)
- `entity_embedding` (Entity nodes)
- `source_embedding` (Source nodes)
- `storyline_embedding` (Storyline nodes)
- `macro_embedding` (Macro nodes)

**Implication**: Relationship embeddings are currently searched via in-memory similarity (dot product) rather than indexed vector search

**Note**: Documentation mentions vector indexes for relationships (`docs/investigations/relationship-description-embedding.md:219`) but they are not implemented

## Data Flow Summary

### relation_embedding Flow

1. **Creation**: `create_relationship` tool → generates from `relationship_type + attitudeWord + proximityWord` → sets on relationship
2. **Update**: `update_relationship` or Phase 5 tools → checks if properties changed → regenerates if changed → updates relationship
3. **Retrieval**: Selected in queries but removed from API responses

### notes_embedding Flow

1. **Creation**: `create_relationship` tool → initializes as empty array `[]`
2. **Update**: `add_note_to_relationship` tool → concatenates notes → generates embedding → updates relationship
3. **Batch Regeneration**: Phase 5 consolidation → processes all dirty relationships → always regenerates `notes_embedding` → marks as clean
4. **Retrieval**: Selected in queries but removed from API responses

## Patterns to Follow

### Embedding Generation Pattern

- **Always use**: `generateEmbedding()` from `embeddingGenerationService.ts`
- **Empty handling**: Return empty array `[]` if text is empty or null
- **Text truncation**: `notes_embedding` truncates to 1000 characters (relationship.tool.ts:295)
- **Model**: Always uses `text-embedding-3-small` (1536 dimensions)

### Regeneration Triggers

- **relation_embedding**: Regenerates when `relationship_type`, `attitude`, or `proximity` change
- **notes_embedding**: Regenerates when notes are added OR during Phase 5 batch processing (always for dirty relationships)

### Word Mapping Pattern

- **Source**: Use `getAttitudeProximityWords()` from `relationshipSemantics.ts` (preferred)
- **Fallback**: Local WORD_MAPPINGS constants exist in some tools (should be consolidated)

## Integration Points

### External Dependencies

- **OpenAI Embeddings**: `@langchain/openai` → `OpenAIEmbeddings` model `text-embedding-3-small`
- **Neo4j**: All embedding updates use Cypher `SET` clauses
- **LangGraph Tools**: All relationship tools are LangGraph tools used by ingestion agent

### Related Systems

- **Ingestion Agent**: Uses relationship tools during Phase 3 (entity extraction) and Phase 4 (relationship creation)
- **Consolidation Pipeline**: Phase 5 batch processes dirty relationships and regenerates embeddings
- **Retrieval Service**: Queries relationships but excludes embeddings from responses

## Notes

### Current Architecture

- **Two separate embeddings**: `relation_embedding` (structural semantics) and `notes_embedding` (narrative semantics)
- **Different regeneration triggers**: `relation_embedding` regenerates on property changes, `notes_embedding` regenerates on note additions
- **No vector indexes**: Relationship embeddings are not indexed (unlike node embeddings)

### Refactoring Considerations

- **Unified embedding**: Combine both semantic dimensions into single `relationship_embedding`
- **Text composition**: Need to decide how to combine `relationship_type + attitudeWord + proximityWord` with concatenated notes
- **Regeneration logic**: Need to update all 5 locations that currently generate embeddings separately
- **Word mappings**: Consider consolidating duplicate WORD_MAPPINGS constants to single source
- **Vector indexes**: May want to add vector index for unified relationship embedding after refactoring

### Edge Cases

- **Empty notes**: `notes_embedding` initialized as `[]` and only generated when notes exist
- **Empty text**: `generateEmbedding()` returns `[]` for empty strings
- **Truncation**: Notes truncated to 1000 chars before embedding (may need to preserve this limit)
- **Property changes**: `relation_embedding` only regenerates if specific properties change (not on description changes)

### Performance Considerations

- **Batch processing**: Phase 5 regenerates `notes_embedding` for all dirty relationships (could be expensive)
- **API responses**: Embeddings excluded from responses (good - reduces payload size)
- **No indexing**: Relationship embeddings searched in-memory (may need vector index for unified embedding)
