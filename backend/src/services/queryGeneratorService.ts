/**
 * Query Generator Service
 *
 * Uses GPT-5-nano to convert natural language descriptions into:
 * 1. Explore tool JSON (semantic search)
 * 2. Cypher queries
 */

import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { withSpan, buildEntityAttributes } from '../utils/tracing.js';

export type QueryType = 'explore' | 'cypher';

export interface GeneratedExploreQuery {
  type: 'explore';
  json: {
    queries?: Array<{ query: string; threshold: number }>;
    text_matches?: string[];
    return_explanations?: boolean;
  };
  explanation: string;
}

export interface GeneratedCypherQuery {
  type: 'cypher';
  query: string;
  explanation: string;
}

export type GeneratedQuery = GeneratedExploreQuery | GeneratedCypherQuery;

// Zod schemas for structured output
const ExploreQuerySchema = z.object({
  json: z.object({
    queries: z.array(z.object({
      query: z.string(),
      threshold: z.number(),
    })).optional(),
    text_matches: z.array(z.string()).optional(),
    return_explanations: z.boolean().optional(),
  }),
  explanation: z.string(),
});

const CypherQuerySchema = z.object({
  query: z.string(),
  explanation: z.string(),
});

// Infer types from schemas
type ExploreQueryResult = z.infer<typeof ExploreQuerySchema>;
type CypherQueryResult = z.infer<typeof CypherQuerySchema>;

class QueryGeneratorService {
  constructor() {
    // Service uses AI SDK directly, no model instance needed
  }

  /**
   * Generate an explore tool JSON query from natural language
   */
  async generateExploreQuery(description: string, userId?: string): Promise<GeneratedExploreQuery> {
    return withSpan(
      'service.queryGenerator.generateExploreQuery',
      buildEntityAttributes('query_generation', 'create', {
        userId: userId ?? 'unknown',
        entityCount: 1,
      }),
      async () => {
        const prompt = `You are a query generator for a Neo4j knowledge graph with semantic search capabilities.

The explore tool accepts JSON in this format:
{
  "queries": [
    {"query": "semantic search query", "threshold": 0.6}
  ],
  "text_matches": ["exact name to match"],
  "return_explanations": true
}

Guidelines:
- "queries" is for semantic/conceptual searches (e.g., "career planning", "relationships", "health topics")
- "text_matches" is for exact/fuzzy name matching (e.g., person names, company names)
- threshold is cosine similarity (0-1), default 0.6, lower = more results
- You can include both queries and text_matches in the same request

User's natural language description: "${description}"

Generate appropriate explore tool JSON based on the description. If the user mentions specific names, include them in text_matches. If they describe concepts/topics, include them in queries.`;

        try {
          const { object } = await generateObject({
            model: openai('gpt-5-nano', {
              reasoningEffort: 'low', // Use low reasoning for faster execution
            }),
            prompt,
            schema: ExploreQuerySchema,
            experimental_telemetry: {
              isEnabled: true,
              functionId: 'query-generator-explore',
              metadata: {
                queryType: 'semantic',
                ...(userId && { userId }),
              },
            },
          }) as { object: ExploreQueryResult };

          return {
            type: 'explore',
            json: object.json,
            explanation: object.explanation,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          throw new Error(`Failed to generate explore query: ${errorMessage}`);
        }
      }
    );
  }

  /**
   * Generate a Cypher query from natural language
   */
  async generateCypherQuery(description: string, userId?: string): Promise<GeneratedCypherQuery> {
    return withSpan(
      'service.queryGenerator.generateCypherQuery',
      buildEntityAttributes('query_generation', 'create', {
        userId: userId ?? 'unknown',
        entityCount: 1,
      }),
      async () => {
        const prompt = `You are a Cypher query generator for a Neo4j knowledge graph.

Graph schema:
- Node types: Person, Concept, Entity, Source, Artifact
- Person properties: name, appearance, situation, history, personality, expertise, interests, notes, description
- Concept properties: name, description, notes
- Entity properties: name, description, notes
- Source properties: description, content (JSON), type
- Artifact properties: description, content (JSON), type

Common relationships:
- (Person)-[:engages_with]->(Concept)
- (Person)-[:has_relationship_with]->(Person)
- (Concept)-[:relates_to]->(Concept)
- (Concept)-[:involves]->(Person|Entity)
- (Person)-[:associated_with]->(Entity)
- (Entity)-[:relates_to]->(Entity)
- (Source)-[:mentions]->(Person|Concept|Entity)

All nodes have:
- entity_key (unique identifier)
- user_id (for multi-tenancy)
- created_at, updated_at

CRITICAL SECURITY RULE:
ALL queries MUST include {user_id: $user_id} constraint to prevent cross-user data access.

Examples:
- "Find all people mentioned" → MATCH (p:Person {user_id: $user_id}) RETURN p
- "Show Sarah's relationships" → MATCH (p:Person {user_id: $user_id})-[r:has_relationship_with]->(other:Person) WHERE toLower(p.name) = 'sarah' RETURN p, r, other
- "Find career-related concepts" → MATCH (c:Concept {user_id: $user_id}) WHERE c.name CONTAINS 'career' OR c.description CONTAINS 'career' RETURN c

User's natural language description: "${description}"

Generate an appropriate Cypher query.`;

        try {
          const { object } = await generateObject({
            model: openai('gpt-5-nano', {
              reasoningEffort: 'low', // Use low reasoning for faster execution
            }),
            prompt,
            schema: CypherQuerySchema,
            experimental_telemetry: {
              isEnabled: true,
              functionId: 'query-generator-cypher',
              metadata: {
                queryType: 'traversal',
                ...(userId && { userId }),
              },
            },
          }) as { object: CypherQueryResult };

          return {
            type: 'cypher',
            query: object.query,
            explanation: object.explanation,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          throw new Error(`Failed to generate Cypher query: ${errorMessage}`);
        }
      }
    );
  }

  /**
   * Auto-detect query type and generate appropriate query
   */
  async generateQuery(description: string, preferredType?: QueryType): Promise<GeneratedQuery> {
    // If type is specified, use it
    if (preferredType === 'explore') {
      return this.generateExploreQuery(description);
    }
    if (preferredType === 'cypher') {
      return this.generateCypherQuery(description);
    }

    // Auto-detect: Use explore for semantic/conceptual queries, Cypher for specific graph traversals
    const lowerDesc = description.toLowerCase();
    const cypherKeywords = ['relationship', 'path', 'connected', 'between', 'traverse', 'match', 'return'];
    const exploreKeywords = ['find', 'search', 'about', 'related to', 'topics', 'concepts'];

    const hasCypherIntent = cypherKeywords.some(kw => lowerDesc.includes(kw));
    const hasExploreIntent = exploreKeywords.some(kw => lowerDesc.includes(kw));

    // Default to explore for most queries (it's more user-friendly)
    if (hasCypherIntent && !hasExploreIntent) {
      return this.generateCypherQuery(description);
    }

    return this.generateExploreQuery(description);
  }
}

export const queryGeneratorService = new QueryGeneratorService();
