import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type {
  PipelineProgress,
  PipelineStage,
  VectorSearchResult,
  RAGFilteredEntity,
  GraphRetrievalResult,
} from '../../types/search';

interface PipelineVisualizationProps {
  progress: PipelineProgress | null;
}

// Type guards
function isVectorSearchResults(data: unknown): data is VectorSearchResult[] {
  return Array.isArray(data) && data.length > 0 && 'similarity_score' in data[0];
}

function isRAGFilteredEntities(data: unknown): data is RAGFilteredEntity[] {
  return Array.isArray(data) && data.length > 0 && 'reasoning' in data[0];
}

function isGraphRetrievalResult(data: unknown): data is GraphRetrievalResult {
  return typeof data === 'object' && data !== null && 'nodes' in data && 'links' in data;
}

const stages: { id: PipelineStage; label: string; description: string }[] = [
  {
    id: 'vector_search',
    label: 'Vector Search',
    description: 'Semantic search across knowledge graph',
  },
  {
    id: 'rag_filtering',
    label: 'RAG Filtering',
    description: 'AI-powered relevance analysis',
  },
  {
    id: 'graph_retrieval',
    label: 'Graph Retrieval',
    description: 'Expand nodes and relationships',
  },
];

export function PipelineVisualization({ progress }: PipelineVisualizationProps) {
  if (!progress) {
    return null;
  }

  const currentStageIndex = stages.findIndex((s) => s.id === progress.stage);
  const isComplete = progress.stage === 'complete';

  return (
    <div className="w-full max-w-2xl bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex justify-between mb-2">
          {stages.map((stage, index) => {
            const isActive = index === currentStageIndex;
            const isCompleted = index < currentStageIndex || isComplete;

            return (
              <div key={stage.id} className="flex-1">
                <div className="flex items-center">
                  {/* Stage indicator */}
                  <div className="flex flex-col items-center">
                    <div className="relative">
                      {isCompleted ? (
                        <CheckCircle2 className="w-8 h-8 text-green-600" />
                      ) : isActive ? (
                        <div className="relative">
                          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                        </div>
                      ) : (
                        <Circle className="w-8 h-8 text-gray-300" />
                      )}
                    </div>

                    {/* Stage label */}
                    <div className="mt-2 text-center">
                      <div
                        className={`text-xs font-medium ${
                          isActive
                            ? 'text-blue-600'
                            : isCompleted
                            ? 'text-green-600'
                            : 'text-gray-400'
                        }`}
                      >
                        {stage.label}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 max-w-[100px]">
                        {stage.description}
                      </div>
                    </div>
                  </div>

                  {/* Connector line */}
                  {index < stages.length - 1 && (
                    <div className="flex-1 h-0.5 mx-2 mb-12">
                      <div
                        className={`h-full transition-colors duration-300 ${
                          isCompleted ? 'bg-green-600' : 'bg-gray-200'
                        }`}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Current status message */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-900">{progress.message}</div>
            {progress.stage !== 'complete' && (
              <div className="mt-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${progress.progress}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-600 font-medium w-12 text-right">
                    {progress.progress}%
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stage results preview */}
      {progress.data && progress.stage !== 'complete' && (
        <div className="mt-4 text-sm">
          {progress.stage === 'vector_search' && isVectorSearchResults(progress.data) && (
            <div className="space-y-1">
              <div className="font-medium text-gray-700">
                Top Vector Results ({progress.data.length} entities):
              </div>
              <div className="flex flex-wrap gap-2">
                {progress.data.slice(0, 5).map((result, idx) => (
                  <div
                    key={idx}
                    className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs"
                  >
                    {result.entity_name} ({(result.similarity_score * 100).toFixed(0)}%)
                  </div>
                ))}
                {progress.data.length > 5 && (
                  <div className="px-2 py-1 text-gray-500 text-xs">
                    +{progress.data.length - 5} more
                  </div>
                )}
              </div>
            </div>
          )}

          {progress.stage === 'rag_filtering' && isRAGFilteredEntities(progress.data) && (
            <div className="space-y-1">
              <div className="font-medium text-gray-700">
                RAG Filtered ({progress.data.length} entities):
              </div>
              <div className="space-y-2">
                {progress.data.map((entity, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs">
                    <div className="px-2 py-1 bg-green-50 text-green-700 rounded font-medium">
                      {entity.entity_name}
                    </div>
                    <div className="text-gray-600 flex-1">{entity.reasoning}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {progress.stage === 'graph_retrieval' && isGraphRetrievalResult(progress.data) && (
            <div className="space-y-1">
              <div className="font-medium text-gray-700">Graph Structure:</div>
              <div className="flex gap-4 text-xs">
                <div className="px-2 py-1 bg-purple-50 text-purple-700 rounded">
                  {progress.data.nodes.length} nodes
                </div>
                <div className="px-2 py-1 bg-purple-50 text-purple-700 rounded">
                  {progress.data.links.length} relationships
                </div>
                <div className="px-2 py-1 bg-purple-50 text-purple-700 rounded">
                  {progress.data.central_node_ids.length} central entities
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Complete state */}
      {isComplete && (
        <div className="mt-4 flex items-center gap-2 text-green-600">
          <CheckCircle2 className="w-5 h-5" />
          <span className="text-sm font-medium">Search pipeline complete!</span>
        </div>
      )}
    </div>
  );
}
