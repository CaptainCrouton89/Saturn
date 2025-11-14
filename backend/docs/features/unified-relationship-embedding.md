# Unified Relationship Embedding - Requirements Document

**Feature ID**: unified-relationship-embedding
**Date**: 2025-01-14
**Status**: Requirements Gathering
**Priority**: High

## Executive Summary

Refactor relationship embeddings from three separate fields (relation_embedding, notes_embedding, description_embedding) to a single unified embedding that captures all semantic aspects of a relationship. Enable relationship search via embedding similarity and extend the explore tool to search both nodes AND relationships.

## Background

### Current State

Relationships currently have (or were planned to have) three separate embedding fields:

1. **relation_embedding** (vector) - Generated from `relationship_type + attitude_word + proximity_word`
   - Example: "friend friendly close"
   - Purpose: Semantic search for relationship types and sentiment
   - Status: Currently implemented

2. **notes_embedding** (vector) - Generated from concatenated relationship notes
   - Purpose: Semantic search within relationship notes
   - Status: Currently implemented

3. **description_embedding** (vector) - Planned for relationship description field
   - Purpose: Semantic search by narrative description
   - Status: Documented but NOT implemented (see backend/docs/investigations/relationship-description-embedding.md)

### Problems with Current Approach

1. **Storage overhead**: 3 embeddings × ~1536 dimensions × ~6KB per relationship = ~18KB per relationship
2. **Retrieval complexity**: No clear strategy for combining search results across 3 embeddings
3. **Not actually used**: RetrievalService.vectorSearch() only searches nodes (Concept, Entity, Source) - relationships aren't searchable at all
4. **Semantic redundancy**: Description, attitude/proximity, and notes all describe the same relationship from different angles but overlap significantly

### Gap in Current System

The explore tool (used in Phase 4 of the ingestion pipeline) performs semantic search via RetrievalService.vectorSearch(), but this ONLY searches node embeddings. When a relationship description matches semantically, the connected nodes are never discovered because relationships aren't in the search surface.

**Example**: User asks "tell me about my mentor relationships" → semantic search finds no results because:
- Person nodes don't contain "mentor" in their embeddings
- The relationship between User and Person HAS "mentor" in its description
- But relationships aren't searched, so the connection is invisible

## Requirements

### Functional Requirements

#### FR1: Unified Relationship Embedding

**MUST** consolidate all relationship semantic information into a single embedding field:

- **Field name**: `relationship_embedding` (rename from `relation_embedding`)
- **Content**: Combined text from:
  1. `description` (1-sentence narrative, e.g., "User's mentor from college")
  2. Attitude word mapping (based on `attitude` value 1-5)
  3. Proximity word mapping (based on `proximity` value 1-5)
  4. Concatenated notes content (from `notes` array, max 1000 chars total)

**Format**: `"<description> <relationship_type> <attitude_word> <proximity_word> <notes_text>"`

**Example**:
```
description: "User's mentor from college who provides career guidance"
relationship_type: "mentor"
attitude: 5 (maps to "very_positive")
proximity: 4 (maps to "close")
notes: [{content: "They meet monthly for coffee"}, {content: "Helped user get first job"}]

Final embedding text:
"User's mentor from college who provides career guidance mentor very_positive close They meet monthly for coffee Helped user get first job"
```

#### FR2: Remove Old Embedding Fields

**MUST** delete the following fields from relationship schema:
- `relation_embedding`
- `notes_embedding`
- `description_embedding` (planned but not implemented)

**Migration**: Existing relationships will have these fields set to null/removed. New unified embedding will be generated lazily on first update or proactively via migration script.

#### FR3: Embedding Generation Triggers

**MUST** generate `relationship_embedding` in the following scenarios:

1. **On relationship creation** (create_relationship tool)
   - Generate immediately when relationship is created
   - Use initial values of description, attitude, proximity, notes

2. **On relationship update** (update_relationship tool)
   - Regenerate when ANY of these fields change:
     - `description`
     - `relationship_type`
     - `attitude`
     - `proximity`

3. **On note addition** (add_note_to_relationship tool)
   - Regenerate embedding with new concatenated notes

4. **Edge cases**:
   - Empty description: Use empty string in concatenation
   - No notes: Omit notes section from embedding text
   - Null attitude/proximity: Skip word mapping for that dimension

#### FR4: Relationship Vector Search

**MUST** add relationship semantic search to RetrievalService:

**Method signature** (new):
```typescript
async relationshipVectorSearch(
  query: string,
  threshold: number,
  userId: string,
  relationshipTypes?: string[] // Optional filter by type
): Promise<RelationshipSearchResult[]>
```

**Return type**:
```typescript
interface RelationshipSearchResult {
  from_entity_key: string;
  to_entity_key: string;
  relationship_type: string;
  description?: string;
  attitude?: number;
  proximity?: number;
  similarity: number;
  // Full relationship properties for context
  properties: Record<string, unknown>;
}
```

**Search logic**:
- Generate embedding for query string
- Compute cosine similarity against all relationships with `relationship_embedding` field
- Filter by similarity >= threshold
- Filter by userId (relationships are user-scoped via connected nodes)
- Optionally filter by relationship_type
- Return top 20 results sorted by similarity DESC

#### FR5: Node Discovery via Relationship Search

**MUST** add method to return connected nodes when relationships match:

**Method signature** (new):
```typescript
async findNodesViaRelationshipSearch(
  query: string,
  threshold: number,
  userId: string,
  relationshipTypes?: string[]
): Promise<{
  nodes: GraphNode[];
  relationships: RelationshipSearchResult[];
}>
```

**Logic**:
1. Call `relationshipVectorSearch()` to find matching relationships
2. Extract unique `from_entity_key` and `to_entity_key` from results
3. Fetch full node data for these entity keys
4. Return nodes + relationships together

**Use case**: "Find my mentor relationships" → returns both the relationships AND the Person nodes involved

#### FR6: Extend Explore Tool

**MUST** extend the explore tool to search relationships in addition to nodes:

**Changes to explore tool**:
1. Add optional parameter: `search_relationships?: boolean` (default: true)
2. When enabled, perform parallel searches:
   - Node vector search (existing behavior)
   - Relationship vector search (new behavior via FR4)
3. Combine results:
   - If relationship matches, include connected nodes in the result set
   - Add relationships to the edges returned by expandGraph()
   - Prevent duplicate nodes (deduplicate by entity_key)

**Updated tool description**:
```
"Explore the knowledge graph using semantic search and text matching.
Finds relevant entities (People, Concepts, Entities, Sources) and relationships.
Expands the graph to show connections. Use for broad investigation when you need
to discover what the user knows about a topic, person, or relationship."
```

### Non-Functional Requirements

#### NFR1: Performance

- Embedding generation MUST complete in <500ms per relationship (single)
- Batch embedding generation SHOULD be used when updating multiple relationships
- Relationship vector search MUST return in <2s for typical graph sizes (10k relationships)

#### NFR2: Backward Compatibility

- Existing relationships with old embedding fields MUST continue to work
- Old embedding fields SHOULD be ignored (not cause errors)
- Migration SHOULD be lazy (generate new embedding on first update)
- Optional migration script for proactive regeneration

#### NFR3: Storage Efficiency

- Single unified embedding: ~6KB per relationship (vs ~18KB with 3 embeddings)
- 67% reduction in embedding storage overhead
- Maintain same embedding model (text-embedding-3-small, 1536 dimensions)

## User Stories

### US1: Discover Relationships via Semantic Search

**As an** AI agent processing a conversation
**I want to** search for relationships by semantic meaning
**So that** I can discover relevant connections even when nodes don't mention the topic

**Acceptance Criteria**:
- Agent can call explore tool with query like "mentor relationships"
- Explore tool searches both nodes AND relationships
- Results include Person nodes connected by mentor relationships
- Relationship properties (description, attitude, proximity) are included in response

### US2: Update Relationship and Regenerate Embedding

**As an** ingestion agent updating a relationship
**I want** the embedding to automatically regenerate when I change description/notes
**So that** the relationship remains searchable with current information

**Acceptance Criteria**:
- Calling update_relationship with new description triggers embedding regeneration
- Adding notes via add_note_to_relationship triggers embedding regeneration
- Changing only attitude/proximity triggers embedding regeneration
- Generated embedding includes all current relationship information

### US3: Find People with Specific Relationship Types

**As a** user
**I want** the system to find people based on relationship descriptions
**So that** I can ask questions like "who are my mentors?" or "which friends from college?"

**Acceptance Criteria**:
- Query "mentors" matches relationships with description containing "mentor"
- Query "friends from college" matches relationships with those semantic concepts
- Results include the Person nodes, not just relationship metadata
- Relationships are ranked by semantic similarity

## Technical Constraints

### TC1: Embedding Model

- MUST use existing OpenAI text-embedding-3-small model (1536 dimensions)
- MUST NOT change embedding dimension or model (maintains compatibility)
- SHOULD use existing embeddingGenerationService methods

### TC2: Neo4j Storage

- Embedding field stored as vector type in Neo4j
- Field name: `relationship_embedding` (property on relationship edges)
- SHOULD create vector index for performance (phase 2)

### TC3: Tool Schema Validation

- MUST update Zod schemas for create_relationship and update_relationship tools
- MUST validate that embedding generation doesn't break existing tool contracts
- SHOULD maintain existing tool input/output formats

## Dependencies

### Code Dependencies

1. **embeddingGenerationService.ts** - Provides generateEmbedding() helper
2. **relationship.tool.ts** - create_relationship tool (needs embedding generation)
3. **generic.tool.ts** - update_relationship tool (needs regeneration logic)
4. **retrievalService.ts** - Needs new relationship search methods
5. **explore.tool.ts** - Needs extension to search relationships
6. **scripts/ingestion/relationships.md** - Schema documentation needs update

### Investigation Dependencies

Parallel investigations to inform implementation:
- Investigation 1: All locations where relation_embedding/notes_embedding are generated
- Investigation 2: Current retrieval/search usage of relationship embeddings
- Investigation 3: Complete relationship schema and properties
- Investigation 4: Embedding generation service infrastructure

## Success Criteria

### SC1: Functionality

- [ ] All existing relation_embedding/notes_embedding generation replaced with unified embedding
- [ ] Relationship search returns semantically relevant results
- [ ] Explore tool searches both nodes and relationships
- [ ] Node discovery via relationship search works correctly

### SC2: Quality

- [ ] All existing tests pass with new embedding structure
- [ ] New tests cover relationship search and embedding generation
- [ ] No regression in node search functionality
- [ ] Schema documentation updated to reflect new structure

### SC3: Performance

- [ ] Embedding generation completes in <500ms per relationship
- [ ] Relationship search returns in <2s for 10k relationships
- [ ] No increase in API response times for existing endpoints

## Out of Scope

### Explicitly NOT Included

1. **Vector index creation** - Will create index in phase 2 after validating search works
2. **Batch migration script** - Lazy migration preferred; batch script optional
3. **Relationship ranking algorithm** - Use simple cosine similarity; advanced ranking later
4. **Traverse tool changes** - Only extend explore tool for now
5. **UI/visualization changes** - Backend-only feature

## Open Questions

1. **Q**: Should we preserve old embeddings during transition, or delete immediately?
   **A**: DELETE immediately (per user requirement)

2. **Q**: What is the max length for concatenated text before embedding?
   **A**: TBD - check embeddingGenerationService limits (investigation agent will document)

3. **Q**: Should relationship search results include node details inline, or just entity keys?
   **A**: TBD - depends on performance implications (decide during planning)

4. **Q**: Do we need to handle bidirectional relationships specially in search?
   **A**: TBD - investigate if relationships have directionality constraints

## Next Steps

1. ✅ Spawn investigation agents (4 parallel investigations)
2. ⏳ Wait for investigation completion
3. ⏳ Review investigation findings
4. ⏳ Get user sign-off on requirements
5. ⏳ Create detailed implementation plan
6. ⏳ Delegate implementation to specialized agents
7. ⏳ Validate and test implementation

## References

- **Investigation Doc**: backend/docs/investigations/relationship-description-embedding.md
- **Schema Doc**: scripts/ingestion/relationships.md
- **Retrieval Service**: src/services/retrievalService.ts
- **Explore Tool**: src/agents/tools/retrieval/explore.tool.ts
- **Relationship Tools**: src/agents/tools/relationships/relationship.tool.ts, src/agents/tools/ingestion/generic.tool.ts
