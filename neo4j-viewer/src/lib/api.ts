import type { GraphData } from '../components/graph/types';

// Get environment variables
const VITE_ENV = import.meta.env.VITE_ENV;
const VITE_API_URL = import.meta.env.VITE_API_URL;
const ADMIN_API_KEY = import.meta.env.VITE_ADMIN_API_KEY;

// Validate required environment variables in production
if (VITE_ENV === 'production') {
  if (!VITE_API_URL) {
    throw new Error('VITE_API_URL is required in production mode');
  }
  if (!ADMIN_API_KEY) {
    throw new Error('VITE_ADMIN_API_KEY is required in production mode');
  }
}

// Build API base URL
const API_BASE = VITE_API_URL
  ? `https://${VITE_API_URL}/api`
  : '/api';

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
