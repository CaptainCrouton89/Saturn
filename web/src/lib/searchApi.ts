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
