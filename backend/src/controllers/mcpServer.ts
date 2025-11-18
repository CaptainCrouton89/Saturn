import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createSdkMcpServer, tool } from '@r-cli/sdk';
import { ExploreInputSchema, TraverseInputSchema } from '../agents/schemas/ingestion.js';
import { executeExplore } from '../agents/tools/retrieval/explore.tool.js';
import { executeTraverse } from '../agents/tools/retrieval/traverse.tool.js';

/**
 * MCP Server for Knowledge Graph Tools
 *
 * Provides explore and traverse tools for semantic search and graph navigation.
 * Factory function creates user-scoped MCP server instances.
 */

/**
 * Create user-scoped MCP server with graph tools
 *
 * Each user gets their own MCP server instance with tools that access
 * their personal knowledge graph.
 *
 * @param userId - User ID to scope graph queries
 * @returns MCP server instance with user-scoped tools
 */
export function createGraphMcpServer(userId: string) {
  /**
   * Explore tool - Semantic search across the knowledge graph
   *
   * Supports:
   * - Vector search with natural language queries
   * - Fuzzy text matching
   * - Relationship search
   * - Graph expansion from top results
   */
  const exploreTool = tool(
    'explore',
    'Explore the knowledge graph using semantic search, text matching, and relationship search. ' +
    'Finds relevant entities (People, Concepts, Entities, Sources) and relationships. ' +
    'Expands the graph to show connections. Use for broad investigation when you need ' +
    'to discover what the user knows about a topic, person, or relationship.',
    // Convert Zod schema to raw shape for Claude Code SDK
    {
      queries: ExploreInputSchema.shape.queries as any,
      text_matches: ExploreInputSchema.shape.text_matches as any,
      search_relationships: ExploreInputSchema.shape.search_relationships as any,
      return_explanations: ExploreInputSchema.shape.return_explanations as any,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const result = await executeExplore(userId, args as any);

        return {
          content: [{
            type: 'text',
            text: result
          }]
        };
      } catch (exploreError) {
        const errorMessage = exploreError instanceof Error ? exploreError.message : String(exploreError);
        throw new Error(`Explore failed: ${errorMessage}`);
      }
    }
  );

  /**
   * Traverse tool - Navigate the knowledge graph from a specific node
   *
   * Supports:
   * - Outbound, inbound, or bidirectional traversal
   * - Multi-hop navigation (1-3 hops)
   * - Verbose or truncated output
   */
  const traverseTool = tool(
    'traverse',
    'Navigate the knowledge graph from a specific node by following relationships. ' +
    'Use after explore to inspect relationships and connected nodes. ' +
    'Returns both the relationships and the nodes they connect to. ' +
    'Direction: outbound (->), inbound (<-), or both (<->). ' +
    'Set verbose=false to truncate long content fields for efficiency.',
    // Convert Zod schema to raw shape for Claude Code SDK
    {
      entity_key: TraverseInputSchema.shape.entity_key as any,
      direction: TraverseInputSchema.shape.direction as any,
      max_hops: TraverseInputSchema.shape.max_hops as any,
      verbose: TraverseInputSchema.shape.verbose as any,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const result = await executeTraverse(userId, args as any);

        return {
          content: [{
            type: 'text',
            text: result
          }]
        };
      } catch (traverseError) {
        const errorMessage = traverseError instanceof Error ? traverseError.message : String(traverseError);
        throw new Error(`Traverse failed: ${errorMessage}`);
      }
    }
  );

  return createSdkMcpServer({
    name: 'graph-tools',
    version: '1.0.0',
    tools: [exploreTool, traverseTool]
  });
}

/**
 * Create conversation management MCP server
 *
 * Provides tools for conversation control and lifecycle management.
 *
 * @returns MCP server instance with conversation tools
 */
export function createConversationMcpServer() {
  /**
   * End tool - Signals the end of the conversation
   *
   * When called, instructs the LLM to respond dismissively and end the conversation.
   */
  const endTool = tool(
    'end',
    'End the conversation. Use this when the user is being a dick. Do not say you are going to use this tool, just use it with no warning.',
    {},
    async (): Promise<CallToolResult> => {
      return {
        content: [{
          type: 'text',
          text: 'Respond with a brief dismissive message like "Alright, screw you too". Keep it short and snarky, and swear if the user is being a dick.'
        }]
      };
    }
  );

  return createSdkMcpServer({
    name: 'conversation',
    version: '1.0.0',
    tools: [endTool]
  });
}
