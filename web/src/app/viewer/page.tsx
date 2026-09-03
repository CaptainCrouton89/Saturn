'use client';

import { GraphData, NODE_TYPES, NodeType } from '@/components/graph/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { executeExplore, fetchGraphData, generateExploreQuery } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';
import { getNodeColor } from '@/lib/graphUtils';
import { Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';

// Dynamically import KnowledgeGraph to avoid SSR issues
const KnowledgeGraph = dynamic(() => import('@/components/graph/KnowledgeGraph'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[600px] items-center justify-center rounded-xl bg-gradient-to-br from-white/50 to-beige/50 backdrop-blur-sm">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  )
});

export default function ViewerPage() {
  // Session state. The graph routes derive their subject from this token, so
  // the viewer always shows the signed-in user's own graph.
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Full graph state
  const [fullGraphData, setFullGraphData] = useState<GraphData | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);

  // Filtering state
  const [nameFilter, setNameFilter] = useState('');
  const [selectedNodeTypes, setSelectedNodeTypes] = useState<Set<NodeType>>(new Set(NODE_TYPES));

  // Explore tool state
  const [exploreInput, setExploreInput] = useState('');
  const [exploreResult, setExploreResult] = useState<GraphData | null>(null);
  const [isExecutingExplore, setIsExecutingExplore] = useState(false);

  // Query generator state
  const [queryDescription, setQueryDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Authenticate on mount
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        window.location.href = '/login';
        return;
      }
      setToken(session.access_token);
      setUserId(session.user.id);
    });
  }, []);

  // Fetch the signed-in user's full graph
  useEffect(() => {
    if (!token || !userId) return;

    async function loadFullGraph(userId: string, token: string) {
      try {
        setLoadingGraph(true);
        setError(null);
        setFullGraphData(await fetchGraphData(userId, token));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load graph data');
        setFullGraphData(null);
      } finally {
        setLoadingGraph(false);
      }
    }

    loadFullGraph(userId, token);
  }, [userId, token]);

  // Explore results are shown exactly as returned; only the full graph is filtered.
  const filteredGraphData = useMemo((): GraphData | null => {
    if (exploreResult) return exploreResult;
    if (!fullGraphData) return null;

    const matchesFilters = (node: { type: NodeType; name: string }) =>
      selectedNodeTypes.has(node.type) &&
      (!nameFilter || node.name.toLowerCase().includes(nameFilter.toLowerCase()));

    const nodes = fullGraphData.nodes.filter(matchesFilters);
    const visibleIds = new Set(nodes.map((node) => node.id));

    return {
      nodes,
      // force-graph rewrites a link's source/target from an id to a node object
      // in place, so hand it copies and keep fullGraphData's links id-keyed.
      links: fullGraphData.links
        .filter((link) => visibleIds.has(link.source) && visibleIds.has(link.target))
        .map((link) => ({ ...link }))
    };
  }, [exploreResult, fullGraphData, nameFilter, selectedNodeTypes]);

  const toggleNodeType = (type: NodeType) => {
    setSelectedNodeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const handleExecuteExplore = async () => {
    if (!userId || !token) return;

    if (!exploreInput.trim()) {
      setError('Please enter explore tool JSON input');
      return;
    }

    setIsExecutingExplore(true);
    setError(null);

    try {
      const input = JSON.parse(exploreInput.trim());

      const graphData = await executeExplore({
        userId,
        queries: input.queries,
        textMatches: input.text_matches,
        returnExplanations: input.return_explanations
      }, token);

      setExploreResult(graphData);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Explore execution failed');
    } finally {
      setIsExecutingExplore(false);
    }
  };

  const handleClearExplore = () => {
    setExploreResult(null);
    setExploreInput('');
    setNameFilter('');
    setSelectedNodeTypes(new Set(NODE_TYPES));
  };

  const handleGenerateQuery = async () => {
    if (!token) return;

    if (!queryDescription.trim()) {
      setError('Please enter a query description');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const result = await generateExploreQuery(queryDescription.trim(), token);
      setExploreInput(JSON.stringify(result.json, null, 2));
      setQueryDescription('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Query generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  if (!token || !userId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <header className="border-b border-border bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <h1 className="mb-2 font-heading text-3xl font-bold text-primary">Knowledge Graph Viewer</h1>
          <p className="text-text-secondary">
            Explore your knowledge graph with semantic search and filtering
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="space-y-6">
          {/* Filters (full graph view only) */}
          {!exploreResult && (
            <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
              <div className="space-y-4">
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
          )}

          {/* Query Generator */}
          <div className="rounded-xl border border-border bg-gradient-to-br from-primary/5 to-primary/10 p-6 shadow-sm">
            <h2 className="mb-2 font-heading text-lg font-semibold text-primary">AI Query Generator</h2>
            <p className="mb-4 text-sm text-text-secondary">
              Describe what you want to find in natural language, and the backend generates the Explore input below
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
              <Button
                onClick={handleGenerateQuery}
                disabled={isGenerating || !queryDescription.trim()}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Generate Explore Query'
                )}
              </Button>
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

          {/* Explore Result Banner */}
          {exploreResult && (
            <div className="rounded-xl border border-success bg-success/5 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-success">✓ Explore executed successfully</span>
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
                  {exploreResult ? 'Explore Results' : 'Full Graph'}
                </h2>
                <div className="text-sm text-text-secondary">
                  {filteredGraphData.nodes.length} nodes, {filteredGraphData.links.length} relationships
                </div>
              </div>

              <KnowledgeGraph data={filteredGraphData} width={1100} height={700} />

              {/* Legend */}
              <div className="mt-6 flex flex-wrap justify-center gap-4 border-t border-border pt-4">
                {NODE_TYPES.map((type) => (
                  <div key={type} className="flex items-center gap-2">
                    <div
                      className="h-4 w-4 rounded-full"
                      style={{ backgroundColor: getNodeColor(type) }}
                    />
                    <span className="text-sm text-text-secondary">{type}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            !error && (
              <div className="rounded-xl border border-dashed border-border bg-white p-12 text-center">
                <div className="mx-auto max-w-md space-y-4">
                  <div className="text-5xl">🗺️</div>
                  <h3 className="font-heading text-xl font-semibold text-primary">No Graph Data</h3>
                  <p className="text-text-secondary">
                    Nothing matches the current filters, and your graph may still be empty. Upload
                    content and it will appear here once processing finishes.
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
