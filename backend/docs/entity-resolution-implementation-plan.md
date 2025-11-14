# Entity Resolution System Implementation Plan

**Date**: November 14, 2025
**Status**: Planning phase
**Scope**: Add intelligent entity resolution to Phase 2 of the ingestion pipeline

## Overview

This document outlines the implementation of an entity resolution system that determines whether extracted entities are new or match existing nodes in the knowledge graph. The system uses multi-tier matching (exact, fuzzy, embedding-based) with an LLM arbiter to make final resolution decisions.

## Architecture

### High-Level Flow

```
Phase 2: Extraction
  ↓
Phase 2.5: Entity Resolution (NEW)
  ├─ Step 1.5a: Generate embeddings for extracted entities
  ├─ Step 1.5b: Multi-tier candidate search (exact + fuzzy + embedding)
  └─ Step 1.5c: LLM-based resolution (resolved vs. new)
    ├─ If resolved → Step 2: Update Path
    │   ├─ Load existing node + neighbors
    │   ├─ Agent updates node additively (only update tools)
    │   └─ Regenerate embeddings
    └─ If new → Step 3: New Node Path
        ├─ Structured extraction for new node
        ├─ Create node with embedding
        ├─ Find top-K neighbors
        └─ Agent creates edges (only relationship tools)
  ↓
Phase 2 (continued): Persistence & relationships
  (Remainder of original Phase 2 pipeline)
```

## Files Requiring Updates

### 1. Type Definitions

**File**: `backend/src/types/ingestion.ts`

**Changes**:
- Add `EntityResolutionResult` type:
  ```typescript
  interface EntityResolutionResult {
    resolved: boolean
    entity_key?: string
    resolution_reason: string
    candidates: Array<{
      entity_key: string
      name: string
      description: string
      similarity_score?: number
    }>
  }
  ```

- Add `ResolvedEntity` type extending extracted entity:
  ```typescript
  interface ResolvedEntity extends ExtractedEntity {
    embedding: number[]
    resolved: boolean
    entity_key?: string
    resolution_reason: string
  }
  ```

- Add `NeighborMatch` type:
  ```typescript
  interface NeighborMatch {
    entity_key: string
    name: string
    description: string
    notes: string[]
    similarity_score: number
  }
  ```

**Files**: `backend/src/types/graph.ts` (if entity type definitions live here)
- Ensure all entity types have `embedding` property
- Add embedding-based relationship types if needed

### 2. Repository Methods

**Files**:
- `backend/src/repositories/PersonRepository.ts`
- `backend/src/repositories/ConceptRepository.ts`
- `backend/src/repositories/EntityRepository.ts`

**Changes** (same pattern for all three):

Add these methods to each repository:

```typescript
// Find entity by exact name + type match
async findByExactMatch(
  userId: string,
  name: string,
  canonicalName?: string,
  type: string
): Promise<Node | null>

// Fuzzy name matching with Levenshtein distance
async findByFuzzyMatch(
  userId: string,
  name: string,
  type: string,
  distanceThreshold?: number
): Promise<Node[]>

// Embedding-based similarity search
async findByEmbeddingSimilarity(
  userId: string,
  embedding: number[],
  type: string,
  similarityThreshold?: number,
  limit?: number
): Promise<Array<Node & { similarity_score: number }>>

// Deduplicate and aggregate candidates (helper)
private deduplicateCandidates(
  exact: Node[],
  fuzzy: Node[],
  similar: Array<Node & { similarity_score: number }>,
  maxCandidates?: number
): Node[]
```

**Line Ranges**:
- PersonRepository: ~200-400 range (add after existing methods)
- ConceptRepository: ~280-350 range
- EntityRepository: ~300-380 range

### 3. Service Layer

**File**: `backend/src/services/entityResolutionService.ts` (NEW)

**Purpose**: Orchestrate the entity resolution pipeline

**Main Functions**:

```typescript
// Main entry point
async resolveEntities(
  userId: string,
  teamId: string,
  extractedEntities: ExtractedEntity[],
  sourceContent: string,
  sourceEntityKey: string
): Promise<{
  resolved: ResolvedEntity[]
  unresolved: ResolvedEntity[]
  actions: Array<{ type: 'update' | 'create', entity_key: string }>
}>

// Step 1: Generate embeddings for entities
private async generateEntityEmbeddings(
  entities: ExtractedEntity[]
): Promise<Array<{ entity: ExtractedEntity, embedding: number[] }>>

// Step 2: Find candidates for each entity
private async findResolutionCandidates(
  userId: string,
  entity: ExtractedEntity,
  embedding: number[]
): Promise<EntityResolutionResult['candidates']>

// Step 3: LLM-based resolution
private async resolveWithLLM(
  entity: ExtractedEntity,
  embedding: number[],
  candidates: EntityResolutionResult['candidates']
): Promise<EntityResolutionResult>

// Step 2 Path: Update existing node
async updateExistingNode(
  userId: string,
  entity_key: string,
  newInformation: string,
  sourceContent: string,
  sourceEntityKey: string
): Promise<void>

// Step 3 Path: Create new node
async createNewNode(
  userId: string,
  teamId: string,
  entity: ResolvedEntity,
  sourceContent: string,
  sourceEntityKey: string
): Promise<string> // returns entity_key

// Helper: Regenerate embeddings for a node
private async regenerateNodeEmbeddings(
  entity_key: string
): Promise<number[]>
```

**Prompts** (referenced in service):
- `ENTITY_RESOLUTION_SYSTEM_PROMPT`: LLM instructions for resolution decision
- `NODE_UPDATE_SYSTEM_PROMPT`: LLM instructions for additive node updates
- `NODE_CREATION_SYSTEM_PROMPT`: LLM instructions for new node creation
- `NEW_ENTITY_EXTRACTION_PROMPT`: LLM instructions for structured entity extraction

### 4. Agent Tools

**File**: `backend/src/agents/tools/ingestion/generic.tool.ts`

**Changes**:

Update existing tools for resolution workflow:

- **`createNodeTool`** (line ~67-120):
  - Before creation, perform neighbor search
  - Load top-K similar nodes as context
  - Pass neighbors to agent for edge creation guidance
  - Add `neighbor_search_results` to tool input schema

- **`updateNodeTool`** (line ~120-180):
  - Support additive updates (append to notes arrays)
  - Parameter: `operation: 'append' | 'replace'` (default: 'append')
  - New parameter: `preserve_existing: boolean` (default: true)
  - Update agent prompt to favor `append` operations

- **`createRelationshipTool`** (line ~180-240):
  - Add parameter: `create_reciprocal: boolean` (default: false)
  - Add parameter: `relationship_notes: string` (optional)
  - No changes to core logic, but ensure it's available in resolution agents

**New Tool**: `updateRelationshipNotesTool` (line ~240+):
```typescript
interface UpdateRelationshipNotesInput {
  from_entity_key: string
  to_entity_key: string
  relationship_type: string
  new_notes: string
  operation?: 'append' | 'replace'  // default: 'append'
}
```

### 5. Specialized Retrieval Tools

**File**: `backend/src/agents/tools/retrieval/explore.tool.ts`

**Changes** (line ~37-159):

- Enhance `findNeighborsByEmbeddingSimilarity()`:
  - Support `embedding_threshold` parameter (default: 0.6)
  - Return top-K with similarity scores
  - Include neighbor node full details (description, notes)
  - Filter by entity type if provided

- Add new helper function:
  ```typescript
  async findTopKNeighbors(
    userId: string,
    entityType: string,
    embedding: number[],
    k?: number,
    similarityThreshold?: number
  ): Promise<NeighborMatch[]>
  ```

### 6. Agent Prompt Files

**File**: `backend/src/agents/prompts/ingestion/phase1-extraction.ts` (if exists)

**Changes**:
- Ensure extraction includes `subpoints` array for each entity
- Add instruction to extract contextual description for each entity
- Output should be ready for resolution matching

**File**: `backend/src/agents/prompts/ingestion/resolution.ts` (NEW)

Contains three prompts:

```typescript
// ENTITY_RESOLUTION_SYSTEM_PROMPT
export const ENTITY_RESOLUTION_SYSTEM_PROMPT = `
You are an entity resolution expert. Your task is to determine whether an extracted entity
matches an existing entity in the knowledge graph.

Consider:
1. Exact name matches (highest confidence)
2. Semantic similarity (entity descriptions match the same concept)
3. Context clues (does the new information fit with the existing node?)
4. Entity type match (must be same type)

Be conservative: only mark as resolved if confident. Prefer creating new nodes for ambiguous cases.

Output JSON with: { resolved: boolean, entity_key?: string, reason: string }
`

// NODE_UPDATE_SYSTEM_PROMPT
export const NODE_UPDATE_SYSTEM_PROMPT = `
You are updating an existing entity node with new information.

IMPORTANT: Use additive updates ONLY. Append new notes rather than overwriting existing content.

You have access to only two tools:
1. update_node: Append notes, update description (preserve existing data)
2. update_edge: Add notes to relationships or create new relationships

Task:
- Review the existing node data
- Review the connected nodes/edges
- Decide what information from the new input should be added as notes
- Create/update relationships if the new information reveals connections

Never delete or overwrite existing content. Only append and expand.
`

// NODE_CREATION_SYSTEM_PROMPT
export const NODE_CREATION_SYSTEM_PROMPT = `
You are creating a new entity node and establishing its relationships.

You have access to only relationship tools:
1. create_relationship: Create edges between this node and others
2. add_note_to_relationship: Add context to relationship edges

Task:
- Review the new node information
- Review similar neighbor nodes
- Decide which neighbors to connect to
- For each connection, explain the semantic relationship in relationship notes

Be thoughtful about creating edges. Only connect if there's a clear semantic relationship.
Focus on the strongest connections.
`

// NEW_ENTITY_EXTRACTION_PROMPT
export const NEW_ENTITY_EXTRACTION_PROMPT = `
Extract detailed information for a new entity.

You must output a JSON object with:
{
  "name": "string - normalized entity name",
  "description": "string - 2-3 sentences describing the entity",
  "notes": ["array", "of", "key", "details", "to", "remember"]
}

Be concise but comprehensive. The notes array should capture the most important aspects.
`
```

**File**: `backend/src/agents/prompts/ingestion/phase4-unified.ts`

**Changes** (line ~8-200):
- Update to reference new resolution agents
- Remove manual "explore and find related entities" step (now done in resolution)
- For UPDATE path agents: ensure they only have update tools
- For CREATE path agents: ensure they only have relationship tools
- Add section documenting the two-path workflow

### 7. Ingestion Agent Orchestration

**File**: `backend/src/agents/ingestionAgent.ts`

**Changes** (line ~189-241):

Add new phase between extraction and relationship agent:

```typescript
// Step 1: Extract entities
const extractedEntities = await extractionPhase(...)

// NEW: Step 2: Resolve entities
const resolutionService = new EntityResolutionService(neo4j, openai, llm)
const { resolved, unresolved } = await resolutionService.resolveEntities(
  userId,
  teamId,
  extractedEntities,
  source.content,
  source.entity_key
)

// Step 3: Create mentions relationships for all entities
await createMentionsRelationships(
  source.entity_key,
  [...resolved, ...unresolved].map(e => e.entity_key)
)

// Step 4: Agent-based refinement (optional, for relationship quality)
// This is now supplementary, primary work done in resolution
```

### 8. Ingestion Service Orchestration

**File**: `backend/src/services/ingestionService.ts`

**Changes** (line ~39-284):

Update the Phase 2 job handler:

```typescript
async function handleExtractionJob(jobData: { entity_key: string, user_id: string }) {
  // ... existing processing ...

  // NEW: Add entity resolution step
  const resolutionService = new EntityResolutionService(...)
  const { resolved, unresolved } = await resolutionService.resolveEntities(
    user_id,
    source.team_id,
    extractedEntities,
    source.content.content,
    source.entity_key
  )

  // Continue with mentions relationships and other steps
  // But now using resolved entities from resolution service
}
```

### 9. Utility Functions

**File**: `backend/src/utils/entityNormalization.ts`

**Changes** (line ~16-73):

Enhance fuzzy matching:

```typescript
// Existing: fuzzyMatch()
// Enhance to use library like 'string-similarity' or 'levenshtein'

export function fuzzyMatchScore(str1: string, str2: string): number {
  // Return similarity score 0-1
  // Use levenshtein distance or similar
}

export function normalizeEntityName(name: string): string {
  // Lowercase, trim, remove special chars
  // Return normalized version for matching
}

export function normalizeEntityDescription(description: string): string {
  // Remove extra whitespace, standardize formatting
  // Return normalized version for embedding
}
```

### 10. Types for Zod Validation

**File**: `backend/src/agents/schemas/ingestion.ts`

**Changes**:

Add Zod schemas for resolution:

```typescript
export const EntityResolutionSchema = z.object({
  resolved: z.boolean(),
  entity_key: z.string().uuid().optional(),
  reason: z.string().max(500)
})

export const NewEntitySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(10).max(1000),
  notes: z.array(z.string()).optional()
})
```

## Implementation Phases

### Phase 1: Foundation (Days 1-2)
- [ ] Create type definitions (types/ingestion.ts, types/graph.ts)
- [ ] Create entityResolutionService.ts skeleton
- [ ] Create resolution prompt file (prompts/ingestion/resolution.ts)
- [ ] Add methods to repositories (PersonRepository, ConceptRepository, EntityRepository)

### Phase 2: Matching & Resolution (Days 2-3)
- [ ] Implement multi-tier candidate search in service
- [ ] Implement LLM-based resolution in service
- [ ] Create embeddings generation for entities
- [ ] Implement candidate deduplication logic

### Phase 3: Update Path (Days 3-4)
- [ ] Implement updateExistingNode() in service
- [ ] Create NODE_UPDATE_SYSTEM_PROMPT and agent
- [ ] Update generic.tool.ts for additive updates
- [ ] Test update path with existing nodes

### Phase 4: New Node Path (Days 4-5)
- [ ] Implement createNewNode() in service
- [ ] Create NODE_CREATION_SYSTEM_PROMPT and agent
- [ ] Implement neighbor search and edge creation
- [ ] Test new node path with similarity matching

### Phase 5: Integration (Days 5-6)
- [ ] Update ingestionAgent.ts to call resolution service
- [ ] Update ingestionService.ts to orchestrate resolution
- [ ] Update Phase 2 pipeline documentation
- [ ] Update explore.tool.ts for neighbor search enhancement

### Phase 6: Testing & Optimization (Days 6-7)
- [ ] End-to-end testing of resolution flow
- [ ] Performance profiling of embedding searches
- [ ] Cost analysis (embeddings, LLM calls)
- [ ] Fine-tune LLM prompts based on test results

## Cost Analysis

**Per Extracted Entity**:
- Embedding generation: ~$0.0001 (embedding-3-small)
- LLM resolution: ~$0.001 (GPT-4.1-mini structured)
- Update/Create agent: ~$0.002-0.003 (gpt-4.1-mini)
- **Total**: ~$0.004-0.005 per entity

**Compared to Current Flow**:
- Current Phase 2 agent: ~$0.03 per source
- New resolution: ~$0.01-0.015 per source (for ~3-5 entities)
- **Savings**: ~$0.015-0.020 per source (33-50% reduction)

## Performance Targets

**Per Source Processing**:
- Entity extraction: ~5-10 seconds (unchanged)
- Entity resolution: ~10-15 seconds (embeddings + DB searches + LLM)
- Embedding regeneration: ~3-5 seconds
- Total Phase 2: ~25-35 seconds (slightly longer, but better accuracy)

## Success Metrics

1. **Accuracy**: 95%+ of resolved entities correctly identified
2. **Recall**: <5% false negatives (missed matches)
3. **Performance**: <35 seconds per source
4. **Cost**: <$0.02 per source
5. **Quality**: Update path produces natural, additive notes without duplication

## Testing Strategy

### Unit Tests
- Repository methods (exact, fuzzy, embedding search)
- Entity deduplication logic
- Embedding generation

### Integration Tests
- Full resolution flow with mock entities
- Update path with existing nodes
- New node path with neighbor creation

### E2E Tests
- Process sample conversations end-to-end
- Validate resolved vs. new entity decisions
- Inspect generated notes and relationships
- Cost tracking

## Rollout Plan

1. **Develop on feature branch**: Complete all implementation
2. **Internal testing**: Validate with sample data
3. **Staged deployment**: 10% traffic, monitor metrics
4. **Full deployment**: Roll out to all users
5. **Monitor**: Track accuracy, costs, performance for 1 week

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| LLM makes poor resolution decisions | Data quality | Conservative thresholds, human review for ambiguous cases |
| Embedding search performance | Slow processing | Tune similarity threshold, implement caching |
| Exponential cost increase | Budget overrun | Use gpt-4.1-mini (cheaper), batch processing |
| Duplicate note creation | Poor UX | Strong additive-only constraints in update prompts |
| Edge explosion in graph | Query slowdown | Limit neighbor connections, validate relationship semantics |

## Dependencies

- OpenAI API: Embeddings + LLM
- Neo4j: APOC library for fuzzy matching and graph queries
- LangChain: Agent orchestration
- Zod: Schema validation
- pg-boss: Job queue (existing)

## Next Steps

1. Review this plan with team
2. Clarify any ambiguities on resolution logic
3. Finalize LLM prompt templates
4. Begin Phase 1 implementation
5. Set up test fixtures and mock data
