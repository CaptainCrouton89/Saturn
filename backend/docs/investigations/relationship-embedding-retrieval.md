# Relationship Embedding Retrieval Usage Investigation

**Investigation Date**: 2025-01-XX  
**Status**: Current State Analysis  
**Related Files**:
- `src/services/retrievalService.ts` - Main retrieval service
- `src/agents/tools/retrieval/explore.tool.ts` - Explore tool implementation
- `src/agents/tools/retrieval/traverse.tool.ts` - Traverse tool implementation
- `src/db/schema.ts` - Neo4j schema initialization (vector indexes)
- `scripts/ingestion/retrieval.md` - Retrieval documentation
- `src/agents/tools/relationships/relationship.tool.ts` - Relationship creation/update tools

## Executive Summary

**Finding**: `relation_embedding` and `notes_embedding` are **generated and stored** on relationships but are **NOT currently used** in any retrieval/search operations. They are explicitly filtered out from query results and no vector similarity queries exist for relationship embeddings.

## Current State Analysis

### 1. Relationship Embedding Generation

**Location**: `src/agents/tools/relationships/relationship.tool.ts`

**`relation_embedding`**:
- **Generated**: Lines 124-126
- **Source**: `relationship_type + attitude_word + proximity_word`
- **Example**: `"friend friendly close"` → embedding vector
- **Regenerated**: When `relationship_type`, `attitude`, or `proximity` change (see `src/agents/tools/ingestion/generic.tool.ts:580-591`)

**`notes_embedding`**:
- **Generated**: `src/agents/tools/relationships/relationship.tool.ts:290-308`
- **Source**: Concatenated `notes[].content` (max 1000 chars)
- **Regenerated**: When notes are added via `add_note_to_relationship` tool

**Storage**: Both embeddings are stored as relationship properties in Neo4j.

### 2. RetrievalService Analysis

**File**: `src/services/retrievalService.ts`

#### Vector Search (Lines 250-310)

**Purpose**: Semantic search across node types using embeddings  
**Node Types Searched**: `Concept`, `Entity`, `Source` only  
**Relationship Search**: **NOT IMPLEMENTED**

```typescript:250-310:src/services/retrievalService.ts
async vectorSearch(
  query: string,
  threshold: number,
  userId: string,
  nodeTypes: Array<'Concept' | 'Entity' | 'Source'> = ['Concept', 'Entity', 'Source']
): Promise<VectorSearchResult[]>
```

**Key Finding**: The `vectorSearch` method only searches node embeddings (`n.embedding`), not relationship embeddings (`r.relation_embedding` or `r.notes_embedding`).

#### Expand Graph (Lines 448-723)

**Purpose**: Expand graph around given nodes, fetching edges and neighbors  
**Relationship Embedding Handling**: **EXPLICITLY FILTERED OUT**

**Locations where embeddings are removed**:

1. **Lines 485-486**: Filter `relation_embedding` and `notes_embedding` from edges between hit nodes
2. **Lines 534-535**: Filter `relation_embedding` and `notes_embedding` from edges to user owner node
3. **Lines 609-610**: Filter `relation_embedding` and `notes_embedding` from neighbor edges

```typescript:483-506:src/services/retrievalService.ts
// Remove embedding fields and unwanted properties from edge properties
const cleanEdgesBetween = edgesBetween.map((edge) => {
  const {
    relation_embedding,
    notes_embedding,
    is_dirty,
    decay_gradient,
    recall_frequency,
    last_recall_interval,
    created_by,
    last_update_source,
    ...cleanProps
  } = edge.properties;
  // ... cleaned properties returned without embeddings
});
```

**Conclusion**: Relationship embeddings are stored but intentionally excluded from retrieval results.

### 3. Explore Tool Analysis

**File**: `src/agents/tools/retrieval/explore.tool.ts`

**Search Methods**:
1. **Vector Search** (Line 59): Calls `retrievalService.vectorSearch()` - **nodes only**
2. **Fuzzy Text Match** (Line 82): Calls `retrievalService.fuzzyTextMatch()` - **nodes only**
3. **Graph Expansion** (Line 120): Calls `retrievalService.expandGraph()` - returns relationships but **without embeddings**

**Relationship Filtering**: Edges are sorted by `relevance` property or date (Lines 122-144), but **no embedding-based similarity search** is performed on relationships.

### 4. Traverse Tool Analysis

**File**: `src/agents/tools/retrieval/traverse.tool.ts`

**Purpose**: Execute custom Cypher queries  
**Relationship Embedding Access**: **POSSIBLE BUT NOT BUILT-IN**

The traverse tool allows agents to write custom Cypher queries that could theoretically search relationship embeddings, but:
- No built-in methods for relationship embedding search
- No examples or documentation showing relationship embedding queries
- Agents would need to manually write cosine similarity calculations

**Example of what would be needed** (NOT CURRENTLY IMPLEMENTED):
```cypher
MATCH (a)-[r]->(b)
WHERE a.user_id = $user_id AND b.user_id = $user_id
WITH r,
  reduce(dot = 0.0, i IN range(0, size(r.relation_embedding)-1) |
    dot + r.relation_embedding[i] * $queryEmbedding[i]
  ) AS dotProduct,
  sqrt(reduce(sum = 0.0, x IN r.relation_embedding | sum + x * x)) AS normA,
  sqrt(reduce(sum = 0.0, x IN $queryEmbedding | sum + x * x)) AS normB
WITH r, dotProduct / (normA * normB) AS similarity
WHERE similarity >= $threshold
RETURN r, similarity
ORDER BY similarity DESC
LIMIT 10
```

### 5. Neo4j Vector Indexes

**File**: `src/db/schema.ts`

**Vector Indexes Created** (Lines 221-295):
- `person_embedding` - Person node embeddings
- `concept_embedding` - Concept node embeddings
- `entity_embedding` - Entity node embeddings
- `source_embedding` - Source node embeddings
- `storyline_embedding` - Storyline node embeddings
- `macro_embedding` - Macro node embeddings

**Relationship Embedding Indexes**: **NONE CREATED**

**Finding**: No vector indexes exist for `relation_embedding` or `notes_embedding` on relationships. This means:
1. Relationship embedding searches would be slow (full scan)
2. No optimized HNSW index for relationship similarity search
3. Vector indexes are only created for node embeddings

### 6. API Endpoints

**Searched Files**: `src/routes/*.ts`

**Finding**: **NO API endpoints** expose relationship search by embedding.

Available routes:
- `graph.ts` - Graph queries (if any)
- `conversations.ts` - Conversation endpoints
- `artifacts.ts` - Artifact endpoints
- `preferences.ts` - User preferences
- `init.ts` - Initialization
- `auth.ts` - Authentication
- `admin.ts` - Admin operations
- `informationDump.ts` - Information dump

**Conclusion**: Relationship embedding search is not exposed via REST API.

### 7. Documentation vs Implementation

**File**: `scripts/ingestion/retrieval.md:117`

**Documentation States**:
> "**Relationships** - via `relation_embedding`, `notes_embedding` OR text match on `relationship_type`, `description`, notes contents"

**Reality**: This is **aspirational documentation**, not implemented functionality.

**Gap Analysis**:
- ✅ Embeddings are generated and stored
- ✅ Text matching on `relationship_type` and `description` could work (not verified)
- ❌ Vector similarity search on `relation_embedding` is NOT implemented
- ❌ Vector similarity search on `notes_embedding` is NOT implemented

## Search Surface Area Summary

### Implemented Search Methods

| Search Target | Method | Location | Uses Embeddings? |
|--------------|--------|----------|------------------|
| Concept nodes | `vectorSearch()` | `retrievalService.ts:250` | ✅ `n.embedding` |
| Entity nodes | `vectorSearch()` | `retrievalService.ts:250` | ✅ `n.embedding` |
| Source nodes | `vectorSearch()` | `retrievalService.ts:250` | ✅ `n.embedding` |
| Person nodes | `fuzzyTextMatch()` | `retrievalService.ts:325` | ❌ Text only |
| Entity nodes | `fuzzyTextMatch()` | `retrievalService.ts:325` | ❌ Text only |

### Unimplemented Search Methods

| Search Target | Expected Method | Status | Blockers |
|--------------|----------------|--------|----------|
| Relationships (relation_embedding) | Vector similarity | ❌ Not implemented | No query method, no vector index |
| Relationships (notes_embedding) | Vector similarity | ❌ Not implemented | No query method, no vector index |
| Relationships (text) | Text match on `relationship_type` | ❓ Unknown | Not verified in code |

## Technical Details

### Embedding Dimensions

**Node Embeddings**: 1536 dimensions (text-embedding-3-small)  
**Relationship Embeddings**: Same dimension (1536) - generated via `embeddingGenerationService.ts:175`

### Cosine Similarity Calculation

**Current Implementation** (for nodes):
```cypher
WITH n,
  reduce(dot = 0.0, i IN range(0, size(n.embedding)-1) |
    dot + n.embedding[i] * $embedding[i]
  ) AS dotProduct,
  sqrt(reduce(sum = 0.0, x IN n.embedding | sum + x * x)) AS normA,
  sqrt(reduce(sum = 0.0, x IN $embedding | sum + x * x)) AS normB
WITH n, dotProduct / (normA * normB) AS similarity
WHERE similarity >= $threshold
```

**Would Need** (for relationships):
```cypher
WITH r,
  reduce(dot = 0.0, i IN range(0, size(r.relation_embedding)-1) |
    dot + r.relation_embedding[i] * $embedding[i]
  ) AS dotProduct,
  sqrt(reduce(sum = 0.0, x IN r.relation_embedding | sum + x * x)) AS normA,
  sqrt(reduce(sum = 0.0, x IN $embedding | sum + x * x)) AS normB
WITH r, dotProduct / (normA * normB) AS similarity
WHERE similarity >= $threshold
```

### Performance Considerations

**Without Vector Indexes**:
- Full relationship scan required
- O(n) complexity where n = number of relationships
- Slow for large graphs

**With Vector Indexes** (if implemented):
- HNSW algorithm for approximate nearest neighbor search
- O(log n) complexity
- Fast similarity search even with millions of relationships

## Recommendations

### Option 1: Implement Relationship Embedding Search

**Steps**:
1. Add `relationshipVectorSearch()` method to `RetrievalService`
2. Create vector indexes for `relation_embedding` and `notes_embedding` in `schema.ts`
3. Add relationship search to `explore` tool
4. Update documentation to reflect implementation

**Benefits**:
- Enables semantic relationship discovery
- Matches documented capabilities
- Complements node-based search

**Costs**:
- Additional Neo4j storage for vector indexes
- Query complexity
- Maintenance overhead

### Option 2: Remove Relationship Embeddings

**Steps**:
1. Stop generating `relation_embedding` and `notes_embedding`
2. Remove embedding generation code
3. Update schema documentation
4. Clean up existing relationship embeddings (optional)

**Benefits**:
- Reduces storage overhead
- Simplifies codebase
- Removes unused features

**Costs**:
- Lose future capability for relationship search
- May need to regenerate if search is added later

### Option 3: Keep Embeddings, Document as Future Feature

**Steps**:
1. Update documentation to clarify embeddings are stored but not searched
2. Add TODO comments in code
3. Plan implementation for future phase

**Benefits**:
- Preserves future flexibility
- No code changes needed
- Clear communication of current state

## Related Investigations

- `docs/investigations/relationship-description-embedding.md` - Plans to add `description_embedding` (also not searched)

## Conclusion

**Current State**: Relationship embeddings (`relation_embedding` and `notes_embedding`) are generated, stored, and filtered out from results. They are **not used** in any retrieval operations.

**Gap**: Documentation suggests relationship embedding search exists, but implementation is missing.

**Recommendation**: Choose Option 3 (document current state) or Option 1 (implement search) based on product priorities. Option 2 (remove embeddings) only if relationship search is definitively not needed.
