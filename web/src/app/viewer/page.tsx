'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { executeManualQuery, executeExplore, fetchUsers, fetchGraphData, generateQuery, type User, type GeneratedQuery } from '@/lib/searchApi';
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

const NODE_TYPES: NodeType[] = ['Person', 'Concept', 'Entity', 'Source', 'Artifact'];

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

  // Manual query state
  const [cypherQuery, setCypherQuery] = useState('');
  const [queryResult, setQueryResult] = useState<GraphData | null>(null);
  const [isExecutingQuery, setIsExecutingQuery] = useState(false);

  // Explore tool state
  const [exploreInput, setExploreInput] = useState('');
  const [exploreResult, setExploreResult] = useState<GraphData | null>(null);
  const [isExecutingExplore, setIsExecutingExplore] = useState(false);

  // Query generator state
  const [queryDescription, setQueryDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

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
    const validTypes: NodeType[] = ['Person', 'Concept', 'Entity', 'Source', 'Artifact'];
    if (!validTypes.includes(type as NodeType)) {
      throw new Error(`Invalid node type received from backend: ${type}. Expected one of: ${validTypes.join(', ')}`);
    }
    return type as NodeType;
  };

  // Filter graph data (explore results, query results, or full graph) based on name and node type filters
  const filteredGraphData = useMemo((): GraphData | null => {
    const sourceData = exploreResult || queryResult || fullGraphData;
    if (!sourceData) return null;

    return {
      nodes: sourceData.nodes.filter((node) => {
        // Filter by node type
        if (!selectedNodeTypes.has(node.type)) return false;

        // Filter by name
        if (nameFilter) {
          const query = nameFilter.toLowerCase();
          return node.name.toLowerCase().includes(query);
        }

        return true;
      }),
      links: sourceData.links.filter((link) => {
        // Only include links where both source and target are visible
        const sourceNode = sourceData.nodes.find((n) => n.id === link.source);
        const targetNode = sourceData.nodes.find((n) => n.id === link.target);

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
  }, [queryResult, fullGraphData, nameFilter, selectedNodeTypes]);

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

  const handleExecuteExplore = async () => {
    if (!selectedUserId) {
      setError('Please select a user first');
      return;
    }

    if (!exploreInput.trim()) {
      setError('Please enter explore tool JSON input');
      return;
    }

    setIsExecutingExplore(true);
    setError(null);

    try {
      // Parse JSON input
      const input = JSON.parse(exploreInput.trim());

      const result = await executeExplore({
        userId: selectedUserId,
        queries: input.queries,
        textMatches: input.text_matches,
        returnExplanations: input.return_explanations
      });

      setExploreResult(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Explore execution failed';
      setError(errorMessage);
      console.error('Explore execution failed:', error);
    } finally {
      setIsExecutingExplore(false);
    }
  };

  const handleExecuteQuery = async () => {
    if (!selectedUserId) {
      setError('Please select a user first');
      return;
    }

    if (!cypherQuery.trim()) {
      setError('Please enter a Cypher query');
      return;
    }

    setIsExecutingQuery(true);
    setError(null);

    try {
      const result = await executeManualQuery({
        userId: selectedUserId,
        cypherQuery: cypherQuery.trim()
      });

      setQueryResult(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Query execution failed';
      setError(errorMessage);
      console.error('Query execution failed:', error);
    } finally {
      setIsExecutingQuery(false);
    }
  };

  const handleClearQuery = () => {
    setQueryResult(null);
    setCypherQuery('');
    setNameFilter('');
  };

  const handleClearExplore = () => {
    setExploreResult(null);
    setExploreInput('');
  };

  const handleGenerateQuery = async (targetType?: 'explore' | 'cypher') => {
    if (!queryDescription.trim()) {
      setError('Please enter a query description');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const result = await generateQuery({
        description: queryDescription.trim(),
        type: targetType
      });

      if (result.type === 'explore') {
        // Populate explore input
        setExploreInput(JSON.stringify(result.json, null, 2));
        setError(null);
      } else {
        // Populate cypher query input
        setCypherQuery(result.query);
        setError(null);
      }

      // Clear the description after successful generation
      setQueryDescription('');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Query generation failed';
      setError(errorMessage);
      console.error('Query generation failed:', error);
    } finally {
      setIsGenerating(false);
    }
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

              {/* Simple Name Filter (only when not showing query results) */}
              {!queryResult && (
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

          {/* Query Generator */}
          <div className="rounded-xl border border-border bg-gradient-to-br from-primary/5 to-primary/10 p-6 shadow-sm">
            <h2 className="mb-2 font-heading text-lg font-semibold text-primary">🤖 AI Query Generator</h2>
            <p className="mb-4 text-sm text-text-secondary">
              Describe what you want to find in natural language, and AI will generate the appropriate query
            </p>
            <div className="space-y-4">
              <div>
                <label htmlFor="query-description" className="mb-2 block text-sm font-medium text-primary">
                  What would you like to find?
                </label>
                <Input
                  id="query-description"
                  type="text"
                  placeholder="e.g., 'Find all people Sarah knows' or 'Search for career-related topics'"
                  value={queryDescription}
                  onChange={(e) => setQueryDescription(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isGenerating) {
                      handleGenerateQuery();
                    }
                  }}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleGenerateQuery()}
                  disabled={isGenerating || !queryDescription.trim()}
                  className="flex-1"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    '✨ Auto-Generate Query'
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleGenerateQuery('explore')}
                  disabled={isGenerating || !queryDescription.trim()}
                  className="flex-1"
                >
                  Generate Explore Query
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleGenerateQuery('cypher')}
                  disabled={isGenerating || !queryDescription.trim()}
                  className="flex-1"
                >
                  Generate Cypher Query
                </Button>
              </div>
            </div>
          </div>

          {/* Explore Tool Input */}
          <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
            <h2 className="mb-4 font-heading text-lg font-semibold text-primary">Explore Tool (Semantic Search)</h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="explore-input" className="mb-2 block text-sm font-medium text-primary">
                  Enter Explore Tool JSON
                </label>
                <Textarea
                  id="explore-input"
                  placeholder={`{
  "queries": [
    {"query": "career planning", "threshold": 0.6}
  ],
  "text_matches": ["Sarah"],
  "return_explanations": true
}`}
                  value={exploreInput}
                  onChange={(e) => setExploreInput(e.target.value)}
                  rows={8}
                  className="font-mono text-sm"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleExecuteExplore}
                  disabled={isExecutingExplore || !exploreInput.trim()}
                >
                  {isExecutingExplore ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Executing...
                    </>
                  ) : (
                    'Execute Explore'
                  )}
                </Button>
                {exploreResult && (
                  <Button variant="outline" onClick={handleClearExplore}>
                    Clear Results
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Manual Query Input */}
          <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
            <h2 className="mb-4 font-heading text-lg font-semibold text-primary">Manual Cypher Query</h2>
            <div className="space-y-4">
              <div>
                <label htmlFor="cypher-query" className="mb-2 block text-sm font-medium text-primary">
                  Enter Cypher Query
                </label>
                <Textarea
                  id="cypher-query"
                  placeholder="MATCH (n:Person)-[r]->(m) RETURN n, r, m LIMIT 50"
                  value={cypherQuery}
                  onChange={(e) => setCypherQuery(e.target.value)}
                  rows={4}
                  className="font-mono text-sm"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleExecuteQuery}
                  disabled={isExecutingQuery || !cypherQuery.trim()}
                >
                  {isExecutingQuery ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Executing...
                    </>
                  ) : (
                    'Execute Query'
                  )}
                </Button>
                {queryResult && (
                  <Button variant="outline" onClick={handleClearQuery}>
                    Clear Results
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Explore Result Banner */}
          {exploreResult && (
            <div className="rounded-xl border border-success bg-success/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-success">
                    ✓ Explore executed successfully
                  </span>
                  <span className="ml-4 text-sm text-text-secondary">
                    ({exploreResult.nodes.length} nodes, {exploreResult.links.length} relationships)
                  </span>
                </div>
                <Button variant="outline" size="sm" onClick={handleClearExplore}>
                  Clear Explore
                </Button>
              </div>
            </div>
          )}

          {/* Query Result Banner */}
          {queryResult && !exploreResult && (
            <div className="rounded-xl border border-success bg-success/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-success">
                    ✓ Query executed successfully
                  </span>
                  <span className="ml-4 text-sm text-text-secondary">
                    ({queryResult.nodes.length} nodes, {queryResult.links.length} relationships)
                  </span>
                </div>
                <Button variant="outline" size="sm" onClick={handleClearQuery}>
                  Clear Query
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
          ) : filteredGraphData && filteredGraphData.nodes.length > 0 ? (
            <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-heading text-xl font-semibold text-primary">
                  {exploreResult ? 'Explore Results' : queryResult ? 'Query Results' : 'Full Graph'}
                </h2>
                <div className="text-sm text-text-secondary">
                  {filteredGraphData.nodes.length} nodes, {filteredGraphData.links.length} relationships
                </div>
              </div>

              <KnowledgeGraph data={filteredGraphData} width={1100} height={700} />

              {/* Legend */}
              <div className="mt-6 flex flex-wrap justify-center gap-4 border-t border-border pt-4">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full bg-node-people"></div>
                  <span className="text-sm text-text-secondary">Person</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full bg-node-concepts"></div>
                  <span className="text-sm text-text-secondary">Concept</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full bg-node-entities"></div>
                  <span className="text-sm text-text-secondary">Entity</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full bg-node-sources"></div>
                  <span className="text-sm text-text-secondary">Source</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full bg-node-artifacts"></div>
                  <span className="text-sm text-text-secondary">Artifact</span>
                </div>
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
