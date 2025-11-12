# Saturn Web App - CLAUDE.md

Next.js 16 landing page and admin tools for Cosmo AI companion.

## Development Commands

```bash
pnpm install              # Install dependencies
pnpm run dev              # Dev server at localhost:3000
pnpm run build            # Production build
pnpm run db:pull          # Generate Supabase types from schema
```

## Architecture

```
src/
├── app/                  # Next.js App Router
│   ├── page.tsx          # Landing page (waitlist + graph viz)
│   ├── upload/           # Information dump upload UI
│   │   ├── page.tsx      # Upload form
│   │   └── status/[id]/  # Job status checker
│   ├── viewer/           # Graph viewer (admin tool)
│   └── api/              # Server-side API routes (proxies to backend)
│       ├── upload/       # Information dump proxy
│       └── waitlist/     # Waitlist signup (writes to Supabase)
├── components/
│   ├── ui/               # shadcn/ui components
│   └── graph/            # Knowledge graph visualization (D3 force graph)
├── lib/
│   ├── api.ts            # **Centralized API client** (use this!)
│   ├── supabase.ts       # Client-side Supabase client
│   ├── supabase-server.ts# Server-side Supabase client
│   └── graphUtils.ts     # Graph data transformation utils
└── types/                # TypeScript type definitions
```

## Key Patterns

### API Calls: Use Centralized Client

**ALWAYS use `lib/api.ts`** for backend API calls. Never write raw fetch logic.

```typescript
import { createInformationDump, fetchGraphData } from '@/lib/api';

// User-authenticated endpoints (requires JWT token)
const result = await createInformationDump(
  { title: 'Test', content: '...' },
  userToken
);

// Admin endpoints (uses NEXT_PUBLIC_ADMIN_KEY)
const graphData = await fetchGraphData(userId);
```

### Next.js API Routes: Thin Proxies Only

Use `app/api/*` routes ONLY for:
- Adding server-side authentication (JWT generation)
- Hiding backend URL from client
- Server-side operations (Supabase writes)

**Don't duplicate validation** - let the backend handle it.

### Environment Variables

Required in `.env.local`:
```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_API_URL=https://saturn-backend-production.up.railway.app
NEXT_PUBLIC_ADMIN_KEY=...  # For admin tools (viewer, graph queries)
```

Client-side: `NEXT_PUBLIC_*` variables only (exposed to browser)
Server-side: Can access all env vars (API routes, Server Components)

### Component Organization

**Client Components** (`"use client"`):
- Interactive forms (upload page)
- Graph visualization (D3 requires browser APIs)
- State management with useState/useEffect

**Server Components** (default):
- Static pages (landing page)
- Data fetching without user interaction
- SEO-critical content

## Pages & Routes

### Public Pages

- `/` - Landing page with waitlist signup and graph demo
- `/upload` - Information dump upload form (MVP: hardcoded test-user-id)
- `/upload/status/[id]` - Check information dump processing status

### Admin Pages

- `/viewer` - Graph visualization tool (requires NEXT_PUBLIC_ADMIN_KEY)
  - User selector dropdown
  - Full graph view with filtering
  - Manual Cypher query execution
  - Explore tool (semantic search + graph expansion)
  - Natural language query generator

## API Integration

### Backend Endpoints Used

All defined in `lib/api.ts`:

**Information Dumps** (User Auth):
- `POST /api/information-dumps` - Upload content for ingestion
- `GET /api/information-dumps/:id` - Check processing status
- `GET /api/information-dumps` - List user's dumps

**Graph Queries** (Admin Auth):
- `GET /api/graph/users` - List all users
- `GET /api/graph/users/:id/full-graph` - Get user's full knowledge graph
- `POST /api/graph/query` - Execute manual Cypher query
- `POST /api/graph/explore` - Semantic search + graph expansion
- `POST /api/graph/generate-query` - Generate query from natural language

### Adding New API Endpoint

1. Add function to `lib/api.ts`:
   ```typescript
   export async function myNewEndpoint(params: MyParams): Promise<MyResponse> {
     return apiFetch('/api/my-endpoint', {
       method: 'POST',
       body: params,
       authType: 'user', // or 'admin' or 'none'
       token // if authType is 'user'
     });
   }
   ```

2. Use in components:
   ```typescript
   import { myNewEndpoint } from '@/lib/api';
   const result = await myNewEndpoint({ ... });
   ```

**Don't create duplicate fetch logic!**

## Supabase Integration

### Client-Side (Components)

```typescript
import { supabase } from '@/lib/supabase';
const { data, error } = await supabase
  .from('waitlist')
  .insert({ email });
```

### Server-Side (API Routes, Server Components)

```typescript
import { createClient } from '@/lib/supabase-server';
const supabase = createClient();
const { data, error } = await supabase
  .from('waitlist')
  .select('*');
```

## Styling

- **Tailwind CSS 4** with custom design tokens
- **shadcn/ui** components in `components/ui/`
- **Design system**: Cream/beige color palette, serif headings (font-heading)

Custom colors defined in `globals.css`:
- `--cream`, `--beige`, `--primary`, `--success`, `--destructive`

## Graph Visualization

Uses `react-force-graph-2d` (D3 force-directed graph):

```typescript
import KnowledgeGraph from '@/components/graph/KnowledgeGraph';

<KnowledgeGraph
  data={graphData}
  onNodeClick={(node) => console.log(node)}
  nameFilter="sarah"  // Filter nodes by name
  selectedNodeTypes={new Set(['Person', 'Concept'])}  // Filter by type
/>
```

**Node Types**: Person, Concept, Entity, Source, Artifact

## Known Limitations (MVP)

- ❌ No user authentication (hardcoded test-user-id)
- ❌ No JWT token generation
- ❌ Admin key exposed in client (NEXT_PUBLIC_ADMIN_KEY)
- ❌ Upload endpoint bypasses backend auth (no JWT sent)

**TODO**: Implement proper JWT-based authentication for production.

## Common Tasks

### Adding a New Page

1. Create `app/my-page/page.tsx`
2. Export default component
3. Use client directive if interactive: `"use client"`
4. Add link from landing page or nav

### Updating Supabase Types

```bash
pnpm run db:pull  # Generates types/database.types.ts
```

Run this after changing database schema in Supabase Studio.

### Debugging Backend Connection

Check environment variables:
```typescript
console.log(process.env.NEXT_PUBLIC_API_URL);
```

Check network tab in browser DevTools for failed requests.

## Notes

- Graph viewer is admin-only (requires manual URL navigation to `/viewer`)
- Upload form uses Next.js API route proxy (client → `/api/upload` → backend)
- All admin tools use `NEXT_PUBLIC_ADMIN_KEY` for authentication
- Backend API response format: snake_case (matches PostgreSQL schema)
