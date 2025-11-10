'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import SearchBar from '@/components/search/SearchBar';
import PipelineVisualization from '@/components/search/PipelineVisualization';
import { executeSearchPipeline, fetchUsers, fetchGraphData, type User } from '@/lib/searchApi';
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

const NODE_TYPES: NodeType[] = ['User', 'Person', 'Project', 'Topic', 'Idea', 'Conversation'];

export default function ViewerPage() {
  // User selection state
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [loadingUsers, setLoadingUsers] = useState(true);

  // Full graph state
  const [fullGraphData, setFullGraphData] = useState<GraphData | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);

  // Filtering state
  const [nameFilter, setNameFilter] = useState('');
  const [selectedNodeTypes, setSelectedNodeTypes] = useState<Set<NodeType>>(new Set(NODE_TYPES));

  // Search pipeline state
  const [progress, setProgress] = useState<PipelineProgress>({
    stage: 'idle',
    data: {}
  });
  const [searchResult, setSearchResult] = useState<SearchPipelineResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Fetch users on mount
  useEffect(() => {
    async function loadUsers() {
      try {
        setLoadingUsers(true);
        const userList = await fetchUsers();
        setUsers(userList);
        if (userList.length > 0) {
          setSelectedUserId(userList[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load users');
      } finally {
        setLoadingUsers(false);
      }
    }
    loadUsers();
  }, []);

  // Fetch full graph when user changes
  useEffect(() => {
    if (!selectedUserId) return;

    async function loadFullGraph() {
      try {
        setLoadingGraph(true);
        setError(null);
        const data = await fetchGraphData(selectedUserId);
        setFullGraphData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load graph data');
        setFullGraphData(null);
      } finally {
        setLoadingGraph(false);
      }
    }

    loadFullGraph();
  }, [selectedUserId]);

  // Helper to validate and assert node type
  const assertNodeType = (type: string): NodeType => {
    const validTypes: NodeType[] = ['User', 'Person', 'Project', 'Topic', 'Idea', 'Conversation'];
    if (!validTypes.includes(type as NodeType)) {
      throw new Error(`Invalid node type received from backend: ${type}. Expected one of: ${validTypes.join(', ')}`);
    }
    return type as NodeType;
  };

  // Convert search results to graph data format
  const searchGraphData = useMemo((): GraphData | null => {
    if (!searchResult?.pipeline_stages.graph_retrieval) {
      return null;
    }

    const { nodes, links } = searchResult.pipeline_stages.graph_retrieval;

    return {
      nodes: nodes.map((node) => ({
        id: node.id,
        name: node.name,
        type: assertNodeType(node.type),
        val: 10,
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

  // Filter full graph data based on name and node type filters
  const filteredFullGraphData = useMemo((): GraphData | null => {
    if (!fullGraphData) return null;

    return {
      nodes: fullGraphData.nodes.filter((node) => {
        // Filter by node type
        if (!selectedNodeTypes.has(node.type)) return false;

        // Filter by name
        if (nameFilter) {
          const query = nameFilter.toLowerCase();
          return node.name.toLowerCase().includes(query);
        }

        return true;
      }),
      links: fullGraphData.links.filter((link) => {
        // Only include links where both source and target are visible
        const sourceNode = fullGraphData.nodes.find((n) => n.id === link.source);
        const targetNode = fullGraphData.nodes.find((n) => n.id === link.target);

        if (!sourceNode || !targetNode) return false;

        return (
          selectedNodeTypes.has(sourceNode.type) &&
          selectedNodeTypes.has(targetNode.type) &&
          (!nameFilter ||
            sourceNode.name.toLowerCase().includes(nameFilter.toLowerCase()) ||
            targetNode.name.toLowerCase().includes(nameFilter.toLowerCase()))
        );
      })
    };
  }, [fullGraphData, nameFilter, selectedNodeTypes]);

  // Determine which graph to display (search results or filtered full graph)
  const displayGraphData = searchGraphData || filteredFullGraphData;

  // Get highlighted node IDs from search (central entities)
  const highlightedNodeIds = useMemo(() => {
    return searchResult?.pipeline_stages.graph_retrieval.central_node_ids || [];
  }, [searchResult]);

  // Toggle node type filter
  const toggleNodeType = (type: NodeType) => {
    setSelectedNodeTypes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(type)) {
        newSet.delete(type);
      } else {
        newSet.add(type);
      }
      return newSet;
    });
  };

  const handleSearch = async (query: string) => {
    if (!selectedUserId) {
      setError('Please select a user first');
      return;
    }

    setIsSearching(true);
    setProgress({ stage: 'idle', data: {} });
    setSearchResult(null);
    setError(null);

    try {
      const result = await executeSearchPipeline({
        userId: selectedUserId,
        query,
        onProgress: setProgress
      });

      setSearchResult(result);
    } catch (error) {
      // Error state is set via progress callback, but also set error message for UI
      const errorMessage = error instanceof Error ? error.message : 'Search failed';
      setError(errorMessage);
      console.error('Search failed:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleClear = () => {
    setProgress({ stage: 'idle', data: {} });
    setSearchResult(null);
    setNameFilter('');
  };

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <header className="border-b border-border bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <h1 className="mb-2 font-heading text-3xl font-bold text-primary">Knowledge Graph Viewer</h1>
          <p className="text-text-secondary">
            Explore user knowledge graphs with semantic search and filtering
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="space-y-6">
          {/* Controls Row */}
          <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
            <div className="space-y-4">
              {/* User Selection */}
              <div>
                <label htmlFor="user-select" className="mb-2 block text-sm font-medium text-primary">
                  Select User
                </label>
                <select
                  id="user-select"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  disabled={loadingUsers || users.length === 0}
                  className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} ({user.id.substring(0, 8)}...)
                    </option>
                  ))}
                </select>
              </div>

              {/* Simple Name Filter (only when not searching) */}
              {!searchResult && (
                <div>
                  <label htmlFor="name-filter" className="mb-2 block text-sm font-medium text-primary">
                    Filter by Name
                  </label>
                  <Input
                    id="name-filter"
                    type="text"
                    placeholder="Filter nodes by name..."
                    value={nameFilter}
                    onChange={(e) => setNameFilter(e.target.value)}
                  />
                </div>
              )}

              {/* Node Type Filters */}
              <div>
                <label className="mb-2 block text-sm font-medium text-primary">Node Types</label>
                <div className="flex flex-wrap gap-2">
                  {NODE_TYPES.map((type) => (
                    <Button
                      key={type}
                      variant={selectedNodeTypes.has(type) ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => toggleNodeType(type)}
                      className="text-xs"
                    >
                      {type}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Search Bar */}
          <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
            <h2 className="mb-4 font-heading text-lg font-semibold text-primary">Semantic Search</h2>
            <SearchBar onSearch={handleSearch} onClear={handleClear} isLoading={isSearching} />
          </div>

          {/* Pipeline Visualization */}
          {progress.stage !== 'idle' && (
            <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
              <h2 className="mb-4 font-heading text-lg font-semibold text-primary">Search Pipeline</h2>
              <PipelineVisualization progress={progress} />
            </div>
          )}

          {/* Search Result Banner */}
          {searchResult && progress.stage === 'complete' && (
            <div className="rounded-xl border border-success bg-success/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-success">
                    ✓ Search results for: "{searchResult.query}"
                  </span>
                  <span className="ml-4 text-sm text-text-secondary">
                    ({searchResult.total_execution_time_ms}ms)
                  </span>
                </div>
                <Button variant="outline" size="sm" onClick={handleClear}>
                  Clear Search
                </Button>
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="rounded-xl border border-error bg-error/5 p-4">
              <p className="text-error">Error: {error}</p>
            </div>
          )}

          {/* Graph Visualization */}
          {loadingGraph ? (
            <div className="flex h-[600px] items-center justify-center rounded-xl border border-border bg-white">
              <div className="text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                <p className="mt-2 text-sm text-text-secondary">Loading graph data...</p>
              </div>
            </div>
          ) : displayGraphData && displayGraphData.nodes.length > 0 ? (
            <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-heading text-xl font-semibold text-primary">
                  {searchResult ? 'Search Results' : 'Full Graph'}
                </h2>
                <div className="text-sm text-text-secondary">
                  {displayGraphData.nodes.length} nodes, {displayGraphData.links.length} relationships
                  {searchResult && (
                    <span className="ml-2 text-success">
                      ({highlightedNodeIds.length} central entities)
                    </span>
                  )}
                </div>
              </div>

              <KnowledgeGraph data={displayGraphData} width={1100} height={700} highlightedNodeIds={highlightedNodeIds} />

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
                {searchResult && (
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full border-2 border-primary"></div>
                    <span className="text-sm text-text-secondary">Highlighted (Central Entities)</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            !loadingUsers && !error && (
              <div className="rounded-xl border border-dashed border-border bg-white p-12 text-center">
                <div className="mx-auto max-w-md space-y-4">
                  <div className="text-5xl">🗺️</div>
                  <h3 className="font-heading text-xl font-semibold text-primary">
                    {selectedUserId ? 'No Graph Data' : 'Select a User'}
                  </h3>
                  <p className="text-text-secondary">
                    {selectedUserId
                      ? 'No graph data found for this user. Try selecting a different user or performing a search.'
                      : 'Choose a user from the dropdown above to view their knowledge graph.'}
                  </p>
                </div>
              </div>
            )
          )}
        </div>
      </main>
    </div>
  );
}
