import { useState, useEffect } from 'react';
import { fetchUsers, fetchGraphData, type User } from './lib/api';
import { executeSearchPipeline } from './lib/searchApi';
import KnowledgeGraph from './components/graph/KnowledgeGraph';
import { SearchBar } from './components/search/SearchBar';
import { PipelineVisualization } from './components/search/PipelineVisualization';
import type { GraphData, NodeType } from './components/graph/types';
import type { PipelineProgress, SearchResult } from './types/search';
import './App.css';

function App() {
  // State
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtering state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNodeTypes, setSelectedNodeTypes] = useState<Set<NodeType>>(
    new Set(['User', 'Person', 'Project', 'Topic', 'Idea', 'Conversation', 'Note', 'Artifact'])
  );

  // Search pipeline state
  const [isSearching, setIsSearching] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState<PipelineProgress | null>(null);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchGraphData, setSearchGraphData] = useState<GraphData | null>(null);

  // Fetch users on mount
  useEffect(() => {
    async function loadUsers() {
      try {
        const userList = await fetchUsers();
        setUsers(userList);
        if (userList.length > 0) {
          setSelectedUserId(userList[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load users');
      }
    }
    loadUsers();
  }, []);

  // Fetch graph data when user selection changes
  useEffect(() => {
    if (!selectedUserId) return;

    async function loadGraphData() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchGraphData(selectedUserId);
        setGraphData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load graph data');
        setGraphData(null);
      } finally {
        setLoading(false);
      }
    }

    loadGraphData();
  }, [selectedUserId]);

  // Filter graph data based on search and node type filters
  const filteredGraphData: GraphData | null = graphData
    ? {
        nodes: graphData.nodes.filter((node) => {
          // Filter by node type
          if (!selectedNodeTypes.has(node.type)) return false;

          // Filter by search query
          if (searchQuery) {
            const query = searchQuery.toLowerCase();
            return node.name.toLowerCase().includes(query);
          }

          return true;
        }),
        links: graphData.links.filter((link) => {
          // Only include links where both source and target nodes are visible
          const sourceNode = graphData.nodes.find((n) => n.id === link.source);
          const targetNode = graphData.nodes.find((n) => n.id === link.target);

          if (!sourceNode || !targetNode) return false;

          return (
            selectedNodeTypes.has(sourceNode.type) &&
            selectedNodeTypes.has(targetNode.type) &&
            (!searchQuery ||
              sourceNode.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              targetNode.name.toLowerCase().includes(searchQuery.toLowerCase()))
          );
        }),
      }
    : null;

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

  // Handle search pipeline execution
  const handleSearch = async (query: string) => {
    if (!selectedUserId) {
      setError('Please select a user first');
      return;
    }

    setIsSearching(true);
    setPipelineProgress(null);
    setSearchResult(null);
    setSearchGraphData(null);
    setError(null);

    try {
      const result = await executeSearchPipeline(query, selectedUserId, (progress) => {
        setPipelineProgress(progress);
      });

      setSearchResult(result);
      setSearchGraphData(result.pipeline_stages.graph_retrieval);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  // Clear search and return to full graph view
  const handleClearSearch = () => {
    setSearchResult(null);
    setSearchGraphData(null);
    setPipelineProgress(null);
    setSearchQuery('');
  };

  const nodeTypes: NodeType[] = [
    'User',
    'Person',
    'Project',
    'Topic',
    'Idea',
    'Conversation',
    'Note',
    'Artifact',
  ];

  // Determine which graph data to display (search results or full graph)
  const displayGraphData = searchGraphData || filteredGraphData;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Neo4j Knowledge Graph Viewer</h1>

        <div className="controls">
          {/* User Selection */}
          <div className="control-group">
            <label htmlFor="user-select">User:</label>
            <select
              id="user-select"
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              disabled={users.length === 0}
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.id.substring(0, 8)}...)
                </option>
              ))}
            </select>
          </div>

          {/* Simple filter search (only active when not using pipeline search) */}
          {!searchResult && (
            <div className="control-group">
              <label htmlFor="search">Filter:</label>
              <input
                id="search"
                type="text"
                placeholder="Filter nodes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          )}

          {/* Node Type Filters */}
          <div className="control-group node-filters">
            <label>Node Types:</label>
            <div className="filter-buttons">
              {nodeTypes.map((type) => (
                <button
                  key={type}
                  className={`filter-btn ${selectedNodeTypes.has(type) ? 'active' : ''}`}
                  onClick={() => toggleNodeType(type)}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="app-main">
        {/* Search Bar */}
        <div className="search-section">
          <SearchBar
            onSearch={handleSearch}
            onClear={handleClearSearch}
            isSearching={isSearching}
          />
        </div>

        {/* Pipeline Visualization */}
        {(isSearching || pipelineProgress) && (
          <div className="pipeline-section">
            <PipelineVisualization progress={pipelineProgress} />
          </div>
        )}

        {/* Search Result Summary */}
        {searchResult && !isSearching && (
          <div className="search-result-summary">
            <div className="flex items-center justify-between p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div>
                <span className="text-sm font-medium text-blue-900">
                  Search Results for: "{searchResult.query}"
                </span>
                <span className="text-xs text-blue-600 ml-4">
                  ({searchResult.total_execution_time_ms}ms)
                </span>
              </div>
              <button
                onClick={handleClearSearch}
                className="text-sm text-blue-700 hover:text-blue-900 underline"
              >
                Clear search
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="error-message">
            <p>Error: {error}</p>
          </div>
        )}

        {loading && (
          <div className="loading-message">
            <p>Loading graph data...</p>
          </div>
        )}

        {!loading && !error && displayGraphData && (
          <div className="graph-container">
            <KnowledgeGraph data={displayGraphData} />
            <div className="graph-info">
              <p>
                {displayGraphData.nodes.length} nodes, {displayGraphData.links.length}{' '}
                relationships
                {searchResult && searchResult.pipeline_stages.graph_retrieval && (
                  <span className="text-blue-600 ml-2">
                    (
                    {searchResult.pipeline_stages.graph_retrieval.central_node_ids.length}{' '}
                    central entities)
                  </span>
                )}
              </p>
            </div>
          </div>
        )}

        {!loading && !error && !displayGraphData && !isSearching && (
          <div className="empty-message">
            <p>No graph data available. Select a user to view their knowledge graph.</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
