# Entity Resolvers

Match mentioned entities to existing Neo4j nodes during Phase 2 of memory extraction.

## Resolution Strategy (Multi-Tier)

1. **entity_key** (hash of normalized name + type + userId) - Most reliable
2. **canonical_name** (lowercase normalized name)
3. **Alias** (via Alias nodes in Neo4j)
4. **Vector similarity** (semantic matching, score > 0.85)
5. **Fuzzy search** (Person only)
6. **LLM disambiguation** (multiple candidates)

## BaseResolver Utilities

- `vectorSimilaritySearch()` - Semantic search via Neo4j vector index
- `disambiguate()` - LLM choice between candidates (intrinsic properties only)
- `createAliasIfNeeded()` - Create Alias node if resolved with different name

**Entity-Specific**: PersonResolver (full 6-tier), ProjectResolver/TopicResolver (5-tier), IdeaResolver (entity_key only)