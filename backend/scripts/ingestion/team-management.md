# Team Management & Access Control

> **Related Documentation**:
> - [architecture.md](./architecture.md) - Memory architecture overview
> - [nodes/source.md](./nodes/source.md) - Source node (team-scoped)
> - [nodes/](./nodes/) - Semantic nodes (user-scoped)

## Team Structure

**Team Creation**:
```cypher
CREATE (t:Team {
  team_id: randomUUID(),
  name: $teamName,
  created_at: datetime(),
  created_by: $userId,
  settings: $settingsJson
})
```

**Team Membership** (stored in Supabase PostgreSQL):
```sql
CREATE TABLE team_members (
  team_id UUID REFERENCES teams(id),
  user_id UUID REFERENCES users(id),
  role TEXT CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);
```

**Roles**:
- `owner`: Can delete team, manage all settings, invite/remove members
- `admin`: Can invite/remove members, manage settings
- `member`: Can access team knowledge, contribute to conversations

## Access Patterns

**Reading Personal Semantic Knowledge** (any query):
```typescript
// All semantic nodes are user-scoped
const query = `
  MATCH (c:Concept)
  WHERE c.user_id = $userId
  RETURN c
`;
```

**Reading Team Sources** (episodic memory):
```typescript
// Get user's team IDs from Supabase
const userTeams = await getTeamIdsForUser(userId);

// Query Neo4j with team filter for Sources only
const query = `
  MATCH (s:Source)
  WHERE s.team_id IN $teamIds
    OR s.user_id = $userId
    OR $userId IN s.participants
  RETURN s
`;
```

**Creating Entities** (ingestion pipeline):
```typescript
// All semantic entities are user-scoped
await personRepository.create({
  canonical_name: normalizedName,
  user_id: userId,
  created_by: userId,
  ...entityData
});

// Sources can be team-scoped
const teamId = conversation.team_id || null;  // null = personal source
await sourceRepository.create({
  entity_key: uuid(),
  user_id: userId,
  team_id: teamId,
  ...sourceData
});
```

**Personal vs Team Sources**:
```typescript
// Personal conversation
const source = {
  entity_key: uuid(),
  user_id: userId,
  team_id: null,              // Null = personal
  participants: [userId],     // Single participant
  context_type: "personal-reflection"
};

// Team meeting
const source = {
  entity_key: uuid(),
  user_id: userId,            // Who initiated/contributed
  team_id: teamId,            // Team context
  participants: [user1, user2, user3],  // Multiple participants
  context_type: "team-meeting"
};
```

## Multi-Team Support

Users can belong to multiple teams. Implementation considerations:

**Primary Team**: Each user has a `primary_team_id` (default context for team Sources)

**Team Switching**:
```typescript
// UI allows user to switch active team
setActiveTeam(teamId: string) {
  // Changes which team Sources are visible
  // Semantic graph (user_id scoped) stays the same
}
```

**Cross-Team Source Queries**:
```cypher
// User can access Sources from any of their teams
MATCH (s:Source)
WHERE s.team_id IN $userTeamIds
RETURN s
```

**Semantic Graph Isolation**: User's personal semantic graph is always filtered by `user_id`, regardless of active team. Team membership only affects Source visibility.

## Authorship & Attribution

**Node-Level Tracking**:
- `created_by`: User who first created the entity
- Can be updated if entity is merged from multiple sources

**Note-Level Tracking**:
- `added_by`: User who added each note
- Enables "who said what" queries and audit trails

**Relationship-Level Tracking**:
- `recorded_by`: User who created/updated the relationship
- For personal relationships (from owner node), this is always the owner

**Example Query - Show Contributions**:
```cypher
// Find all semantic entities for user (all are user-scoped)
MATCH (e:Entity {user_id: $userId})
RETURN e

// Find all notes added by user (in their own graph)
MATCH (n)
WHERE n.user_id = $userId
UNWIND n.notes AS note
WITH n, note
WHERE note.added_by = $userId
RETURN n.name, note.content, note.date_added
```

## Access Control Implementation

**Query-Time Filtering** (applied to all reads):
```typescript
// Repository base class
interface QueryFilters {
  [key: string]: string | number | boolean | null;
}

class BaseSemanticRepository {
  async find(filters: QueryFilters) {
    // Semantic nodes always filter by user_id only
    const query = `
      MATCH (n:${this.label})
      WHERE n.user_id = $userId
      AND ${this.buildFilterClause(filters)}
      RETURN n
    `;

    return this.neo4j.run(query, { userId: this.userId, ...filters });
  }

  private buildFilterClause(filters: QueryFilters): string {
    // Convert filters object to Cypher WHERE clauses
    return Object.keys(filters).map(key => `n.${key} = $${key}`).join(' AND ');
  }
}

class SourceRepository {
  async find(filters: QueryFilters) {
    // Sources filter by team_id AND user participation
    const userTeams = await this.getUserTeams(this.userId);

    const query = `
      MATCH (s:Source)
      WHERE (s.team_id IN $teamIds OR s.user_id = $userId OR $userId IN s.participants)
      AND ${this.buildFilterClause(filters)}
      RETURN s
    `;

    return this.neo4j.run(query, { teamIds: userTeams, userId: this.userId, ...filters });
  }
}
```

**Write-Time Validation**:
```typescript
// Ensure user can write to team
async validateTeamAccess(userId: string, teamId: string): Promise<boolean> {
  const membership = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .single();

  return membership !== null;
}

// Before creating entity
if (teamId && !(await validateTeamAccess(userId, teamId))) {
  throw new Error('User does not have access to this team');
}
```

## Edge Cases & Conflict Resolution

**Same Entity, Different Users**:
- Multiple users can have entities with identical names (e.g., User A and User B both have "Google" entity)
- Scoped by user_id, no conflicts
- Each user's "Google" node reflects their personal context and relationships

**User Leaves Team**:
- User loses access to team Sources (team_id-scoped episodic memory)
- User's personal semantic graph (user_id-scoped) remains fully accessible
- User's personal Sources (team_id=null) remain accessible
- User's contributions (created_by, added_by) in their graph remain attributed

**Entity Merging** (not applicable):
- Semantic nodes are personal, not shared
- No need to merge entities between users
- Each user maintains independent semantic interpretations

**Personal Relationships - Multiple Users, Same Real-World Person**:
```cypher
// Alice's personal view of "Sarah"
(alice:Person {is_owner: true, user_id: 'alice-123'})
  -[:has_relationship_with {
    description: 'Close friend and former colleague',
    relationship_type: 'friend',
    attitude: 5,  // close
    proximity: 5,  // intimate-knowledge
    notes: [
      {content: 'We worked together at Google from 2019-2021', added_by: 'alice-123', ...},
      {content: 'She helped me through a difficult time', added_by: 'alice-123', ...}
    ],
    relation_embedding: [...],  // embedded from "friend close intimate-knowledge"
    notes_embedding: [...],  // embedded from concatenated notes
    recorded_by: 'alice-123',
    state: 'core',
    salience: 0.85
  }]-
(aliceSarah:Person {user_id: 'alice-123', canonical_name: 'sarah'})

// Bob's personal view of "Sarah" (separate node, different context)
(bob:Person {is_owner: true, user_id: 'bob-456'})
  -[:has_relationship_with {
    description: 'Coworker in marketing department',
    relationship_type: 'colleague',
    attitude: 3,  // neutral
    proximity: 3,  // familiar
    notes: [
      {content: 'Works on campaign strategy', added_by: 'bob-456', ...}
    ],
    relation_embedding: [...],  // embedded from "colleague neutral familiar"
    notes_embedding: [...],
    recorded_by: 'bob-456',
    state: 'active',
    salience: 0.35
  }]-
(bobSarah:Person {user_id: 'bob-456', canonical_name: 'sarah'})

// Both Alice and Bob may have learned about Sarah from the same team Source,
// but each maintains their own Person node with personal context
```

## Design Notes

**Personal Knowledge Graphs with Shared Sources**: This schema prioritizes individual interpretation over shared consensus. Each user builds their own semantic understanding from shared episodic experiences (team Sources).

**Clean Separation of Concerns**:
- **Episodic layer** (Sources): Team-scoped, shared across members
- **Semantic layer** (Person/Concept/Entity/relationships): User-scoped, personal interpretation
- **Artifacts**: User-scoped outputs

**Full Authorship**: Every contribution is attributed (`created_by`, `added_by`, `recorded_by`). Enables audit trails and "who contributed what" queries within personal graphs.

**Multi-Team Support**: Users can belong to multiple teams, affecting which Sources they see. Their semantic graph stays consistent (always filtered by `user_id`), regardless of active team context.

**Simpler Access Control**: No complex team-scoped entity resolution or merging logic. All semantic queries simply filter by `user_id`. Only Sources need team-based access checks.
