# Agent Tools - CLAUDE.md

LangChain tools for Neo4j graph manipulation and memory retrieval.

## Overview

This directory contains 12 tools used by LangGraph agents:

**Node Tools** (6): Create and update Person, Concept, Entity nodes
**Relationship Tools** (2): Create and update relationships between nodes
**Retrieval Tools** (2): Semantic search and Cypher query execution
**Conversation Tools** (2): Write responses and complete onboarding

## Directory Structure

```
tools/
├── nodes/                    # Node creation/update tools
│   ├── person.tool.ts        # createPersonTool, updatePersonTool
│   ├── concept.tool.ts       # createConceptTool, updateConceptTool
│   └── entity.tool.ts        # createEntityTool, updateEntityTool
├── relationships/            # Relationship tools
│   └── relationship.tool.ts  # createRelationshipTool, updateRelationshipTool
├── retrieval/                # Memory retrieval tools
│   ├── explore.tool.ts       # Semantic search + graph expansion
│   └── traverse.tool.ts      # Cypher query execution
├── write.tool.ts             # Conversation response tool
├── completeOnboarding.tool.ts # Onboarding completion tool
├── index.ts                  # Tool exports
└── registry.ts               # Tool collections (allTools, ingestionTools)
```

## Tool Collections

### Ingestion Tools

Used by ingestion agent during memory extraction:

```typescript
export const ingestionTools = [
  // Node tools
  createPersonTool,
  updatePersonTool,
  createConceptTool,
  updateConceptTool,
  createEntityTool,
  updateEntityTool,
  // Relationship tools
  createRelationshipTool,
  updateRelationshipTool,
];
```

Plus dynamically added retrieval tools:
- `exploreTool` (requires userId, created per invocation)
- `traverseTool` (requires userId, created per invocation for security)

### Conversation Tools

Used by conversation agent for real-time responses:

```typescript
export const allTools = [
  writeTool,
  completeOnboardingTool,
];
```

Plus dynamically added retrieval tools (same as ingestion).

## Node Tools

### Person Tools

**File**: `nodes/person.tool.ts`

#### createPersonTool

Creates a new Person node in Neo4j.

**Input Schema**:
```typescript
{
  user_id: string,              // Required: For entity_key generation
  canonical_name: string,       // Required: Normalized name for matching
  last_update_source: string,   // Required: conversation_id for provenance
  confidence: number,           // Required: 0-1 confidence in creation

  // Optional Person properties (from tech.md:15-30)
  name?: string,                // Display name (may differ from canonical_name)
  appearance?: string,          // Physical description
  situation?: string,           // Current circumstances
  history?: string,             // Past events, relationships
  personality?: string,         // Character traits, mannerisms
  expertise?: string,           // Skills, knowledge domains
  interests?: string,           // Hobbies, passions
  notes?: string,               // Unstructured info that doesn't fit elsewhere
}
```

**Output**: `{ entity_key: string, message: string }`

**Repository Method**: `PersonRepository.create()`

**Validation**: Zod schema from `schemas/ingestion.ts`

**Example**:
```json
{
  "user_id": "user_123",
  "canonical_name": "sarah johnson",
  "last_update_source": "conv_456",
  "confidence": 0.95,
  "name": "Sarah",
  "situation": "Recently started new job at tech startup",
  "personality": "Energetic, optimistic, detail-oriented"
}
```

#### updatePersonTool

Updates an existing Person node. Cannot update `canonical_name` (immutable).

**Input Schema**: Same as createPersonTool, except:
- `entity_key` (required) replaces `user_id` + `canonical_name`
- All Person properties are optional (partial update)

**Output**: `{ entity_key: string, message: string }`

**Repository Method**: `PersonRepository.update()`

**Example**:
```json
{
  "entity_key": "person_abc123",
  "last_update_source": "conv_789",
  "confidence": 0.90,
  "situation": "Promoted to team lead, managing 3 engineers"
}
```

### Concept Tools

**File**: `nodes/concept.tool.ts`

#### createConceptTool

Creates a new Concept node (important topics/projects/ideas).

**Input Schema**:
```typescript
{
  user_id: string,              // Required: For entity_key generation
  name: string,                 // Required: Concept name
  last_update_source: string,   // Required: conversation_id
  confidence: number,           // Required: 0-1

  // Optional Concept properties (from tech.md:5-13)
  description?: string,         // What is this concept?
  notes?: string,               // Unstructured info
}
```

**Output**: `{ entity_key: string, message: string }`

**Repository Method**: `ConceptRepository.create()`

**Important**: Only create Concepts with user-specific context (per tech.md:127-131). Generic topics without personal relevance should NOT be created.

**Example**:
```json
{
  "user_id": "user_123",
  "name": "Project Phoenix",
  "last_update_source": "conv_456",
  "confidence": 0.98,
  "description": "Personal side project - building a habit tracker app",
  "notes": "User excited about this, mentioned wanting to launch by Q2"
}
```

#### updateConceptTool

Updates an existing Concept node.

**Input Schema**: Same as createConceptTool, except:
- `entity_key` (required) replaces `user_id` + `name`
- All Concept properties are optional (partial update)

**Output**: `{ entity_key: string, message: string }`

**Repository Method**: `ConceptRepository.update()`

### Entity Tools

**File**: `nodes/entity.tool.ts`

#### createEntityTool

Creates a new Entity node (companies, places, objects, groups, institutions, products, technology).

**Input Schema**:
```typescript
{
  user_id: string,              // Required: For entity_key generation
  name: string,                 // Required: Entity name
  type: string,                 // Required: company, place, object, group, institution, product, technology
  last_update_source: string,   // Required: conversation_id
  confidence: number,           // Required: 0-1

  // Optional Entity properties (from tech.md:31-40)
  description?: string,         // What is this entity?
  notes?: string,               // User-specific context
}
```

**Output**: `{ entity_key: string, message: string }`

**Repository Method**: `EntityRepository.create()`

**Important**: Only create Entities with user-specific context. "Chicago" mentioned casually → NO. "Chicago" with user's plans/feelings → YES.

**Example**:
```json
{
  "user_id": "user_123",
  "name": "Anthropic",
  "type": "company",
  "last_update_source": "conv_456",
  "confidence": 0.92,
  "description": "AI safety company",
  "notes": "User applied for ML engineer role, excited about mission alignment"
}
```

#### updateEntityTool

Updates an existing Entity node.

**Input Schema**: Same as createEntityTool, except:
- `entity_key` (required) replaces `user_id` + `name` + `type`
- All Entity properties are optional (partial update)

**Output**: `{ entity_key: string, message: string }`

**Repository Method**: `EntityRepository.update()`

## Relationship Tools

**File**: `relationships/relationship.tool.ts`

### createRelationshipTool

Creates a relationship between two nodes with type-specific property validation.

**Input Schema**:
```typescript
{
  from_entity_key: string,      // Required: Source node entity_key
  to_entity_key: string,        // Required: Target node entity_key
  relationship_type: string,    // Required: See relationship types below
  properties: Record<string, unknown>, // Type-specific properties
}
```

**Supported Relationship Types** (from tech.md:57-118):

#### 1. thinks_about
`(Person)-[:thinks_about]->(Concept)`

**Properties**:
- `mood?: string` - User's emotional state about this concept (optional)
- `frequency?: string` - How often user thinks about this (e.g., "daily", "weekly") (optional)

#### 2. has_relationship_with
`(Person)-[:has_relationship_with]->(Person)`

**Properties**:
- `attitude_towards_person?: string` - User's feelings/opinions about this person (optional)
- `closeness?: string` - Strength of relationship (e.g., "close friend", "acquaintance") (optional)
- `relationship_type?: string` - Nature of relationship (e.g., "friend", "colleague", "family") (optional)
- `notes?: string` - Rich text description of relationship (optional)

#### 3. relates_to_concept
`(Concept)-[:relates_to]->(Concept)`

**Properties**:
- `notes?: string` - How concepts are related (optional)
- `relevance?: number` - 0-1 strength of connection (optional)

#### 4. involves_person
`(Concept)-[:involves]->(Person)`

**Properties**:
- `notes?: string` - Person's role in this concept (optional)
- `relevance?: number` - 0-1 importance of person to concept (optional)

#### 5. involves_entity
`(Concept)-[:involves]->(Entity)`

**Properties**:
- `notes?: string` - Entity's role in this concept (optional)
- `relevance?: number` - 0-1 importance of entity to concept (optional)

#### 6. produced
`(Concept)-[:produced]->(Artifact)`

**Properties**:
- `notes?: string` - How concept led to artifact (optional)
- `relevance?: number` - 0-1 importance of artifact (optional)

#### 7. relates_to_entity
`(Person)-[:relates_to]->(Entity)`

**Properties**:
- `relationship_type?: string` - Nature of relationship (e.g., "works at", "lives in") (optional)
- `notes?: string` - Details of relationship (optional)
- `relevance?: number` - 0-1 importance (optional)

#### 8. relates_to_entity_entity
`(Entity)-[:relates_to]->(Entity)`

**Properties**:
- `relationship_type?: string` - How entities are related (optional)
- `notes?: string` - Details of relationship (optional)
- `relevance?: number` - 0-1 strength of connection (optional)

#### 9. mentions
`(Source)-[:mentions]->(Person|Concept|Entity)`

**Properties**: None (auto-created by Phase 2)

#### 10. sourced_from
`(Artifact)-[:sourced_from]->(Source)`

**Properties**: None

**Validation**: Tool validates properties against Zod schemas and ignores extra fields not in schema for each relationship type.

**Output**: `{ success: boolean, message: string }`

**Example**:
```json
{
  "from_entity_key": "person_user_123",
  "to_entity_key": "concept_project_phoenix",
  "relationship_type": "thinks_about",
  "properties": {
    "mood": "excited and motivated",
    "frequency": "daily"
  }
}
```

### updateRelationshipTool

Updates properties on an existing relationship.

**Input Schema**: Same as createRelationshipTool

**Behavior**: Uses `MERGE` semantics - updates if exists, creates if not

**Output**: `{ success: boolean, message: string }`

## Retrieval Tools

### explore Tool

**File**: `retrieval/explore.tool.ts`

**Purpose**: Semantic search + graph expansion for memory retrieval

**Input Schema**:
```typescript
{
  queries?: Array<{
    query: string,           // Semantic search query
    threshold?: number       // Minimum similarity score (0-1), default 0.5
  }>,
  text_matches?: string[],   // Fuzzy text match for Person/Entity names
  return_explanations?: boolean  // Include debug info in output
}
```

**Process** (from tech.md:167-213):

1. **Gather Phase**:
   - Semantic search: Query Concept/Entity/Source embeddings via cosine similarity
   - Text matching: Fuzzy match Person names, Entity names
   - Normalize scores to 0-1 range

2. **Rerank & Expand Phase**:
   - Calculate salience = connections * recency weight
   - Order by score + salience
   - Take top 5 concepts, 3 entities, 3 persons, 5 sources
   - Fetch edges between hits
   - Fetch edges between hits and user node
   - Fetch edges to neighbors (1-hop)
   - Return top 10 edges sorted by relevance/date

**Output Schema**:
```typescript
{
  nodes: Array<{
    entity_key: string,
    node_type: string,
    // ... node properties
  }>,
  edges: Array<{
    from_entity_key: string,
    to_entity_key: string,
    relationship_type: string,
    properties: Record<string, unknown>
  }>,
  neighbors: Array<{
    entity_key: string,
    node_type: string,
    name?: string,
    // ... limited properties
  }>,
  explanations?: {
    vector_search_hits: number,
    text_match_hits: number,
    total_unique_hits: number,
    top_concepts: number,
    top_entities: number,
    top_persons: number,
    top_sources: number
  }
}
```

**Service**: Uses `retrievalService.ts` for implementation

**Note**: Requires `userId` context, so tool is created dynamically:
```typescript
const exploreTool = createExploreTool(userId);
```

**Example**:
```json
{
  "queries": [
    {"query": "career planning and job search", "threshold": 0.6}
  ],
  "text_matches": ["Sarah", "Anthropic"],
  "return_explanations": true
}
```

### traverse Tool

**File**: `retrieval/traverse.tool.ts`

**Purpose**: Execute arbitrary Cypher queries for complex graph traversals

**Input Schema**:
```typescript
{
  cypher: string,      // Cypher query to execute
  verbose?: boolean    // If false, truncate content fields (default: false)
}
```

**Security**:
- Tool is created via factory function `createTraverseTool(userId)` to bind user context
- Validates all queries include `user_id` constraint to prevent cross-user data access
- Automatically injects `$user_id` parameter into query execution
- Rejects queries without `user_id:`, `user_id =`, or `user_id=` in the Cypher

**Note**: Requires `userId` context, so tool is created dynamically:
```typescript
const traverseTool = createTraverseTool(userId);
```

**Output Schema**:
```typescript
{
  results: Record<string, unknown>[]   // Array of query result records
}
```

**Truncation**: If `verbose: false`, content/notes/description fields limited to 200 chars

**Example**:
```json
{
  "cypher": "MATCH (p:Person {user_id: $user_id}) WHERE p.canonical_name = 'john doe' RETURN p.canonical_name, p.situation LIMIT 5",
  "verbose": false
}
```

**Security Error Example**:
```json
// Query without user_id constraint returns error
{
  "cypher": "MATCH (p:Person) RETURN p",
  "verbose": false
}
// Returns: {"error": "Security: Cypher queries must include user_id constraint to prevent cross-user data access", "example": "MATCH (p:Person {user_id: $user_id}) RETURN p"}
```

## Conversation Tools

### write Tool

**File**: `write.tool.ts`

**Purpose**: Send conversational response to user

**Input Schema**:
```typescript
{
  content: string  // Message to send to user
}
```

**Output**: `{ success: boolean, message: string }`

**Usage**: Conversation agent calls this to respond to user input

### completeOnboarding Tool

**File**: `completeOnboarding.tool.ts`

**Purpose**: Mark user's onboarding as complete

**Input Schema**:
```typescript
{
  user_id: string  // User to mark as onboarded
}
```

**Output**: `{ success: boolean, message: string }`

**Side Effect**: Updates PostgreSQL `user` table: `onboarding_completed_at = NOW()`

## Tool Validation

All tools use Zod schemas for input validation:

1. **Node Tools**: Validate against `PersonNodeSchema`, `ConceptNodeSchema`, `EntityNodeSchema` from `schemas/ingestion.ts`
2. **Relationship Tools**: Validate properties against type-specific schemas (8 relationship property schemas)
3. **Retrieval Tools**: Validate query structure and parameters

**Validation Errors**: Thrown as `ZodError` with detailed field errors, visible to agent for retry

## Error Handling

**Neo4j Errors**:
- Connection errors → thrown, agent sees error message
- Cypher syntax errors → thrown with query context
- Constraint violations → thrown with entity_key

**Validation Errors**:
- Missing required fields → ZodError with field list
- Invalid types → ZodError with type mismatch details
- Invalid relationship type → Error with supported types list

**Agent Retry Strategy**: Agent receives error message in tool result and can retry with corrected input

## Performance

**Node Tools**: ~50-100ms per call (Cypher MERGE + property updates)

**Relationship Tools**: ~30-80ms per call (Cypher MERGE relationship)

**Explore Tool**: ~200-500ms (vector search + graph expansion)

**Traverse Tool**: ~50-200ms (depends on query complexity)

**Bottleneck**: Explore tool (vector search) - consider caching frequent queries

## Adding New Tools

To add a new tool:

1. **Create tool file**: `tools/[category]/[name].tool.ts`
   ```typescript
   import { tool } from '@langchain/core/tools';
   import { z } from 'zod';

   const InputSchema = z.object({
     // ... input fields
   });

   export const myNewTool = tool(
     async (input) => {
       // Tool implementation
       return { result: '...' };
     },
     {
       name: 'my_new_tool',
       description: 'Clear description for LLM',
       schema: InputSchema,
     }
   );
   ```

2. **Add to registry**: `tools/registry.ts`
   ```typescript
   import { myNewTool } from './[category]/[name].tool.js';

   export const ingestionTools = [
     // ... existing tools
     myNewTool,
   ];
   ```

3. **Update prompts**: Mention new tool in relevant system prompts

4. **Document**: Add to this file with input/output schemas and examples

## Testing Tools

**Unit Tests** (with mock Neo4j):
```typescript
describe('createPersonTool', () => {
  it('creates person node with valid input', async () => {
    const result = await createPersonTool.invoke({
      user_id: 'test_user',
      canonical_name: 'john doe',
      last_update_source: 'test_conv',
      confidence: 0.95,
      name: 'John',
    });
    expect(result.entity_key).toMatch(/^person_/);
  });
});
```

**Integration Tests** (with real Neo4j):
```typescript
describe('explore tool', () => {
  it('returns relevant nodes for semantic query', async () => {
    const exploreTool = createExploreTool('test_user');
    const result = await exploreTool.invoke({
      queries: [{ query: 'career planning', threshold: 0.6 }],
    });
    expect(result.nodes.length).toBeGreaterThan(0);
  });
});
```

**Manual Testing** (Neo4j Browser):
```cypher
// Verify node creation
MATCH (p:Person {entity_key: "person_abc123"})
RETURN p

// Verify relationship creation
MATCH (p:Person)-[r:thinks_about]->(c:Concept)
RETURN p.canonical_name, type(r), r.mood, c.name

// Verify provenance tracking
MATCH (n)
WHERE n.last_update_source = "conv_123"
RETURN labels(n), n.entity_key, n.confidence
```

## See Also

- `../CLAUDE.md` - Ingestion agent architecture and workflow
- `../schemas/ingestion.ts` - Zod validation schemas for all tools
- `/Users/silasrhyneer/Code/Cosmo/Saturn/tech.md` - Graph schema specification (lines 5-118)
- `/Users/silasrhyneer/Code/Cosmo/Saturn/backend/INGESTION_REFACTOR_PLAN.md` - Implementation plan (Phase 2)
