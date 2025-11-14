# Relationship Schema and Properties - Current State Investigation

**Investigation Date**: 2025-01-XX  
**Status**: Documentation  
**Purpose**: Document complete current relationship schema including all embedding fields for unified embedding refactor

## Executive Summary

This document catalogs the complete current relationship schema, focusing on embedding-related properties. Semantic relationships have **three embedding fields**:
1. `relation_embedding` - Generated from relationship_type + attitude/proximity word mappings
2. `notes_embedding` - Generated from concatenated notes (max 1000 chars)
3. `description_embedding` - Generated from description field

All semantic relationships (Person↔Person, Person↔Concept, Person↔Entity, Concept↔Concept, Concept↔Entity, Entity↔Entity) share the same standardized property schema.

## Schema Sources

### Primary Documentation
- **`scripts/ingestion/relationships.md:14-40`** - Complete shared properties list (source of truth)
- **`scripts/ingestion/agent-tools.md:126-304`** - Tool signatures and embedding generation strategy
- **`scripts/ingestion/relationships.md:126-128`** - Word mappings reference

### Validation Schemas
- **`src/agents/schemas/ingestion.ts:192-224`** - Zod `SemanticRelationshipSchema` for validation
- **`src/agents/schemas/ingestion.ts:258-284`** - `RelationshipToolInputSchema` for tool inputs

### TypeScript Types
- **`src/types/graph.ts:271-402`** - `RelationshipProperties` interface (legacy, for old relationship types)
- **Note**: No dedicated TypeScript interface exists for semantic relationship properties. Properties are inferred from Zod schemas and tool implementations.

### Implementation
- **`src/agents/tools/relationships/relationship.tool.ts`** - `create_relationship` and `add_note_to_relationship` tools
- **`src/agents/tools/ingestion/generic.tool.ts:510-648`** - `update_relationship` tool
- **`src/utils/relationshipSemantics.ts`** - Word mappings and embedding text generation

## Complete Relationship Schema

### Shared Properties (All Semantic Relationships)

All semantic relationships share these standardized properties:

#### Core Properties
- **`user_id`**: string (required) - Identifies which user this relationship belongs to
- **`description`**: string - 1 sentence overview of the relationship nature
- **`relationship_type`**: string - Flexible one-word descriptor chosen by agent (e.g., "friend", "colleague", "sibling", "uses", "studies", "located-at", "part-of")
- **`attitude`**: int (1-5) - Sentiment/valence of this relationship (1=negative, 3=neutral, 5=positive). Semantics vary by relationship type.
- **`proximity`**: int (1-5) - Depth of connection/knowledge (1=distant/unfamiliar, 5=close/intimate). Semantics vary by relationship type.
- **`confidence`**: float (0-1) - Confidence in this relationship

#### Embedding Fields

**`relation_embedding`**: vector
- **Source**: Generated from `relationship_type + attitude_word + proximity_word`
- **Generation**: On relationship creation and when `relationship_type`, `attitude`, or `proximity` change
- **Example**: For Person→Person with type="friend", attitude=5, proximity=5:
  - Text: `"friend close intimate-knowledge"`
  - Embedding: `embed_small("friend close intimate-knowledge")`
- **Purpose**: Enables semantic relationship search (e.g., "show me close friendly relationships")
- **Location**: `src/agents/tools/relationships/relationship.tool.ts:124-126`
- **Regeneration**: `src/agents/tools/ingestion/generic.tool.ts:580-592`

**`notes_embedding`**: vector
- **Source**: Concatenated `notes[].content` (max 1000 chars)
- **Generation**: When notes are added via `add_note_to_relationship` tool
- **Example**: If notes = `["Helped with interview prep", "Mentor from college"]`:
  - Text: `"Helped with interview prep Mentor from college"` (truncated to 1000 chars)
  - Embedding: `embed_small(notes_text)`
- **Purpose**: Enables semantic note search within relationships
- **Location**: `src/agents/tools/relationships/relationship.tool.ts:290-308`
- **Initial Value**: Empty array `[]` on relationship creation

**`description_embedding`**: vector
- **Source**: Generated from `description` field alone
- **Generation**: On relationship creation and when `description` field changes
- **Example**: If description = `"User's close friend from college, they talk weekly"`:
  - Embedding: `embed_small("User's close friend from college, they talk weekly")`
- **Purpose**: Enables semantic description search (e.g., "Find mentor relationships")
- **Location**: `src/agents/tools/relationships/relationship.tool.ts:128-131` (creation), `src/agents/tools/ingestion/generic.tool.ts:594-603` (update)
- **Empty Handling**: If description is empty or null, set to empty array `[]`

#### Notes Array
- **`notes`**: array of objects with structure:
  ```typescript
  {
    content: string,
    added_by: string,           // User ID who added the note (authorship tracking)
    date_added: ISO timestamp,
    source_entity_key: string | null,  // Entity key of Source this note was derived from (provenance)
    expires_at: ISO timestamp | null   // Expiration date (null for permanent notes)
  }
  ```
- **`is_dirty`**: boolean - Set to true when notes are added, triggers nightly description regeneration

#### Lifecycle Properties
- **`state`**: enum (candidate | active | core | archived) - Relationship lifecycle state
- **`salience`**: float (0-1) - Relationship importance, boosted on access, decays over time
- **`recall_frequency`**: int - Number of times retrieved (for spacing effect calculation)
- **`last_recall_interval`**: int - Days between last two recalls
- **`decay_gradient`**: float (default 1.0) - Increases with spacing effect for slower forgetting
- **`access_count`**: int
- **`last_accessed_at`**: ISO timestamp | null

#### Bi-Temporal Tracking
- **`recorded_by`**: string - User ID who recorded this relationship
- **`valid_from`**: ISO timestamp - When this relationship became true in the real world
- **`valid_to`**: ISO timestamp | null - When invalidated (null if currently valid)
- **`recorded_at`**: ISO timestamp - When system learned this relationship

#### Timestamps
- **`created_at`**: ISO timestamp
- **`updated_at`**: ISO timestamp

### Relationship Scoping

**Critical Constraint**: `user_id` must equal both connected nodes' `user_ids`
- When creating relationships: `rel.user_id = from.user_id` and assert `from.user_id = to.user_id`
- Enables simple query guards: Filter relationships with `WHERE rel.user_id = $userId`
- Rationale: Since all semantic nodes are user-scoped, relationships between them are also user-scoped

## Relationship Types

### Semantic Knowledge Relationships

All semantic relationships use the same property schema. The relationship type is determined by the node types being connected:

| From Node | To Node | Cypher Relationship Type | Attitude Semantics | Proximity Semantics |
|-----------|---------|-------------------------|-------------------|---------------------|
| Person | Person | `has_relationship_with` | 1=hostile → 5=close | 1=stranger → 5=intimate-knowledge |
| Person | Concept | `engages_with` | 1=dislikes → 5=passionate | 1=unfamiliar → 5=expert |
| Person | Entity | `associated_with` | 1=negative-view → 5=strongly-positive | 1=distant → 5=deeply-connected |
| Concept | Concept | `relates_to` | 1=contradicts → 5=integral | 1=loosely-related → 5=inseparable |
| Concept | Entity | `involves` | 1=peripheral → 5=central | 1=tangential → 5=essential |
| Entity | Entity | `connected_to` | 1=adversarial → 5=integrated | 1=distantly-connected → 5=tightly-coupled |

**Source**: `scripts/ingestion/relationships.md:49-88`, `scripts/ingestion/agent-tools.md:180-193`

### Episodic Memory Relationships

These relationships (Source→Person, Source→Concept, Source→Entity, Source→Artifact) have **no properties** - they are simple provenance links.

**Source**: `scripts/ingestion/relationships.md:90-104`

### Hierarchical Memory Relationships

These relationships (Storyline→Person/Concept/Entity, Storyline→Source, Macro→Person/Concept/Entity, Macro→Storyline) have **no properties** - they are simple anchor/aggregation links.

**Source**: `scripts/ingestion/relationships.md:106-124`

## Word Mappings

Word mappings convert numeric attitude/proximity scores (1-5) to semantic words for embedding generation.

**Source**: `src/utils/relationshipSemantics.ts:28-59`, `scripts/ingestion/agent-tools.md:255-281`

### Person ↔ Person (`has_relationship_with`)
- **Attitude**: 1=hostile | 2=unfriendly | 3=neutral | 4=friendly | 5=close
- **Proximity**: 1=stranger | 2=acquaintance | 3=familiar | 4=known-well | 5=intimate-knowledge

### Person ↔ Concept (`engages_with`)
- **Attitude**: 1=dislikes | 2=skeptical | 3=neutral | 4=interested | 5=passionate
- **Proximity**: 1=unfamiliar | 2=aware | 3=understands | 4=experienced | 5=expert

### Person ↔ Entity (`associated_with`)
- **Attitude**: 1=negative-view | 2=unfavorable | 3=neutral | 4=favorable | 5=strongly-positive
- **Proximity**: 1=distant | 2=aware-of | 3=familiar-with | 4=involved-with | 5=deeply-connected

### Concept ↔ Concept (`relates_to`)
- **Attitude**: 1=contradicts | 2=conflicts | 3=independent | 4=complementary | 5=integral
- **Proximity**: 1=loosely-related | 2=somewhat-related | 3=related | 4=closely-related | 5=inseparable

### Concept ↔ Entity (`involves`)
- **Attitude**: 1=peripheral | 2=minor | 3=relevant | 4=important | 5=central
- **Proximity**: 1=tangential | 2=mentioned | 3=involved | 4=key-component | 5=essential

### Entity ↔ Entity (`connected_to`)
- **Attitude**: 1=adversarial | 2=competing | 3=independent | 4=cooperative | 5=integrated
- **Proximity**: 1=distantly-connected | 2=indirectly-connected | 3=connected | 4=closely-linked | 5=tightly-coupled

## Zod Schema Definitions

### SemanticRelationshipSchema

**Location**: `src/agents/schemas/ingestion.ts:192-224`

```typescript
export const SemanticRelationshipSchema = z.object({
  relationship_type: z.string().optional()
    .describe('Flexible one-word descriptor (e.g., "friend", "colleague", "sibling", "uses", "studies", "works-at", "part-of")'),
  description: z.string().optional()
    .describe('1 sentence overview of the relationship nature'),
  attitude: z.number().int().min(1).max(5).optional()
    .describe('Sentiment/valence (1=negative, 3=neutral, 5=positive). Semantics vary by relationship type - see Word Mappings in agent-tools.md'),
  proximity: z.number().int().min(1).max(5).optional()
    .describe('Depth of connection/knowledge (1=distant/unfamiliar, 5=close/intimate). Semantics vary by relationship type - see Word Mappings'),
  confidence: z.number().min(0).max(1).optional()
    .describe('Confidence in this relationship (0-1), defaults to 0.8'),
});
```

**Key Points**:
- All fields are optional (for updates)
- `attitude` and `proximity` are validated as integers 1-5
- `confidence` defaults to 0.8 if not provided
- **Embedding fields are NOT in Zod schema** - they are generated automatically by tools

### RelationshipToolInputSchema

**Location**: `src/agents/schemas/ingestion.ts:258-284`

```typescript
export const RelationshipToolInputSchema = z.object({
  from_entity_key: z.string().describe('Entity key of source node'),
  to_entity_key: z.string().describe('Entity key of target node'),
  relationship_type: z.enum([
    'engages_with',
    'has_relationship_with',
    'relates_to',
    'involves',
    'produced',
    'mentions',
    'sourced_from',
  ]).describe('Relationship type - must match allowed types'),
  properties: z.union([
    PersonThinksAboutConceptSchema,
    PersonHasRelationshipWithPersonSchema,
    // ... (all aliased to SemanticRelationshipSchema)
  ]).describe('Relationship properties - validated based on relationship_type'),
});
```

**Note**: All relationship property schemas are aliased to `SemanticRelationshipSchema` (lines 230-237).

## TypeScript Type Definitions

### RelationshipProperties Interface

**Location**: `src/types/graph.ts:271-402`

**Status**: **Legacy** - This interface defines properties for old relationship types (HAD_CONVERSATION, KNOWS, WORKING_ON, etc.) that are NOT used by semantic relationships.

**Current Semantic Relationships**: No dedicated TypeScript interface exists. Types are inferred from:
- Zod schemas (`SemanticRelationshipSchema`)
- Tool implementations
- Neo4j query results

**Recommendation**: Create a new interface for semantic relationship properties if needed for type safety.

## Embedding Generation Implementation

### Creation Flow

**Location**: `src/agents/tools/relationships/relationship.tool.ts:69-212`

1. **Determine Cypher relationship type** (lines 74-95)
   - Based on node labels (Person, Concept, Entity)
   - Maps to one of: `has_relationship_with`, `engages_with`, `associated_with`, `relates_to`, `involves`, `connected_to`

2. **Get attitude/proximity words** (lines 98-102)
   - Calls `getAttitudeProximityWords(cypherRelType, attitude, proximity)`
   - Returns semantic words from `WORD_MAPPINGS`

3. **Generate relation_embedding** (lines 124-126)
   ```typescript
   const relationText = `${relationship_type} ${attitudeWord} ${proximityWord}`;
   const relationEmbedding = await generateEmbedding(relationText);
   ```

4. **Generate description_embedding** (lines 128-131)
   ```typescript
   const descriptionEmbedding = description && description.length > 0 
     ? await generateEmbedding(description) 
     : [];
   ```

5. **Set notes_embedding** (line 146)
   - Initialized as empty array: `r.notes_embedding = []`

6. **Create relationship** (lines 134-162)
   - Sets all properties including embeddings
   - Sets defaults: `state = 'candidate'`, `salience = 0.5`, etc.

### Update Flow

**Location**: `src/agents/tools/ingestion/generic.tool.ts:510-648`

1. **Detect relationship type** (lines 516-540)
   - Queries existing relationship to get Cypher type and current values

2. **Check for property changes** (lines 544-551)
   - `propertiesChanged`: If `relationship_type`, `attitude`, or `proximity` changed
   - `descriptionChanged`: If `description` changed

3. **Regenerate relation_embedding** (lines 580-592)
   - Only if `propertiesChanged` is true
   - Uses current or new values for `relationship_type`, `attitude`, `proximity`
   - Generates embedding text: `${finalRelType} ${attitudeWord} ${proximityWord}`

4. **Regenerate description_embedding** (lines 594-603)
   - Only if `descriptionChanged` is true
   - Handles empty descriptions (sets to empty array)

5. **Update relationship** (lines 618-624)
   - Sets updated properties and regenerated embeddings

### Note Addition Flow

**Location**: `src/agents/tools/relationships/relationship.tool.ts:233-331`

1. **Add note to array** (lines 261-273)
   - Appends note object with `content`, `added_by`, `source_entity_key`, `date_added`, `expires_at`
   - Sets `is_dirty = true`

2. **Regenerate notes_embedding** (lines 290-308)
   - Concatenates all note contents: `notes.map(n => n.content).join(' ')`
   - Truncates to max 1000 chars: `.substring(0, 1000)`
   - Generates embedding: `await generateEmbedding(notesText)`
   - Handles empty notes (sets to empty array)

## Embedding Service

**Location**: `src/services/embeddingGenerationService.ts`

**Function**: `generateEmbedding(text: string): Promise<number[]>`
- Uses OpenAI `text-embedding-3-small` model
- Returns vector embedding array
- Used by all relationship embedding generation

**Source**: `src/agents/tools/relationships/relationship.tool.ts:12`, `src/agents/tools/ingestion/generic.tool.ts:11`

## Property Constraints and Validations

### Attitude/Proximity Validation
- **Range**: 1-5 (integers only)
- **Validation**: Zod schema enforces `z.number().int().min(1).max(5)`
- **Semantics**: Vary by relationship type (see Word Mappings)

### Confidence Validation
- **Range**: 0-1 (float)
- **Default**: 0.8 if not provided
- **Validation**: Zod schema enforces `z.number().min(0).max(1)`

### Notes Array Constraints
- **Max length**: No explicit limit in schema (bounded by practical limits)
- **Note content**: String (no length limit specified)
- **Concatenation limit**: Max 1000 chars for `notes_embedding` generation
- **Expiration**: Notes can expire based on `lifetime` parameter (week/month/year/forever)

### Description Constraints
- **Format**: 1 sentence overview
- **Length**: No explicit limit (typically 10-50 words)
- **Empty handling**: If empty/null, `description_embedding = []`

### User Scoping
- **Required**: `user_id` must match both connected nodes' `user_ids`
- **Enforcement**: Tool implementations should validate this constraint

## Discrepancies and Notes

### Missing TypeScript Interface

**Issue**: No dedicated TypeScript interface exists for semantic relationship properties.

**Current State**: 
- `RelationshipProperties` in `src/types/graph.ts` is for legacy relationship types
- Semantic relationships use Zod schemas for validation
- Types inferred from tool implementations

**Impact**: Low - Zod schemas provide runtime validation, but TypeScript types would improve compile-time safety.

### Embedding Field Naming Consistency

**Current**: All embedding fields use `_embedding` suffix:
- `relation_embedding`
- `notes_embedding`
- `description_embedding`

**Consistency**: ✅ Consistent naming pattern

### Empty Array Handling

**Pattern**: All embedding fields use empty array `[]` when:
- `notes_embedding`: No notes exist
- `description_embedding`: Description is empty/null
- `relation_embedding`: Always generated (never empty)

**Consistency**: ✅ Consistent empty array pattern

### Notes Embedding Truncation

**Constraint**: Notes concatenation truncated to 1000 chars for embedding generation.

**Location**: `src/agents/tools/relationships/relationship.tool.ts:292-295`

**Rationale**: Prevents embedding generation from extremely long note concatenations.

## File References Summary

### Schema Documentation
- `scripts/ingestion/relationships.md:14-40` - Complete property list (source of truth)
- `scripts/ingestion/relationships.md:49-88` - Relationship types
- `scripts/ingestion/relationships.md:126-128` - Word mappings reference
- `scripts/ingestion/agent-tools.md:126-304` - Tool signatures and embedding strategy

### Validation Schemas
- `src/agents/schemas/ingestion.ts:192-224` - `SemanticRelationshipSchema`
- `src/agents/schemas/ingestion.ts:258-284` - `RelationshipToolInputSchema`

### TypeScript Types
- `src/types/graph.ts:271-402` - `RelationshipProperties` (legacy, not used for semantic relationships)

### Tool Implementations
- `src/agents/tools/relationships/relationship.tool.ts:69-212` - `create_relationship` tool
- `src/agents/tools/relationships/relationship.tool.ts:233-331` - `add_note_to_relationship` tool
- `src/agents/tools/ingestion/generic.tool.ts:510-648` - `update_relationship` tool

### Utilities
- `src/utils/relationshipSemantics.ts:28-59` - Word mappings
- `src/utils/relationshipSemantics.ts:70-94` - `getAttitudeProximityWords` function

### Services
- `src/services/embeddingGenerationService.ts` - `generateEmbedding` function

### Usage Examples
- `src/services/retrievalService.ts:485-486, 534-535, 609-610` - Embedding fields excluded from API responses

## Summary for Unified Embedding Refactor

### Current Embedding Fields

1. **`relation_embedding`**
   - Source: `relationship_type + attitude_word + proximity_word`
   - Generated: On create, when `relationship_type`/`attitude`/`proximity` change
   - Dimension: Same as other embeddings (from `text-embedding-3-small`)

2. **`notes_embedding`**
   - Source: Concatenated notes (max 1000 chars)
   - Generated: When notes added
   - Dimension: Same as other embeddings

3. **`description_embedding`**
   - Source: `description` field alone
   - Generated: On create, when `description` changes
   - Dimension: Same as other embeddings

### Key Points for Refactor

- All three embeddings use the same embedding model (`text-embedding-3-small`)
- All three embeddings are vectors (number arrays)
- Empty arrays `[]` are used for empty/null cases
- Embeddings are generated automatically by tools (not in Zod schemas)
- No TypeScript interface exists for semantic relationship properties (only Zod schemas)

### Property Count

**Total Properties**: ~25 properties per semantic relationship
- Core: 5 (user_id, description, relationship_type, attitude, proximity, confidence)
- Embeddings: 3 (relation_embedding, notes_embedding, description_embedding)
- Notes: 2 (notes array, is_dirty)
- Lifecycle: 7 (state, salience, recall_frequency, last_recall_interval, decay_gradient, access_count, last_accessed_at)
- Bi-temporal: 3 (recorded_by, valid_from, valid_to, recorded_at)
- Timestamps: 2 (created_at, updated_at)
