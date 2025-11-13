# Agent Context Loading

**See also**: [schema.md](./schema.md) for full memory architecture

This document defines how to construct the agent's working context at conversation start. The goal is to provide the minimal set of information needed for natural, contextually-aware conversation without overwhelming the LLM with irrelevant details.

---

## Context Loading Strategy

At conversation start, load a **layered context** that prioritizes recent activity and core identity while keeping background knowledge accessible:

### 1. Core User Identity

**Purpose**: Stable facts about who the user is

**What to load**:
```cypher
// Get user's owner Person node (is_owner: true)
MATCH (u:Person {user_id: $userId, is_owner: true})
RETURN u

// Get core beliefs/values (Concepts marked as permanent)
MATCH (c:Concept {team_id: $teamId})
WHERE c.state = 'core' AND c.ttl_policy = 'keep_forever'
RETURN c
ORDER BY c.salience DESC
LIMIT 10

// Get active goals (high salience + recent access)
MATCH (g:Concept {team_id: $teamId})
WHERE g.name CONTAINS 'goal' OR g.description CONTAINS 'goal'
  AND g.state IN ['active', 'core']
  AND g.last_accessed_at > datetime() - duration('P7D')
RETURN g
ORDER BY g.salience DESC
LIMIT 5
```

**From PostgreSQL** (Supabase):
```sql
SELECT * FROM user_preferences WHERE user_id = $userId
```

**Structure**:
```typescript
{
  user_id: string
  owner_person_node: PersonNode  // Full node properties
  preferences: UserPreference[]   // From PostgreSQL
  core_beliefs: Concept[]         // Permanent, high-salience concepts
  primary_goals: Concept[]        // Active goals (last week)
}
```

**Cost**: ~50-100 tokens

---

### 2. Personal Network (Relationships to User)

**Purpose**: Who the user cares about and how they relate

**What to load**:
```cypher
// Get top 10 salient nodes WITH their relationship to the user
// Note: We don't care about specific edge labels—just that it represents "user ↔ something they care about"
// We rank by edge salience to prioritize the strongest relationships
MATCH (u:Person {user_id: $userId, is_owner: true})
MATCH (u)-[r:has_relationship_with|thinks_about|relates_to|involves|associated_with|engages_with|connected_to]-(n)
WHERE n.state IN ['active', 'core']
RETURN n, r.description AS relationship_description, type(r) AS relationship_type, labels(n) AS node_type
ORDER BY r.salience DESC, n.salience DESC
LIMIT 10
```

**Key insight**: For each salient node, include the **edge description** which captures *how* the user relates to that entity. The specific relationship type (edge label) doesn't matter for context loading—we're simply gathering the user's most salient connections across all relationship types and ranking by edge salience.

**Examples**:
- Node: `Sarah (Person)` → Edge description: `"Close friend going through divorce"`
- Node: `Google (Entity)` → Edge description: `"User is considering job offer"`
- Node: `AI Safety (Concept)` → Edge description: `"User thinks about daily, wants to work in this field"`

**Structure**:
```typescript
{
  node: PersonNode | ConceptNode | EntityNode
  relationship_description: string  // From relates_to edge
  relationship_salience: float      // From relates_to edge
  node_type: "Person" | "Concept" | "Entity"
  recent_mentions: number           // Count in last week via Source [mentions]
}
```

**Cost**: ~200-400 tokens (depending on description lengths)

---

### 3. Recent Episodic Memory

**Purpose**: What's been happening recently in the user's life

**What to load**:
```cypher
// Get last week of Source nodes (max 20)
MATCH (s:Source {user_id: $userId})
WHERE s.content.type = 'conversation'
  AND s.started_at > datetime() - duration('P7D')
RETURN s.entity_key, s.started_at, s.context_type, s.summary, s.ended_at
ORDER BY s.started_at DESC
LIMIT 20

// For each source, get top mentioned entities
MATCH (s:Source {entity_key: $sourceEntityKey})-[:mentions]->(e)
WHERE e.salience > 0.3  // Only include salient mentions
RETURN e.entity_key, e.name, type(e) as entity_type
ORDER BY e.salience DESC
LIMIT 5
```

**Structure**:
```typescript
{
  sources: Array<{
    entity_key: string
    started_at: timestamp
    ended_at: timestamp | null
    context_type: string           // "work-session", "personal-reflection", etc.
    summary: string                // 1-2 sentence summary
    key_entities: Array<{          // Top 5 mentioned entities
      entity_key: string
      name: string
      type: "Person" | "Concept" | "Entity"
    }>
  }>
}
```

**Cost**: ~500-800 tokens (20 sources × ~30 tokens each)

---

### 4. Temporal Context

**Purpose**: Time-awareness for natural conversation flow

**What to load**:
```cypher
// Get last conversation timestamp
MATCH (s:Source {user_id: $userId})
WHERE s.content.type = 'conversation'
RETURN s.started_at, s.context_type
ORDER BY s.started_at DESC
LIMIT 1
```

**Structure**:
```typescript
{
  time_since_last_conversation: duration  // Computed from last Source.started_at
  current_datetime: {
    day_of_week: string  // "Monday", "Tuesday", etc.
    hour: number         // 0-23
    date: string         // "2025-01-15"
  }
  last_conversation_type: string  // From last Source.context_type
}
```

**Why this matters**:
- "How was your Monday meeting?" only makes sense if it's Tuesday+
- "Good morning" vs "How was your day?" depends on time
- Long gaps (>3 days) require different greeting style

**Cost**: ~20 tokens

---

## Complete Context Structure

```typescript
interface AgentContext {
  // === CORE IDENTITY (always loaded) ===
  user: {
    user_id: string
    owner_person_node: PersonNode
    preferences: UserPreference[]
    core_beliefs: Concept[]        // state: 'core', ttl: 'keep_forever'
    primary_goals: Concept[]       // Active, recent access
  }

  // === PERSONAL NETWORK (always loaded) ===
  relationships: Array<{
    node: PersonNode | ConceptNode | EntityNode
    relationship_description: string  // From relates_to edge
    relationship_salience: float
    node_type: "Person" | "Concept" | "Entity"
    recent_mentions: number
  }>
  // Top 10 by edge salience, includes edge description

  // === RECENT MEMORY (always loaded) ===
  recent_context: {
    sources: Array<{
      entity_key: string
      started_at: timestamp
      ended_at: timestamp | null
      context_type: string
      summary: string
      key_entities: Array<{
        entity_key: string
        name: string
        type: string
      }>
    }>
    // Last week, max 20, sorted by started_at DESC
  }

  // === TEMPORAL AWARENESS (always loaded) ===
  temporal: {
    time_since_last_conversation: duration
    current_datetime: {
      day_of_week: string
      hour: number
      date: string
    }
    last_conversation_type: string
  }

  // === CURRENT CONVERSATION (real-time, not from graph) ===
  current_conversation: {
    conversation_id: string
    messages: Message[]            // Last N turns in THIS session
    started_at: timestamp
  }
}
```

---

## Context Loading Implementation

### At Conversation Start

```typescript
async function loadAgentContext(userId: string, teamId: string): Promise<AgentContext> {
  // Run all queries in parallel for speed
  const [
    ownerNode,
    coreBeliefs,
    primaryGoals,
    preferences,
    relationships,
    recentSources,
    lastConversation
  ] = await Promise.all([
    loadOwnerPersonNode(userId),
    loadCoreBeliefs(teamId),
    loadPrimaryGoals(teamId),
    loadUserPreferences(userId),        // PostgreSQL
    loadTopRelationships(userId),       // Neo4j with edge descriptions
    loadRecentSources(userId),          // Neo4j + mentions
    loadLastConversationInfo(userId)    // Neo4j
  ])

  return {
    user: {
      user_id: userId,
      owner_person_node: ownerNode,
      preferences,
      core_beliefs: coreBeliefs,
      primary_goals: primaryGoals
    },
    relationships,  // Already includes edge descriptions
    recent_context: {
      sources: recentSources
    },
    temporal: computeTemporalContext(lastConversation),
    current_conversation: {
      conversation_id: generateConversationId(),
      messages: [],
      started_at: new Date().toISOString()
    }
  }
}
```

**Total token cost**: ~700-1300 tokens (reasonable for context window)

**Latency target**: <500ms (all queries parallel)

---

## Dynamic Context Expansion

During conversation, use `explore()` and `traverse()` tools to expand context **only when needed**:

### When to Expand

1. **User mentions new entity not in loaded context**
   - Example: "What about Chicago?" → `explore({text_matches: ["Chicago"]})`
   - Loads entity + relationships + mentions

2. **User asks about past event**
   - Example: "Remember that startup idea we talked about?" → `explore({queries: [{query: "startup idea discussion", threshold: 0.8}]})`
   - Searches episodic memory (Sources)

3. **User probes relationship**
   - Example: "How do I feel about Sarah?" → `traverse({mode: "cypher", cypher: "MATCH (u:Person {is_owner: true})-[r:relates_to]-(p:Person {canonical_name: 'sarah'}) RETURN p, r"})`
   - Gets specific relationship edge with properties

### When NOT to Expand

- Generic questions answerable from loaded context
- Casual mentions of entities already loaded
- Questions about user's own preferences/beliefs (already in core identity)

**Goal**: Keep context lean, expand lazily to avoid token bloat.

---

## Cost & Performance Targets

**Context Loading**:
- Total tokens: 700-1300
- Latency: <500ms (parallel queries)
- Database queries: 7 (5 Neo4j, 2 PostgreSQL)

**Dynamic Expansion** (per explore/traverse call):
- Tokens: 200-500 per expansion
- Latency: 100-300ms
- Max expansions per conversation: 3-5

**Monthly cost** (at 1000 conversations/month):
- Context loading: 1M tokens × $0.075/1M = $0.075
- Dynamic expansion: 2M tokens × $0.075/1M = $0.15
- **Total**: ~$0.23/month for context loading

---

## Design Principles

1. **Relationship-centric**: Load entities WITH their relationships to the user, not just entity properties
2. **Recency-biased**: Prioritize last week, but include core permanent knowledge
3. **Salience-aware**: Use salience to rank what matters most
4. **Lazy expansion**: Start lean, expand only when user's question requires it
5. **Time-aware**: Include temporal context for natural conversation flow

---

## Example Context Payload

```json
{
  "user": {
    "user_id": "user-123",
    "owner_person_node": {
      "entity_key": "person-abc",
      "canonical_name": "alex",
      "name": "Alex",
      "description": "Software engineer interested in AI safety",
      "is_owner": true,
      "salience": 1.0
    },
    "preferences": [
      {"key": "conversation_style", "value": "direct"},
      {"key": "time_zone", "value": "America/New_York"}
    ],
    "core_beliefs": [
      {
        "entity_key": "concept-001",
        "name": "work-life balance",
        "description": "User values flexibility and autonomy over high pay"
      }
    ],
    "primary_goals": [
      {
        "entity_key": "concept-002",
        "name": "career transition to AI safety",
        "description": "User is actively preparing for a career shift"
      }
    ]
  },
  "relationships": [
    {
      "node": {
        "entity_key": "person-sarah",
        "name": "Sarah",
        "canonical_name": "sarah",
        "type": "Person"
      },
      "relationship_description": "Close friend and former colleague, going through divorce",
      "relationship_salience": 0.85,
      "node_type": "Person",
      "recent_mentions": 5
    },
    {
      "node": {
        "entity_key": "entity-google",
        "name": "Google",
        "type": "organization",
        "node_type": "Entity"
      },
      "relationship_description": "User is considering job offer, conflicted about accepting",
      "relationship_salience": 0.92,
      "recent_mentions": 8
    }
  ],
  "recent_context": {
    "sources": [
      {
        "entity_key": "source-001",
        "started_at": "2025-01-14T09:30:00Z",
        "ended_at": "2025-01-14T09:45:00Z",
        "context_type": "work-session",
        "summary": "Discussed Google job offer deadline and compensation details",
        "key_entities": [
          {"entity_key": "entity-google", "name": "Google", "type": "Entity"},
          {"entity_key": "concept-salary", "name": "salary negotiation", "type": "Concept"}
        ]
      }
    ]
  },
  "temporal": {
    "time_since_last_conversation": "PT16H",
    "current_datetime": {
      "day_of_week": "Tuesday",
      "hour": 14,
      "date": "2025-01-15"
    },
    "last_conversation_type": "work-session"
  }
}
```

---

## References

- [schema.md](./schema.md) - Full Neo4j schema with node types, relationships, constraints
- [transcript-to-neo4j-pipeline.md](../docs/transcript-to-neo4j-pipeline.md) - How entities are extracted and stored
- `backend/src/services/initService.ts` - Current context loading implementation
- `backend/src/agents/tools/` - explore() and traverse() tool implementations
