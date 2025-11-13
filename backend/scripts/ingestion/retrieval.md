# Retrieval Implementation Details

> **Main Documentation**: See [architecture.md](./architecture.md) for explore() and traverse() API signatures and return types.
>
> **Related Documentation**:
> - [architecture.md](./architecture.md) - Memory architecture and retrieval API
> - [nodes/](./nodes/) - Node schemas (Person, Concept, Entity, Source, Storyline, Macro, Artifact)
> - [hierarchical-memory.md](./hierarchical-memory.md) - Storyline/Macro aggregation
> - [agent-context.md](./agent-context.md) - Context loading at conversation start
> - [memory-management.md](./memory-management.md) - Salience decay mechanics

This document provides implementation details for the retrieval system, including scoring formulas, query expansion strategies, and ranking algorithms.

---

## Multi-Query Expansion

When `multi_query: true` or `mode: "deep"`, the system generates 2-3 complementary queries targeting different aspects:

**Query Types**:
- **Episodic query**: Targets sources/storylines/macros ("all conversations about: google job offer, offer negotiation")
- **People query**: Targets people/relationships ("user ↔ John work relationship, attitudes / closeness")
- **Concepts query**: Targets abstract concepts ("career decision-making, risk tolerance, long-term goals")

**Fusion Strategy**: Results from multiple queries are fused using **RRF (Reciprocal Rank Fusion)**:
```
RRF_score(doc) = Σ (1 / (k + rank_i))

where:
- k = 60 (standard RRF constant)
- rank_i = rank of doc in query i's results
- Sum over all queries that returned doc
```

RRF is preferred over simple score averaging because:
- Robust to score scale differences across queries
- Doesn't require score normalization
- Handles missing results gracefully (doc not in query → ignored for that query)

---

## Scoring Model

### Final Score Formula

```
final_score = (semantic_weight * cosine_similarity) +
              (time_weight * recency_score) +
              (salience_weight * salience)

where:
- semantic_weight: default 0.3 (how much to weight embedding similarity)
- time_weight: default 0.3 (how much to weight recency)
- salience_weight: default 0.4 (how much to weight graph centrality)
- All weights sum to 1.0
```

### Component Scores

**Cosine Similarity** (semantic signal):
- Embedding similarity between query and result
- Already normalized to 0-1 range
- Computed via Neo4j vector index or in-memory dot product

**Recency Score** (temporal signal):
```
recency_score = exp(-λ * days_since_update)

where:
- λ = 0.02 (decay constant)
- days_since_update = days since last update/access
- Half-life: ln(2) / λ ≈ 35 days
```

Examples:
- 0 days ago: score = 1.0
- 35 days ago: score ≈ 0.5
- 70 days ago: score ≈ 0.25
- 105 days ago: score ≈ 0.125

**Salience** (importance signal):
- Graph centrality score (0-1)
- Boosted on access (+0.05-0.1 per retrieval)
- Decays exponentially over time when not accessed
- See [memory-management.md](./memory-management.md) for full decay mechanics

### Score Normalization

All component scores must be in 0-1 range before combining:

**Embedding search**: Cosine similarity already 0-1

**Exact text matches**: Score as 1.0 (perfect match)

**Fuzzy text matches**: Normalize using string similarity:
```
fuzzy_score = 1 - (levenshtein_distance / max_length)

Alternative metrics:
- Jaro-Winkler similarity
- Token-based similarity (Jaccard, overlap coefficient)
- Phonetic matching (Soundex, Metaphone) for names
```

---

## Gather Phase

Combines all results from search queries (embeddings) and text matches (fuzzy matching).

### Searched Entities

**Semantic Layer**:
- **Person nodes** - via `embedding` OR text match on `canonical_name`
- **Concept nodes** - via `embedding` OR text match on `name`
- **Entity nodes** - via `embedding` OR text match on `name`
- **Relationships** - via `relation_embedding`, `notes_embedding` OR text match on `relationship_type`, `description`, notes contents

**Episodic Layer** (granularity-dependent):
- **Sources (granularity 1)** - via `embedding` (from summary) OR text match on `keywords`, `tags`
- **Storylines (granularity 2)** - via `embedding` (from description) OR text match on `name`
- **Macros (granularity 3)** - via `embedding` (from description) OR text match on `name`

**Artifacts**:
- Text match on `name`, `description`

### Relationship Filtering

Hard filters applied BEFORE scoring (reduces candidate set):

**Filter Parameters**:
- `min_attitude`, `max_attitude`: Include only relationships within attitude range
- `min_proximity`, `max_proximity`: Include only relationships within proximity range
- `relationship_types`: Whitelist of types (e.g., ["friend", "colleague"])
- `exclude_relationship_types`: Blacklist of types (e.g., ["enemy", "competitor"])

**Example**:
```typescript
explore({
  queries: [{query: "close connections", threshold: 0.7}],
  relationship_filters: {
    min_attitude: 4,  // Only friendly/close relationships
    min_proximity: 4  // Only well-known/intimate connections
  }
})
// Removes all relationships with attitude < 4 or proximity < 4 before scoring
```

---

## Rerank and Expand Phase

### 1. Score and Rank

Apply multi-signal scoring model to all gathered entities:
```
For each entity:
  final_score = semantic_weight * cosine_sim +
                time_weight * recency +
                salience_weight * salience
Sort by final_score descending
```

### 2. Filter Top Hits by Granularity

**Granularity 1 (micro - Source-level detail)**:
- Top 5 Sources (full detail)
- Top 5 semantic nodes (Person, Concept, Entity combined)
- Top 10 relationships touching returned nodes
- Top 3 Storylines (minimal context - entity_key, name only)
- Top 2 Macros (minimal context - entity_key, name only)

**Granularity 2 (meso - Storyline-level aggregation)**:
- Top 5 Storylines (full detail with preview_sources)
- Top 5 semantic nodes
- Top 10 relationships touching returned nodes
- Top 10 Sources mentioned in Storylines (as previews only)
- Top 2 Macros (minimal context)

**Granularity 3 (macro - Macro-level themes)**:
- Top 5 Macros (full detail with child Storylines)
- Top 5 semantic nodes (anchor nodes from Macros)
- Top 10 relationships touching returned nodes
- No Sources returned (drill down with separate call if needed)

### 3. Expand Context

For returned nodes, fetch connected context:
- **Connected nodes**: Neighbors with summary info only
- **Relationships**: Between returned nodes (already filtered to top 10)
- **For Storylines**: Top mentioned nodes from child Sources (top 5-10 by salience)
- **For Macros**: Child Storylines with summaries (all children, sorted by started_at)

---

## Performance Considerations

**Vector Index Usage**:
- Use Neo4j vector indexes for embedding search (HNSW algorithm)
- Index creation: `CALL db.index.vector.createNodeIndex('entity_embedding_index', 'Entity', 'embedding', 1536, 'cosine')`
- Query: `CALL db.index.vector.queryNodes('entity_embedding_index', 10, $queryVector)`

**Query Optimization**:
- Pre-filter by `user_id` and `team_id` before scoring (reduces candidate set 100x+)
- Use LIMIT early in Cypher queries to avoid scoring all nodes
- Cache embeddings for common queries (e.g., "recent activity", "work topics")

**Cost Targets**:
- Embedding generation: ~$0.00001 per query (text-embedding-3-small)
- Multi-query expansion: ~$0.0001 per query (gpt-4.1-mini, 100-200 tokens)
- Total per query: ~$0.0001 (negligible)

---

## See Also

- [architecture.md](./architecture.md): explore() and traverse() API signatures and memory architecture
- [memory-management.md](./memory-management.md): Salience decay mechanics
- [hierarchical-memory.md](./hierarchical-memory.md): Storyline/Macro aggregation
- [nodes/](./nodes/): Node type schemas and specifications
- [agent-context.md](./agent-context.md): Context loading at conversation start
