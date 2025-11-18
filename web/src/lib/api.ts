/**
 * Centralized API client for Saturn backend
 *
 * Handles:
 * - Base URL configuration
 * - Authentication (admin key, JWT tokens)
 * - Error handling
 * - Request/response transformation
 */

const getBaseUrl = (): string => {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) {
    throw new Error('NEXT_PUBLIC_API_URL environment variable is not set');
  }
  return apiUrl;
};

const getAdminKey = (): string => {
  const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY;
  if (!adminKey) {
    throw new Error('NEXT_PUBLIC_ADMIN_KEY environment variable is not set');
  }
  return adminKey;
};

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  authType?: 'admin' | 'user' | 'none';
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
  if (authType === 'admin') {
    requestHeaders['X-Admin-Key'] = getAdminKey();
  } else if (authType === 'user' && token) {
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
    throw new Error(errorMessage);
  }

  return data as T;
}

// ============================================================================
// Information Dump API
// ============================================================================

export interface InformationDump {
  id: string;
  user_id: string;
  title: string;
  label: string | null;
  content: string;
  processing_status: 'queued' | 'processing' | 'completed' | 'failed';
  entities_extracted: boolean;
  neo4j_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateInformationDumpRequest {
  title: string;
  label?: string;
  content: string;
}

export interface CreateInformationDumpResponse {
  information_dump_id: string;
  job_id: string;
  status: string;
}

export interface ListInformationDumpsResponse {
  dumps: InformationDump[];
  total: number;
}

export async function createInformationDump(
  data: CreateInformationDumpRequest,
  token: string
): Promise<CreateInformationDumpResponse> {
  return apiFetch('/api/information-dumps', {
    method: 'POST',
    body: data,
    authType: 'user',
    token
  });
}

export async function getInformationDumpStatus(
  dumpId: string,
  token: string
): Promise<InformationDump> {
  return apiFetch(`/api/information-dumps/${dumpId}`, {
    authType: 'user',
    token
  });
}

export async function listInformationDumps(
  token: string,
  options?: {
    limit?: number;
    offset?: number;
    status?: string;
  }
): Promise<ListInformationDumpsResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', options.limit.toString());
  if (options?.offset) params.set('offset', options.offset.toString());
  if (options?.status) params.set('status', options.status);

  const query = params.toString();
  const endpoint = `/api/information-dumps${query ? `?${query}` : ''}`;

  return apiFetch(endpoint, {
    authType: 'user',
    token
  });
}

// ============================================================================
// Graph API (Admin)
// ============================================================================

export interface User {
  id: string;
  name: string;
  created_at: string;
}

/**
 * Backend returns nodes with "properties" field, but frontend expects "details".
 * Transform the response to match frontend types.
 */
interface BackendGraphNode {
  id: string;
  name: string;
  type: string;
  properties?: Record<string, unknown>;
}

interface BackendGraphData {
  nodes: BackendGraphNode[];
  links: import('@/components/graph/types').GraphLink[];
}

function transformGraphData(backendData: BackendGraphData): import('@/components/graph/types').GraphData {
  return {
    nodes: backendData.nodes.map(node => ({
      id: node.id,
      name: node.name,
      type: node.type as import('@/components/graph/types').NodeType,
      details: node.properties // Transform properties → details
    })),
    links: backendData.links
  };
}

export async function fetchUsers(): Promise<User[]> {
  const data = await apiFetch<{ users: User[] }>('/api/graph/users', {
    authType: 'admin'
  });
  return data.users;
}

export async function fetchGraphData(userId: string): Promise<import('@/components/graph/types').GraphData> {
  const backendData = await apiFetch<BackendGraphData>(`/api/graph/users/${userId}/full-graph`, {
    authType: 'admin'
  });
  return transformGraphData(backendData);
}

export async function executeManualQuery(params: {
  userId: string;
  cypherQuery: string;
}): Promise<import('@/components/graph/types').GraphData> {
  const backendData = await apiFetch<BackendGraphData>('/api/graph/query', {
    method: 'POST',
    body: {
      user_id: params.userId,
      query: params.cypherQuery
    },
    authType: 'admin'
  });
  return transformGraphData(backendData);
}

export async function executeExplore(params: {
  userId: string;
  queries?: Array<{ query: string; threshold?: number }>;
  textMatches?: string[];
  returnExplanations?: boolean;
}): Promise<import('@/components/graph/types').GraphData> {
  const backendData = await apiFetch<BackendGraphData>('/api/graph/explore', {
    method: 'POST',
    body: {
      user_id: params.userId,
      queries: params.queries,
      text_matches: params.textMatches,
      return_explanations: params.returnExplanations
    },
    authType: 'admin'
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

export interface GeneratedCypherQuery {
  type: 'cypher';
  query: string;
  explanation: string;
}

export type GeneratedQuery = GeneratedExploreQuery | GeneratedCypherQuery;

export async function generateQuery(params: {
  description: string;
  type?: 'explore' | 'cypher';
}): Promise<GeneratedQuery> {
  return apiFetch('/api/graph/generate-query', {
    method: 'POST',
    body: params,
    authType: 'admin'
  });
}

// ============================================================================
// Chat API (No Auth)
// ============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  toolUse?: {
    toolName: string;
    input: Record<string, unknown>;
    output?: string;
  };
}

export interface ChatStreamEvent {
  type: string;
  data: unknown;
}

/**
 * Stream chat messages using Server-Sent Events (SSE)
 * Returns an async generator that yields SDK messages
 *
 * @param message - User message to send to the chat agent
 * @param userId - User ID to scope knowledge graph queries
 * @param sessionId - Optional session ID to maintain conversation context
 */
export async function* streamChat(
  message: string,
  userId: string,
  sessionId?: string
): AsyncGenerator<ChatStreamEvent> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/api/chat/stream`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, userId, sessionId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to start chat stream: ${response.status}`);
  }

  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Split by newlines to get individual SSE messages
      const lines = buffer.split('\n');
      const lastLine = lines.pop();

      // Keep incomplete line in buffer (explicit validation)
      if (lastLine === undefined) {
        throw new Error('Unexpected buffer state: no lines found');
      }
      buffer = lastLine;

      for (const line of lines) {
        if (!line.startsWith('data: ')) {
          continue;
        }

        const data = line.slice(6); // Remove 'data: ' prefix

        if (data === '[DONE]') {
          return;
        }

        try {
          const event = JSON.parse(data) as ChatStreamEvent;
          yield event;
        } catch (parseError) {
          if (parseError instanceof SyntaxError) {
            // JSON parse error - yield error event to caller
            yield {
              type: 'parse_error',
              data: {
                rawData: data,
                error: parseError.message
              }
            };
          } else {
            // Unexpected error type - re-throw
            throw parseError;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
