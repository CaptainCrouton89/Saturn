# Investigation: Neo4j Entity Management System

> Context bundle for understanding how entities are managed in the Neo4j knowledge graph. Covers repository patterns, entity resolution, creation/update strategies, relationship management, provenance tracking, and bounded array enforcement.

## Goal
Document the complete entity management lifecycle in Neo4j, from identification through resolution to creation/update, including the architectural shift from node-based to relationship-based storage of user-specific properties.

## Related Docs
- `neo4j.md` – Full Neo4j schema with node types, relationships, constraints
- `docs/transcript-to-neo4j-pipeline.md` – 7-phase memory extraction pipeline
- `CLAUDE.md` – Project overview and critical context

## Overview: Entity Management Architecture

The system manages entities (Person, Project, Idea, Topic) through a **7-phase pipeline**:

1. **Entity Identification** → Extract entities from conversation transcript (LLM)
2. **Entity Resolution** → Match to existing Neo4j nodes or mark as new
3. **Entity Update Generation** → Generate structured updates (parallel LLM agents)
4. **Conversation Summary** → Generate summary for Conversation node
5. **Relationship Updates** → Build User→Entity and Conversation→Entity relationships
6. **Embedding Generation** → Create semantic embeddings for search
7. **Neo4j Transaction** → Atomic commit of all changes

**Key Architectural Pattern**: Separation of **intrinsic properties** (stored on entity nodes) vs **user-specific properties** (stored on User→Entity relationships).

---

## Entity Resolution Strategy

### Resolution Cascade (Multi-Tier Matching)

Located in: `/backend/src/services/entityResolutionService.ts`

**Order of resolution attempts**:
1. **entity_key match** (most reliable) - SHA256 hash of normalized name + type + userId
2. **canonical_name match** - Lowercase normalized name
3. **Alias lookup** - Check Alias nodes via `ALIAS_OF` relationship
4. **Vector similarity search** - Semantic matching using embeddings (threshold: 0.85)
   - Score > 0.92: Auto-accept
   - Score 0.85-0.92: LLM disambiguation
5. **Fuzzy name search** - String matching via `CONTAINS` query
6. **LLM disambiguation** - If multiple candidates, ask LLM to pick correct one

### Entity Key Generation

Located in: `/backend/src/utils/entityNormalization.ts`

```typescript
// Stable hash for idempotent processing
function generateEntityKey(name: string, entityType: string, userId: string): string {
  const normalized = normalizeEntityName(name); // stemming, lowercasing
  const input = `${normalized}${entityType}${userId}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}
```

**Normalization steps**:
- Lowercase and trim
- Remove possessives (`'s`)
- Tokenize words
- Apply Porter stemming (plural → singular, gerunds → base)
- Example: "Sarah's Startups" → "sarah startup"

### Alias Management

Located in: `/backend/src/repositories/AliasRepository.ts`

**Key methods**:
- `createAlias(alias, entityId, entityType)` - Link name variant to entity
- `findEntityByAlias(alias, entityType)` - Resolve alias to entity ID
- `mergeEntityAliases(sourceId, targetId, entityType)` - Consolidate duplicates

**When aliases are created**:
- Entity found but mentioned with different name
- Example: "Sarah" resolved to "Sarah Johnson" → create "Sarah" alias

**Alias schema**:
```cypher
(:Alias {
  name: string,              // Original variant
  normalized_name: string,   // Lowercased for matching
  type: string               // Person, Project, Topic
})-[:ALIAS_OF]->(:Person|:Project|:Topic)
```

---

## Repository Pattern

### Common Structure (All Repositories)

All entity repositories follow this pattern:

**Core CRUD Methods**:
- `upsert(entity)` - Create or update entity (intrinsic properties only)
- `findById(id)` - Fetch by Neo4j ID
- `findByEntityKey(entityKey)` - Fetch by stable hash (idempotent lookups)
- `findByCanonicalName(canonicalName)` - Fetch by normalized name

**Relationship Methods**:
- `linkToUser(userId, entityId, metadata)` - Create/update User→Entity relationship
- `linkToConversation(entityId, conversationId, metadata)` - Create Conversation→Entity relationship
- `updateXRelationship(userId, entityId, updates)` - Update relationship properties

### PersonRepository

Located in: `/backend/src/repositories/PersonRepository.ts`

**Node Properties (Intrinsic)**:
```typescript
{
  id: string;
  entity_key: string;
  name: string;
  canonical_name: string;
  updated_at: Date;
  last_update_source: string;  // conversation_id
  confidence: number;           // 0-1
  // Intrinsic context
  personality_traits: string[];      // MAX 10
  current_life_situation: string;
}
```

**Relationship Properties (User-Specific)** - stored on `(User)-[:KNOWS]->(Person)`:
```typescript
{
  relationship_type: string;        // friend, colleague, family, etc.
  relationship_quality: number;     // 0-1
  how_they_met: string;
  why_they_matter: string;
  relationship_status: string;      // growing, stable, fading, complicated
  communication_cadence: string;    // "daily texts", "monthly calls"
  first_mentioned_at: Date;
  last_mentioned_at: Date;
}
```

**Key Methods**:
- `upsert(person)` - Lines 8-60: MERGE on entity_key, bounded array merge for personality_traits
- `upsertKnowsRelationship(userId, personId, properties)` - Lines 65-115: Create/update KNOWS relationship
- `findByIdWithRelationship(id, userId)` - Lines 129-152: Fetch person + relationship data
- `getRecentlyMentionedWithRelationship(userId, daysBack)` - Lines 236-261: Recent people with full context

**Array Bounding**:
```cypher
p.personality_traits = CASE
  WHEN $personality_traits IS NOT NULL
  THEN (p.personality_traits[0..9] + $personality_traits)[0..9]  // Keep first 10 items
  ELSE p.personality_traits
END
```

### ProjectRepository

Located in: `/backend/src/repositories/ProjectRepository.ts`

**Node Properties (Intrinsic)**:
```typescript
{
  id: string;
  entity_key: string;
  name: string;
  canonical_name: string;
  domain: string;              // startup, personal, creative, technical
  last_update_source: string;
  confidence: number;
  vision: string;
  key_decisions: string[];     // MAX 10
  embedding: number[];         // Vector for semantic search
}
```

**Relationship Properties (User-Specific)** - stored on `(User)-[:WORKING_ON]->(Project)`:
```typescript
{
  status: string;                // active, paused, completed, abandoned
  priority: number;
  last_discussed_at: Date;
  confidence_level: number;      // 0-1, belief it will succeed
  excitement_level: number;      // 0-1, emotional investment
  time_invested: string;         // Freeform estimation
  money_invested: number;
  blockers: string[];            // MAX 8
  first_mentioned_at: Date;
  last_mentioned_at: Date;
}
```

**Key Methods**:
- `upsert(project)` - Lines 8-66: MERGE on entity_key, bounded arrays for key_decisions
- `linkToUser(userId, projectId, metadata)` - Lines 134-186: MERGE WORKING_ON relationship
- `updateWorkingOnRelationship(userId, projectId, updates)` - Lines 191-246: Granular updates
- `getActiveProjects(userId)` - Lines 116-129: Filter by status='active'

**Bounded Array Pattern** (blockers):
```cypher
r.blockers = CASE
  WHEN $blockers IS NOT NULL
  THEN (r.blockers[0..7] + $blockers)[0..7]  // Keep first 8 items
  ELSE r.blockers
END
```

### IdeaRepository

Located in: `/backend/src/repositories/IdeaRepository.ts`

**Node Properties (Intrinsic)**:
```typescript
{
  id: string;
  entity_key: string;
  summary: string;               // Ideas don't have "names"
  created_at: Date;
  refined_at: Date;
  updated_at: Date;
  last_update_source: string;
  confidence: number;
  // Intrinsic context
  original_inspiration: string;
  evolution_notes: string;
  obstacles: string[];           // MAX 8
  resources_needed: string[];    // MAX 10
  experiments_tried: string[];   // MAX 10
  context_notes: string;
  embedding: number[];
}
```

**Relationship Properties (User-Specific)** - stored on `(User)-[:EXPLORING]->(Idea)`:
```typescript
{
  status: string;                // raw, refined, abandoned, implemented
  confidence_level: number;      // 0-1, belief it will work
  excitement_level: number;      // 0-1, emotional pull
  potential_impact: string;
  next_steps: string[];          // MAX 8
  first_mentioned_at: Date;
  last_mentioned_at: Date;
}
```

**Key Methods**:
- `upsert(idea)` - Lines 8-85: MERGE on entity_key, bounded arrays for obstacles/resources/experiments
- `setExploringRelationship(userId, ideaId, props)` - Lines 91-136: Create/update EXPLORING relationship
- `findByStatusForUser(userId, status)` - Lines 198-207: Filter ideas by user's exploration status
- `updateStatusForUser(userId, ideaId, status)` - Lines 247-266: Update idea status + refined_at

**Multiple Bounded Arrays**:
```cypher
i.obstacles = CASE
  WHEN $obstacles IS NOT NULL
  THEN (i.obstacles[0..7] + $obstacles)[0..7]
  ELSE i.obstacles
END,
i.resources_needed = CASE
  WHEN $resources_needed IS NOT NULL
  THEN (i.resources_needed[0..9] + $resources_needed)[0..9]
  ELSE i.resources_needed
END
```

### TopicRepository

Located in: `/backend/src/repositories/TopicRepository.ts`

**Node Properties (All Intrinsic)**:
```typescript
{
  id: string;
  entity_key: string;
  name: string;
  canonical_name: string;
  description: string;
  category: string;              // technical, personal, philosophical, professional
  last_update_source: string;
  confidence: number;
  embedding: number[];
}
```

**Relationship Properties (Temporal Only)** - stored on `(User)-[:INTERESTED_IN]->(Topic)`:
```typescript
{
  engagement_level: number;      // 0-1
  last_discussed_at: Date;
  frequency: number;             // Auto-incremented on each mention
  first_mentioned_at: Date;
  last_mentioned_at: Date;
}
```

**Key Methods**:
- `upsert(topic)` - Lines 8-59: MERGE on entity_key
- `linkToUser(userId, topicId, metadata)` - Lines 146-185: MERGE INTERESTED_IN relationship, auto-increment frequency
- `getUserTopics(userId, minEngagement)` - Lines 121-140: Filter by engagement threshold
- `updateUserTopicRelationship(userId, topicId, updates)` - Lines 209-237: Granular updates

**Auto-Incrementing Frequency**:
```cypher
ON MATCH SET
  r.frequency = coalesce($frequency, r.frequency) + 1,
  r.last_mentioned_at = coalesce($last_mentioned_at, datetime())
```

---

## Entity Update Strategy

### Update Service Architecture

Located in: `/backend/src/services/entityUpdateService.ts`

**Update Strategy: REPLACE (MVP)**
- Arrays: Complete replacement (provide full new array, MAX limits enforced)
- Scalars: Replace if new value provided
- LLM instructed to return empty object if no new information

**Separation of Concerns**:
- **Node Updates** (`nodeUpdates`): Intrinsic properties written to entity node
- **Relationship Updates** (`relationshipUpdates`): User-specific properties written to User→Entity relationship

### Person Update Flow

**New Person** (Lines 222-275):
1. Extract intrinsic properties (personality_traits, current_life_situation)
2. Extract user-specific properties (relationship_type, how_they_met, etc.)
3. Return separate `nodeUpdates` and `relationshipUpdates` objects

**Existing Person** (Lines 276-329):
1. LLM sees current intrinsic data (traits, situation)
2. LLM instructed: "Only include fields with NEW or UPDATED information"
3. Arrays must be REPLACED completely (not appended)
4. Return filtered updates (empty values removed)

**Prompts Pattern**:
```typescript
const nodePrompt = `Extract INTRINSIC information (facts about the person themselves):
- personality_traits: Array of traits (MAX 10)
- current_life_situation: Current life context
Only include fields with information from the conversation.`;

const relPrompt = `Extract USER-SPECIFIC information (the user's relationship with them):
- relationship_type, relationship_status, communication_cadence, etc.
Only include fields with NEW information from the conversation.`;
```

### Project Update Flow

**Node Updates** (Intrinsic):
- domain, vision, key_decisions (MAX 10)

**Relationship Updates** (User-Specific):
- status, blockers (MAX 8), confidence_level, excitement_level, time_invested, money_invested

### Idea Update Flow

**Node Updates** (Intrinsic):
- original_inspiration, evolution_notes, obstacles (MAX 8), resources_needed (MAX 10), experiments_tried (MAX 10), context_notes

**Relationship Updates** (User-Specific):
- status, confidence_level, excitement_level, potential_impact, next_steps (MAX 8)

### Topic Update Flow

**Node Updates Only** (Topics have minimal user-specific data):
- description, category

**Relationship Updates**: Temporal tracking only (handled automatically by repository)

---

## Relationship Management

### User → Entity Relationships

Managed in: `/backend/src/services/neo4jTransactionService.ts` (Lines 435-494)

**Relationship Types**:
- `KNOWS` (Person) - Lines 525-541
- `WORKING_ON` (Project) - Lines 543-562
- `INTERESTED_IN` (Topic) - Lines 564-578
- `EXPLORING` (Idea) - Lines 581-596

**Pattern** (MERGE with coalesce):
```cypher
MATCH (u:User {id: $userId})
MATCH (p:Person {id: $targetId})
MERGE (u)-[r:KNOWS]->(p)
ON CREATE SET
  r.first_mentioned_at = datetime(),
  r.last_mentioned_at = datetime()
SET r.relationship_type = coalesce($relationship_type, r.relationship_type),
    r.relationship_quality = coalesce($relationship_quality, r.relationship_quality),
    r.last_mentioned_at = datetime()
```

**Key Behavior**:
- `ON CREATE`: Initialize first_mentioned_at, last_mentioned_at
- `SET`: Update only provided properties (coalesce preserves existing nulls)
- Temporal tracking: Always update last_mentioned_at

### Conversation → Entity Relationships

Managed in: `/backend/src/services/neo4jTransactionService.ts` (Lines 500-519, 605-643)

**Relationship Types**:
- `MENTIONED` (Person) - Appends to mentions array (MAX 20)
- `DISCUSSED` (Topic) - Appends to discussions array (MAX 20)
- `EXPLORED` (Idea) - Appends to explorations array (MAX 20)

**Timeline Tracking Pattern**:
```cypher
MATCH (c:Conversation {id: $conversationId})
MATCH (p:Person {id: $targetId})
MERGE (c)-[r:MENTIONED]->(p)
SET r.mentions = (coalesce(r.mentions, []) + [{
  conversation_id: $conversationId,
  timestamp: c.date
}])[0..19]  // Keep only first 20 items
```

**Purpose**: Track when each entity was referenced across conversations for timeline analysis

---

## Provenance Tracking

### Node-Level Provenance

All entity nodes track:
```typescript
{
  last_update_source: string;    // conversation_id where last updated
  confidence: number;            // 0-1, confidence in entity resolution
  updated_at: Date;              // Auto-set on each update
}
```

**Written by**: `entityUpdateService` (confidence), `neo4jTransactionService` (last_update_source)

### Relationship-Level Provenance

All User→Entity relationships track:
```typescript
{
  first_mentioned_at: Date;      // When relationship was first created
  last_mentioned_at: Date;       // Most recent mention
  last_discussed_at?: Date;      // Most recent deep discussion (Projects, Topics)
}
```

**Auto-updated**: Every transaction updates `last_mentioned_at` via `coalesce(..., datetime())`

### Conversation Timeline Arrays

Conversation→Entity relationships use bounded arrays:
```typescript
{
  mentions: Array<{              // MAX 20
    conversation_id: string;
    timestamp: Date;
  }>;
}
```

**Pattern**: Keep most recent 20 mentions via array slicing: `[0..19]`

---

## Bounded Array Enforcement

### Strategy: Cypher Array Slicing

**Pattern** (prepend + slice):
```cypher
SET property = (existing[0..N-1] + new_items)[0..N-1]
```

**Example** (MAX 10 personality_traits):
```cypher
p.personality_traits = CASE
  WHEN $personality_traits IS NOT NULL
  THEN (p.personality_traits[0..9] + $personality_traits)[0..9]
  ELSE p.personality_traits
END
```

**Behavior**:
- Keeps first 9 existing items
- Appends new items
- Slices result to first 10 items
- Effect: Oldest items age out

### Array Limits by Entity Type

**Person**:
- `personality_traits`: MAX 10

**Project**:
- `key_decisions`: MAX 10
- `blockers`: MAX 8 (on WORKING_ON relationship)

**Idea**:
- `obstacles`: MAX 8
- `resources_needed`: MAX 10
- `experiments_tried`: MAX 10
- `next_steps`: MAX 8 (on EXPLORING relationship)

**Topic**: No arrays (description is scalar)

**Conversation Relationships**:
- `mentions`, `discussions`, `explorations`: MAX 20

### Why Bounded Arrays?

From `CLAUDE.md`:
> **Array Bounding** (prevent unbounded growth):
> - All array properties have MAX limits (8-15 items)
> - Keep most recent/salient items when full
> - Move long histories to Note nodes via `HAS_NOTE` relationship

**Design Rationale**:
- Prevent graph bloat from unlimited history
- Enforce focus on salient/recent information
- Long-term history can be offloaded to Note nodes if needed

---

## Entity Identification Service

Located in: `/backend/src/services/entityIdentificationService.ts`

**Phase 1 of 7-phase pipeline**: Extract entities from conversation transcript

**Process**:
1. Filter transcript to human/AI dialogue only (remove system/tool messages)
2. Format as numbered turns: `[Turn 1] User: ..., [Turn 2] Cosmo: ...`
3. Send to LLM with structured output schema
4. Generate entity_key for each extracted entity (using `generateEntityKey`)

**Extraction Schema**:
```typescript
{
  people: Array<{
    mentionedName: string;
    contextClue: string;  // "my manager", "friend from college"
  }>;
  projects: Array<{
    mentionedName: string;
    contextClue: string;  // "startup idea", "side project"
  }>;
  ideas: Array<{
    summary: string;      // Ideas don't have names
  }>;
  topics: Array<{
    name: string;
    category: 'technical' | 'personal' | 'philosophical' | 'professional';
  }>;
}
```

**Output**: `EntityCandidate` objects with stable `entity_key` for idempotent processing

---

## Neo4j Transaction Coordination

Located in: `/backend/src/services/neo4jTransactionService.ts`

**Phase 7 of pipeline**: Execute all updates atomically

**Transaction Steps** (Lines 30-72):
1. Create Conversation node
2. Upsert entity nodes (batched by type using UNWIND)
3. Update entity embeddings
4. Link User to Conversation
5. Create User→Entity relationships
6. Create Conversation→Entity relationships
7. **Commit** (all-or-nothing)
8. Mark conversation as processed in PostgreSQL

**Batch Upsert Pattern** (UNWIND):
```cypher
UNWIND $people AS person
MERGE (p:Person {entity_key: person.entity_key})
ON CREATE SET p.id = person.id, ...
ON MATCH SET p.updated_at = datetime(), ...
RETURN p.id
```

**Benefits**:
- Single network round-trip for multiple entities
- Maintains transactional guarantees
- Efficient for batch operations

**Entity ID Mapping**:
- New entities get temp IDs (`temp_${entity_key.substring(0, 12)}`)
- After upsert, map temp IDs → actual Neo4j IDs
- Used for creating relationships (Lines 462, 508)

**Rollback on Failure**:
```typescript
try {
  // ... all transaction steps
  await tx.commit();
} catch (error) {
  await tx.rollback();
  throw new Error(`Neo4j transaction failed: ${errorMessage}`);
} finally {
  await session.close();
}
```

---

## Key Files Reference

### Services (Pipeline Phases)
- `/backend/src/services/entityIdentificationService.ts` - Phase 1: Extract entities from transcript
- `/backend/src/services/entityResolutionService.ts` - Phase 2: Match to existing nodes
- `/backend/src/services/entityUpdateService.ts` - Phase 3: Generate structured updates
- `/backend/src/services/neo4jTransactionService.ts` - Phase 7: Atomic commit

### Repositories (Data Access Layer)
- `/backend/src/repositories/PersonRepository.ts` - Person CRUD + KNOWS relationship
- `/backend/src/repositories/ProjectRepository.ts` - Project CRUD + WORKING_ON relationship
- `/backend/src/repositories/IdeaRepository.ts` - Idea CRUD + EXPLORING relationship
- `/backend/src/repositories/TopicRepository.ts` - Topic CRUD + INTERESTED_IN relationship
- `/backend/src/repositories/AliasRepository.ts` - Alias creation/lookup/merging

### Utilities
- `/backend/src/utils/entityNormalization.ts` - Name normalization, entity_key generation

### Type Definitions
- `/backend/src/types/graph.ts` - All Neo4j node/relationship interfaces

---

## Patterns to Follow

### Entity Creation/Update
- **Always** use `entity_key` for MERGE (not name or ID)
- **Always** provide `last_update_source` (conversation_id) for provenance
- **Always** provide `confidence` score (0-1)
- **Always** enforce bounded array limits via Cypher slicing

### Relationship Management
- **Separate** intrinsic properties (node) from user-specific properties (relationship)
- **Use** `coalesce()` to preserve existing values when updating
- **Track** temporal metadata: first_mentioned_at, last_mentioned_at

### Error Handling
- Validate User node exists before creating relationships (Lines 416-424)
- Throw clear errors if entity types are unknown (Line 598)
- Rollback entire transaction on any failure (Lines 65-69)

### Batch Operations
- Group entities by type before upserting
- Use UNWIND for efficient batch processing
- Map temp IDs to actual IDs for relationship creation

---

## Integration Points

### PostgreSQL (Supabase)
- Conversation transcript stored in `conversation` table
- After Neo4j transaction, mark as processed: `entities_extracted = true`, `neo4j_synced_at = now()`

### LangChain/OpenAI
- Entity identification: GPT-4.1-mini with structured output
- Entity update generation: GPT-4.1-nano (parallel agents per entity)
- Entity disambiguation: GPT-4.1-nano when multiple candidates found

### Vector Search (Neo4j)
- Embeddings stored on Project, Topic, Idea nodes
- Vector indexes: `{entityType}_embedding`
- Used for semantic similarity matching during resolution (threshold: 0.85)

---

## Notes

### Critical Architectural Shift (Nov 2024)
User-specific properties moved from entity nodes to User→Entity relationships. This allows:
- Multiple users to have different relationships with same entity
- Cleaner separation of intrinsic vs relational data
- Better support for multi-user features in future

### Idempotency Guarantees
- `entity_key` is deterministic hash (same name + type + userId → same key)
- MERGE on `entity_key` prevents duplicate entity creation
- Safe to re-run pipeline on same conversation (updates will REPLACE)

### Cost Optimization
- Phase 3 uses GPT-4.1-nano (~$0.002 per entity)
- Parallel LLM agents for all entities (fast)
- Target: ~$0.05 per 10k word conversation

### Performance Considerations
- UNWIND batching reduces network round-trips
- Single transaction reduces lock contention
- Vector search fallback only if exact matches fail

### Security Considerations
- User ID always included in entity_key (user isolation)
- User node existence validated before relationship creation
- Transaction rollback prevents partial updates

### Future Enhancements (Not in MVP)
- Pattern detection (Pattern nodes exist in schema but not used)
- Value tracking (Value nodes exist in schema but not used)
- Note nodes for long-form history (HAS_NOTE relationship defined but not implemented)
- Proactive duplicate detection (manual merge only via `AliasRepository.mergeEntityAliases`)
