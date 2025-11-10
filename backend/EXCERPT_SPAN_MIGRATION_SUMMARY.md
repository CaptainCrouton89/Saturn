# Excerpt Span Migration Summary

## Overview

Moved `excerpt_span` from entity nodes to conversation relationship arrays. This makes the architecture more semantically correct - excerpt spans are conversation-specific, not entity-specific.

## Key Architectural Change

### Before
```typescript
// Entity nodes had excerpt_span
Person {
  last_update_source: string; // conversation_id
  confidence: number;
  excerpt_span: string; // ❌ conversation-specific on entity node
}

// Relationships had scalar metadata
MENTIONED {
  count: number;
  sentiment: number;
  importance_score: number;
}
```

### After
```typescript
// Entity nodes have only last_update_source + confidence
Person {
  last_update_source: string; // conversation_id
  confidence: number;
  // No excerpt_span!
}

// Relationships have timeline arrays (MAX 20 items)
MENTIONED {
  mentions: Array<{
    conversation_id: string;
    timestamp: Date;
  }>;
}

DISCUSSED {
  discussions: Array<{
    conversation_id: string;
    timestamp: Date;
  }>;
}

EXPLORED {
  explorations: Array<{
    conversation_id: string;
    timestamp: Date;
  }>;
}
```

## Benefits

1. **Semantically correct**: Excerpt spans are per-conversation, not per-entity
2. **Full timeline**: See all conversations where entity was mentioned
3. **Provenance tracking**: Query full history: "when was Sarah mentioned?"
4. **Natural fit**: Matches bounded array pattern used throughout schema
5. **Simpler queries**: Look up conversation if you need full context

## Files Modified

### Type Definitions
- ✅ `src/types/graph.ts` - Removed `excerpt_span` from Person, Project, Topic, Idea
- ✅ `src/types/graph.ts` - Updated MENTIONED/DISCUSSED/EXPLORED relationships with arrays

### Services
- ✅ `src/services/entityUpdateService.ts` - Removed `excerpt_span` from EntityUpdate interface
- ✅ `src/services/neo4jTransactionService.ts` - Append to mentions arrays instead of setting scalar properties

### Repositories
- ✅ `src/repositories/PersonRepository.ts` - Removed `excerpt_span` from upsert
- ✅ `src/repositories/ProjectRepository.ts` - Removed `excerpt_span` from upsert
- ✅ `src/repositories/TopicRepository.ts` - Removed `excerpt_span` from upsert
- ✅ `src/repositories/IdeaRepository.ts` - Removed `excerpt_span` from upsert

### Scripts & Data
- ✅ `scripts/reset-neo4j.js` - Removed `excerpt_span` from sample data

### Documentation
- ⏳ `neo4j.md` - Update schema documentation
- ⏳ `CLAUDE.md` - Update provenance section
- ⏳ `docs/transcript-to-neo4j-pipeline.md` - Update if needed

## Query Examples

### Get all mentions of an entity
```cypher
MATCH ()-[m:MENTIONED]->(p:Person {name: "Sarah"})
UNWIND m.mentions AS mention
RETURN mention.conversation_id, mention.timestamp
ORDER BY mention.timestamp DESC
```

### Get most recent mention
```cypher
MATCH ()-[m:MENTIONED]->(p:Person {id: $id})
RETURN m.mentions[-1] AS latest_mention
```

### Count total mentions
```cypher
MATCH ()-[m:MENTIONED]->(p:Person {id: $id})
RETURN size(m.mentions) AS total_mentions
```

## Neo4j Transaction Logic

### Creating MENTIONED relationship (before)
```cypher
MERGE (c)-[r:MENTIONED]->(e)
SET r.count = $count,
    r.sentiment = $sentiment,
    r.importance_score = $importance_score
```

### Creating MENTIONED relationship (after)
```cypher
MERGE (c)-[r:MENTIONED]->(e)
SET r.mentions = (coalesce(r.mentions, []) + [{
  conversation_id: $conversationId,
  timestamp: c.date
}])[0..19]  // Keep last 20 mentions
```

## Migration Notes

1. **No database migration needed** - This is greenfield, no existing data
2. **Bounded arrays**: All mention arrays limited to 20 items (keep most recent)
3. **Timestamp source**: Uses `c.date` from Conversation node
4. **Idempotency**: Safe to run multiple times - appends new mentions

## Next Steps

1. Update `neo4j.md` to document new relationship structure
2. Update `CLAUDE.md` provenance section
3. Test memory extraction pipeline end-to-end
4. Consider adding query helpers for common mention patterns
