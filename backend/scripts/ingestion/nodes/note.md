# Note Node

> **Related Documentation**:
> - [../architecture.md](../architecture.md) - Overall memory architecture
> - [../relationships.md](../relationships.md) - Note relationships
> - [../agent-tools.md](../agent-tools.md) - add_note tool implementation

## Overview

Note nodes represent contextual annotations and observations about semantic entities (Person, Concept, Entity). Notes are **always user-scoped** and attached to parent entities via `HAS_NOTE` relationships, enabling filtering by author, source, date, and automatic expiration.

## Properties

### Identity Properties

- **note_id**: string (UUID - stable, immutable identifier)
- **user_id**: string (always set - identifies which user this Note belongs to, inherited from parent entity)

### Content Properties

- **content**: string - the note text
- **added_by**: string - user_id of who created this note (enables filtering by author in team scenarios)
- **added_at**: datetime - when the note was created
- **expires_at**: datetime | null - optional TTL for time-sensitive notes (null = never expires)

### Timestamps

- **created_at**: datetime - when note was first created
- **updated_at**: datetime - last modification timestamp

## Relationships

Note nodes connect to semantic nodes and sources via directed relationships:

- `(Person|Concept|Entity)-[:HAS_NOTE]->(Note)` - Parent entity owns this note
- `(Note)-[:ADDED_IN]->(Source)` - Which conversation/source created this note (provenance tracking)

## Database Constraints

```cypher
// Note: note_id must be globally unique
CREATE CONSTRAINT note_note_id_unique IF NOT EXISTS
FOR (n:Note) REQUIRE (n.note_id) IS UNIQUE;
```

**Purpose**: Ensures stable identity for note nodes across the graph.

## Lifecycle

### Creation

Notes are created via `add_note` tools during:
1. Memory extraction pipeline (agent adds contextual observations)
2. User-initiated note addition (manual annotations)

**Process**:
1. Create Note node with UUID `note_id`
2. Set `user_id` from parent entity
3. Set `added_by` from current user/agent context
4. Set `added_at` to current timestamp
5. Set `expires_at` based on lifetime parameter
6. Create `HAS_NOTE` relationship from parent entity
7. Create `ADDED_IN` relationship to current Source (if applicable)

### Expiration

Notes with `expires_at` set are automatically excluded from queries:

```cypher
// Fetch active notes only
MATCH (p:Person)-[:HAS_NOTE]->(n:Note)
WHERE n.expires_at IS NULL OR n.expires_at > datetime()
RETURN n.content, n.added_by, n.added_at
ORDER BY n.added_at DESC
```

**Cleanup**: Expired notes can be deleted by periodic garbage collection jobs.

### Deletion

Notes are deleted when:
1. Parent entity is deleted (cascading deletion via relationship)
2. Note expires and garbage collection runs
3. User explicitly deletes the note

## Query Patterns

### Fetch All Active Notes for Entity

```cypher
MATCH (e:Entity {entity_key: $entityKey})-[:HAS_NOTE]->(n:Note)
WHERE n.expires_at IS NULL OR n.expires_at > datetime()
RETURN n.content, n.added_by, n.added_at
ORDER BY n.added_at DESC
```

### Filter Notes by Author

```cypher
MATCH (p:Person {entity_key: $personKey})-[:HAS_NOTE]->(n:Note)
WHERE n.added_by = $authorUserId
  AND (n.expires_at IS NULL OR n.expires_at > datetime())
RETURN n.content, n.added_at
```

### Filter Notes by Recency

```cypher
MATCH (c:Concept {entity_key: $conceptKey})-[:HAS_NOTE]->(n:Note)
WHERE n.added_at > datetime() - duration('P30D')
  AND (n.expires_at IS NULL OR n.expires_at > datetime())
RETURN n.content, n.added_by, n.added_at
ORDER BY n.added_at DESC
```

### Find Originating Conversation

```cypher
MATCH (p:Person {entity_key: $personKey})-[:HAS_NOTE]->(n:Note)-[:ADDED_IN]->(s:Source)
WHERE n.note_id = $noteId
RETURN s.entity_key, s.source_type, s.created_at
```

## Migration from Array-Based Notes

Prior to this schema, notes were stored as `notes: string[]` on semantic nodes. Migration process:

1. For each node with `notes` array:
   - Create Note node for each string in array
   - Set `added_at = node.created_at`
   - Set `added_by = node.owner_id` (or `node.user_id` if owner_id unavailable)
   - Set `expires_at = null` (legacy notes never expire)
   - Create `HAS_NOTE` relationship
   - **Skip** `ADDED_IN` relationship (no source provenance for legacy notes)

2. Delete `notes` property from all nodes

3. Update all queries touching notes to use relationship traversal

## Benefits

- **Authorship Tracking**: Know who added each note (critical for teams)
- **Provenance**: Trace notes back to originating conversation
- **Temporal Filtering**: Query recent notes, filter by date ranges
- **TTL Support**: Notes can expire automatically (e.g., temporary context)
- **Scalability**: Notes don't bloat entity property storage

## Costs

- **Storage**: More nodes (10x increase for note-heavy entities)
- **Query Complexity**: All queries need relationship traversal
- **Migration Effort**: Update repositories, tools, API responses

## See Also

- [person.md](./person.md) - Person node schema
- [concept.md](./concept.md) - Concept node schema
- [entity.md](./entity.md) - Entity node schema
- [../relationships.md](../relationships.md) - All relationship types
- [../agent-tools.md](../agent-tools.md) - add_note tool reference
