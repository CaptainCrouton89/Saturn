'use client';

import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { getNodeColor } from '@/lib/graphUtils';
import { GraphNode } from './types';
import { formatKey, formatValue, isFullWidthField, isProminentField, getFieldPriority } from './formatters';

interface NodeDetailPanelProps {
  node: GraphNode | null;
  onClose: () => void;
}

export default function NodeDetailPanel({ node, onClose }: NodeDetailPanelProps) {
  if (!node) return null;

  const renderDetails = () => {
    if (!node.details || Object.keys(node.details).length === 0) {
      return <p className="text-text-secondary">No additional details available.</p>;
    }

    // Sort entries by priority
    const entries = Object.entries(node.details)
      .filter(([_, value]) => value !== null && value !== undefined)
      .sort(([keyA], [keyB]) => getFieldPriority(keyA) - getFieldPriority(keyB));

    if (entries.length === 0) {
      return <p className="text-text-secondary">No additional details available.</p>;
    }

    // Separate prominent fields (e.g., is_owner badge)
    const prominentFields = entries.filter(([key]) => isProminentField(key));
    const regularFields = entries.filter(([key]) => !isProminentField(key));

    return (
      <div className="space-y-4">
        {/* Prominent fields (badges at top) */}
        {prominentFields.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {prominentFields.map(([key, value]) => {
              // Special handling for is_owner boolean
              if (key.toLowerCase() === 'is_owner' && value === true) {
                return <Badge key={key} variant="default">Owner</Badge>;
              }
              // canonical_name
              if (key.toLowerCase() === 'canonical_name' && value !== node.name) {
                return (
                  <div key={key} className="w-full">
                    <span className="text-xs text-text-secondary">{formatKey(key)}: </span>
                    <span className="text-sm font-medium">{String(value)}</span>
                  </div>
                );
              }
              return null;
            })}
          </div>
        )}

        {/* Regular fields */}
        {regularFields.map(([key, value]) => {
          const formattedValue = formatValue(key, value);
          if (!formattedValue) return null;

          const isFullWidth = isFullWidthField(key, value);

          if (isFullWidth) {
            return (
              <div key={key}>
                <h4 className="font-semibold mb-2 text-text-primary">{formatKey(key)}</h4>
                {formattedValue}
              </div>
            );
          }

          return (
            <div key={key} className="flex items-start justify-between gap-4">
              <span className="text-sm text-text-secondary font-medium whitespace-nowrap">{formatKey(key)}:</span>
              <div className="text-right">{formattedValue}</div>
            </div>
          );
        })}
      </div>
    );
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
