import { SearchPipelineResponse, PipelineProgress } from '@/types/search';

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

export interface SearchOptions {
  userId: string;
  query: string;
  onProgress?: (progress: PipelineProgress) => void;
}

/**
 * Execute the full search pipeline: vector search → RAG filtering → graph retrieval
 */
export async function executeSearchPipeline({
  userId,
  query,
  onProgress
}: SearchOptions): Promise<SearchPipelineResponse> {
  try {
    const { apiUrl, adminKey } = getApiConfig();

    // Notify start of vector search
    onProgress?.({
      stage: 'vector_search',
      data: {}
    });

    const response = await fetch(`${apiUrl}/api/search/pipeline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': adminKey
      },
      body: JSON.stringify({
        user_id: userId,
        query
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `API error: ${response.status}`);
    }

    const data: SearchPipelineResponse = await response.json();

    // Simulate progressive updates for better UX
    // In reality, the backend returns all stages at once, but we can animate through them
    if (onProgress) {
      // Vector search results
      onProgress({
        stage: 'vector_search',
        data: {
          vector_search: data.pipeline_stages.vector_search
        }
      });

      // Small delay for animation
      await new Promise(resolve => setTimeout(resolve, 300));

      // RAG filtering results
      onProgress({
        stage: 'rag_filtering',
        data: {
          vector_search: data.pipeline_stages.vector_search,
          rag_filtering: data.pipeline_stages.rag_filtering
        }
      });

      await new Promise(resolve => setTimeout(resolve, 300));

      // Graph retrieval results
      onProgress({
        stage: 'graph_retrieval',
        data: data.pipeline_stages
      });

      await new Promise(resolve => setTimeout(resolve, 300));

      // Complete
      onProgress({
        stage: 'complete',
        data: data.pipeline_stages
      });
    }

    return data;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    onProgress?.({
      stage: 'error',
      data: {},
      error: errorMessage
    });

    throw error;
  }
}

/**
 * Format execution time for display
 */
export function formatExecutionTime(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}
