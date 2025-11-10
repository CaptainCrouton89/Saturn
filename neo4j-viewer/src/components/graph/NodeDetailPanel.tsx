'use client';

import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { getNodeColor } from '@/lib/graphUtils';
import type { GraphNode } from './types';
import { PropertyRenderer } from './PropertyRenderer';

interface NodeDetailPanelProps {
  node: GraphNode | null;
  onClose: () => void;
}

export default function NodeDetailPanel({ node, onClose }: NodeDetailPanelProps) {
  if (!node) return null;

  return (
    <Sheet open={!!node} onOpenChange={onClose}>
      <SheetContent side="right" className="w-[400px] sm:w-[540px] flex flex-col">
        <SheetHeader className="flex-shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-5 h-5 rounded-full flex-shrink-0"
              style={{ backgroundColor: getNodeColor(node.type) }}
            />
            <SheetTitle className="text-2xl leading-tight">{node.name}</SheetTitle>
          </div>
          <SheetDescription>
            <Badge variant="secondary">{node.type}</Badge>
          </SheetDescription>
        </SheetHeader>
        <Separator className="my-4 flex-shrink-0" />
        <div className="overflow-y-auto flex-1 pr-2">
          {node.details ? (
            <div className="space-y-4">
              <PropertyRenderer properties={node.details as Record<string, unknown>} mode="panel" />
            </div>
          ) : (
            <p className="text-text-secondary">No additional details available.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
