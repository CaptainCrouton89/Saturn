'use client';

import { GraphLink } from './types';
import { Badge } from '@/components/ui/badge';

interface LinkTooltipProps {
  link: GraphLink | null;
  position: { x: number; y: number };
}

// Smart formatting for different value types
function formatValue(key: string, value: unknown): React.ReactNode {
  if (value === null || value === undefined) return null;

  const keyLower = key.toLowerCase();

  // Handle dates
  if ((keyLower.includes('_at') || keyLower.includes('date')) && typeof value === 'string') {
    try {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString();
      }
    } catch {
      return String(value);
    }
  }

  // Handle 0-1 scores/levels/quality as progress bars
  if (
    (keyLower.includes('score') ||
      keyLower.includes('quality') ||
      keyLower.includes('level') ||
      keyLower.includes('intensity') ||
      keyLower.includes('confidence')) &&
    typeof value === 'number' &&
    value >= 0 &&
    value <= 1
  ) {
    return (
      <div className="flex items-center gap-2 min-w-[100px]">
        <div className="flex-1 bg-beige/50 rounded-full h-1.5">
          <div
            className="bg-primary h-1.5 rounded-full transition-all"
            style={{ width: `${value * 100}%` }}
          />
        </div>
        <span className="text-xs font-medium whitespace-nowrap">{Math.round(value * 100)}%</span>
      </div>
    );
  }

  // Handle status/type/category fields as badges
  if (
    (keyLower.includes('status') ||
      keyLower.includes('type') ||
      keyLower.includes('category') ||
      keyLower.includes('emotion') ||
      keyLower.includes('depth')) &&
    typeof value === 'string'
  ) {
    return (
      <Badge variant="outline" className="text-xs py-0 whitespace-nowrap">
        {value.replace(/_/g, ' ')}
      </Badge>
    );
  }

  // Handle sentiment as colored badge
  if (keyLower === 'sentiment' && typeof value === 'number') {
    const sentimentColor = value > 0.3 ? 'text-success' : value < -0.3 ? 'text-error' : 'text-text-secondary';
    const sentimentLabel = value > 0.3 ? 'Positive' : value < -0.3 ? 'Negative' : 'Neutral';
    return <span className={`text-xs font-medium ${sentimentColor}`}>{sentimentLabel}</span>;
  }

  // Handle counts/frequencies
  if ((keyLower.includes('count') || keyLower.includes('frequency')) && typeof value === 'number') {
    return <span className="text-xs font-medium">{value} times</span>;
  }

  // Handle priority
  if (keyLower === 'priority' && typeof value === 'number') {
    return <span className="text-xs font-medium">#{value}</span>;
  }

  // Handle long text fields (notes, descriptions, etc.)
  if (
    (keyLower.includes('note') ||
      keyLower.includes('description') ||
      keyLower.includes('why_') ||
      keyLower.includes('how_')) &&
    typeof value === 'string' &&
    value.length > 60
  ) {
    return <p className="text-xs font-medium mt-0.5 leading-relaxed line-clamp-4">{value}</p>;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-1">
        {value.map((item, i) => (
          <Badge key={i} variant="secondary" className="text-xs py-0">
            {String(item)}
          </Badge>
        ))}
      </div>
    );
  }

  // Handle objects
  if (typeof value === 'object') {
    return <span className="text-xs font-mono">{JSON.stringify(value)}</span>;
  }

  // Default: just display the value
  return <span className="text-xs font-medium">{String(value)}</span>;
}

// Check if a field should be displayed as full-width (vs compact row)
function isFullWidthField(key: string, value: unknown): boolean {
  if (typeof value !== 'string') return false;

  const keyLower = key.toLowerCase();
  return (
    (keyLower.includes('note') ||
      keyLower.includes('description') ||
      keyLower.includes('why_') ||
      keyLower.includes('how_') ||
      keyLower === 'role') &&
    value.length > 40
  );
}

// Format key for display
function formatKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
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
      <div className="space-y-2 max-w-[360px]">
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
        top: `${position.y + 10}px`,
      }}
    >
      <div className="bg-white border border-beige shadow-lg rounded-lg p-3 min-w-[200px] max-w-[280px]">
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
