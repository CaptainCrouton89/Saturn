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
    'Finds relevant entities (People, Concepts, Entities, Sources) and relationships. ' +
    'Expands the graph to show connections.',
    {
      queries: z
        .array(z.object({
          query: z.string().describe('Natural language query to embed and search'),
          threshold: z.number().min(0).max(1).describe('Minimum cosine similarity threshold (0-1)'),
        }))
        .optional()
        .describe('Semantic search queries with similarity thresholds'),
      text_matches: z
        .array(z.string())
        .optional()
        .describe('Exact/fuzzy text matches to search for in entity names'),
      search_relationships: z
        .boolean()
        .optional()
        .describe('Also search relationship properties (default: true)'),
      return_explanations: z
        .boolean()
        .optional()
        .describe('If true, include match scores and features in response'),
      node_types: z
        .array(z.enum(['concept', 'entity', 'person', 'event', 'source', 'artifact']))
        .optional()
        .describe('Filter results to only include these node types. If not specified, all types are included.'),
      max_results_per_type: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe('Maximum number of results to return per node type (default: 10)'),
      time_filter: z
        .object({
          after: z.string().optional().describe('ISO 8601 timestamp — only return nodes created after this time'),
          before: z.string().optional().describe('ISO 8601 timestamp — only return nodes created before this time'),
        })
        .optional()
        .describe('Filter results by node created_at timestamp'),
    },
    async (args) => {
      const result = await executeExplore(userId, args);
      return { content: [{ type: 'text' as const, text: result }] };
    }
  );

  server.tool(
    'traverse',
    'Navigate the knowledge graph from a specific node by following relationships. ' +
    'Use after explore to inspect relationships and connected nodes. ' +
    'Direction: outbound (->), inbound (<-), or both (<->).',
    {
      entity_key: z.string().describe('Entity key of the node to traverse from'),
      direction: z
        .enum(['outbound', 'inbound', 'both'])
        .optional()
        .describe('Direction to traverse: outbound (->), inbound (<-), or both (<->)'),
      max_hops: z
        .number()
        .min(1)
        .max(3)
        .optional()
        .describe('Maximum number of hops to traverse (1-3)'),
      verbose: z
        .boolean()
        .optional()
        .describe('If false, truncate content fields in results'),
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
