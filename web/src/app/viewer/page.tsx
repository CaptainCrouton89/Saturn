'use client';

import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import SearchBar from '@/components/search/SearchBar';
import PipelineVisualization from '@/components/search/PipelineVisualization';
import { executeSearchPipeline } from '@/lib/searchApi';
import { PipelineProgress, SearchPipelineResponse } from '@/types/search';
import { GraphData, GraphNode, NodeType } from '@/components/graph/types';

// Dynamically import KnowledgeGraph to avoid SSR issues
const KnowledgeGraph = dynamic(() => import('@/components/graph/KnowledgeGraph'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[600px] items-center justify-center rounded-xl bg-gradient-to-br from-white/50 to-beige/50 backdrop-blur-sm">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  )
});

// Hardcoded user ID for demo purposes
// In production, this would come from authentication
const DEMO_USER_ID = 'fe0bb62b-9695-4744-b2ba-0d7ba41943e7';

export default function ViewerPage() {
  const [progress, setProgress] = useState<PipelineProgress>({
    stage: 'idle',
    data: {}
  });
  const [searchResult, setSearchResult] = useState<SearchPipelineResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // Helper to validate and assert node type
  const assertNodeType = (type: string): NodeType => {
    const validTypes: NodeType[] = ['User', 'Person', 'Project', 'Topic', 'Idea', 'Conversation'];
    if (!validTypes.includes(type as NodeType)) {
      throw new Error(`Invalid node type received from backend: ${type}. Expected one of: ${validTypes.join(', ')}`);
    }
    return type as NodeType;
  };

  // Convert search results to graph data format
  const graphData = useMemo((): GraphData => {
    if (!searchResult?.pipeline_stages.graph_retrieval) {
      return { nodes: [], links: [] };
    }

    const { nodes, links } = searchResult.pipeline_stages.graph_retrieval;

    return {
      nodes: nodes.map((node) => ({
        id: node.id,
        name: node.name,
        type: assertNodeType(node.type),
        val: 10, // Default size
        details: node.properties as unknown as GraphNode['details']
      })),
      links: links.map((link) => ({
        source: link.source,
        target: link.target,
        label: link.type,
        properties: link.properties
      }))
    };
  }, [searchResult]);

  // Get highlighted node IDs (central entities from search)
  const highlightedNodeIds = useMemo(() => {
    return searchResult?.pipeline_stages.graph_retrieval.central_node_ids || [];
  }, [searchResult]);

  const handleSearch = async (query: string) => {
    setIsSearching(true);
    setProgress({ stage: 'idle', data: {} });
    setSearchResult(null);

    try {
      const result = await executeSearchPipeline({
        userId: DEMO_USER_ID,
        query,
        onProgress: setProgress
      });

      setSearchResult(result);
    } catch (error) {
      console.error('Search failed:', error);
      // Error is already handled via progress callback
    } finally {
      setIsSearching(false);
    }
  };

  const handleClear = () => {
    setProgress({ stage: 'idle', data: {} });
    setSearchResult(null);
  };

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <header className="border-b border-border bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <h1 className="mb-2 font-heading text-3xl font-bold text-primary">Knowledge Graph Viewer</h1>
          <p className="text-text-secondary">
            Search your knowledge graph using semantic vector search, RAG filtering, and graph retrieval
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="space-y-6">
          {/* Search Bar */}
          <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
            <SearchBar onSearch={handleSearch} onClear={handleClear} isLoading={isSearching} />
          </div>

          {/* Pipeline Visualization */}
          {progress.stage !== 'idle' && (
            <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
              <h2 className="mb-4 font-heading text-xl font-semibold text-primary">Search Pipeline</h2>
              <PipelineVisualization progress={progress} />
            </div>
          )}

          {/* Graph Visualization */}
          {graphData.nodes.length > 0 && (
            <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-heading text-xl font-semibold text-primary">Graph Results</h2>
                {searchResult && (
                  <div className="text-sm text-text-secondary">
                    {searchResult.pipeline_stages.graph_retrieval.nodes.length} nodes,{' '}
                    {searchResult.pipeline_stages.graph_retrieval.links.length} relationships •{' '}
                    {searchResult.total_execution_time_ms}ms
                  </div>
                )}
              </div>

              <KnowledgeGraph data={graphData} width={1100} height={700} highlightedNodeIds={highlightedNodeIds} />

              {/* Legend */}
              <div className="mt-6 flex flex-wrap justify-center gap-4 border-t border-border pt-4">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full bg-node-people"></div>
                  <span className="text-sm text-text-secondary">People</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full bg-node-projects"></div>
                  <span className="text-sm text-text-secondary">Projects</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full bg-node-ideas"></div>
                  <span className="text-sm text-text-secondary">Ideas</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full bg-node-topics"></div>
                  <span className="text-sm text-text-secondary">Topics</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full border-2 border-primary"></div>
                  <span className="text-sm text-text-secondary">Highlighted (Central Entities)</span>
                </div>
              </div>
            </div>
          )}

          {/* Empty State */}
          {progress.stage === 'idle' && (
            <div className="rounded-xl border border-dashed border-border bg-white p-12 text-center">
              <div className="mx-auto max-w-md space-y-4">
                <div className="text-5xl">🔍</div>
                <h3 className="font-heading text-xl font-semibold text-primary">Start Searching</h3>
                <p className="text-text-secondary">
                  Enter a query above to search your knowledge graph. Try queries like:
                </p>
                <div className="space-y-2 text-sm text-text-secondary">
                  <div>• "Alaska and salmon"</div>
                  <div>• "projects related to AI"</div>
                  <div>• "people I talked about recently"</div>
                  <div>• "ideas about machine learning"</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
