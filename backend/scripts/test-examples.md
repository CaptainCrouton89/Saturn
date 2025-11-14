# Retrieval Tool Test Examples

This document provides example test scenarios for the `explore` and `traverse` retrieval tools.

---

## Explore Tool Examples

### 1. Semantic Search - Work-Related Content

**Description**: Find concepts and sources related to "work" with high similarity threshold.

```bash
tsx backend/scripts/test-explore.ts '{"queries": [{"query": "work conversations and career decisions", "threshold": 0.7}], "return_explanations": true}'
```

**What it tests**:
- Vector search across Concept, Entity, Source nodes
- Embedding similarity matching
- Salience calculation
- Graph expansion

---

### 2. Text Match - Finding a Person

**Description**: Find a person by name using fuzzy text matching.

```bash
tsx backend/scripts/test-explore.ts '{"text_matches": ["John"], "return_explanations": true}'
```

**What it tests**:
- Fuzzy text matching on Person nodes
- Jaro-Winkler similarity scoring
- Exact and partial name matches

---

### 3. Combined Search - Person + Topic

**Description**: Combine semantic search for a topic with text match for a person.

```bash
tsx backend/scripts/test-explore.ts '{"queries": [{"query": "job offer negotiation", "threshold": 0.6}], "text_matches": ["Google"], "return_explanations": true}'
```

**What it tests**:
- Multi-query expansion
- Fusion of vector search and text matching
- Deduplication by entity_key

---

### 4. Multiple Queries - Different Aspects

**Description**: Search multiple topics simultaneously.

```bash
tsx backend/scripts/test-explore.ts '{"queries": [{"query": "career goals and aspirations", "threshold": 0.7}, {"query": "personal relationships", "threshold": 0.7}], "return_explanations": true}'
```

**What it tests**:
- Multiple vector searches
- Score deduplication (max score per entity)
- Combined ranking

---

### 5. Low Threshold Search - Broad Exploration

**Description**: Cast a wide net with low similarity threshold.

```bash
tsx backend/scripts/test-explore.ts '{"queries": [{"query": "technology", "threshold": 0.5}], "return_explanations": true}'
```

**What it tests**:
- Lower threshold = more results
- Salience-based reranking importance

---

### 6. Entity Type Search

**Description**: Search for specific entity types (companies, places, etc.).

```bash
tsx backend/scripts/test-explore.ts '{"text_matches": ["Google", "Apple", "Microsoft"], "return_explanations": true}'
```

**What it tests**:
- Multiple text matches
- Entity name resolution

---

## Traverse Tool Examples

### 1. Get All Persons

**Description**: Retrieve all Person nodes for the user.

```bash
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (p:Person {user_id: $user_id}) RETURN p.entity_key, p.name, p.canonical_name, p.situation ORDER BY p.created_at DESC LIMIT 10", "verbose": false}'
```

**What it tests**:
- Basic Cypher query
- user_id security constraint
- Content truncation (verbose=false)

---

### 2. Get Concepts with Relationships

**Description**: Find concepts and their relationships.

```bash
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (c:Concept {user_id: $user_id})-[r]->(other) RETURN c.name, type(r) as relationship_type, labels(other)[0] as target_type, other.name LIMIT 20", "verbose": false}'
```

**What it tests**:
- Relationship traversal
- Multiple node types in results
- Relationship type extraction

---

### 3. Get Full Person Details (Verbose)

**Description**: Retrieve complete person information without truncation.

```bash
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (p:Person {user_id: $user_id}) WHERE p.canonical_name = '\''John Smith'\'' RETURN p", "verbose": true}'
```

**What it tests**:
- Verbose mode (no truncation)
- Full node properties
- Filtering by property

---

### 4. Count Nodes by Type

**Description**: Get statistics on user's knowledge graph.

```bash
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (n {user_id: $user_id}) RETURN labels(n)[0] as node_type, count(*) as count ORDER BY count DESC", "verbose": false}'
```

**What it tests**:
- Aggregation queries
- Label extraction
- Statistical queries

---

### 5. Find Recent Sources

**Description**: Get most recently created/updated sources.

```bash
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (s:Source {user_id: $user_id}) RETURN s.entity_key, s.source_type, s.summary, s.created_at ORDER BY s.created_at DESC LIMIT 5", "verbose": false}'
```

**What it tests**:
- Date-based sorting
- Source node retrieval
- Summary truncation

---

### 6. Find Entities with Multiple Relationships

**Description**: Identify highly connected entities.

```bash
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (e:Entity {user_id: $user_id})-[r]-() WITH e, count(r) as rel_count WHERE rel_count > 2 RETURN e.name, rel_count ORDER BY rel_count DESC LIMIT 10", "verbose": false}'
```

**What it tests**:
- Relationship counting
- WHERE filtering
- WITH clause handling

---

### 7. Get Owner Person Node

**Description**: Retrieve the user's own Person node.

```bash
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (owner:Person {user_id: $user_id, is_owner: true}) RETURN owner", "verbose": true}'
```

**What it tests**:
- Boolean property filtering
- Owner node identification
- Full properties retrieval

---

### 8. Find Relationships with Properties

**Description**: Get relationships with their full properties.

```bash
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (p:Person {user_id: $user_id})-[r:knows]->(other:Person) RETURN p.name as from_person, other.name as to_person, r.attitude, r.proximity, r.description LIMIT 10", "verbose": true}'
```

**What it tests**:
- Relationship property access
- Named relationship types
- Multi-property extraction

---

### 9. Search by Entity Key

**Description**: Retrieve specific node by entity_key.

```bash
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (n {user_id: $user_id, entity_key: '\''concept_career_goals'\''}) RETURN n", "verbose": true}'
```

**What it tests**:
- entity_key lookup
- Single node retrieval
- Full node properties

---

### 10. Get Neighbors of Specific Node

**Description**: Find all 1-hop neighbors of a specific node.

```bash
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (n {user_id: $user_id, entity_key: '\''person_john_smith'\''})-[r]-(neighbor) RETURN type(r) as relationship_type, labels(neighbor)[0] as neighbor_type, neighbor.name, neighbor.entity_key LIMIT 20", "verbose": false}'
```

**What it tests**:
- Undirected relationship traversal
- Neighbor discovery
- Relationship type extraction

---

## Common Test Patterns

### Testing Search Quality

1. **High Threshold (0.7-0.9)**: Tests precision - should return highly relevant results
2. **Medium Threshold (0.5-0.7)**: Tests balance - mix of relevant and related results
3. **Low Threshold (0.3-0.5)**: Tests recall - should capture broader context

### Testing Salience Calculation

1. **Recently Updated Nodes**: Should have higher salience scores
2. **Highly Connected Nodes**: Should rank higher due to connection count
3. **Old, Unconnected Nodes**: Should rank lower

### Testing Graph Expansion

1. **Top Hits Selection**: Verify correct counts per type (5 Concepts, 3 Entities, etc.)
2. **Edges Between Hits**: Verify relationships between returned nodes
3. **Neighbor Discovery**: Verify 1-hop neighbors are returned (limit 30)

### Testing Security

1. **Missing user_id Constraint**: Should return error message
2. **Dangerous Operations**: Should block DELETE, DROP, REMOVE, etc.
3. **Parameter Injection**: Verify $user_id is properly injected

---

## Debugging Tips

### No Results Returned

- Check if data exists: `tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (n {user_id: $user_id}) RETURN count(*) as total_nodes", "verbose": false}'`
- Lower similarity threshold in explore queries
- Verify user_id is correct

### Wrong Results

- Check embedding quality (are embeddings generated?)
- Verify text matching is using correct fields (canonical_name, name)
- Check salience calculation (recency + connections)

### Security Errors

- Ensure all Cypher queries include `user_id: $user_id` constraint
- Use $user_id parameter syntax, not literal values
- Check for dangerous keywords (delete, drop, etc.)

---

## Quick Reference

### Explore Tool Input Schema

```typescript
{
  queries?: Array<{
    query: string;        // Natural language query to embed
    threshold: number;    // 0-1, minimum cosine similarity
  }>;
  text_matches?: string[];  // Exact/fuzzy text matches
  return_explanations?: boolean;  // Include search stats
}
```

### Traverse Tool Input Schema

```typescript
{
  cypher: string;   // Cypher query to execute
  verbose: boolean; // If false, truncate content fields
}
```

### Explore Output

- `nodes`: Array of matched nodes with full properties
- `edges`: Top 10 relationships between nodes
- `neighbors`: 1-hop neighbors (limit 30)
- `explanations`: Search statistics (if requested)

### Traverse Output

- `results`: Array of query result rows
- `total_results`: Count of results
