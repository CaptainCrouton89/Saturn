# Web App & Documentation Overview

## Table of Contents
1. [Next.js App Structure](#nextjs-app-structure)
2. [Key Documentation](#key-documentation)
3. [Landing Page Architecture](#landing-page-architecture)
4. [API Reference Documentation](#api-reference-documentation)
5. [Component Library](#component-library)
6. [Development Patterns](#development-patterns)

---

## Next.js App Structure

### Directory Layout

```
web/
├── src/
│   ├── app/                    # Next.js App Router (pages & API routes)
│   │   ├── page.tsx            # Landing page (waitlist + graph demo)
│   │   ├── layout.tsx           # Root layout (fonts, metadata)
│   │   ├── upload/             # Information dump upload UI
│   │   │   ├── page.tsx        # Upload form
│   │   │   └── status/[id]/    # Job status checker
│   │   ├── viewer/             # Graph viewer (admin tool)
│   │   │   └── page.tsx        # Full graph visualization interface
│   │   └── api/                # Server-side API routes (proxies)
│   │       ├── upload/         # Information dump proxy
│   │       └── waitlist/       # Waitlist signup (writes to Supabase)
│   ├── components/
│   │   ├── ui/                 # shadcn/ui components (button, card, input, etc.)
│   │   ├── graph/              # Knowledge graph visualization
│   │   │   ├── KnowledgeGraph.tsx      # Main D3 force graph component
│   │   │   ├── GraphControls.tsx       # Filtering & interaction controls
│   │   │   ├── NodeDetailPanel.tsx     # Node information sidebar
│   │   │   ├── LinkTooltip.tsx         # Relationship tooltips
│   │   │   ├── formatters.tsx          # Node/link formatting utilities
│   │   │   └── types.ts                # Graph data type definitions
│   │   └── search/             # Search & pipeline visualization
│   │       ├── SearchBar.tsx
│   │       └── PipelineVisualization.tsx
│   ├── lib/
│   │   ├── api.ts              # ⭐ Centralized API client (use this!)
│   │   ├── supabase.ts         # Client-side Supabase client
│   │   ├── supabase-server.ts  # Server-side Supabase client
│   │   ├── graphUtils.ts       # Graph data transformation utilities
│   │   └── utils.ts            # General utilities (cn, etc.)
│   └── types/
│       ├── database.types.ts   # Generated Supabase types
│       └── search.ts            # Search-related types
├── public/                      # Static assets (SVGs, images)
├── components.json             # shadcn/ui configuration
├── next.config.ts              # Next.js configuration
├── package.json                # Dependencies
└── tsconfig.json               # TypeScript configuration
```

### Key Technologies

- **Framework**: Next.js 16 (App Router)
- **Styling**: Tailwind CSS 4 with custom design tokens
- **UI Components**: shadcn/ui (Radix UI primitives)
- **Graph Visualization**: react-force-graph-2d (D3 force-directed graph)
- **Database**: Supabase (PostgreSQL) for waitlist
- **API Client**: Centralized fetch wrapper in `lib/api.ts`

---

## Key Documentation

### Project Documentation (`docs/`)

#### API Endpoints (`docs/api-endpoints.md`)
Comprehensive API specification covering:
- **Authentication endpoints**: Device registration, token validation, refresh
- **App initialization**: `/api/init` - single endpoint for startup data
- **Conversation endpoints**: Create, exchange, end conversations
- **Preference management**: User preferences for conversation style
- **History & artifacts**: Browse past conversations and generated content
- **LangGraph integration**: State management, checkpointing, tool execution patterns

**Key Endpoints**:
- `POST /api/conversations` - Create conversation
- `POST /api/conversations/:id/exchange` - Real-time exchange (core conversational endpoint)
- `POST /api/conversations/:id/end` - End conversation + trigger background processing
- `GET /api/init` - Load all initialization data (preferences, recent conversations, stats)

#### API Reference Guides (`docs/api-references/`)

**LangGraph Guide** (`langgraph-guide.md`):
- State management with reducers (prevent concurrent overwrites)
- Checkpointing for conversation persistence (thread-based)
- Context loading pattern (first turn only, cached)
- Sliding window message management (keep last 10-15 turns verbatim)
- Command pattern for state updates + navigation
- Streaming modes (values, updates, messages)
- Error handling patterns
- Cosmo-specific full implementation pattern

**AssemblyAI STT Guide** (`assemblyai-stt-guide.md`):
- Realtime streaming event order (Begin → Turn → Termination)
- File format limitations (WAV/PCM16 single-channel only)
- Custom spellings vs pronunciation
- Content safety confidence thresholds
- Speaker labels for sentiment-per-speaker
- PII redaction (audio vs text)
- LeMUR input customization

**ElevenLabs TTS Guide** (`elevenlabs-tts-guide.md`):
- Request stitching for consistent audio prosody
- Streaming latency optimization (0-4 scale)
- Model selection (flash_v2_5 for realtime, turbo_v2_5 for balanced)
- Speech-to-speech for emotion preservation
- Pronunciation dictionaries (versioned)
- Voice settings precedence (global vs per-request)

#### User Flow Documentation (`docs/user-flows/`)

**Onboarding Flow** (`onboarding-flow.yaml`):
- Minimal onboarding (1-2 sentences explanation)
- Permission requests (microphone, notifications)
- Quick intro questions
- No tutorial, no mode selection
- Seamless transition to first conversation
- Duration: ~2 minutes setup, 10-20 minutes first conversation

**Ongoing Conversation Flow** (`ongoing-conversation-flow.yaml`):
- Zero-friction start (open app → speak)
- Context loading (background, invisible)
- Active conversation with sliding window
- Memory usage (informed understanding, not showmanship)
- Auto-end after 3-5 min silence
- Post-conversation batch processing (entity extraction, graph updates)

#### Planning Documents (`docs/plans/`)

**Information Dump** (`plans/information-dump/`):
- Requirements and investigation notes
- Entity management patterns
- Conversation pipeline design

**Manual Upload** (`plans/manual-upload/plan.md`):
- Upload form implementation plan
- Processing workflow

---

## Landing Page Architecture

### Main Landing Page (`src/app/page.tsx`)

**Structure**:
1. **Hero Section**: Main headline, tagline, waitlist form
2. **Problem Recognition**: "You've seen the AI therapist..."
3. **Differentiator Section**: 3 criteria (smart, knows you, enjoyable)
4. **Use Case Examples**: 3 cards (Work Drama, Relationship Decision, Career Transition)
5. **How It Works**: 3-step process (You talk → Cosmo asks → Clarity emerges)
6. **Knowledge Graph Visualization**: Interactive D3 graph demo
7. **Final CTA**: Waitlist signup
8. **Footer**: Link to upload page

**Key Features**:
- Scroll animations (Intersection Observer)
- Responsive design (mobile-first)
- Dynamic graph import (SSR disabled for D3)
- Waitlist form component (reusable, two variants: default, cta)

**Design System**:
- **Colors**: Cream/beige palette (`--cream`, `--beige`, `--primary`)
- **Typography**: Merriweather (headings), Inter (body)
- **Components**: shadcn/ui (Button, Card, Input)

### Graph Visualization Demo

**Demo Data** (`page.tsx:144-159`):
- 5 nodes: Person (Sarah), Concept (Career Growth), Source (Morning Conversation), Entity (Tech Startup), Artifact (Action Plan)
- 5 relationships showing connections
- Interactive: Click nodes, hover for details, pan/zoom

**Component**: `KnowledgeGraph` from `components/graph/KnowledgeGraph.tsx`
- Uses `react-force-graph-2d` (D3 force simulation)
- Custom node rendering with type-based colors
- Link tooltips with relationship labels
- Node detail panel on click

---

## API Reference Documentation

### Centralized API Client (`src/lib/api.ts`)

**Purpose**: Single source of truth for all backend API calls. **Always use this instead of raw fetch.**

**Key Functions**:

#### Information Dump API
```typescript
createInformationDump(data, token): Promise<CreateInformationDumpResponse>
getInformationDumpStatus(dumpId, token): Promise<InformationDump>
listInformationDumps(token, options?): Promise<ListInformationDumpsResponse>
```

#### Graph API (Admin)
```typescript
fetchUsers(): Promise<User[]>
fetchGraphData(userId): Promise<GraphData>
executeManualQuery({ userId, cypherQuery }): Promise<GraphData>
executeExplore({ userId, queries?, textMatches?, returnExplanations? }): Promise<GraphData>
generateQuery({ description, type? }): Promise<GeneratedQuery>
```

**Authentication**:
- **Admin**: Uses `NEXT_PUBLIC_ADMIN_KEY` (X-Admin-Key header)
- **User**: Uses JWT token (Authorization: Bearer token)
- **None**: Public endpoints (waitlist)

**Error Handling**: Throws errors with backend error messages

**Data Transformation**: Transforms backend `properties` → frontend `details` for graph nodes

### Next.js API Routes (`src/app/api/`)

**Purpose**: Thin proxies for:
- Adding server-side authentication
- Hiding backend URL from client
- Server-side operations (Supabase writes)

**Routes**:
- `/api/upload` - Proxies to backend `/api/information-dumps`
- `/api/waitlist` - Writes directly to Supabase `waitlist` table

**Pattern**: Don't duplicate validation - let backend handle it.

---

## Component Library

### UI Components (`src/components/ui/`)

**shadcn/ui Components** (Radix UI + Tailwind):
- `button.tsx` - Variants: default, outline, secondary, destructive
- `card.tsx` - Card, CardContent, CardDescription, CardTitle
- `input.tsx` - Text input with validation states
- `textarea.tsx` - Multi-line text input
- `label.tsx` - Form labels
- `dialog.tsx` - Modal dialogs
- `accordion.tsx` - Collapsible sections
- `avatar.tsx` - User avatars
- `badge.tsx` - Status badges
- `separator.tsx` - Visual dividers
- `sheet.tsx` - Slide-out panels

**Styling**: Uses `cn()` utility (clsx + tailwind-merge) for conditional classes

### Graph Components (`src/components/graph/`)

**KnowledgeGraph.tsx**:
- Props: `data`, `width`, `height`, `highlightedNodeIds?`
- Features:
  - D3 force simulation (collision detection, link distance)
  - Custom node rendering (type-based colors, logarithmic sizing)
  - Node click → detail panel
  - Link hover → tooltip
  - Pan/zoom controls
  - Highlighted nodes (different visual style)

**GraphControls.tsx**:
- Name filter (text input)
- Node type toggles (Person, Concept, Entity, Source, Artifact)
- Reset filters

**NodeDetailPanel.tsx**:
- Sidebar showing selected node details
- Properties display (formatted)
- Relationship list
- Close button

**LinkTooltip.tsx**:
- Hover tooltip for relationships
- Shows relationship label and properties

**formatters.tsx**:
- `getNodeLabel(name)`: Truncates long names
- `formatNodeDetails(details)`: Formats node properties for display

**types.ts**:
```typescript
type NodeType = 'Person' | 'Concept' | 'Entity' | 'Source' | 'Artifact';
interface GraphNode { id, name, type, val?, details? }
interface GraphLink { source, target, label?, properties? }
interface GraphData { nodes, links }
```

---

## Development Patterns

### API Calls Pattern

**✅ DO**: Use centralized API client
```typescript
import { createInformationDump, fetchGraphData } from '@/lib/api';
const result = await createInformationDump({ title, content }, token);
```

**❌ DON'T**: Write raw fetch logic
```typescript
// Don't do this
const response = await fetch(`${API_URL}/api/information-dumps`, { ... });
```

### Component Organization

**Client Components** (`"use client"`):
- Interactive forms (upload page)
- Graph visualization (D3 requires browser APIs)
- State management (useState, useEffect)

**Server Components** (default):
- Static pages (landing page sections)
- Data fetching without user interaction
- SEO-critical content

### Environment Variables

**Client-side** (`NEXT_PUBLIC_*`):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_ADMIN_KEY` (⚠️ exposed to browser)

**Server-side** (API routes, Server Components):
- Can access all env vars (not just `NEXT_PUBLIC_*`)

### Graph Data Flow

1. **Backend** returns nodes with `properties` field
2. **API client** (`lib/api.ts`) transforms `properties` → `details`
3. **Components** consume `GraphData` with `details` field
4. **GraphUtils** (`lib/graphUtils.ts`) provides color/label helpers

### Styling Patterns

**Tailwind CSS 4** with custom tokens:
- Colors: `bg-cream`, `bg-beige`, `text-primary`, `text-success`
- Typography: `font-heading` (Merriweather), `font-body` (Inter)
- Spacing: Standard Tailwind scale

**Component Styling**:
- Use `cn()` for conditional classes
- Follow shadcn/ui patterns for variants
- Responsive: Mobile-first (default), then `md:`, `lg:` breakpoints

---

## Pages Overview

### Public Pages

**`/` (Landing Page)**:
- Hero with waitlist form
- Product explanation sections
- Interactive graph demo
- Final CTA

**`/upload`**:
- Information dump upload form
- User selector (admin tool)
- Source type selector
- Title, label, content fields
- Success state with job ID

**`/upload/status/[id]`**:
- Job status checker
- Polling for processing status
- Display completion/error states

### Admin Pages

**`/viewer`**:
- User selector dropdown
- Full graph view with filtering
- Manual Cypher query execution
- Explore tool (semantic search + graph expansion)
- AI query generator (natural language → query)
- Graph visualization with controls

**Access**: Requires `NEXT_PUBLIC_ADMIN_KEY` (currently exposed in client)

---

## Known Limitations (MVP)

- ❌ No user authentication (hardcoded test-user-id in upload)
- ❌ No JWT token generation
- ❌ Admin key exposed in client (`NEXT_PUBLIC_ADMIN_KEY`)
- ❌ Upload endpoint bypasses backend auth (no JWT sent)

**TODO**: Implement proper JWT-based authentication for production.

---

## Common Tasks

### Adding a New Page

1. Create `app/my-page/page.tsx`
2. Export default component
3. Use `"use client"` if interactive
4. Add link from landing page or nav

### Adding a New API Endpoint

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

### Updating Supabase Types

```bash
cd web
pnpm run db:pull  # Generates types/database.types.ts
```

Run after changing database schema in Supabase Studio.

### Debugging Backend Connection

Check environment variables:
```typescript
console.log(process.env.NEXT_PUBLIC_API_URL);
```

Check network tab in browser DevTools for failed requests.

---

## Summary

The web app serves as:
1. **Landing page** for waitlist signup and product demonstration
2. **Admin tools** for graph visualization and content upload
3. **Documentation hub** for API references and user flows

**Key Principles**:
- Centralized API client (`lib/api.ts`) - always use this
- Thin API route proxies - don't duplicate validation
- Client/Server component separation - use `"use client"` only when needed
- Design system consistency - Tailwind + shadcn/ui
- Type safety - TypeScript throughout, no `any` types

**Architecture Highlights**:
- Next.js 16 App Router for routing
- D3 force graph for knowledge graph visualization
- Supabase for waitlist storage
- Centralized backend API client with auth handling
- Comprehensive documentation in `docs/` directory
