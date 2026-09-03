'use client';

import { GraphData, NODE_TYPES } from '@/components/graph/types';
import { getNodeColor } from '@/lib/graphUtils';
import { Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';

// Dynamically import KnowledgeGraph to avoid SSR issues
const KnowledgeGraph = dynamic(() => import('@/components/graph/KnowledgeGraph'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[600px] items-center justify-center rounded-xl bg-gradient-to-br from-white/50 to-beige/50 backdrop-blur-sm">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  )
});

interface GraphCanvasProps {
  data: GraphData | null;
  loading: boolean;
  /** Explore results are labelled differently from the full graph. */
  isExploreResult: boolean;
  /** The empty state is suppressed while an error is already on screen. */
  showEmptyState: boolean;
}

export function GraphCanvas({ data, loading, isExploreResult, showEmptyState }: GraphCanvasProps) {
  if (loading) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-xl border border-border bg-white">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
          <p className="mt-2 text-sm text-text-secondary">Loading graph data...</p>
        </div>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    if (!showEmptyState) return null;
    return (
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
    );
  }

  return (
    <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-heading text-xl font-semibold text-primary">
          {isExploreResult ? 'Explore Results' : 'Full Graph'}
        </h2>
        <div className="text-sm text-text-secondary">
          {data.nodes.length} nodes, {data.links.length} relationships
        </div>
      </div>

      <KnowledgeGraph data={data} width={1100} height={700} />

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
  );
}
