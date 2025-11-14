# Relationship Description Embedding Architecture

**Investigation Date**: 2025-01-XX  
**Status**: Planning  
**Related Files**:
- `scripts/ingestion/relationships.md` - Relationship schema
- `src/agents/tools/relationships/relationship.tool.ts` - Relationship creation/update tools
- `src/agents/tools/ingestion/generic.tool.ts` - Update relationship tool
- `src/services/embeddingGenerationService.ts` - Embedding generation service
- `src/services/retrievalService.ts` - Semantic search service

## Executive Summary

Add `description_embedding` field to semantic relationships to enable semantic search over relationship descriptions. This complements existing `relation_embedding` (from type/attitude/proximity) and `notes_embedding` (from concatenated notes), providing a third semantic dimension for relationship retrieval.

## Current State Analysis

### Existing Embeddings

**`relation_embedding`** (vector):
- **Source**: `relationship_type + attitude_word + proximity_word`
- **Example**: `"friend friendly close"` (for Person→Person with attitude=4, proximity=5)
- **Generated**: On relationship creation and when `relationship_type`, `attitude`, or `proximity` change
- **Purpose**: Semantic search for relationship types and sentiment (e.g., "show me close friendly relationships")
- **Location**: `src/agents/tools/relationships/relationship.tool.ts:174-175`

**`notes_embedding`** (vector):
- **Source**: Concatenated `notes[].content` (max 1000 chars)
- **Generated**: When notes are added via `add_note_to_relationship` tool
- **Purpose**: Semantic search within relationship notes
- **Location**: `src/agents/tools/relationships/relationship.tool.ts:332-338`

**`description`** (string):
- **Current State**: 1-sentence plain text field, **NOT embedded**
- **Example**: `"User's close friend from college, they talk weekly"`
- **Purpose**: Human-readable overview of relationship nature
- **Location**: `scripts/ingestion/relationships.md:17`

### Schema Location

Relationship properties are defined in:
- `scripts/ingestion/relationships.md:14-40` - Complete property list
- `src/types/graph.ts` - TypeScript interfaces (if defined)

### Tool Implementation

**Creation**: `create_relationship` tool (`src/agents/tools/relationships/relationship.tool.ts:118-254`)
- Creates relationship with `relation_embedding` generated
- Sets `notes_embedding = []` (empty initially)
- Does NOT generate `description_embedding`

**Updates**: `update_relationship` tool (`src/agents/tools/ingestion/generic.tool.ts:520-632`)
- Updates `description` field when provided
- Regenerates `relation_embedding` if `relationship_type`, `attitude`, or `proximity` change
- Does NOT regenerate embedding when only `description` changes

**Note Addition**: `add_note_to_relationship` tool (`src/agents/tools/relationships/relationship.tool.ts:275-373`)
- Adds note and regenerates `notes_embedding`
- Does NOT touch `description` or its embedding

## Investigation Questions & Answers

### 1. What Should Be Embedded?

**Decision**: Embed `description` field alone (not combined with attitude/proximity words).

**Rationale**:
- **Separation of Concerns**: `relation_embedding` already captures structural semantics (type + sentiment). `description_embedding` should capture narrative semantics (what the relationship actually is).
- **Semantic Independence**: Description is a free-form narrative that may not align with attitude/proximity mappings. Example: "User's mentor who challenges them" (attitude=4, proximity=4) vs "User's friend who they see occasionally" (attitude=4, proximity=2). The description adds unique semantic content.
- **Retrieval Flexibility**: Three independent embeddings enable different search strategies:
  - `relation_embedding`: "Find friendly relationships"
  - `notes_embedding`: "Find relationships with notes about travel"
  - `description_embedding`: "Find mentor relationships" or "Find relationships with people from college"

**Alternative Considered**: Combine `description + attitude_word + proximity_word`
- **Rejected**: Redundant with `relation_embedding` and loses narrative focus of description

**Text to Embed**: Just the `description` string (1 sentence, typically 10-50 words)

### 2. Field Naming and Schema

**Decision**: Add `description_embedding` field (vector, same dimension as other embeddings).

**Schema Location**: `scripts/ingestion/relationships.md:14-40` (Shared Properties section)

**Proposed Schema Addition**:
```markdown
- **description_embedding**: vector - small embedding generated from description field (enables semantic description search)
```

**Placement**: Add after `notes_embedding` in the property list for logical grouping:
```markdown
- **relation_embedding**: vector - small embedding generated from relationship_type + attitude/proximity word mappings (enables semantic relationship search)
- **notes_embedding**: vector - small embedding from concatenated notes (max 1000 chars, enables semantic note search within relationships)
- **description_embedding**: vector - small embedding generated from description field (enables semantic description search)
```

**TypeScript Types**: Update `src/types/graph.ts` if `RelationshipProperties` interface exists (check required)

**Neo4j Property**: `description_embedding` (vector type, same dimension as `relation_embedding` and `notes_embedding`)

### 3. When Should It Be Generated?

**Decision**: Generate on relationship creation AND when description changes.

**Generation Triggers**:

1. **On Creation** (`create_relationship` tool):
   - Generate `description_embedding` immediately when relationship is created
   - Parallel to `relation_embedding` generation
   - **Location**: `src/agents/tools/relationships/relationship.tool.ts:173-175` (after `relation_embedding` generation)

2. **On Description Update** (`update_relationship` tool):
   - Regenerate `description_embedding` when `description` field changes
   - Similar to how `relation_embedding` regenerates when `relationship_type`/`attitude`/`proximity` change
   - **Location**: `src/agents/tools/ingestion/generic.tool.ts:565-568` (in description update block)

3. **NOT on Attitude/Proximity Change**:
   - If only `attitude` or `proximity` change (without description change), do NOT regenerate `description_embedding`
   - Description is independent of attitude/proximity mappings

4. **NOT on Note Addition**:
   - `add_note_to_relationship` only updates `notes_embedding`
   - Description is separate from notes

**Edge Cases**:
- **Empty Description**: If `description` is empty or null, set `description_embedding = []` (empty vector)
- **Description Unchanged**: If `update_relationship` is called but `description` value hasn't changed, skip regeneration (check current value first)

### 4. Retrieval Integration

**Decision**: Add `description_embedding` to semantic search capabilities, but keep it as a separate search dimension (not combined with other embeddings).

**Current Retrieval State**:
- `retrievalService.ts` does NOT currently search relationships semantically
- Only searches nodes (`Concept`, `Entity`, `Source`) via `vectorSearch()` method
- Relationships are returned in `expandGraph()` but not searched semantically

**Proposed Integration**:

**Option A: Separate Relationship Search Method** (Recommended)
- Add `relationshipVectorSearch()` method to `RetrievalService`
- Search across all relationship embeddings (`relation_embedding`, `notes_embedding`, `description_embedding`)
- Allow filtering by embedding type or combining results
- **Location**: `src/services/retrievalService.ts` (new method)

**Option B: Extend Existing `vectorSearch()`**
- Add relationships as a searchable "node type"
- Requires treating relationships as first-class searchable entities
- More complex but unified API

**Ranking Strategy**:
- **Separate Results**: Return separate result sets for each embedding type, let caller combine/rank
- **Combined Results**: Use weighted combination (e.g., `description_embedding` weight=1.0, `relation_embedding` weight=0.7, `notes_embedding` weight=0.5)
- **Recommendation**: Start with separate results for flexibility

**Use Cases**:
1. **Description Search**: "Find mentor relationships" → search `description_embedding`
2. **Type Search**: "Find friendly relationships" → search `relation_embedding` (existing)
3. **Note Search**: "Find relationships with travel notes" → search `notes_embedding` (existing)
4. **Combined**: "Find close friend relationships" → search both `relation_embedding` and `description_embedding`

**Implementation Priority**: 
- **Phase 1**: Generate `description_embedding` on create/update (no retrieval yet)
- **Phase 2**: Add relationship semantic search to `RetrievalService`
- **Phase 3**: Integrate relationship search into explore/traverse tools

### 5. Implementation Considerations

#### Tool Updates

**`create_relationship` Tool** (`src/agents/tools/relationships/relationship.tool.ts`):
- **Line 173-175**: After generating `relation_embedding`, generate `description_embedding`
- **Line 188**: Add `description_embedding` to SET clause
- **Line 219**: Include `description_embedding` in params

**`update_relationship` Tool** (`src/agents/tools/ingestion/generic.tool.ts`):
- **Line 526-534**: Fetch current `description` value in getQuery
- **Line 552-556**: Check if `description` changed (add to `propertiesChanged` logic)
- **Line 565-568**: If `description` changed, regenerate `description_embedding`
- **Line 585-597**: Add `description_embedding` regeneration logic (similar to `relation_embedding`)

**`add_note_to_relationship` Tool**: No changes (only touches `notes_embedding`)

#### Embedding Generation

**Service**: Use existing `generateEmbedding()` helper (`src/services/embeddingGenerationService.ts:192-194`)
- Already used by relationship tools for `relation_embedding` and `notes_embedding`
- No changes needed to embedding service

**Generation Logic**:
```typescript
// In create_relationship tool
const descriptionEmbedding = description && description.length > 0 
  ? await generateEmbedding(description) 
  : [];

// In update_relationship tool (when description changes)
const newDescription = description ?? current[0].current_description;
const descriptionEmbedding = newDescription && newDescription.length > 0
  ? await generateEmbedding(newDescription)
  : [];
```

#### Performance Implications

**Storage**: 
- Each embedding is ~1536 dimensions (text-embedding-3-small) = ~6KB per relationship
- With 3 embeddings per relationship (`relation_embedding`, `notes_embedding`, `description_embedding`), ~18KB per relationship
- **Impact**: Minimal for typical graph sizes (thousands of relationships)

**Generation Cost**:
- OpenAI `text-embedding-3-small`: ~$0.02 per 1M tokens
- Description is ~10-50 words = ~0.0001 tokens per description
- **Cost**: Negligible (~$0.000002 per relationship creation/update)

**Query Performance**:
- Vector similarity queries in Neo4j are O(n) where n = number of relationships
- Indexing: Neo4j vector indexes can be created for `description_embedding` (same as `relation_embedding`)
- **Recommendation**: Create vector index after implementation

#### Backward Compatibility

**Existing Relationships**:
- Relationships created before this change will have `description_embedding = null` or missing
- **Migration Strategy**: 
  - Option 1: Lazy migration (generate on next update)
  - Option 2: Batch migration script (generate for all existing relationships)
  - **Recommendation**: Lazy migration (simpler, no downtime)

**Query Compatibility**:
- Queries that don't use `description_embedding` continue to work
- Only new semantic search features require the field

#### Testing Considerations

**Unit Tests**:
- Test `create_relationship` generates `description_embedding`
- Test `update_relationship` regenerates `description_embedding` when description changes
- Test `update_relationship` does NOT regenerate when only attitude/proximity change
- Test empty description results in empty embedding

**Integration Tests**:
- Test relationship creation with description → verify embedding exists
- Test relationship update with description change → verify embedding updated
- Test relationship update without description change → verify embedding unchanged

## Implementation Plan

### Phase 1: Schema & Generation (Immediate)

1. **Update Schema Documentation**
   - Add `description_embedding` to `scripts/ingestion/relationships.md:14-40`
   - Document generation triggers and purpose

2. **Update `create_relationship` Tool**
   - Generate `description_embedding` on creation
   - Add to SET clause and params
   - Handle empty description case

3. **Update `update_relationship` Tool**
   - Fetch current description in getQuery
   - Regenerate `description_embedding` when description changes
   - Skip regeneration if description unchanged

4. **TypeScript Types** (if needed)
   - Update `RelationshipProperties` interface in `src/types/graph.ts`

### Phase 2: Retrieval Integration (Future)

5. **Add Relationship Search to `RetrievalService`**
   - Create `relationshipVectorSearch()` method
   - Support searching `description_embedding`, `relation_embedding`, `notes_embedding`
   - Return relationship results with similarity scores

6. **Create Vector Index** (Neo4j)
   - Index `description_embedding` for performance
   - Similar to existing `relation_embedding` index (if exists)

7. **Integrate into Explore/Traverse Tools**
   - Add relationship search to agent tools
   - Enable semantic relationship discovery

### Phase 3: Migration (Optional)

8. **Lazy Migration** (Default)
   - Generate `description_embedding` on next update for existing relationships
   - No batch script needed

9. **Batch Migration** (If needed)
   - Script to generate embeddings for all existing relationships
   - Run during maintenance window

## File Change Summary

### Files to Modify

1. **`scripts/ingestion/relationships.md`**
   - Add `description_embedding` property documentation

2. **`src/agents/tools/relationships/relationship.tool.ts`**
   - Generate `description_embedding` in `createRelationshipTool` (line ~173-175, 188, 219)

3. **`src/agents/tools/ingestion/generic.tool.ts`**
   - Fetch current description in `updateRelationshipTool` (line ~526-534)
   - Regenerate `description_embedding` when description changes (line ~565-568, ~585-597)

4. **`src/types/graph.ts`** (if `RelationshipProperties` interface exists)
   - Add `description_embedding?: number[]` property

### Files to Create (Future)

5. **`src/services/retrievalService.ts`** (extend)
   - Add `relationshipVectorSearch()` method (Phase 2)

6. **Migration Script** (optional, Phase 3)
   - `scripts/migrations/add-description-embeddings.ts`

## Open Questions

1. **Vector Index Creation**: Should we create Neo4j vector index immediately or wait for Phase 2?
   - **Recommendation**: Wait for Phase 2 (retrieval integration)

2. **Combined Search**: Should we support weighted combination of all three embeddings in a single search?
   - **Recommendation**: Start with separate searches, add combination later if needed

3. **Description Length Limits**: Should we enforce max length on `description` field before embedding?
   - **Current**: No explicit limit (assumed 1 sentence)
   - **Recommendation**: Add validation (max 200 chars) to prevent abuse

## References

- **Relationship Schema**: `scripts/ingestion/relationships.md:14-40`
- **Creation Tool**: `src/agents/tools/relationships/relationship.tool.ts:118-254`
- **Update Tool**: `src/agents/tools/ingestion/generic.tool.ts:520-632`
- **Embedding Service**: `src/services/embeddingGenerationService.ts:192-194`
- **Retrieval Service**: `src/services/retrievalService.ts` (current node search only)
