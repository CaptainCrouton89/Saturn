# Retrieval Tool Testing Scripts

Manual testing infrastructure for the `explore` and `traverse` retrieval tools.

## Overview

These scripts allow you to manually test the retrieval tools with JSON inputs to verify they work correctly with your Neo4j data.

## Files Created

```
backend/scripts/
├── test-retrieval.ts       # Shared utilities (DB connection, user selection, formatting)
├── test-explore.ts         # Test script for explore tool
├── test-traverse.ts        # Test script for traverse tool
├── test-examples.md        # Example test scenarios and patterns
└── test-retrieval-README.md # This file
```

## Quick Start

### 1. Ensure Environment Variables are Set

The scripts load from `.env.local` (or `.env` as fallback) automatically. Required variables:

```bash
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_password
OPENAI_API_KEY=sk-...
```

### 2. Test the Explore Tool

**Semantic search example:**
```bash
tsx backend/scripts/test-explore.ts '{"queries": [{"query": "work conversations", "threshold": 0.7}], "return_explanations": true}'
```

**Text match example:**
```bash
tsx backend/scripts/test-explore.ts '{"text_matches": ["John"], "return_explanations": true}'
```

**Combined search:**
```bash
tsx backend/scripts/test-explore.ts '{"queries": [{"query": "career goals", "threshold": 0.6}], "text_matches": ["Google", "Apple"]}'
```

### 3. Test the Traverse Tool

**Get all persons:**
```bash
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (p:Person {user_id: $user_id}) RETURN p.name, p.canonical_name LIMIT 10", "verbose": false}'
```

**Get concepts with relationships:**
```bash
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (c:Concept {user_id: $user_id})-[r]->(other) RETURN c.name, type(r), other.name LIMIT 20", "verbose": false}'
```

**Get full node details:**
```bash
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (p:Person {user_id: $user_id, is_owner: true}) RETURN p", "verbose": true}'
```

## Features

### Shared Utilities (`test-retrieval.ts`)

- **Environment Loading**: Automatically loads `.env.local` or `.env`
- **Neo4j Connection**: Handles connection initialization and cleanup
- **User Selection**: Interactive prompt to select user ID (or auto-select if only one user)
- **Pretty Printing**: Formatted output with colors and structure
- **Type-Safe**: Full TypeScript types for all operations

### Explore Tool Testing (`test-explore.ts`)

**What it does:**
1. Validates input against `ExploreInputSchema`
2. Runs vector search and/or text matching
3. Calculates salience for all hits
4. Ranks and filters top results by type
5. Expands graph to get relationships and neighbors
6. Pretty-prints results grouped by type

**Output includes:**
- Nodes grouped by type (Person, Concept, Entity, Source)
- Top 10 relationships between nodes
- 1-hop neighbors (up to 30)
- Search explanations (if requested)

### Traverse Tool Testing (`test-traverse.ts`)

**What it does:**
1. Validates input against `TraverseInputSchema`
2. Security checks (blocks dangerous operations, validates user_id constraint)
3. Executes Cypher query with auto-injected `$user_id` parameter
4. Truncates content fields if `verbose=false`
5. Pretty-prints results with proper formatting

**Security features:**
- Blocks DELETE, DROP, REMOVE, CREATE CONSTRAINT, CREATE INDEX
- Requires `user_id` constraint in all queries
- Auto-injects `$user_id` parameter

## Tool Schemas

### Explore Input Schema

```typescript
{
  queries?: Array<{
    query: string;        // Natural language query for semantic search
    threshold: number;    // 0-1, minimum cosine similarity
  }>;
  text_matches?: string[];        // Exact/fuzzy text matches on names
  return_explanations?: boolean;  // Include search statistics
}
```

**Validation**: At least one of `queries` or `text_matches` must be provided.

### Traverse Input Schema

```typescript
{
  cypher: string;   // Cypher query to execute
  verbose: boolean; // If false, truncate content fields to 200 chars
}
```

**Requirements**:
- Query must include `user_id: $user_id` constraint
- No dangerous operations (DELETE, DROP, etc.)

## Example Test Scenarios

See `test-examples.md` for comprehensive examples including:

- **Explore Tool**: 6 example patterns (semantic search, text matching, combined, multiple queries, etc.)
- **Traverse Tool**: 10 example Cypher queries (get nodes, relationships, counts, filtering, etc.)
- **Testing Patterns**: Tips for testing search quality, salience, graph expansion, and security
- **Debugging Tips**: Solutions for common issues

## Common Use Cases

### Verify Embedding Search Works

```bash
tsx backend/scripts/test-explore.ts '{"queries": [{"query": "career and job opportunities", "threshold": 0.5}], "return_explanations": true}'
```

Check that:
- Results are semantically related to query
- Similarity scores are reasonable (0.5+)
- Top results make sense

### Verify Text Matching Works

```bash
tsx backend/scripts/test-explore.ts '{"text_matches": ["John Smith", "Google"], "return_explanations": true}'
```

Check that:
- Exact matches have score 1.0
- Partial matches have scores 0.7-1.0
- Fuzzy matches have scores 0.3-0.6

### Verify Salience Calculation

```bash
tsx backend/scripts/test-explore.ts '{"queries": [{"query": "important topics", "threshold": 0.6}], "return_explanations": true}'
```

Then check the results:
- Recently updated nodes rank higher
- Highly connected nodes rank higher
- Old, isolated nodes rank lower

### Verify Graph Expansion

```bash
tsx backend/scripts/test-explore.ts '{"queries": [{"query": "people I know", "threshold": 0.7}]}'
```

Check that:
- Relationships between returned nodes are included
- 1-hop neighbors are discovered
- Neighbor limit is respected (max 30)

### Verify Security

```bash
# Should fail - no user_id constraint
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (p:Person) RETURN p", "verbose": false}'

# Should fail - dangerous operation
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (p:Person {user_id: $user_id}) DELETE p", "verbose": false}'

# Should succeed
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (p:Person {user_id: $user_id}) RETURN p LIMIT 5", "verbose": false}'
```

## Debugging Tips

### No Results Returned

1. Check if data exists:
   ```bash
   tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (n {user_id: $user_id}) RETURN labels(n)[0] as type, count(*) as count", "verbose": false}'
   ```

2. Lower similarity threshold in explore queries (try 0.3-0.5)

3. Verify embeddings are generated:
   ```bash
   tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (n {user_id: $user_id}) WHERE n.embedding IS NOT NULL RETURN labels(n)[0] as type, count(*) as count", "verbose": false}'
   ```

### Wrong Results

1. Check embedding quality - are related concepts grouped together?
2. Verify text matching fields (canonical_name, name)
3. Check salience calculation (connections × recency_factor)

### TypeScript Errors

Run type-check (note: may have dependency warnings, but script-specific errors should be fixed):
```bash
npx tsc --noEmit scripts/test-retrieval.ts scripts/test-explore.ts scripts/test-traverse.ts
```

## Implementation Details

### Explore Tool Flow

1. **Gather Phase**:
   - Run vector search on Concept, Entity, Source nodes
   - Run fuzzy text match on Person, Entity nodes
   - Deduplicate by entity_key (keep max score)

2. **Rerank Phase**:
   - Calculate salience for each hit
   - Compute combined_score = search_score + salience
   - Sort by combined_score descending

3. **Select Top Hits**:
   - Top 5 Concepts
   - Top 3 Entities
   - Top 3 Persons
   - Top 5 Sources

4. **Expand Graph**:
   - Get all edges between top hits
   - Get edges to user's owner Person node
   - Get 1-hop neighbors (limit 30)
   - Return top 10 edges sorted by relevance/recency

### Traverse Tool Flow

1. **Security Checks**:
   - Block dangerous operations (DELETE, DROP, etc.)
   - Validate user_id constraint present
   - Auto-inject $user_id parameter

2. **Execute Query**:
   - Run Cypher with injected parameters
   - Handle Neo4j-specific types (Integer, DateTime, etc.)

3. **Process Results**:
   - If verbose=false: Truncate content fields to 200 chars
   - If verbose=true: Return full properties

4. **Format Output**:
   - Return {results, total_results}
   - JSON serialization with proper type conversion

## Next Steps

1. **Add to CI/CD**: Consider running these tests in your test suite
2. **Performance Testing**: Test with large datasets to verify performance
3. **Integration Tests**: Use these scripts as basis for automated integration tests
4. **Documentation**: Keep test-examples.md updated with new patterns

## Troubleshooting

### Connection Issues

```bash
# Test Neo4j connection
docker ps | grep neo4j
# or
neo4j-admin server status
```

### Environment Issues

```bash
# Verify .env.local exists
ls -la backend/.env.local

# Check required vars
grep -E 'NEO4J|OPENAI' backend/.env.local
```

### Data Issues

```bash
# Check if user has data
tsx backend/scripts/test-traverse.ts '{"cypher": "MATCH (owner:Person {user_id: $user_id, is_owner: true}) RETURN owner", "verbose": true}'
```

## Related Documentation

- `backend/scripts/ingestion/retrieval.md` - Retrieval implementation details
- `backend/scripts/ingestion/architecture.md` - Memory architecture overview
- `backend/src/agents/tools/retrieval/` - Tool implementations
- `backend/src/services/retrievalService.ts` - Service layer implementation

---

**Questions?** Check `test-examples.md` for more examples or reach out to the team.
