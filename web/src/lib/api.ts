/**
 * Centralized API client for Saturn backend
 *
 * Handles:
 * - Base URL configuration
 * - Authentication (JWT tokens)
 * - Error handling
 * - Request/response transformation
 */

import { GraphData, GraphLink, NODE_TYPES, NodeType } from '@/components/graph/types';

const getBaseUrl = (): string => {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) {
    throw new Error('NEXT_PUBLIC_API_URL environment variable is not set');
  }
  return apiUrl;
};

/** An error response from the backend, carrying the HTTP status it came with. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  authType?: 'user' | 'none';
  token?: string; // JWT token for user auth
}

/**
 * Base fetch wrapper with common error handling and auth
 */
async function apiFetch<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    headers = {},
    authType = 'none',
    token
  } = options;

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${endpoint}`;

  // Build headers
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers
  };

  // Add authentication
  if (authType === 'user' && token) {
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  // Make request
  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined
  });

  // Parse response
  const data = await response.json().catch(() => ({}));

  // Handle errors
  if (!response.ok) {
    const errorMessage = data.error || `Request failed: ${response.status}`;
    throw new ApiError(errorMessage, response.status);
  }

  return data as T;
}

// ============================================================================
// Sources / Information Dumps
// ============================================================================

/**
 * Response of POST /api/information-dumps, forwarded verbatim by the Next
 * proxy at web/src/app/api/upload/route.ts.
 */
export interface CreateSourceResponse {
  source_id: string;
  processing_status: string;
  message: string;
  created_at: string;
}

/** The lifecycle the pipeline persists on the source row. */
export type ProcessingStatus = 'queued' | 'processing' | 'completed' | 'failed';

/**
 * Response of GET /api/information-dumps/:id — the source row's columns.
 * processing_status is null on rows created before the lifecycle columns were
 * added: those rows will never be updated, so null is its own state and not a
 * synonym for queued. entities_extracted and neo4j_synced_at answer the
 * separate question of whether the graph write landed.
 */
export interface SourceStatus {
  id: string;
  user_id: string;
  content: string;
  content_processed: string[] | null;
  summary: string | null;
  created_at: string;
  entities_extracted: boolean;
  neo4j_synced_at: string | null;
  processing_status: ProcessingStatus | null;
  error_message: string | null;
  attempt_count: number;
}

export async function getSourceStatus(sourceId: string, token: string): Promise<SourceStatus> {
  return apiFetch(`/api/information-dumps/${sourceId}`, {
    authType: 'user',
    token
  });
}

// ============================================================================
// Graph API (User Auth)
// ============================================================================

/**
 * Backend nodes carry a "properties" bag and a Neo4j label as "type": the
 * full-graph route emits the label verbatim (`Person`) while Explore lowercases
 * it (`person`). Normalize both to the closed NodeType union here, and rename
 * properties → details, so nothing downstream handles a raw label.
 */
interface BackendGraphNode {
  id: string;
  name: string;
  type: string;
  properties?: Record<string, unknown>;
}

interface BackendGraphData {
  nodes: BackendGraphNode[];
  links: GraphLink[];
}

function toNodeType(label: string): NodeType {
  const normalized = label.toLowerCase();
  const match = NODE_TYPES.find((type) => type === normalized);
  if (!match) {
    throw new Error(
      `Unknown node label from backend: ${label}. Expected one of: ${NODE_TYPES.join(', ')}`
    );
  }
  return match;
}

function transformGraphData(backendData: BackendGraphData): GraphData {
  return {
    nodes: backendData.nodes.map(node => ({
      id: node.id,
      name: node.name,
      type: toNodeType(node.type),
      details: node.properties
    })),
    links: backendData.links
  };
}

export async function fetchGraphData(userId: string, token: string): Promise<GraphData> {
  const backendData = await apiFetch<BackendGraphData>(`/api/graph/users/${userId}/full-graph`, {
    authType: 'user',
    token
  });
  return transformGraphData(backendData);
}

export async function executeExplore(params: {
  userId: string;
  queries?: Array<{ query: string; threshold?: number }>;
  textMatches?: string[];
  returnExplanations?: boolean;
}, token: string): Promise<GraphData> {
  const backendData = await apiFetch<BackendGraphData>(`/api/graph/users/${params.userId}/explore`, {
    method: 'POST',
    body: {
      queries: params.queries,
      text_matches: params.textMatches,
      return_explanations: params.returnExplanations
    },
    authType: 'user',
    token
  });
  return transformGraphData(backendData);
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

/**
 * POST /api/graph/generate-query also generates Cypher, but the web has no
 * Cypher surface: /api/graph/query is admin-key only.
 */
export async function generateExploreQuery(
  description: string,
  token: string
): Promise<GeneratedExploreQuery> {
  return apiFetch('/api/graph/generate-query', {
    method: 'POST',
    body: { description, type: 'explore' },
    authType: 'user',
    token
  });
}

// ============================================================================
// Profile API (User Auth)
// ============================================================================

export interface UserProfileDTO {
  id: string;
  device_id: string | null;
  onboarding_completed: boolean;
  display_name: string | null;
  bio: string | null;
  created_at: string;
  updated_at: string;
}

export async function getProfile(token: string): Promise<UserProfileDTO> {
  const res = await apiFetch<{ success: boolean; data: { user: UserProfileDTO } }>('/api/auth/me', {
    authType: 'user',
    token,
  });
  return res.data.user;
}

export async function updateProfile(
  token: string,
  updates: { display_name?: string; bio?: string }
): Promise<UserProfileDTO> {
  const res = await apiFetch<{ success: boolean; data: { profile: UserProfileDTO } }>('/api/auth/profile', {
    method: 'PATCH',
    body: updates,
    authType: 'user',
    token,
  });
  return res.data.profile;
}

// ============================================================================
// API Keys (User Auth)
// ============================================================================

export interface ApiKeyDTO {
  id: string;
  key_prefix: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export async function listApiKeys(token: string): Promise<ApiKeyDTO[]> {
  const res = await apiFetch<{ success: boolean; data: { keys: ApiKeyDTO[] } }>('/api/auth/api-keys', {
    authType: 'user',
    token,
  });
  return res.data.keys;
}

export async function generateApiKey(
  token: string,
  label: string
): Promise<{ id: string; key: string; key_prefix: string }> {
  const res = await apiFetch<{ success: boolean; data: { id: string; key: string; key_prefix: string } }>(
    '/api/auth/api-keys',
    {
      method: 'POST',
      body: { label },
      authType: 'user',
      token,
    }
  );
  return res.data;
}

export async function revokeApiKey(token: string, keyId: string): Promise<void> {
  await apiFetch<{ success: boolean; message: string }>(`/api/auth/api-keys/${keyId}`, {
    method: 'DELETE',
    authType: 'user',
    token,
  });
}
