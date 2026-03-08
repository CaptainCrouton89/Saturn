# Graph Components - CLAUDE.md

D3 force-directed knowledge graph visualization for Saturn's Neo4j semantic network.

## Architecture

- **KnowledgeGraph.tsx** - Main component wrapping `react-force-graph-2d`
- **graphUtils.ts** - Neo4j query response → D3-compatible data transformation
- Node type components - Render type-specific UI (Person, Concept, Entity, etc.)

## Data Flow

Neo4j query response → `transformGraphData()` → `{ nodes: [], links: [] }` → D3 renderer

**Node structure:**
```typescript
{ id: string; label: string; type: NodeType; properties: Record<string, any>; }
```

**Link structure:**
```typescript
{ source: nodeId; target: nodeId; type: string; properties: Record<string, any>; }
```

## Key Patterns

### Filtering
- `nameFilter` - Substring match on node labels (case-insensitive)
- `selectedNodeTypes` - Set of visible node types (Person, Concept, Entity, Source, Artifact)
- Apply filters client-side during render (avoid over-fetching)

### Interactivity
- `onNodeClick` callback for node selection
- D3 handles drag, zoom, pan automatically
- Node colors/sizes by type (defined in styling config)

### Performance
- `react-force-graph-2d` uses Canvas (not SVG) for rendering >1000 nodes
- Memoize expensive data transformations
- Pass stable object references to prevent re-simulations

## Common Tasks

**Add new node type:**
1. Update `NodeType` enum in types
2. Add styling config (color, size) in KnowledgeGraph.tsx
3. Update `transformGraphData()` to handle new type
4. Add filter option in parent component

**Customize node appearance:**
- Edit node color/size logic in `nodeCanvasObject()` callback
- D3 force simulation parameters in KnowledgeGraph props

## Notes

- Nodes are scoped by `user_id` from Neo4j queries
- Link types preserve relationship semantics (e.g., "knows", "mentioned_in")
- Graph updates trigger full re-simulation (not incremental)
