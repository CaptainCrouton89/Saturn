# Agent-Based Ingestion System - Implementation Plan

**Goal**: Replace service orchestration with agent-based ingestion following tech.md specification

**Spec Reference**: `/Users/silasrhyneer/Code/Cosmo/Saturn/tech.md` (lines 228-265 for ingestion, 161-226 for retrieval)

---

## Overview

Current state: Deleted ~2,000 lines of TypeScript service orchestration (resolvers, updaters, memoryExtractionService)

Target state: LangGraph agent with tools that directly manipulate Neo4j graph per tech.md

---

## Phase 1: Foundation - Type Definitions & Schemas

**Goal**: Define shared types and Zod schemas for tool inputs/outputs

### Tasks:

1.1. **Create shared types file**: `backend/src/types/ingestion.ts`
   - `EntityMention` - Raw entity extraction from transcript
   - `ResolvedEntity` - Entity matched to existing or marked as new
   - `NodeToolInput` - Input schema for create/update tools
   - `RelationshipToolInput` - Input schema for relationship tools
   - `ExploreInput` / `ExploreOutput` - Retrieval tool schemas
   - `TraverseInput` / `TraverseOutput` - Cypher query tool schemas

1.2. **Create Zod validation schemas**: `backend/src/agents/schemas/ingestion.ts`
   - `PersonNodeSchema` - matches tech.md:15-30 (canonical_name, appearance, situation, history, personality, expertise, interests, notes)
   - `ConceptNodeSchema` - matches tech.md:5-13 (name, description, notes)
   - `EntityNodeSchema` - matches tech.md:31-40 (name, type, description, notes)
   - `RelationshipSchemas` - All 10 relationship types from tech.md:57-118 with property validation
     - `PersonThinksAboutConceptSchema` (mood, frequency)
     - `PersonHasRelationshipWithPersonSchema` (attitude_towards_person, closeness, relationship_type, notes)
     - `ConceptRelatesToConceptSchema` (notes, relevance)
     - `ConceptInvolvesPersonSchema` (notes, relevance)
     - `ConceptInvolvesEntitySchema` (notes, relevance)
     - `ConceptProducedArtifactSchema` (notes, relevance)
     - `PersonRelatesToEntitySchema` (relationship_type, notes, relevance)
     - `EntityRelatesToEntitySchema` (relationship_type, notes, relevance)

**Dependencies**: None
**Validation**: TypeScript compilation, Zod schema parsing tests

---

## Phase 2: Node Creation/Update Tools (8 tools)

**Goal**: Implement tools that LangGraph agent calls to create/update nodes

### Tasks:

2.1. **Person tools**: `backend/src/agents/tools/nodes/person.tool.ts`
   - `createPersonTool` - Calls `PersonRepository.create()` with validated schema
   - `updatePersonTool` - Calls `PersonRepository.update()` with partial schema (can't update canonical_name)
   - Input: PersonNodeSchema from Phase 1.2
   - Returns: `entity_key` of created/updated Person

2.2. **Concept tools**: `backend/src/agents/tools/nodes/concept.tool.ts`
   - `createConceptTool` - Calls `ConceptRepository.create()`
   - `updateConceptTool` - Calls `ConceptRepository.update()`
   - Input: ConceptNodeSchema from Phase 1.2
   - Returns: `entity_key` of created/updated Concept

2.3. **Entity tools**: `backend/src/agents/tools/nodes/entity.tool.ts`
   - `createEntityTool` - Calls `EntityRepository.create()`
   - `updateEntityTool` - Calls `EntityRepository.update()`
   - Input: EntityNodeSchema from Phase 1.2
   - Returns: `entity_key` of created/updated Entity

2.4. **Relationship tools**: `backend/src/agents/tools/relationships/relationship.tool.ts`
   - `createRelationshipTool` - Creates relationships with property validation
   - `updateRelationshipTool` - Updates relationships with property validation
   - Validates relationship type + properties match allowed schemas (tech.md:256-265)
   - Ignores extra fields not in schema for each relationship type
   - Returns: Success status

2.5. **Tool registry update**: `backend/src/agents/tools/registry.ts`
   - Add all 8 new tools to `allTools` array
   - Export tool instances for agent use

**Dependencies**: Phase 1 (type definitions, schemas)
**Validation**:
- Each tool callable with valid inputs
- Tools properly validate against Zod schemas
- Tools reject invalid relationship property combinations
- Repository methods called correctly

---

## Phase 3: Retrieval Tools (2 tools)

**Goal**: Implement `explore` and `traverse` tools for agent memory retrieval

### Tasks:

3.1. **Explore tool**: `backend/src/agents/tools/retrieval/explore.tool.ts`
   - Input: `{queries?: {query, threshold}[], text_matches?: string[], return_explanations?: boolean}`
   - **Gather Phase** (tech.md:181-196):
     - Semantic search: Query Concepts, Entities, Sources via embeddings (cosine similarity)
     - Text matching: Fuzzy match Person names, Entity names
     - Normalize scores to 0-1 range
   - **Rerank & Expand Phase** (tech.md:198-212):
     - Order by score + salience (connections * recency)
     - Take top 5 concepts, 3 entities, 3 persons, 5 sources
     - Fetch edges between hits, hits↔user, hits↔neighbors
     - Return top 10 edges sorted by relevance/date
   - Output: `{nodes: [...], edges: [...], neighbors: [...]}`

3.2. **Traverse tool**: `backend/src/agents/tools/retrieval/traverse.tool.ts`
   - Input: `{cypher: string, verbose: boolean}`
   - Execute Cypher query via `neo4jService.executeQuery()`
   - If verbose=false, truncate content fields (e.g., notes, description)
   - Return structured data from query results
   - Output: `{results: any[]}`

3.3. **Create helper service**: `backend/src/services/retrievalService.ts`
   - `vectorSearch(query, threshold, nodeTypes)` - Semantic search across node types
   - `fuzzyTextMatch(text, nodeTypes)` - Text matching with scoring
   - `calculateSalience(nodeId)` - Score based on connections + recency
   - `expandGraph(nodeIds)` - Fetch edges and neighbors
   - Used by explore tool to avoid bloating tool file

3.4. **Tool registry update**: `backend/src/agents/tools/registry.ts`
   - Add explore and traverse tools to `allTools` array

**Dependencies**: Phase 1 (type definitions)
**Validation**:
- Explore returns correctly structured graph data
- Traverse executes valid Cypher queries
- Salience calculation produces reasonable scores
- Edge expansion includes user relationships

---

## Phase 4: Ingestion Agent (LangGraph)

**Goal**: Create LangGraph agent that orchestrates 3-step ingestion process

### Tasks:

4.1. **Agent definition**: `backend/src/agents/ingestionAgent.ts`
   - LangGraph state machine with 3 nodes:
     1. `extractAndDisambiguate` - Single LLM call for extraction + matching
     2. `autoCreateSourceEdges` - Create `Source [mentions] Node` edges
     3. `relationshipAgent` - LLM agent with tools for node/relationship creation
   - State schema: `{conversationId, userId, transcript, summary, entities: [], relationships: []}`
   - Prompts for each phase (see Phase 4.2)

4.2. **Agent prompts**: `backend/src/agents/prompts/ingestion.ts`
   - `EXTRACTION_SYSTEM_PROMPT` - Extract entities from transcript, match to existing via entity_key/canonical_name
   - `RELATIONSHIP_AGENT_SYSTEM_PROMPT` - Given entities + transcript, create/update nodes and relationships using tools
   - Emphasize tech.md rules:
     - Only create Concepts/Entities with user-specific context (tech.md:127-131)
     - Notes field for non-fitting information (tech.md:123-125)
     - Provenance tracking: last_update_source, confidence

4.3. **Extraction node implementation**:
   - LLM structured output with Zod schema
   - For each mentioned entity:
     - Try match via entity_key (hash of normalized name + type + user_id)
     - For People: fallback to canonical_name
     - For Concepts/Entities: fallback to vector similarity (if embeddings exist)
   - Output: Array of `{mentionedName, entityType, entityKey, matchedId, isNew, contextClue}`

4.4. **Source edges node implementation**:
   - For each entity in extraction output
   - Create `Source [mentions] {Person|Concept|Entity}` edge via Cypher
   - Update node's `updated_at` timestamp

4.5. **Relationship agent node implementation**:
   - LLM with access to all 10 tools (8 node + 2 relationship)
   - Receives: transcript, extracted entities, existing relationships for those entities
   - Calls tools to create/update nodes and relationships
   - Runs until agent signals completion or max iterations (10)

**Dependencies**: Phase 2 (node tools), Phase 3 (retrieval tools for context loading)
**Validation**:
- Agent completes 3-step flow without errors
- Extraction correctly identifies entities and matches to existing
- Source edges created for all mentioned entities
- Relationship agent creates valid nodes and relationships using tools

---

## Phase 5: Ingestion Service (Orchestrator)

**Goal**: Service that wraps LangGraph agent and handles job processing

### Tasks:

5.1. **Create ingestion service**: `backend/src/services/ingestionService.ts`
   - `processConversation(conversationId, userId)` method
   - Fetches transcript + summary from PostgreSQL
   - Invokes ingestion agent (Phase 4)
   - Marks conversation as processed (`entities_extracted: true`, `neo4j_synced_at`)
   - Error handling with retry logic
   - Logging for each phase

5.2. **Generate embeddings post-processing**:
   - After agent completes, identify new Concepts/Entities
   - Call `embeddingGenerationService.generate()` for new nodes
   - Update Neo4j with embeddings via batch Cypher query

5.3. **Summary Source node creation**:
   - Create Source node for conversation summary
   - Link to User via `Source [mentions] Person {is_owner: true}`
   - Use `summaryService` to ensure 1-sentence description

**Dependencies**: Phase 4 (ingestion agent)
**Validation**:
- Service processes full conversation end-to-end
- Embeddings generated for new Concepts/Entities
- Source node created with summary
- Conversation flags updated correctly

---

## Phase 6: Worker Integration

**Goal**: Wire new ingestion service into background worker

### Tasks:

6.1. **Update worker**: `backend/src/worker.ts`
   - Replace commented-out `memoryExtractionService` call
   - Call `ingestionService.processConversation(conversationId, userId)`
   - Remove TODO comments

6.2. **Test job processing**:
   - Enqueue test job via pg-boss
   - Verify worker picks up job
   - Verify ingestion agent runs successfully
   - Verify Neo4j updates appear

**Dependencies**: Phase 5 (ingestion service)
**Validation**:
- Worker processes jobs without errors
- Jobs retry on failure (pg-boss config)
- Neo4j graph updated correctly after job completion

---

## Phase 7: Documentation & Cleanup

**Goal**: Update documentation to reflect new architecture

### Tasks:

8.1. **Update CLAUDE.md files**:
   - `backend/CLAUDE.md` - Document agent-based ingestion architecture
   - `backend/src/agents/CLAUDE.md` - Add ingestion agent documentation
   - `backend/src/agents/tools/CLAUDE.md` - Document all 10 tools

8.2. **Update API reference docs**:
   - Remove references to old service orchestration
   - Add ingestion agent flow diagram
   - Document tool schemas and validation rules

8.3. **Remove obsolete types**:
   - Delete `EntityUpdate` type from `embeddingGenerationService.ts` (use types from Phase 1.1)
   - Clean up any remaining TODO comments

**Dependencies**: Phase 7 (testing complete)
**Validation**:
- Documentation accurately reflects implementation
- No broken references to deleted services
- CLAUDE.md files provide clear guidance

---

## Risk Mitigation

### High-Risk Areas:

1. **Entity Resolution Complexity** (Phase 4.3)
   - Risk: Matching entities to existing without dedicated resolver classes
   - Mitigation: Use simple hierarchy: entity_key → canonical_name → vector similarity, all in single LLM call

2. **Tool Call Overhead** (Phase 4.5)
   - Risk: LLM calling tools sequentially may be slow/expensive
   - Mitigation: Use gpt-4.1-mini (fast/cheap), monitor cost in Phase 7.4

3. **Relationship Property Validation** (Phase 2.4)
   - Risk: 10 relationship types with different property schemas
   - Mitigation: Comprehensive Zod schemas in Phase 1.2, exhaustive testing in Phase 7.1

### Rollback Plan:

If agent-based approach fails:
- All deleted code preserved in git history
- Can restore service orchestration approach
- Worker TODO comments indicate restoration points

---

## Success Criteria

- ✅ Worker processes conversations without errors
- ✅ Neo4j graph updated with correct entity/relationship structure
- ✅ Embeddings generated for new Concepts/Entities
- ✅ Source edges created for all mentions
- ✅ Cost under $0.05 per 10k word conversation
- ✅ Explore/traverse tools return correct retrieval data
- ✅ All tests pass
- ✅ Documentation updated and accurate
