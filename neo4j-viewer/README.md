# Neo4j Knowledge Graph Viewer

A visual interface for exploring Neo4j knowledge graph data from the Cosmo backend. Built with React, TypeScript, and Vite.

## Features

- **User Selection**: Select any user from the database to view their knowledge graph
- **Interactive Force Graph**: D3-powered force-directed graph with zoom, pan, and drag
- **Node Type Filtering**: Toggle visibility of different entity types (Person, Project, Topic, Idea, etc.)
- **Search**: Find nodes by name
- **Node Details**: Click nodes to see full entity details
- **Relationship Inspection**: Hover over links to see relationship properties
- **Real-time Data**: Fetches live data from Neo4j via backend API

## Setup

### Prerequisites

- Node.js 20+
- Backend API running on `localhost:3001` (see `backend/` directory)
- Neo4j database with data (via backend connection)

### Installation

```bash
cd neo4j-viewer
pnpm install
```

### Configuration

**1. Copy environment file:**
```bash
cp .env.example .env.local
```

**2. Configure admin API key:**
The viewer uses an admin API key to bypass JWT authentication. This key must match the `ADMIN_API_KEY` in your backend `.env`:

```bash
# In neo4j-viewer/.env.local
VITE_ADMIN_API_KEY=dev-admin-key-local-only-change-in-production

# In backend/.env
ADMIN_API_KEY=dev-admin-key-local-only-change-in-production
```

**3. API Proxy:**
The viewer proxies API requests through Vite dev server to avoid CORS issues. By default:
- Frontend runs on: `http://localhost:5173`
- Backend API proxied from: `http://localhost:3001`

To change the backend URL, edit `vite.config.ts`:

```typescript
proxy: {
  '/api': {
    target: 'http://localhost:YOUR_PORT',
    changeOrigin: true,
  },
}
```

## Development

Start the dev server:

```bash
pnpm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Project Structure

```
neo4j-viewer/
├── src/
│   ├── components/
│   │   └── graph/          # Graph visualization components (from web app)
│   ├── lib/
│   │   └── api.ts          # Backend API client
│   ├── App.tsx             # Main application
│   ├── App.css             # Styles
│   └── main.tsx            # Entry point
├── vite.config.ts          # Vite config with backend proxy
└── package.json
```

## API Endpoints Used

### `GET /api/graph/users`
Returns list of all users for dropdown selector.

**Response:**
```json
{
  "users": [
    {
      "id": "user-uuid",
      "name": "User Name",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### `GET /api/graph/users/:userId/full-graph`
Returns complete graph data for a specific user.

**Response:**
```json
{
  "nodes": [
    {
      "id": "node-id",
      "name": "Node Name",
      "type": "Person",
      "val": 1,
      "details": { /* entity-specific properties */ }
    }
  ],
  "links": [
    {
      "source": "node-id-1",
      "target": "node-id-2",
      "label": "KNOWS",
      "value": 1,
      "properties": { /* relationship properties */ }
    }
  ]
}
```

## Usage

1. **Start the backend** (in `backend/` directory):
   ```bash
   pnpm run dev
   ```

2. **Start the viewer**:
   ```bash
   cd neo4j-viewer
   pnpm run dev
   ```

3. **Select a user** from the dropdown to load their knowledge graph

4. **Interact with the graph**:
   - **Click nodes** to view details
   - **Hover over links** to see relationship properties
   - **Drag nodes** to reposition
   - **Zoom/pan** to navigate large graphs
   - **Use filter buttons** to show/hide node types
   - **Search** for specific nodes

## Building for Production

```bash
pnpm run build
```

Output will be in `dist/` directory. Serve with any static file server.

**Note**: Update API proxy configuration for production deployment.

## Tech Stack

- **React 19** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **react-force-graph-2d** - Force-directed graph visualization
- **D3** - Graph layout and rendering (via react-force-graph-2d)

## Troubleshooting

### "Failed to fetch users" error
- Ensure backend is running on `localhost:3001`
- Check backend logs for errors
- Verify Neo4j connection in backend

### Empty graph
- Ensure user has entities in Neo4j database
- Run memory extraction pipeline on backend to populate graph
- Check `entities_extracted` flag on conversations in PostgreSQL

### Graph renders but no links
- Check that relationships exist in Neo4j
- Verify `KNOWS`, `WORKING_ON`, `INTERESTED_IN` relationships are created
- Run Neo4j query: `MATCH (u:User {id: $userId})-[r]-(n) RETURN count(r)`

## Development Notes

- Graph components copied from `web/src/components/graph/`
- Keep components in sync if updating visualization logic
- Backend types defined in `backend/src/types/visualization.ts`
- Frontend types in `src/components/graph/types.ts` (should match backend)
