'use client';

import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { PipelineProgress } from '@/types/search';
import { CheckCircle2, Circle, Loader2, ArrowRight } from 'lucide-react';

interface PipelineVisualizationProps {
  progress: PipelineProgress;
}

export default function PipelineVisualization({ progress }: PipelineVisualizationProps) {
  const stages = [
    {
      id: 'vector_search',
      name: 'Vector Search',
      description: 'Semantic search across knowledge graph'
    },
    {
      id: 'rag_filtering',
      name: 'RAG Filtering',
      description: 'AI-powered relevance analysis'
    },
    {
      id: 'graph_retrieval',
      name: 'Graph Retrieval',
      description: 'Expand nodes and relationships'
    }
  ] as const;

  const getStageStatus = (stageId: typeof stages[number]['id']) => {
    if (progress.stage === 'error') return 'error';
    if (progress.stage === 'idle') return 'idle';
    if (progress.stage === 'complete') return 'complete';

    const stageOrder = ['vector_search', 'rag_filtering', 'graph_retrieval'];
    const currentIndex = stageOrder.indexOf(progress.stage);
    const stageIndex = stageOrder.indexOf(stageId);

    if (stageIndex < currentIndex) return 'complete';
    if (stageIndex === currentIndex) return 'loading';
    return 'idle';
  };

  const getStageIcon = (status: string) => {
    switch (status) {
      case 'complete':
        return <CheckCircle2 className="h-5 w-5 text-success" />;
      case 'loading':
        return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
      case 'error':
        return <Circle className="h-5 w-5 text-error" />;
      default:
        return <Circle className="h-5 w-5 text-text-secondary/40" />;
    }
  };

  if (progress.stage === 'idle') {
    return null;
  }

  return (
    <div className="w-full space-y-4">
      {/* Pipeline Progress Bar */}
      <div className="flex items-center justify-between gap-2">
        {stages.map((stage, index) => {
          const status = getStageStatus(stage.id);

          return (
            <div key={stage.id} className="flex flex-1 items-center gap-2">
              {/* Stage Card */}
              <Card
                className={`flex-1 transition-all ${
                  status === 'loading'
                    ? 'border-primary bg-primary/5'
                    : status === 'complete'
                    ? 'border-success/30 bg-success/5'
                    : status === 'error'
                    ? 'border-error/30 bg-error/5'
                    : 'border-border bg-background'
                }`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {getStageIcon(status)}
                    <div className="flex-1">
                      <CardTitle className="text-sm font-semibold">{stage.name}</CardTitle>
                      <CardDescription className="mt-1 text-xs">{stage.description}</CardDescription>

                      {/* Stage Results Preview */}
                      {status === 'complete' || status === 'loading' ? (
                        <div className="mt-2 text-xs text-text-secondary">
                          {stage.id === 'vector_search' && progress.data.vector_search && (
                            <div>
                              Found {progress.data.vector_search.length} entities
                              {progress.data.vector_search.length > 0 && (
                                <div className="mt-1 space-y-0.5">
                                  {progress.data.vector_search.slice(0, 3).map((result, i) => (
                                    <div key={i} className="text-xs">
                                      • {result.entity_name} ({(result.similarity_score * 100).toFixed(0)}%)
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {stage.id === 'rag_filtering' && progress.data.rag_filtering && (
                            <div>
                              Filtered to {progress.data.rag_filtering.length} relevant entities
                              {progress.data.rag_filtering.length > 0 && (
                                <div className="mt-1 space-y-0.5">
                                  {progress.data.rag_filtering.slice(0, 2).map((result, i) => (
                                    <div key={i} className="text-xs">
                                      • {result.entity_name}
                                      <div className="ml-2 italic text-text-secondary/80">
                                        "{result.reasoning.substring(0, 60)}..."
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {stage.id === 'graph_retrieval' && progress.data.graph_retrieval && (
                            <div>
                              Retrieved {progress.data.graph_retrieval.nodes.length} nodes,{' '}
                              {progress.data.graph_retrieval.links.length} links
                              <div className="mt-1">
                                Central entities: {progress.data.graph_retrieval.central_node_ids.length}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Arrow between stages */}
              {index < stages.length - 1 && (
                <ArrowRight className="h-5 w-5 flex-shrink-0 text-text-secondary/40" />
              )}
            </div>
          );
        })}
      </div>

      {/* Error Message */}
      {progress.stage === 'error' && progress.error && (
        <Card className="border-error bg-error/5">
          <CardContent className="p-4">
            <div className="text-sm text-error">
              <strong>Error:</strong> {progress.error}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Success Summary */}
      {progress.stage === 'complete' && progress.data.graph_retrieval && (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="p-4">
            <div className="text-sm text-success">
              <strong>✓ Search complete!</strong> Found {progress.data.graph_retrieval.nodes.length} nodes and{' '}
              {progress.data.graph_retrieval.links.length} relationships.
              {progress.data.graph_retrieval.central_node_ids.length > 0 && (
                <span>
                  {' '}
                  Highlighting {progress.data.graph_retrieval.central_node_ids.length} central entities.
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
