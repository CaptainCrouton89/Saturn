import { GraphData } from '@/components/graph/types';

function getApiConfig() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY;

  if (!apiUrl) {
    throw new Error('NEXT_PUBLIC_API_URL environment variable is not set');
  }

  if (!adminKey) {
    throw new Error('NEXT_PUBLIC_ADMIN_KEY environment variable is not set');
  }

  return { apiUrl, adminKey };
}

export interface User {
  id: string;
  name: string;
  created_at: string;
}

/**
 * Fetch all users for dropdown selector
 */
export async function fetchUsers(): Promise<User[]> {
  const { apiUrl, adminKey } = getApiConfig();

  const response = await fetch(`${apiUrl}/api/graph/users`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': adminKey
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch users: ${response.statusText}`);
  }

  const data = await response.json();
  return data.users;
}

/**
 * Fetch full graph data for a specific user
 */
export async function fetchGraphData(userId: string): Promise<GraphData> {
  const { apiUrl, adminKey } = getApiConfig();

  const response = await fetch(`${apiUrl}/api/graph/users/${userId}/full-graph`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': adminKey
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch graph data: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Execute a manual Cypher query against the user's knowledge graph
 */
export async function executeManualQuery({
  userId,
  cypherQuery
}: {
  userId: string;
  cypherQuery: string;
}): Promise<GraphData> {
  const { apiUrl, adminKey } = getApiConfig();

  const response = await fetch(`${apiUrl}/api/graph/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': adminKey
    },
    body: JSON.stringify({
      user_id: userId,
      query: cypherQuery
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Query failed: ${response.status}`);
  }

  return await response.json();
}

/**
 * Execute explore tool (semantic search + graph expansion)
 */
export async function executeExplore({
  userId,
  queries,
  textMatches,
  returnExplanations
}: {
  userId: string;
  queries?: Array<{ query: string; threshold?: number }>;
  textMatches?: string[];
  returnExplanations?: boolean;
}): Promise<GraphData> {
  const { apiUrl, adminKey } = getApiConfig();

  const response = await fetch(`${apiUrl}/api/graph/explore`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': adminKey
    },
    body: JSON.stringify({
      user_id: userId,
      queries,
      text_matches: textMatches,
      return_explanations: returnExplanations
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Explore failed: ${response.status}`);
  }

  return await response.json();
}

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

/**
 * Generate query from natural language description using GPT-4.1-nano
 */
export async function generateQuery({
  description,
  type
}: {
  description: string;
  type?: 'explore' | 'cypher';
}): Promise<GeneratedQuery> {
  const { apiUrl, adminKey } = getApiConfig();

  const response = await fetch(`${apiUrl}/api/graph/generate-query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': adminKey
    },
    body: JSON.stringify({
      description,
      type
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Query generation failed: ${response.status}`);
  }

  return await response.json();
}
