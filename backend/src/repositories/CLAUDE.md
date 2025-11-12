# Repositories - Neo4j Data Access Layer

## Pattern Overview

Each repository encapsulates Neo4j queries for one entity type. Repositories handle:
- Entity CRUD operations
- Relationship management (User→Entity, Conversation→Entity)
- Entity resolution (by entity_key, canonical_name, or alias)

## Critical Conventions

**User-Specific Properties on Relationships**: Properties like `mood`, `relationship_type`, `relevance` live on relationships between nodes (e.g., `(Person)-[:thinks_about]->(Concept)`, `(Person)-[:relates_to]->(Entity)`). This allows multiple users to have different relationships with the same entity.

**Entity Key Stability**: `entity_key` = hash(normalized_name + entity_type + user_id). Used for idempotent batch processing. Never change once set.

**Relationship Property Updates**: Use Cypher pattern:
```cypher
MERGE (p:Person {entity_key: $personKey})-[r:thinks_about]->(c:Concept {entity_key: $conceptKey})
SET r.mood = $mood, r.frequency = $frequency, r.updated_at = datetime()
```

**Notes Fields**: Use `notes` string field for unstructured information that doesn't fit elsewhere. On relationships, notes describe the relationship in rich text.

**Provenance Tracking**: Every entity update must set:
- `last_update_source`: conversation_id or source_id
- `confidence`: 0-1 score

**Source Mentions**: Source nodes track entity mentions via simple `(Source)-[:mentions]->(Person|Concept|Entity)` relationships with just an id.

## Exception: SupabaseConversationRepository

This repository uses PostgreSQL (Supabase), not Neo4j. Handles full transcript storage, embeddings, and conversation metadata. All other repositories use Neo4j.
