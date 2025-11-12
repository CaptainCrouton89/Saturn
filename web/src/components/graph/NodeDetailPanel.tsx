'use client';

import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { getNodeColor } from '@/lib/graphUtils';
import {
  GraphNode,
  PersonDetails,
  ConceptDetails,
  EntityDetails,
  SourceDetails,
  ArtifactDetails,
} from './types';

interface NodeDetailPanelProps {
  node: GraphNode | null;
  onClose: () => void;
}

export default function NodeDetailPanel({ node, onClose }: NodeDetailPanelProps) {
  if (!node) return null;

  const renderDetails = () => {
    if (!node.details) return <p className="text-text-secondary">No additional details available.</p>;

    const formatDate = (dateStr?: string) => {
      if (!dateStr) return 'N/A';
      try {
        return new Date(dateStr).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      } catch {
        return dateStr;
      }
    };

    const getContentPreview = (content: string | Record<string, unknown>, maxLength = 200): string => {
      if (typeof content === 'string') {
        return content.length > maxLength ? content.slice(0, maxLength) + '...' : content;
      }
      const jsonStr = JSON.stringify(content, null, 2);
      return jsonStr.length > maxLength ? jsonStr.slice(0, maxLength) + '...' : jsonStr;
    };

    switch (node.type) {
      case 'Person':
        const personDetails = node.details as PersonDetails;
        return (
          <div className="space-y-4">
            {personDetails.is_owner && (
              <div>
                <Badge variant="default">Owner</Badge>
              </div>
            )}
            {personDetails.canonical_name && personDetails.canonical_name !== node.name && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Canonical Name</h4>
                <p className="text-text-secondary text-sm">{personDetails.canonical_name}</p>
              </div>
            )}
            {personDetails.appearance && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Appearance</h4>
                <p className="text-text-secondary text-sm">{personDetails.appearance}</p>
              </div>
            )}
            {personDetails.situation && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Current Situation</h4>
                <p className="text-text-secondary text-sm">{personDetails.situation}</p>
              </div>
            )}
            {personDetails.history && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">History</h4>
                <p className="text-text-secondary text-sm">{personDetails.history}</p>
              </div>
            )}
            {personDetails.personality && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Personality</h4>
                <p className="text-text-secondary text-sm">{personDetails.personality}</p>
              </div>
            )}
            {personDetails.expertise && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Expertise</h4>
                <p className="text-text-secondary text-sm">{personDetails.expertise}</p>
              </div>
            )}
            {personDetails.interests && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Interests</h4>
                <p className="text-text-secondary text-sm">{personDetails.interests}</p>
              </div>
            )}
            {personDetails.notes && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Notes</h4>
                <p className="text-text-secondary text-sm">{personDetails.notes}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <h4 className="font-semibold mb-1 text-text-primary">Created</h4>
                <p className="text-text-secondary">{formatDate(personDetails.created_at)}</p>
              </div>
              <div>
                <h4 className="font-semibold mb-1 text-text-primary">Updated</h4>
                <p className="text-text-secondary">{formatDate(personDetails.updated_at)}</p>
              </div>
            </div>
          </div>
        );

      case 'Concept':
        const conceptDetails = node.details as ConceptDetails;
        return (
          <div className="space-y-4">
            {conceptDetails.description && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Description</h4>
                <p className="text-text-secondary text-sm">{conceptDetails.description}</p>
              </div>
            )}
            {conceptDetails.notes && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Notes</h4>
                <p className="text-text-secondary text-sm">{conceptDetails.notes}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <h4 className="font-semibold mb-1 text-text-primary">Created</h4>
                <p className="text-text-secondary">{formatDate(conceptDetails.created_at)}</p>
              </div>
              <div>
                <h4 className="font-semibold mb-1 text-text-primary">Updated</h4>
                <p className="text-text-secondary">{formatDate(conceptDetails.updated_at)}</p>
              </div>
            </div>
          </div>
        );

      case 'Entity':
        const entityDetails = node.details as EntityDetails;
        return (
          <div className="space-y-4">
            {entityDetails.type && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Type</h4>
                <Badge variant="secondary">{entityDetails.type}</Badge>
              </div>
            )}
            {entityDetails.description && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Description</h4>
                <p className="text-text-secondary text-sm">{entityDetails.description}</p>
              </div>
            )}
            {entityDetails.notes && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Notes</h4>
                <p className="text-text-secondary text-sm">{entityDetails.notes}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <h4 className="font-semibold mb-1 text-text-primary">Created</h4>
                <p className="text-text-secondary">{formatDate(entityDetails.created_at)}</p>
              </div>
              <div>
                <h4 className="font-semibold mb-1 text-text-primary">Updated</h4>
                <p className="text-text-secondary">{formatDate(entityDetails.updated_at)}</p>
              </div>
            </div>
          </div>
        );

      case 'Source':
        const sourceDetails = node.details as SourceDetails;
        return (
          <div className="space-y-4">
            {sourceDetails.description && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Description</h4>
                <p className="text-text-secondary text-sm">{sourceDetails.description}</p>
              </div>
            )}
            {sourceDetails.content && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Content Type</h4>
                <Badge variant="secondary">{sourceDetails.content.type}</Badge>
              </div>
            )}
            {sourceDetails.content && sourceDetails.content.content && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Content Preview</h4>
                <div className="bg-beige/20 rounded-md p-3 text-xs text-text-secondary font-mono whitespace-pre-wrap break-words">
                  {getContentPreview(sourceDetails.content.content)}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <h4 className="font-semibold mb-1 text-text-primary">Created</h4>
                <p className="text-text-secondary">{formatDate(sourceDetails.created_at)}</p>
              </div>
              <div>
                <h4 className="font-semibold mb-1 text-text-primary">Updated</h4>
                <p className="text-text-secondary">{formatDate(sourceDetails.updated_at)}</p>
              </div>
            </div>
          </div>
        );

      case 'Artifact':
        const artifactDetails = node.details as ArtifactDetails;
        return (
          <div className="space-y-4">
            {artifactDetails.description && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Description</h4>
                <p className="text-text-secondary text-sm">{artifactDetails.description}</p>
              </div>
            )}
            {artifactDetails.content && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Content Type</h4>
                <Badge variant="secondary">{artifactDetails.content.type}</Badge>
              </div>
            )}
            {artifactDetails.content && artifactDetails.content.output && (
              <div>
                <h4 className="font-semibold mb-2 text-text-primary">Content Preview</h4>
                <div className="bg-beige/20 rounded-md p-3 text-xs text-text-secondary font-mono whitespace-pre-wrap break-words">
                  {getContentPreview(artifactDetails.content.output)}
                </div>
              </div>
            )}
            <div className="text-xs">
              <h4 className="font-semibold mb-1 text-text-primary">Updated</h4>
              <p className="text-text-secondary">{formatDate(artifactDetails.updated_at)}</p>
            </div>
          </div>
        );

      default:
        return <p className="text-text-secondary">No details available for this node type.</p>;
    }
  };

  return (
    <Sheet open={!!node} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] flex flex-col">
        <SheetHeader className="flex-shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: getNodeColor(node.type) }}
            />
            <SheetTitle className="text-2xl">{node.name}</SheetTitle>
          </div>
          <SheetDescription>
            <Badge variant="secondary">{node.type}</Badge>
          </SheetDescription>
        </SheetHeader>
        <Separator className="my-4 flex-shrink-0" />
        <div className="px-6 overflow-y-auto flex-1 pb-8">{renderDetails()}</div>
      </SheetContent>
    </Sheet>
  );
}
