'use client';

import { GraphLink } from './types';
import { Badge } from '@/components/ui/badge';
import { formatKey, formatValue, isFullWidthField } from './formatters';

interface LinkTooltipProps {
  link: GraphLink | null;
  position: { x: number; y: number };
}

export default function LinkTooltip({ link, position }: LinkTooltipProps) {
  if (!link) return null;

  const renderProperties = () => {
    const props = link.properties;

    if (!props || Object.keys(props).length === 0) {
      return (
        <p className="text-xs text-text-secondary italic">
          No relationship properties stored
        </p>
      );
    }

    const entries = Object.entries(props).filter(([_, value]) => value !== null && value !== undefined);

    if (entries.length === 0) {
      return (
        <p className="text-xs text-text-secondary italic">
          No relationship properties stored
        </p>
      );
    }

    return (
      <div className="space-y-2">
        {entries.map(([key, value]) => {
          const formattedValue = formatValue(key, value);
          if (!formattedValue) return null;

          const isFullWidth = isFullWidthField(key, value);

          if (isFullWidth) {
            return (
              <div key={key}>
                <span className="text-xs text-text-secondary">{formatKey(key)}:</span>
                {formattedValue}
              </div>
            );
          }

          return (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-xs text-text-secondary whitespace-nowrap">{formatKey(key)}:</span>
              {formattedValue}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{
        left: `${position.x + 10}px`,
        bottom: `${window.innerHeight - position.y + 10}px`,
      }}
    >
      <div className="bg-white border border-beige shadow-lg rounded-lg p-4 min-w-[300px] max-w-[500px]">
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-beige/50">
          <Badge variant="secondary" className="text-xs">
            {link.label}
          </Badge>
        </div>
        <div className="space-y-2">{renderProperties()}</div>
      </div>
    </div>
  );
}
