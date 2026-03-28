/**
 * MCP Server for Saturn Knowledge Graph
 *
 * Mounts on Express as SSE + POST endpoints at /mcp.
 * Exposes explore and traverse tools for use with Claude Desktop,
 * Claude Code, or any MCP client.
 *
 * Required env: SATURN_USER_ID (or passed per-session in the future)
 */

import { Router, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { executeExplore } from './agents/tools/retrieval/explore.tool.js';
import { executeTraverse } from './agents/tools/retrieval/traverse.tool.js';

function createGraphMcpServer(userId: string): McpServer {
  const server = new McpServer({
    name: 'saturn-graph',
    version: '1.0.0',
  });

  server.tool(
    'explore',
    'Explore the knowledge graph using semantic search, text matching, and relationship search. ' +
    'Finds relevant nodes (People, Concepts, Entities, Sources) and expands the graph to show connections between them.\n\n' +
    'Node types: Concepts = ideas, principles, lessons, strategies, themes. Entities = concrete things (tools, products, companies, places). ' +
    'People = individuals. Sources = raw conversation transcripts. Events = time-bound occurrences.\n\n' +
    'Strategy tips:\n' +
    '- For thematic/exploratory queries (e.g. "what are the key lessons"), use node_types: ["concept"] and search_relationships: false to avoid noise.\n' +
    '- For finding specific people/things, use text_matches with their name.\n' +
    '- For understanding how things connect, use search_relationships: true (default) or follow up with the traverse tool.\n' +
    '- Use fewer, more specific queries over many broad ones — each query runs a full vector search.',
    {
      queries: z
        .array(z.object({
          query: z.string().describe('Natural language query to embed and search. Be specific — "hiring philosophy" works better than "best practices".'),
          threshold: z.number().min(0).max(1).describe('Cosine similarity threshold. 0.5+ = tight/specific matches. 0.3-0.5 = moderate recall. Below 0.3 = very broad, likely noisy. Start at 0.4 for most queries.'),
        }))
        .optional()
        .describe('Semantic search queries. Use for finding nodes by meaning/topic. Prefer 1-3 focused queries over many broad ones.'),
      text_matches: z
        .array(z.string())
        .optional()
        .describe('Fuzzy name matching (Jaro-Winkler). Use for known entity/person names — e.g. ["Matt", "Linear"]. Not useful for topic search.'),
      search_relationships: z
        .boolean()
        .optional()
        .describe('Search relationship embeddings to discover nodes connected by relevant edges (default: true). Set to false for broad/thematic queries to reduce noise — relationship search can return many tangential hits. Keep true when exploring how specific entities connect.'),
      return_explanations: z
        .boolean()
        .optional()
        .describe('Include hit counts per signal type (vector, text, relationship) and result stats. Useful for debugging search quality.'),
      node_types: z
        .array(z.enum(['concept', 'entity', 'person', 'event', 'source', 'artifact']))
        .optional()
        .describe('Filter to specific node types. Strongly recommended — omitting searches all types and dilutes results. Use ["concept"] for ideas/lessons/strategies, ["person"] for people, ["entity"] for tools/products/companies, ["source"] for raw transcripts.'),
      max_results_per_type: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe('Max results per node type (default: 10). Lower (3-5) for focused lookups, higher (15-25) for comprehensive sweeps.'),
      time_filter: z
        .object({
          after: z.string().optional().describe('ISO 8601 timestamp — only return nodes created after this time'),
          before: z.string().optional().describe('ISO 8601 timestamp — only return nodes created before this time'),
        })
        .optional()
        .describe('Filter by node created_at. Useful for scoping to recent conversations or a specific time window.'),
    },
    async (args) => {
      const result = await executeExplore(userId, args);
      return { content: [{ type: 'text' as const, text: result }] };
    }
  );

  server.tool(
    'traverse',
    'Navigate the knowledge graph from a specific node by following its relationships. ' +
    'Use after explore to drill into a node\'s connections. Returns the node\'s details plus all connected nodes and relationship metadata.\n\n' +
    'Typical workflow: explore → find interesting entity_key → traverse to see its neighborhood.',
    {
      entity_key: z.string().describe('Entity key of the starting node (get this from explore results)'),
      direction: z
        .enum(['outbound', 'inbound', 'both'])
        .optional()
        .describe('Relationship direction: outbound (this node →), inbound (→ this node), or both (default). Use "outbound" to see what this node relates to, "inbound" to see what references it.'),
      max_hops: z
        .number()
        .min(1)
        .max(3)
        .optional()
        .describe('How many relationship hops to follow (default: 1). Use 1 for direct connections, 2-3 to explore broader neighborhood. Higher = more results but more noise.'),
      limit: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe('Maximum results to return (default: 25). Excess results are truncated with a count. Lower for quick overviews, raise if you need the full neighborhood.'),
      verbose: z
        .boolean()
        .optional()
        .describe('Include full descriptions and notes (default: false). Set true only when you need complete content on every connected node.'),
    },
    async (args) => {
      const result = await executeTraverse(userId, args);
      return { content: [{ type: 'text' as const, text: result }] };
    }
  );

  return server;
}

/**
 * Create Express router for MCP SSE endpoints
 */
export function createMcpRouter(): Router {
  const router = Router();
  const transports = new Map<string, SSEServerTransport>();

  const userId = process.env.SATURN_USER_ID;
  if (!userId) {
    console.warn('SATURN_USER_ID not set — MCP endpoints will return 503');
  }

  // SSE connection endpoint — client GETs this to open the event stream
  router.get('/', async (_req: Request, res: Response) => {
    if (!userId) {
      res.status(503).json({ error: 'SATURN_USER_ID not configured' });
      return;
    }

    const server = createGraphMcpServer(userId);
    const transport = new SSEServerTransport('/mcp', res);

    transports.set(transport.sessionId, transport);

    transport.onclose = () => {
      transports.delete(transport.sessionId);
    };

    await server.connect(transport);
  });

  // Message endpoint — client POSTs JSON-RPC messages here
  router.post('/', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);

    if (!transport) {
      res.status(400).json({ error: 'Invalid or expired session' });
      return;
    }

    await transport.handlePostMessage(req, res, req.body);
  });

  return router;
}
