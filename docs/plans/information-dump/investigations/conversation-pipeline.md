# Investigation: Conversation Memory Extraction Pipeline

> Context bundle for implementing information dump feature. All file references, data flows, and patterns needed for reusable entity extraction from arbitrary text input.

## Goal

Understand the existing conversation-to-Neo4j pipeline to extract reusable components for processing user information dumps (text/images/PDFs) into structured knowledge graph entities.

## Related Docs
- `/Users/silasrhyneer/Code/Cosmo/Saturn/docs/transcript-to-neo4j-pipeline.md` – Original pipeline design doc
- `/Users/silasrhyneer/Code/Cosmo/Saturn/neo4j.md` – Neo4j graph schema
- `/Users/silasrhyneer/Code/Cosmo/Saturn/CLAUDE.md` – Architecture overview

## Pipeline Overview

The memory extraction pipeline is a **7-phase async batch processing system** that converts conversation transcripts into Neo4j graph updates:

1. **Entity Identification** → Extract People/Projects/Ideas/Topics from text using LLM
2. **Entity Resolution** → Match extracted entities to existing Neo4j nodes (multi-tier matching)
3. **Entity Updates** → Generate structured property updates using parallel LLM agents
4. **Conversation Summary** → Pre-generated during conversation end (Phase 4 is skip)
5. **Relationship Scoring** → LLM scores User→Entity and Conversation→Entity relationships
6. **Embedding Generation** → Generate semantic vectors for Projects/Topics/Ideas
7. **Neo4j Transaction** → Atomic batch write using UNWIND for all updates

**Cost target**: ~$0.05 per 10k word conversation using gpt-4.1-mini/nano

**Idempotency**: Stable `entity_key` (hash of normalized name + type + user_id) prevents duplicates on re-runs

## Key Files

### Entry Points
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/services/conversationService.ts:254-263` – Enqueues memory extraction job after conversation ends
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/worker.ts` – Background worker that processes jobs
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/queue/memoryQueue.ts:87-119` – Job enqueueing logic

### Pipeline Orchestrator
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/services/memoryExtractionService.ts:30-128` – Main pipeline orchestrator
  - Fetches conversation from PostgreSQL
  - Runs 7 phases sequentially
  - Marks conversation as processed
  - Error handling with retry support

### Phase 1: Entity Identification
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/services/entityIdentificationService.ts:100-170` – Extract entities from transcript
  - Uses GPT-4.1-mini with structured output (Zod schemas)
  - Extracts: People, Projects, Ideas, Topics
  - Generates stable `entity_key` for each
  - Returns: `IdentifiedEntities` with `EntityCandidate[]` per type

### Phase 2: Entity Resolution
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/services/entityResolutionService.ts:138-167` – Multi-tier resolution strategy
  - **Tier 1**: entity_key exact match (most reliable)
  - **Tier 2**: canonical_name match
  - **Tier 3**: Alias lookup
  - **Tier 4**: Vector similarity search (cosine similarity threshold: 0.85)
  - **Tier 5**: LLM disambiguation for multiple candidates
  - Creates Alias nodes for name variants
  - Returns: `ResolvedEntity[]` with existing data + confidence scores

### Phase 3: Entity Updates
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/services/entityUpdateService.ts:161-180` – Parallel LLM agents per entity
  - Uses GPT-4.1-nano for cost efficiency
  - **Intrinsic vs User-specific split**:
    - Person: intrinsic (personality_traits, current_life_situation) vs KNOWS relationship (relationship_type, why_they_matter, etc.)
    - Project: intrinsic (domain, vision, key_decisions) vs WORKING_ON relationship (status, blockers, confidence/excitement levels)
    - Idea: intrinsic (original_inspiration, obstacles, resources_needed) vs EXPLORING relationship (status, next_steps, potential_impact)
  - **REPLACE strategy**: Arrays bounded (MAX 8-15), complete replacement not append
  - Filters empty values (empty strings, empty arrays, -1 sentinel numbers)
  - Returns: `EntityUpdate[]` with `nodeUpdates` + `relationshipUpdates`

### Phase 5: Relationship Scoring
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/services/relationshipUpdateService.ts:75-108` – LLM scores relationships
  - Uses GPT-4.1-nano
  - Scores: sentiment (-1 to 1), importance_score (0 to 1), depth/outcome (entity-specific)
  - Creates User→Entity relationships:
    - Person → KNOWS (with relationship_type required)
    - Project → WORKING_ON (only if status != abandoned)
    - Topic → INTERESTED_IN (with engagement_level)
    - Idea → EXPLORING (with status required)
  - Creates Conversation→Entity relationships:
    - MENTIONED (People, Projects)
    - DISCUSSED (Topics with depth)
    - EXPLORED (Ideas with outcome)

### Phase 6: Embedding Generation
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/services/embeddingGenerationService.ts:38-86` – Semantic vectors
  - Uses OpenAI text-embedding-3-small (1536 dimensions)
  - Embeds: Projects (name + vision), Topics (name + description), Ideas (summary + context_notes)
  - Batch processing (up to 2048 inputs per API call)
  - Returns: `EmbeddingUpdate[]` with entity_id + vector

### Phase 7: Neo4j Transaction
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/services/neo4jTransactionService.ts:30-72` – Atomic batch write
  - All updates in single transaction (rollback on any failure)
  - Uses UNWIND for efficient batch operations
  - Creates Conversation node
  - Upserts entities by type (Person, Project, Topic, Idea)
  - Updates embeddings
  - Creates User→Conversation relationship
  - Creates User→Entity relationships (with property updates)
  - Creates Conversation→Entity relationships (appends to timeline arrays, MAX 20)
  - Marks conversation as processed in PostgreSQL

### Utilities
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/utils/entityNormalization.ts:16-37` – Entity name normalization
  - Lowercase, remove possessives, tokenize, stem (Porter stemmer)
  - Ensures "startups" and "startup" generate same entity_key
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/utils/entityNormalization.ts:49-57` – Entity key generation
  - SHA256(normalizedName + entityType + userId)
  - Deterministic and collision-resistant

### Repositories (Entity-specific Neo4j queries)
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/repositories/PersonRepository.ts` – Person CRUD + KNOWS relationship
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/repositories/ProjectRepository.ts` – Project CRUD + WORKING_ON relationship
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/repositories/TopicRepository.ts` – Topic CRUD + INTERESTED_IN relationship
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/repositories/IdeaRepository.ts` – Idea CRUD + EXPLORING relationship
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/repositories/AliasRepository.ts` – Alias creation and lookup

### Job Processing
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/src/queue/memoryQueue.ts:27-71` – pg-boss queue setup
  - PostgreSQL-backed queue (no Redis needed)
  - Retry policy: 3 retries, exponential backoff (60s → 120s → 240s)
  - Job expiration: 1 hour if not completed
  - Deletion: 24 hours after completion
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/worker.ts` – Background worker
  - Polls queue every 2 seconds
  - Batch size: 5 jobs
  - Calls `memoryExtractionService.processConversation()` for each job

## Database Tables

**PostgreSQL (Supabase)**:
- **`conversation`**: id, user_id, transcript (JSON array of SerializedMessage), summary, status, entities_extracted (boolean), neo4j_synced_at
  - Flags: `entities_extracted` and `neo4j_synced_at` track sync status
  - Full transcript stored as JSON for pipeline input

**Neo4j**:
- **Person**: id, entity_key, name, canonical_name, personality_traits[], current_life_situation, last_update_source, confidence, embedding (optional)
- **Project**: id, entity_key, name, canonical_name, domain, vision, key_decisions[], last_update_source, confidence, embedding
- **Topic**: id, entity_key, name, canonical_name, description, category, last_update_source, confidence, embedding
- **Idea**: id, entity_key, summary, original_inspiration, evolution_notes, obstacles[], resources_needed[], experiments_tried[], context_notes, last_update_source, confidence, embedding
- **Alias**: id, normalized_name, confidence, is_canonical
- **Conversation**: id, summary, date, duration, trigger_method, status, topic_tags[]

**Relationships** (User-specific properties stored on edges):
- **(User)-[:KNOWS]->(Person)**: relationship_type, relationship_quality, how_they_met, why_they_matter, relationship_status, communication_cadence, first_mentioned_at, last_mentioned_at
- **(User)-[:WORKING_ON]->(Project)**: status, priority, confidence_level, excitement_level, time_invested, money_invested, blockers[], first_mentioned_at, last_mentioned_at
- **(User)-[:INTERESTED_IN]->(Topic)**: engagement_level, frequency, first_mentioned_at, last_mentioned_at
- **(User)-[:EXPLORING]->(Idea)**: status, confidence_level, excitement_level, potential_impact, next_steps[], first_mentioned_at, last_mentioned_at
- **(Conversation)-[:MENTIONED/DISCUSSED/EXPLORED]->(Entity)**: Timeline arrays with {conversation_id, timestamp}[] (MAX 20)

## Data Flow

### Conversation End → Memory Extraction

1. **Input**: User ends conversation via iOS app
2. **API**: `POST /api/conversations/:id/end` → `conversationService.endConversation()`
3. **Summary Generation**: `summaryService.generateConversationSummary(transcript)` (uses GPT-4.1-mini)
4. **Database Update**: Mark conversation status='completed', save summary
5. **Job Enqueue**: `enqueueConversationProcessing(conversationId, userId)` → pg-boss queue
6. **Response**: Return immediately (job runs async)

### Background Worker Processing

1. **Worker polls**: pg-boss checks for jobs every 2 seconds
2. **Job picked up**: Worker calls `memoryExtractionService.processConversation(conversationId, userId)`
3. **Phase 1**: Fetch transcript from PostgreSQL → `entityIdentificationService.identify(transcript, userId)`
   - LLM structured extraction with Zod schemas
   - Generate entity_key for each candidate
   - Output: `IdentifiedEntities` with 4 arrays (people, projects, ideas, topics)
4. **Phase 2**: Resolve entities → `entityResolutionService.resolve(entities, userId)`
   - Try entity_key → canonical_name → alias → vector search → LLM disambiguation
   - Create Alias nodes for name variants
   - Output: `ResolvedEntity[]` with existing data + confidence
5. **Phase 3**: Generate updates → `entityUpdateService.generateUpdates(transcript, resolvedEntities, conversationId)`
   - Parallel LLM agents (one per entity)
   - Split intrinsic (node) vs user-specific (relationship) properties
   - Filter empty values
   - Output: `EntityUpdate[]` with nodeUpdates + relationshipUpdates
6. **Phase 4**: Summary already generated (skip)
7. **Phase 5**: Score relationships → `relationshipUpdateService.scoreRelationships(transcript, entityUpdates, conversationId, userId)`
   - LLM scores sentiment, importance, depth/outcome
   - Create User→Entity relationships
   - Create Conversation→Entity relationships
   - Output: `RelationshipUpdates` with 2 arrays
8. **Phase 6**: Generate embeddings → `embeddingGenerationService.generate(entityUpdates)`
   - Batch embed Projects, Topics, Ideas
   - OpenAI text-embedding-3-small
   - Output: `EmbeddingUpdate[]` with vectors
9. **Phase 7**: Execute transaction → `neo4jTransactionService.execute({conversationId, userId, entities, summary, relationships, embeddings})`
   - Begin Neo4j transaction
   - Create Conversation node
   - UNWIND batch upsert entities by type
   - Update embeddings
   - Create User→Conversation relationship
   - MERGE User→Entity relationships (upsert with property updates)
   - MERGE Conversation→Entity relationships (append to timeline arrays)
   - Commit transaction
   - Mark conversation as processed in PostgreSQL
10. **Job completion**: pg-boss marks job as complete, removes from queue after 24h

### Error Handling

- **Phase failures**: Entire transaction rolls back (all-or-nothing)
- **Job failures**: pg-boss retries with exponential backoff (3 retries max)
- **Persistent failures**: Job expires after 1 hour, logs error
- **PostgreSQL flags**: `entities_extracted=false` allows manual retry

## Patterns to Follow

### Entity Identification Pattern
```typescript
// Define Zod schemas for structured extraction
const EntitySchema = z.object({
  mentionedName: z.string(),
  contextClue: z.string(),
});

const ExtractedSchema = z.object({
  entities: z.array(EntitySchema),
});

// Use structured output
const structuredLlm = this.model.withStructuredOutput(ExtractedSchema);
const extracted = await structuredLlm.invoke(prompt);

// Generate stable entity_key
const entityKey = generateEntityKey(entity.mentionedName, 'EntityType', userId);
```

### Entity Resolution Pattern
```typescript
// Multi-tier resolution
let existing = await repository.findByEntityKey(candidate.entityKey);

if (!existing) {
  existing = await repository.findByCanonicalName(normalizedName);
}

if (!existing) {
  const entityId = await aliasRepository.findEntityByAlias(name, type);
  if (entityId) existing = await repository.findById(entityId);
}

if (!existing) {
  const similarEntities = await vectorSimilaritySearch(searchText, type, 3, 0.85);
  if (similarEntities.length > 0) {
    // Use top match if score > 0.92, else disambiguate with LLM
  }
}

// Create alias if found with different name
if (existing && existing.name !== candidate.mentionedName) {
  await aliasRepository.createAlias(candidate.mentionedName, existing.id, type);
}
```

### Entity Update Pattern
```typescript
// Split intrinsic (node) vs user-specific (relationship) properties
const nodeSchema = z.object({
  personality_traits: z.array(z.string()).max(10).default([]),
  current_life_situation: z.string().default(''),
});

const relationshipSchema = z.object({
  relationship_type: z.string().default(''),
  why_they_matter: z.string().default(''),
});

// Generate both in parallel
const [nodeUpdates, relationshipUpdates] = await Promise.all([
  nodeStructuredLlm.invoke(nodePrompt),
  relStructuredLlm.invoke(relPrompt),
]);

// Filter empty values
return {
  nodeUpdates: this.filterEmptyValues(nodeUpdates),
  relationshipUpdates: this.filterEmptyValues(relationshipUpdates),
};
```

### Neo4j Transaction Pattern
```typescript
const session = neo4jService.getDriver().session();
const tx = session.beginTransaction();

try {
  // Batch upsert with UNWIND
  const query = `
    UNWIND $entities AS entity
    MERGE (n:EntityType {entity_key: entity.entity_key})
    ON CREATE SET
      n.id = entity.id,
      n.name = entity.name,
      n.property = entity.property
    ON MATCH SET
      n.property = coalesce(entity.property, n.property)
    RETURN n.id
  `;

  await tx.run(query, { entities: entitiesData });

  // Create relationships with MERGE
  const relQuery = `
    MATCH (u:User {id: $userId})
    MATCH (e:EntityType {id: $entityId})
    MERGE (u)-[r:RELATIONSHIP]->(e)
    ON CREATE SET r.property = $value
    ON MATCH SET r.property = coalesce($value, r.property)
  `;

  await tx.run(relQuery, params);

  await tx.commit();
} catch (error) {
  await tx.rollback();
  throw error;
} finally {
  await session.close();
}
```

### Job Processing Pattern
```typescript
// Enqueue job
const jobId = await queue.send(QUEUE_NAME, {
  conversationId,
  userId,
});

// Worker processes job
boss.work(QUEUE_NAME, { batchSize: 5 }, async (jobs) => {
  for (const job of jobs) {
    await memoryExtractionService.processConversation(
      job.data.conversationId,
      job.data.userId
    );
  }
});

// Retry configuration
await boss.createQueue(QUEUE_NAME, {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  expireInSeconds: 3600,
});
```

## Integration Points

### OpenAI (LangChain)
- **Entity Identification**: `ChatOpenAI` with `withStructuredOutput()` + Zod schemas
- **Entity Resolution**: Vector similarity search using `OpenAIEmbeddings.embedQuery()`
- **Entity Updates**: Parallel LLM agents with `ChatOpenAI` + structured output
- **Relationship Scoring**: LLM judgment with `ChatOpenAI` + structured output
- **Embedding Generation**: Batch embeddings with `OpenAIEmbeddings.embedDocuments()`

### Neo4j (neo4j-driver)
- **Repository pattern**: Each entity type has dedicated repository
- **Transactions**: Use `session.beginTransaction()` for atomic writes
- **UNWIND batching**: Efficient bulk operations for entities
- **MERGE operations**: Upsert entities and relationships
- **Vector search**: `db.index.vector.queryNodes()` for semantic matching

### PostgreSQL (Supabase)
- **Conversation storage**: Full transcript as JSON array
- **Sync flags**: `entities_extracted`, `neo4j_synced_at`
- **Job queue**: pg-boss uses PostgreSQL for persistence

### pg-boss Queue
- **PostgreSQL-backed**: No Redis needed
- **Retry logic**: Exponential backoff
- **Supervision**: Automatic recovery from failures

## Reusable Components for Information Dump

### 1. Entity Identification Service
**Adaptable for**: Processing arbitrary text input (user dumps, PDFs, images via OCR)

**Reuse strategy**:
- Keep Zod schemas and structured extraction pattern
- Replace `prepareTranscript()` with `prepareTextInput()` for arbitrary text
- Add entity type: `Note` for general knowledge snippets
- Keep `generateEntityKey()` for idempotent processing

**Changes needed**:
- Accept `rawText: string` instead of `transcript: SerializedMessage[]`
- Add prompt variations for different input types (raw text, OCR output, structured data)
- Support batch processing for large text dumps (chunk by paragraph/section)

### 2. Entity Resolution Service
**Directly reusable**: Multi-tier matching strategy works for any entity source

**Vector search** is especially useful for information dumps where entity names may vary significantly.

### 3. Entity Update Service
**Adaptable**: Split intrinsic/user-specific properties works for any entity source

**Changes needed**:
- Add `source_type` field to track origin (conversation vs info_dump vs pdf)
- Support "merge" strategy for info dumps (append to arrays instead of replace)
- Add `Note` entity type with `content`, `source`, `tags[]`, `related_entities[]`

### 4. Relationship Scoring Service
**Partially reusable**: LLM scoring pattern works, but relationship types differ

**Changes needed**:
- Info dumps don't have Conversation nodes → no Conversation→Entity relationships
- User→Entity relationships same (KNOWS, WORKING_ON, etc.)
- Add User→Note relationships with `relevance_score`, `tags[]`

### 5. Embedding Generation Service
**Directly reusable**: Batch embedding pattern works for any entity type

**Add**: Note embeddings (full content for semantic search)

### 6. Neo4j Transaction Service
**Reusable pattern**: UNWIND batching and atomic transactions work for any data source

**Changes needed**:
- Skip Conversation node creation
- Add Note node creation
- Add User→Note relationships
- Track provenance: `source_type`, `source_id`, `extracted_at`

### 7. Entity Normalization Utils
**Directly reusable**: Name normalization and entity_key generation work for any text source

### 8. Repository Pattern
**Reusable**: Add `NoteRepository` following same CRUD pattern

## Notes

### Key Architectural Decisions
- **Async processing**: Conversation ends immediately, extraction runs in background
- **All-or-nothing transactions**: Neo4j transaction rolls back on any failure
- **Idempotent processing**: entity_key allows safe re-runs
- **Cost optimization**: Uses gpt-4.1-mini/nano for efficient processing
- **Property split**: Intrinsic (node) vs user-specific (relationship) enables multi-user support

### Performance Considerations
- **Parallel LLM calls**: Phase 3 runs one agent per entity in parallel (cost vs latency tradeoff)
- **Batch embeddings**: OpenAI allows up to 2048 inputs per call
- **UNWIND efficiency**: Single query for all entities of same type (vs N queries)
- **Vector search threshold**: 0.85 cosine similarity balances precision/recall

### Security Considerations
- **User isolation**: entity_key includes userId → prevents cross-user pollution
- **Transaction isolation**: Neo4j transactions prevent race conditions
- **Input validation**: Zod schemas validate LLM outputs before database writes

### Information Dump Adaptations
1. **Input flexibility**: Replace transcript parsing with generic text chunking
2. **Source tracking**: Add `source_type`, `source_id` to provenance
3. **Merge strategy**: Info dumps should append to arrays, not replace
4. **Note entities**: Add general knowledge snippets not tied to specific entity types
5. **Batch processing**: Large dumps need chunking + progress tracking
6. **No conversation relationships**: Skip Conversation→Entity relationships
7. **Immediate processing**: No need for async queue (unless very large dumps)

### Next Steps for Information Dump
1. Create `InformationDumpService` wrapping reusable components
2. Add `Note` entity type to Neo4j schema
3. Create `NoteRepository` following repository pattern
4. Add `/api/information-dump` endpoint for file uploads
5. Support text extraction from PDFs/images (OCR)
6. Add progress tracking for large dumps
7. Support manual entity tagging/categorization
