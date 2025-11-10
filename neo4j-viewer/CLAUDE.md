# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**neo4j-viewer** is a standalone React-based visualization tool for exploring Neo4j knowledge graphs from the Cosmo (Saturn) backend. This is a development/debugging tool, not a production user-facing app.

**Purpose**: Visual inspection of user knowledge graphs (People, Projects, Topics, Ideas) stored in Neo4j, enabling developers to verify graph structure, relationships, and entity properties during development.

## Development Commands

```bash
# Install dependencies
pnpm install

# Development server (connects to backend at localhost:3001)
pnpm run dev              # Opens at http://localhost:5173

# Development with production API (uses VITE_API_URL from .env.production.local)
pnpm run dev:prod

# Type-check and build for production
pnpm run build

# Lint code
pnpm run lint

# Preview production build
pnpm run preview
```

## Environment Setup

**Required**: Backend API must be running on `localhost:3001` (or configured port).

**Environment variables** (create `.env.local` from `.env.example`):
```bash
# Development: Uses Vite proxy to backend
VITE_API_URL=http://localhost:3001

# Admin API key - MUST match backend ADMIN_API_KEY in backend/.env
VITE_ADMIN_API_KEY=dev-admin-key-local-only-change-in-production
```

**Production mode** (`.env.production.local`):
```bash
# Production: Direct API URL (no proxy)
VITE_ENV=production
VITE_API_URL=https://your-backend-domain.com  # or http://ip:port
VITE_ADMIN_API_KEY=your-production-admin-key
```

**Environment validation**: `src/lib/api.ts:9-16` throws errors if `VITE_API_URL` or `VITE_ADMIN_API_KEY` are missing in production mode.

## High-Level Architecture

### Component Flow

```
App.tsx (root)
  ├─ Fetches users via /api/graph/users
  ├─ Fetches graph data via /api/graph/users/:userId/full-graph
  ├─ Applies filtering (search query, node type toggles)
  └─ Renders KnowledgeGraph component
       ├─ ForceGraph2D (react-force-graph-2d)
       │    ├─ Custom node rendering (paintNode)
       │    └─ Custom link rendering (paintLink)
       ├─ GraphControls (zoom in/out/reset)
       ├─ LinkTooltip (relationship properties on hover)
       └─ NodeDetailPanel (entity details on click)
```

### Data Flow

1. **Initial Load**: `App.tsx` fetches all users from backend
2. **User Selection**: Dropdown triggers fetch of full graph for selected user
3. **Filtering**: Local state filters nodes by type and search query
4. **Visualization**: Force-directed graph renders filtered data with D3 physics
5. **Interaction**: Click nodes → detail panel; hover links → property tooltip

### Key Components

**`src/lib/api.ts`** - Backend API client
- `fetchUsers()`: GET `/api/graph/users` → list of users
- `fetchGraphData(userId)`: GET `/api/graph/users/:userId/full-graph` → graph nodes/links
- Injects `X-Admin-Key` header to bypass JWT auth
- Handles environment-based API URL resolution (proxy in dev, direct in prod)

**`src/App.tsx`** - Main application container
- User selection dropdown
- Search input (filters nodes by name)
- Node type filter buttons (toggle visibility per entity type)
- Orchestrates data fetching and filtering logic
- Passes filtered graph data to `KnowledgeGraph`

**`src/components/graph/KnowledgeGraph.tsx`** - Core visualization
- Wraps `react-force-graph-2d` with custom rendering
- `paintNode()`: Custom canvas rendering for nodes with color by type
- `paintLink()`: Custom link rendering with hover highlighting
- D3 force configuration (line 183-188): charge, link distance, collision
- Zoom controls, node click handling, link hover tooltips

**`src/components/graph/NodeDetailPanel.tsx`** - Entity detail sheet
- Displays full properties for clicked node
- Type-specific rendering (Person vs Project vs Topic vs Idea)
- Uses shadcn/ui Sheet component (slide-in panel)

**`src/components/graph/types.ts`** - TypeScript types
- Matches Neo4j schema from `backend/src/types/visualization.ts`
- 8 node types: User, Person, Project, Topic, Idea, Conversation, Note, Artifact
- Type-specific detail interfaces (PersonDetails, ProjectDetails, etc.)
- Relationship property types (KnowsProperties, WorkingOnProperties, etc.)

### Backend Integration

**API Endpoints** (backend routes defined in `backend/src/routes/graphVisualization.ts`):

```typescript
GET /api/graph/users
// Returns: { users: [{ id, name, created_at }] }

GET /api/graph/users/:userId/full-graph
// Returns: { nodes: GraphNode[], links: GraphLink[] }
// Requires: X-Admin-Key header matching backend ADMIN_API_KEY
```

**Authentication**: Uses admin API key instead of JWT tokens (development tool, not user-facing).

**Proxy Configuration** (`vite.config.ts:15-20`):
- Development: `/api/*` proxied to `http://localhost:3001`
- Production: Direct fetch to `VITE_API_URL` (no proxy)

## Critical Context

### Relationship to Parent Project

This is a **standalone development tool** for the Cosmo (Saturn) project. It is NOT part of the main web app or iOS app.

**Graph components copied from**: `../web/src/components/graph/`
- `KnowledgeGraph.tsx`, `NodeDetailPanel.tsx`, `GraphControls.tsx`, `LinkTooltip.tsx`
- Keep in sync with web app if visualization logic changes

**Neo4j schema reference**: `../neo4j.md` and `../backend/src/types/visualization.ts`

### Type Synchronization

**IMPORTANT**: Frontend types in `src/components/graph/types.ts` MUST match backend types in `backend/src/types/visualization.ts`.

When backend adds new entity types or properties:
1. Update `backend/src/types/visualization.ts`
2. Update `src/components/graph/types.ts` to match
3. Update `NodeType` union and detail interfaces accordingly

### Admin API Key Security

**Development**: Default key `dev-admin-key-local-only-change-in-production` is UNSAFE for production.

**Production**: MUST use a secure random key matching backend configuration. Keys are environment variables, never committed to git.

**Why admin key exists**: This viewer needs to query ANY user's graph without device authentication. Admin key bypasses JWT auth layer.

### D3 Force Graph Configuration

**Physics tuning** (in `KnowledgeGraph.tsx:180-189`):
- `charge`: `-300` (repulsion between nodes)
- `link distance`: `100` (minimum spacing between connected nodes)
- `collide radius`: `30` (prevents node overlap)

Adjust these values if graphs look too sparse/dense.

### Environment Variable Handling

**Development**: Vite proxy handles `/api/*` → `http://localhost:3001`
- `VITE_API_URL` is optional (proxy is the default)

**Production**: No proxy, requires explicit `VITE_API_URL`
- `src/lib/api.ts:21-25` builds full URL with protocol handling
- Validates presence in production mode (throws if missing)

### Node Type Filtering

**All node types** (must match `NodeType` in `types.ts`):
- `User` - The user whose graph is being visualized
- `Person` - People mentioned in conversations
- `Project` - User's projects
- `Topic` - Discussion topics
- `Idea` - Emerging ideas
- `Conversation` - Conversation nodes (lightweight summaries)
- `Note` - Long-form notes (for context overflow)
- `Artifact` - Generated artifacts (saved outputs)

Filtering is client-side only (backend always returns full graph).

## Common Patterns

### Adding a New Node Type

When backend adds a new entity type to Neo4j:

1. Update `src/components/graph/types.ts`:
   ```typescript
   // Add to NodeType union
   export type NodeType = 'User' | 'Person' | ... | 'NewType';

   // Add detail interface
   export interface NewTypeDetails {
     // Properties from Neo4j schema
   }
   ```

2. Update `src/lib/graphUtils.ts` color mapping:
   ```typescript
   export function getNodeColor(type: NodeType): string {
     switch (type) {
       case 'NewType': return '#HEXCOLOR';
       // ...
     }
   }
   ```

3. Update `src/App.tsx` nodeTypes array (line 104-113):
   ```typescript
   const nodeTypes: NodeType[] = [..., 'NewType'];
   ```

4. Update `NodeDetailPanel.tsx` to render new type's properties