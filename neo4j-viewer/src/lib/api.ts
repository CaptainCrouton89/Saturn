import type { GraphData } from '../components/graph/types';

const API_BASE = '/api';

// Get admin API key from environment
const ADMIN_API_KEY = import.meta.env.VITE_ADMIN_API_KEY;

export interface User {
  id: string;
  name: string;
  created_at: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

/**
 * Get headers with admin API key
 */
function getHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (ADMIN_API_KEY) {
    headers['X-Admin-Key'] = ADMIN_API_KEY;
  }

  return headers;
}

/**
 * Fetch all users for dropdown selector
 */
export async function fetchUsers(): Promise<User[]> {
  const response = await fetch(`${API_BASE}/graph/users`, {
    headers: getHeaders(),
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
  const response = await fetch(`${API_BASE}/graph/users/${userId}/full-graph`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch graph data: ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}
