# Attitude/Proximity Mapping Extraction & Refactoring

**Status**: Planning
**Priority**: High (blocking relationship description embedding and other features)
**Related Files**:
- `src/agents/tools/relationships/relationship.tool.ts:18-77` - Current WORD_MAPPINGS
- `src/agents/tools/relationships/` - All relationship tools
- `src/agents/tools/ingestion/generic.tool.ts` - Uses word mappings
- `src/services/embeddingGenerationService.ts` - Embedding generation

## Executive Summary

Extract the hardcoded `WORD_MAPPINGS` and `getWords()` logic from `relationship.tool.ts` into a reusable, bidirectional utility module. This enables:
1. Bidirectional mapping (number ↔ word)
2. Reuse across tools and services (not just relationship tool)
3. Centralized maintenance of attitude/proximity semantics
4. Type-safe API with proper error handling

## Current State

**Location**: `src/agents/tools/relationships/relationship.tool.ts:18-77`

**Current Structure**:
```typescript
const WORD_MAPPINGS = {
  has_relationship_with: {
    attitude: ['hostile', 'unfriendly', 'neutral', 'friendly', 'close'],
    proximity: ['stranger', 'acquaintance', 'familiar', 'known-well', 'intimate-knowledge'],
  },
  // ... 5 more relationship types
}

function getWords(cypherRelType, attitude, proximity) {
  // One-directional: number → word
  const attitudeWord = mapping.attitude[attitude - 1];
  const proximityWord = mapping.proximity[proximity - 1];
  return { attitudeWord, proximityWord };
}
```

**Limitations**:
- One-directional only (number → word)
- Embedded in tool file (hard to reuse)
- No reverse lookup (word → number)
- No centralized error handling
- No type validation

## Implementation Plan

### Phase 1: Create New Utility Module

**File**: `src/utils/relationshipSemantics.ts`

**Exports**:
```typescript
// Types
export interface AttitudeProximityMapping {
  readonly has_relationship_with: { attitude: string[]; proximity: string[] };
  readonly engages_with: { attitude: string[]; proximity: string[] };
  readonly associated_with: { attitude: string[]; proximity: string[] };
  readonly relates_to: { attitude: string[]; proximity: string[] };
  readonly involves: { attitude: string[]; proximity: string[] };
  readonly connected_to: { attitude: string[]; proximity: string[] };
}

export type CypherRelationshipType = keyof AttitudeProximityMapping;

// Forward mapping: number → word
export function getAttitudeProximityWords(
  cypherRelType: CypherRelationshipType,
  attitude: number,    // 1-5
  proximity: number     // 1-5
): { attitudeWord: string; proximityWord: string }

// Reverse mapping: word → number
export function getAttitudeProximityNumbers(
  cypherRelType: CypherRelationshipType,
  attitudeWord: string,
  proximityWord: string
): { attitude: number; proximity: number }

// Utility: get all valid words for a relationship type
export function getValidWords(
  cypherRelType: CypherRelationshipType
): { attitude: string[]; proximity: string[] }

// Utility: validate attitude/proximity numbers
export function isValidAttitudeProximity(attitude: number, proximity: number): boolean

// Utility: validate words for a relationship type
export function isValidWords(
  cypherRelType: CypherRelationshipType,
  attitudeWord: string,
  proximityWord: string
): boolean

// Export raw mappings for reference
export const WORD_MAPPINGS: AttitudeProximityMapping
```

### Phase 2: Update relationship.tool.ts

**Changes**:
1. Remove hardcoded `WORD_MAPPINGS` (lines 18-49)
2. Remove `getWords()` function (lines 68-77)
3. Add import: `import { getAttitudeProximityWords } from '../../utils/relationshipSemantics.js'`
4. Update call site (line 147-151):
   ```typescript
   // Before
   const { attitudeWord, proximityWord } = getWords(
     cypherRelType as keyof typeof WORD_MAPPINGS,
     attitude,
     proximity
   );

   // After
   const { attitudeWord, proximityWord } = getAttitudeProximityWords(
     cypherRelType,
     attitude,
     proximity
   );
   ```

### Phase 3: Update Other Usage Sites

**Files to update**:
- `src/agents/tools/ingestion/generic.tool.ts` - Update relationship tool (if uses word mappings)
- Any other files that reference WORD_MAPPINGS

### Phase 4: API Design Details

**Bidirectional Mapping Example**:
```typescript
// Forward: number to word
const { attitudeWord, proximityWord } = getAttitudeProximityWords(
  'has_relationship_with',
  4,  // attitude
  5   // proximity
);
// → { attitudeWord: 'friendly', proximityWord: 'intimate-knowledge' }

// Reverse: word to number
const { attitude, proximity } = getAttitudeProximityNumbers(
  'has_relationship_with',
  'friendly',
  'intimate-knowledge'
);
// → { attitude: 4, proximity: 5 }
```

**Error Handling**:
- Invalid relationship type → throw `Error('Unsupported relationship type: ...')`
- Invalid attitude/proximity numbers (not 1-5) → throw `Error('Attitude/proximity must be 1-5')`
- Invalid word for relationship type → throw `Error('Invalid word "..."for relationship type "..."')`
- Case-insensitive word matching (convert input to lowercase, match against words)

### Phase 5: Integration Points

**Current Users**:
- `src/agents/tools/relationships/relationship.tool.ts` - createRelationshipTool (for embedding generation)
- Future: Retrieval service (when relationship description search is implemented)
- Future: Agent reasoning about relationship strength (e.g., "this is a close friendship")

**Future Users**:
- Relationship ranking/filtering by attitude/proximity
- Relationship display in markdown output (use word representations)
- Validation of relationship data from external sources

### Performance Considerations

**Caching**:
- `WORD_MAPPINGS` is a constant, no need for runtime caching
- Reverse lookup (word → number) can be built once on import if needed
- For now, linear search through words array is acceptable (only 5 words per type)

**Memory**:
- Minimal impact (static data)
- Could precompute reverse mapping as index map if performance becomes issue

## Testing Strategy

Create `tests/utils/relationshipSemantics.test.ts`:
1. Forward mapping tests (number → word for all 6 relationship types)
2. Reverse mapping tests (word → number)
3. Error cases (invalid inputs)
4. Case insensitivity for reverse mapping
5. Boundary cases (1, 5)

## Benefits

1. **Reusability**: Any tool/service can map attitude/proximity
2. **Maintainability**: Single source of truth for semantic mappings
3. **Type Safety**: Strong typing with TypeScript
4. **Bidirectionality**: Enable new features (e.g., displaying relationships as "friendly" in UI)
5. **Testability**: Isolated utility with clear API
6. **Future-Proof**: Easy to add new relationship types or attitudes

## Implementation Order

1. Create `src/utils/relationshipSemantics.ts` (Phase 1)
2. Update `relationship.tool.ts` (Phase 2)
3. Check and update any other usage sites (Phase 3)
4. Write tests
5. Run type checks and tests to verify
