# Repository Updates Summary

## Completed Updates

### ✅ types/graph.ts
- Added `question_preferences` to User interface (probe, reflect, reframe, contrast, hypothetical)
- Updated Conversation summary comment to specify ~100 words
- Added provenance fields to Person, Project, Topic, Idea: `entity_key`, `canonical_name`, `last_update_source`, `confidence`, `excerpt_span`
- Added array bounds comments (MAX 10 for personality_traits, MAX 8-10 for various arrays)
- Marked Pattern and Value interfaces with "NOT IN MVP" notes
- Added provenance fields to Pattern and Value
- Updated Note tags comment to specify MAX 15 items
- Created new Alias interface for entity resolution

### ✅ PersonRepository.ts
- Updated `upsert()` to require: `entity_key`, `canonical_name`, `last_update_source`, `confidence`, `excerpt_span`
- Changed MERGE to use `entity_key` instead of `id` for idempotency
- Implemented array bounding for `personality_traits` (MAX 10 items) using Cypher CASE statement
- Added methods:
  - `findByEntityKey(entityKey: string)` - for idempotent lookups
  - `findByCanonicalName(canonicalName: string)` - for name matching
- Updated `searchByName()` to also search by canonical_name

### ✅ ProjectRepository.ts
- Updated `upsert()` to require provenance fields
- Changed MERGE to use `entity_key` for idempotency
- Implemented array bounding:
  - `blockers`: MAX 8 items
  - `key_decisions`: MAX 10 items
- Sets `canonical_name` on create and update

### ✅ AliasRepository.ts (NEW FILE)
Created complete repository for alias management:
- `createAlias(alias, entityId, entityType)` - link name variant to entity
- `findEntityByAlias(alias, entityType)` - resolve alias to entity ID
- `getEntityAliases(entityId, entityType)` - get all aliases for entity
- `deleteAlias(alias, entityType)` - remove alias
- `mergeEntityAliases(sourceId, targetId, entityType)` - merge duplicate entities

---

## Remaining Updates Needed

### 🔨 IdeaRepository.ts
**Required changes:**
1. Add to `upsert()` signature: `entity_key`, `canonical_name`, `last_update_source`, `confidence`, `excerpt_span`
2. Change `MERGE (i:Idea {id: $id})` → `MERGE (i:Idea {entity_key: $entity_key})`
3. Add `canonical_name` to ON CREATE and ON MATCH
4. Add provenance fields to ON CREATE and ON MATCH
5. Implement array bounding in ON MATCH:
   ```cypher
   obstacles = CASE WHEN $obstacles IS NOT NULL THEN (i.obstacles[0..7] + $obstacles)[0..7] ELSE i.obstacles END,
   resources_needed = CASE WHEN $resources_needed IS NOT NULL THEN (i.resources_needed[0..9] + $resources_needed)[0..9] ELSE i.resources_needed END,
   experiments_tried = CASE WHEN $experiments_tried IS NOT NULL THEN (i.experiments_tried[0..9] + $experiments_tried)[0..9] ELSE i.experiments_tried END,
   next_steps = CASE WHEN $next_steps IS NOT NULL THEN (i.next_steps[0..7] + $next_steps)[0..7] ELSE i.next_steps END
   ```
6. Add params for new fields to query execution
7. Add methods: `findByEntityKey()`, `findByCanonicalName()`

### 🔨 TopicRepository.ts
**Required changes:**
1. Add to `upsert()` signature: `entity_key`, `canonical_name`, `last_update_source`, `confidence`, `excerpt_span`
2. Change `MERGE (t:Topic {id: $id})` → `MERGE (t:Topic {entity_key: $entity_key})`
3. Add `canonical_name` to ON CREATE and ON MATCH
4. Add provenance fields to ON CREATE and ON MATCH
5. Add params for new fields to query execution
6. Update `searchByName()` to also search `canonical_name`
7. Add methods: `findByEntityKey()`, `findByCanonicalName()`

### 🔨 UserRepository.ts
**Required changes:**
1. Add `question_preferences` to `upsert()` signature (optional field)
2. Add to ON CREATE and ON MATCH:
   ```cypher
   u.question_preferences = $question_preferences
   ```
3. Add param to query execution:
   ```typescript
   question_preferences: user.question_preferences !== undefined ? user.question_preferences : null
   ```
4. Add method:
   ```typescript
   async updateQuestionPreferences(userId: string, preferences: {
     probe: number;
     reflect: number;
     reframe: number;
     contrast: number;
     hypothetical: number;
   }): Promise<void> {
     const query = `
       MATCH (u:User {id: $userId})
       SET u.question_preferences = $preferences
     `;
     await neo4jService.executeQuery(query, { userId, preferences });
   }
   ```

### 🔨 PatternRepository.ts
**Required changes (mark as NOT IN MVP):**
1. Add comment at top of class:
   ```typescript
   /**
    * NOTE: Pattern detection not in MVP - schema reserved for future use
    * This repository is available but pattern detection features are not
    * part of the current MVP implementation.
    */
   ```
2. Add to `upsert()` signature: `entity_key`, `last_update_source`
3. Change `MERGE (p:Pattern {id: $id})` → `MERGE (p:Pattern {entity_key: $entity_key})`
4. Add `last_update_source` to ON CREATE and ON MATCH
5. Add params for new fields

### 🔨 ValueRepository.ts
**Required changes (mark as NOT IN MVP):**
1. Add comment at top of class:
   ```typescript
   /**
    * NOTE: Not actively used in MVP - schema reserved for future use
    * This repository is available but value tracking features are not
    * part of the current MVP implementation.
    */
   ```
2. Add to `upsert()` signature: `entity_key`, `last_update_source`
3. Change `MERGE (v:Value {id: $id})` → `MERGE (v:Value {entity_key: $entity_key})`
4. Add `last_update_source` to ON CREATE and ON MATCH
5. Add params for new fields

### 🔨 NoteRepository.ts
**Required changes:**
1. Add array bounding to `upsert()` ON MATCH:
   ```cypher
   n.tags = CASE
     WHEN $tags IS NOT NULL
     THEN (n.tags[0..14] + $tags)[0..14]
     ELSE n.tags
   END
   ```
2. Add comment to class:
   ```typescript
   /**
    * NOTE: tags array is bounded to MAX 15 items to prevent unbounded growth
    */
   ```

---

## Implementation Pattern

For all remaining repositories, follow this pattern:

### 1. Update upsert() signature
```typescript
async upsert(
  entity: Partial<EntityType> & {
    id: string;
    entity_key: string;
    name: string; // or summary for Idea
    canonical_name: string;
    last_update_source: string;
    confidence: number;
    excerpt_span: string;
  }
): Promise<EntityType>
```

### 2. Change MERGE clause
```cypher
MERGE (e:Entity {entity_key: $entity_key})
ON CREATE SET
  e.id = $id,
  e.name = $name,
  e.canonical_name = $canonical_name,
  e.first_mentioned_at = datetime(),
  e.last_mentioned_at = datetime(),
  e.last_update_source = $last_update_source,
  e.confidence = $confidence,
  e.excerpt_span = $excerpt_span,
  ... other fields
ON MATCH SET
  e.name = $name,
  e.canonical_name = $canonical_name,
  e.last_mentioned_at = datetime(),
  e.last_update_source = $last_update_source,
  e.confidence = $confidence,
  e.excerpt_span = $excerpt_span,
  ... other fields with array bounding
```

### 3. Implement array bounding
```cypher
e.array_field = CASE
  WHEN $array_field IS NOT NULL
  THEN (e.array_field[0..MAX-1] + $array_field)[0..MAX-1]
  ELSE e.array_field
END
```

### 4. Add lookup methods
```typescript
async findByEntityKey(entityKey: string): Promise<EntityType | null>
async findByCanonicalName(canonicalName: string): Promise<EntityType | null>
```

---

## Neo4j Indexes to Create

Run these Cypher commands to optimize queries:

```cypher
// Entity key indexes (critical for idempotency)
CREATE INDEX entity_key_person IF NOT EXISTS FOR (p:Person) ON (p.entity_key);
CREATE INDEX entity_key_project IF NOT EXISTS FOR (p:Project) ON (p.entity_key);
CREATE INDEX entity_key_topic IF NOT EXISTS FOR (t:Topic) ON (t.entity_key);
CREATE INDEX entity_key_idea IF NOT EXISTS FOR (i:Idea) ON (i.entity_key);

// Canonical name indexes (for name matching)
CREATE INDEX person_canonical_name IF NOT EXISTS FOR (p:Person) ON (p.canonical_name);
CREATE INDEX project_canonical_name IF NOT EXISTS FOR (p:Project) ON (p.canonical_name);
CREATE INDEX topic_canonical_name IF NOT EXISTS FOR (t:Topic) ON (t.canonical_name);

// Alias indexes
CREATE INDEX alias_normalized_name IF NOT EXISTS FOR (a:Alias) ON (a.normalized_name);
CREATE INDEX alias_type IF NOT EXISTS FOR (a:Alias) ON (a.type);

// Existing indexes (should already exist)
CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name);
CREATE INDEX project_name IF NOT EXISTS FOR (p:Project) ON (p.name);
CREATE INDEX topic_name IF NOT EXISTS FOR (t:Topic) ON (t.name);
```

---

## Testing Checklist

After completing all updates:

- [ ] Verify all upsert methods accept new required fields
- [ ] Test entity_key idempotency (running upsert twice with same entity_key shouldn't duplicate)
- [ ] Test canonical_name matching
- [ ] Test array bounding (ensure arrays don't exceed MAX limits)
- [ ] Test alias creation and resolution
- [ ] Test findByEntityKey and findByCanonicalName methods
- [ ] Verify provenance fields are stored correctly
- [ ] Test User.question_preferences updates
- [ ] Run type-check: `npm run type-check`
- [ ] Create indexes in Neo4j database
