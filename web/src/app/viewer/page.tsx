'use client';

import { GraphData, NODE_TYPES, NodeType } from '@/components/graph/types';
import { Button } from '@/components/ui/button';
import { ExplorePanel } from '@/components/viewer/ExplorePanel';
import { GraphCanvas } from '@/components/viewer/GraphCanvas';
import { GraphFilters } from '@/components/viewer/GraphFilters';
import { useSession } from '@/hooks/useSession';
import { fetchGraphData } from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

export default function ViewerPage() {
  // The graph routes derive their subject from this token, so the viewer always
  // shows the signed-in user's own graph.
  const session = useSession();

  const [fullGraphData, setFullGraphData] = useState<GraphData | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);

  const [nameFilter, setNameFilter] = useState('');
  const [selectedNodeTypes, setSelectedNodeTypes] = useState<Set<NodeType>>(new Set(NODE_TYPES));

  const [exploreInput, setExploreInput] = useState('');
  const [exploreResult, setExploreResult] = useState<GraphData | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Fetch the signed-in user's full graph. Depend on the token and id rather
  // than the session object so a re-run of useSession's effect does not refetch.
  const token = session?.token ?? null;
  const userId = session?.userId ?? null;

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

  const handleClearExplore = () => {
    setExploreResult(null);
    setExploreInput('');
    setNameFilter('');
    setSelectedNodeTypes(new Set(NODE_TYPES));
  };

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-border bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <h1 className="mb-2 font-heading text-3xl font-bold text-primary">Knowledge Graph Viewer</h1>
          <p className="text-text-secondary">
            Explore your knowledge graph with semantic search and filtering
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="space-y-6">
          {/* Filters apply to the full graph view only */}
          {!exploreResult && (
            <GraphFilters
              nameFilter={nameFilter}
              onNameFilterChange={setNameFilter}
              selectedNodeTypes={selectedNodeTypes}
              onToggleNodeType={toggleNodeType}
            />
          )}

          <ExplorePanel
            session={session}
            input={exploreInput}
            onInputChange={setExploreInput}
            onResult={setExploreResult}
            onError={setError}
            hasResult={!!exploreResult}
            onClear={handleClearExplore}
          />

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

          {error && (
            <div className="rounded-xl border border-error bg-error/5 p-4">
              <p className="text-error">Error: {error}</p>
            </div>
          )}

          <GraphCanvas
            data={filteredGraphData}
            loading={loadingGraph}
            isExploreResult={!!exploreResult}
            showEmptyState={!error}
          />
        </div>
      </main>
    </div>
  );
}
