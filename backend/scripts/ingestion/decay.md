# Memory Lifecycle & Decay

> **Related Documentation**:
> - [architecture.md](./architecture.md) - Memory architecture
> - [ingestion-pipeline.md](./ingestion-pipeline.md) - How nodes are created
> - [hierarchical-memory.md](./hierarchical-memory.md) - Storyline/Macro decay

All nodes (both semantic and episodic) use salience scoring and decay mechanisms to determine what stays in active memory. However, semantic nodes persist longer and decay more slowly than episodic nodes, reflecting their role as consolidated knowledge.

## Salience Updates

**On Every Retrieval** (when a node is returned in `explore()` or `traverse()` results):
```
For each returned node:
1. access_count += 1
2. recall_frequency += 1
3. last_accessed_at = now
4. salience = min(1.0, salience + α) where α ∈ [0.05, 0.1]
```

## Memory Lifecycle (State Transitions)

**Universal State Flow** (applies to all nodes and relationships with full lifecycle tracking):

```
candidate → active → core → archived
```

**State Definitions**:
- **candidate**: Newly created, not yet retrieved (initial state)
- **active**: Retrieved 1-9 times (confirmed through use)
- **core**: Retrieved 10+ times (highly important, resistant to decay)
- **archived**: Salience < 0.01 or ttl_policy expired (excluded from default searches)

**Transition Rules**:
- `candidate → active`: On first retrieval (`access_count >= 1`)
- `active → core`: On frequent retrieval (`access_count >= 10`)
- `active/core → archived`: When salience drops below 0.01 OR ttl_policy forces archival
- `archived → active`: If re-accessed after archival (salience boosted)

**Which Nodes Have Full Lifecycle Tracking**:
- **Semantic nodes**: Person, Concept, Entity (all properties)
- **Semantic relationships**: All relationship types (all properties)
- **Hierarchical nodes**: Storyline, Macro (all properties)
- **Episodic nodes**: Source, Artifact (simplified - see below)

**Simplified Lifecycle for Episodic Nodes** (Source, Artifact):
- Include: `state`, `salience`, `access_count`, `last_accessed_at`, `ttl_policy`
- Include: `recall_frequency`, `last_recall_interval`, `decay_gradient` (for spacing effect)
- These nodes participate in full decay mechanics despite being episodic

## Candidate Semantics (Confidence + State Interaction)

**How confidence affects decay** (candidates only):

- **state = candidate** & **confidence >= 0.8**: High confidence candidate
  - No decay until first retrieval
  - Persists indefinitely (tentative but likely real)
  - Purpose: High-certainty extractions don't fade until validated by use
  - Once retrieved → state becomes `active`, normal decay applies

- **state = candidate** & **confidence < 0.8**: Low confidence candidate
  - Accelerated decay based on confidence score
  - Formula: `decay_rate = base_decay_rate × (1 + (1 - confidence) × 2)`
  - Example (confidence = 0.4): decay_rate = 0.02 × 2.2 = 0.044 (2.2× faster)
  - Example (confidence = 0.7): decay_rate = 0.02 × 1.6 = 0.032 (1.6× faster)
  - Purpose: Uncertain extractions fade quickly if never confirmed through retrieval

- **state = active/core/archived**: Confidence no longer affects decay (only relevant for candidates)

## Offline/Nightly Jobs

### Decay Job

**Offline/Nightly Decay Job**:
```
For all nodes with salience > 0:
1. days = days_since(last_accessed_at or created_at)
2. Calculate dynamic decay rate incorporating recall frequency AND confidence:
   base_decay_rate = 0.02 / (1 + recall_frequency^decay_gradient)

   // Apply confidence penalty for low-confidence candidates
   if (state === 'candidate' && confidence < 0.8):
     confidence_penalty = 1 + (1 - confidence) * 2  // 0.4 conf → 2.2x faster, 0.7 conf → 1.6x faster
     decay_rate = base_decay_rate * confidence_penalty
   else if (state === 'candidate' && confidence >= 0.8):
     decay_rate = 0  // No decay for high-confidence candidates until accessed
   else:
     decay_rate = base_decay_rate  // Normal decay for active/core/archived

3. salience *= exp(-decay_rate * days)
4. Update spacing effect:
   - If recalled: calculate new_interval = days_since_last_recall
   - If new_interval > last_recall_interval: decay_gradient += 0.1 (slower forgetting)
   - If new_interval < last_recall_interval: decay_gradient -= 0.05 (faster forgetting)
   - last_recall_interval = new_interval
5. If salience < 0.01: state = 'archived' (optional governance)
```

**Decay Formula with Recall Frequency:**
```
decay_rate = base_rate / (1 + recall_frequency^decay_gradient)
salience_t = salience_0 * exp(-decay_rate * days_unused)

where:
- base_rate = 0.02 (default decay constant)
- recall_frequency = number of times node was retrieved
- decay_gradient = 1.0 initially, increases with spacing effect
- Spacing effect: memories recalled at longer intervals retain better

Examples (recall_frequency=0, decay_gradient=1.0):
- After 35 days unused: salience × 0.5 (half-life)
- After 70 days unused: salience × 0.25
- After 105 days unused: salience × 0.125

Examples (recall_frequency=5, decay_gradient=1.5):
- decay_rate = 0.02 / (1 + 5^1.5) ≈ 0.0015 (much slower decay)
- After 35 days: salience × 0.95 (minimal decay)
- After 70 days: salience × 0.90
- Frequently recalled memories become highly resistant to forgetting

Examples with confidence (candidates only):
- state=candidate, confidence=0.5, recall_frequency=0:
  - base_decay_rate = 0.02
  - confidence_penalty = 1 + (1 - 0.5) × 2 = 2.0
  - decay_rate = 0.02 × 2.0 = 0.04 (2x faster decay)
  - After 17 days unused: salience × 0.5 (half-life cut in half)
  - After 35 days unused: salience × 0.25 (archives quickly)

- state=candidate, confidence=0.85, recall_frequency=0:
  - decay_rate = 0 (no decay for high-confidence candidates)
  - Node persists indefinitely until first access
  - After first access: state → active, normal decay applies

- state=active, confidence=0.4, recall_frequency=0:
  - Confidence no longer matters (only affects candidates)
  - decay_rate = 0.02 (normal decay)
  - After 35 days: salience × 0.5 (standard half-life)
```

**Initial Values** (when node is created):
- salience: 0.5 (starts neutral, can go up or down)
- state: 'candidate' (promoted to 'active' after first retrieval, 'core' after 10+ retrievals)
- confidence: <set by extraction agent> (0-1, based on context and certainty)
- access_count: 0
- recall_frequency: 0
- last_recall_interval: 0
- decay_gradient: 1.0
- last_accessed_at: null

### Description Consolidation

**Nightly Description Consolidation** (semantic nodes and relationships):

For all Person, Concept, Entity nodes with is_dirty = true:
```
1. Gather current description + all notes (sorted by date_added)
2. LLM synthesizes updated description incorporating new notes:
   - Person: Short description of who they are (appearance, role, context)
   - Concept: 1-sentence overview of most important information
   - Entity: Short overview of most important information
3. Update description field with new synthesized version
4. Regenerate embedding from updated description + notes
5. Set is_dirty = false
6. Update updated_at timestamp
```

For all relationships with is_dirty = true:
```
1. Gather current description + all notes (sorted by date_added)
2. LLM synthesizes updated description incorporating new notes:
   - 1-sentence overview of the relationship nature and key details
3. Update description field with new synthesized version
4. Regenerate notes_embedding from concatenated notes (max 1000 chars)
5. Optionally update relation_embedding if relationship_type, attitude, or proximity changed
6. Set is_dirty = false
7. Update updated_at timestamp
```

When is_dirty gets set:
- During ingestion when notes array is appended to (Step 4: Relationship Agent using add_note_* tools)
- When relationship description is updated via update_relationship tool
- Manually when user edits notes through UI

Benefits:
- Descriptions stay current without blocking real-time ingestion
- Notes accumulate throughout the day, consolidated overnight
- Embeddings stay fresh for semantic search (nodes only)
- Mimics human memory consolidation (processing during sleep)

### Note Cleanup

**Nightly Note Cleanup** (remove expired notes):
```cypher
// Run nightly at 4am - cleanup expired notes from all nodes and relationships
MATCH (n)
WHERE n.notes IS NOT NULL
WITH n, [note IN n.notes
  WHERE note.expires_at IS NULL
  OR note.expires_at > datetime()] AS validNotes
WHERE size(validNotes) < size(n.notes)
SET n.notes = validNotes, n.updated_at = datetime()
```

**Purpose**:
- Removes notes where `expires_at` timestamp has passed
- Keeps notes with `expires_at = null` (lifetime: "forever")
- Automatic cleanup ensures notes don't accumulate indefinitely
- Runs after description consolidation (which uses all notes before cleanup)

**Cost**: Negligible (simple property filtering, no LLM calls)

## Consolidation Cost Estimates

**Assumptions** (per 1000 active users):
- Average nodes per user: 50 semantic nodes (Person + Concept + Entity)
- Average relationships per user: 30 relationships
- Dirty rate: 20% of nodes updated daily (10 nodes/user)
- Relationship dirty rate: 15% (4.5 relationships/user)
- Model: gpt-4.1-mini ($0.075/1M input, $0.30/1M output)
- Only consolidate nodes accessed in last 7 days (reduces scope by 60%)

**Node Description Consolidation**:
- Eligible nodes/night: 1000 users × 10 dirty nodes × 40% (recent access) = 4000 nodes
- Tokens per node: ~200 input (description + notes) + 100 output (new description) = 300 tokens
- Total tokens: 4000 × 300 = 1.2M tokens
- Cost: (1.2M × 0.67 input + 0.33 output ratio) × $0.15/1M avg = **~$0.18/night** = **$5.40/month**

**Relationship Description Consolidation**:
- Eligible relationships/night: 1000 users × 4.5 dirty × 40% (recent access) = 1800 relationships
- Tokens per relationship: ~150 input + 50 output = 200 tokens
- Total tokens: 1800 × 200 = 360k tokens
- Cost: 360k × $0.15/1M avg = **~$0.05/night** = **$1.50/month**

**Embedding Regeneration**:
- Nodes: 4000 nodes × 1536 dims × $0.00001/1k dims = **$0.06/night** = **$1.80/month**
- Relationships (notes only): 1800 × 1536 dims × $0.00001/1k dims = **~$0.03/night** = **$0.90/month**

**Total Nightly Consolidation Cost**: **$9.60/month** (for 1000 users)

**Per-User Cost**: **$0.0096/month** (~$0.12/year per user)

**Cost Optimization Strategies**:
1. **Recent access filtering** (implemented above): Only consolidate nodes accessed in last 7 days
2. **Use gpt-4.1-nano for simple consolidations**: If notes < 3, use nano (~4x cheaper)
3. **Batch multiple notes together**: Consolidate 5-10 notes in single call (reduces overhead)
4. **Skip re-embedding if description unchanged**: Compare old/new description, skip embedding if identical
5. **Lazy consolidation**: Only consolidate on next access instead of nightly (trades freshness for cost)

With these optimizations, cost can be reduced to **~$3-5/month** (for 1000 users).

## Memory Consolidation (Episodic → Semantic)

Over time, episodic memory consolidates into semantic knowledge, mimicking human memory processes during sleep:

**Consolidation triggers:**
- Source older than 7 days with salience < 0.2
- Multiple sources (5+) with overlapping entities
- Source with high access_count but low salience (frequently referenced detail)

**Consolidation process:**
1. **Identify consolidation candidates**: Cluster related sources by temporal proximity, shared entities, semantic similarity
2. **Extract insights**: LLM generates semantic summaries from source clusters
3. **Update semantic nodes**: Append extracted insights to Person/Concept/Entity notes, or create new semantic facts
4. **Preserve provenance**: Maintain links from semantic nodes to original sources
5. **Archive sources**: Mark consolidated sources as `state: 'archived'` (still retrievable but excluded from default search)

**Benefits:**
- Reduces graph size 40-60% over time
- Faster semantic queries (smaller search space)
- Preserves drill-down capability: "Show me the original conversation about X"
- Mirrors human memory: specific experiences become generalized knowledge

## Access Pattern Examples

**High-frequency topic** (accessed every 3 days):
- Salience quickly rises to 1.0 and stays there
- access_count grows rapidly
- state: 'candidate' → 'active' (first access) → 'core' (10+ accesses, ~30 days)

**One-off mention** (never retrieved):
- Salience decays from 0.5 → 0.25 in 35 days
- access_count remains 0
- state: 'candidate' → 'archived' after 100 days (salience < 0.01)

**Seasonal topic** (accessed in bursts):
- Salience spikes during usage, decays between
- Maintains moderate baseline (0.3-0.6)
- state: 'active' with cyclical salience

**Low-confidence candidate** (confidence=0.4, never accessed):
- Accelerated decay: salience 0.5 → 0.25 in ~17 days (2x faster)
- state: 'candidate' → 'archived' after ~50 days (salience < 0.01)
- Purpose: Tentative extractions fade quickly if never confirmed

**High-confidence candidate** (confidence=0.9, never accessed):
- No decay while in candidate state
- Persists indefinitely until first retrieval
- state: 'candidate' → 'active' on first access, then normal decay applies
- Purpose: High-certainty extractions don't fade until validated by use

## Governance Hooks

Governance policies control node lifecycle independent of salience decay.

### TTL Policy Table

**Policy precedence** (highest to lowest):

| ttl_policy | Behavior | Use for |
|------------|----------|---------|
| `keep_forever` | No decay, never archived, salience stays 1.0 | Owner node, key Macros, permanent facts |
| `ephemeral` | Hard expiry (30d episodic / 90d semantic), archival guaranteed | Strictly short-lived data |
| `decay` (default) | Salience-based decay only, archives when salience < 0.01 | Most memories |

**Conflict Resolution**: Highest precedence wins. Examples:
- `keep_forever` + low salience → keep_forever wins, salience stays 1.0
- `ephemeral` + high salience → ephemeral wins, archives at deadline despite high salience

### Sensitivity Field (Access Control Only)

- **Field**: `sensitivity: enum (low | normal | high)` - defaults to `normal`
- **Scope**: Episodic nodes only (Source, Artifact)
- **Does NOT affect decay behavior** - purely a governance flag for permissions/access control
- **Use cases**: audit trails, privacy controls, data classification
- Semantic nodes (Person/Concept/Entity) do NOT have sensitivity field

**Raw Data Preservation** (Episodic nodes):
- Source node `raw_content` field preserves unprocessed data indefinitely
- Persists even if Source is archived (state: 'archived')
- Independent of ttl_policy and salience

**Note Retention:**
- Each note in the `notes` array (on both nodes and relationships) has its own `expires_at` timestamp
- Notes with `expires_at` in the past are automatically deleted during nightly cleanup
- Notes with `expires_at = null` (lifetime: "forever") are never deleted
- Agent chooses lifetime based on information relevance:
  - "week" for transient details (temporary situations, short-term plans)
  - "month" for typical contextual information (default)
  - "year" for long-term relevant details (major life events, ongoing projects)
  - "forever" for foundational facts (core personality traits, permanent relationships)
