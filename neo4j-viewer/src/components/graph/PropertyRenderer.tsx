'use client';

import { Badge } from '@/components/ui/badge';
import { formatDate, formatLabel, getValueType, SKIP_FIELDS, sortProperties } from '@/lib/graphUtils';

interface PropertyRendererProps {
  properties: Record<string, unknown>;
  mode: 'tooltip' | 'panel';
}

export function PropertyRenderer({ properties, mode }: PropertyRendererProps) {
  // Filter out technical/internal fields
  const entries = Object.entries(properties).filter(([key]) => !SKIP_FIELDS.has(key));

  // Sort for consistent order
  const sortedEntries = sortProperties(entries);

  return (
    <>
      {sortedEntries.map(([key, value]) => {
        const valueType = getValueType(key, value);
        const label = formatLabel(key);

        // Skip null/undefined
        if (valueType === 'null') return null;

        // ARRAY rendering
        if (valueType === 'array' && Array.isArray(value)) {
          if (value.length === 0) return null;
          return (
            <div key={key} className={mode === 'tooltip' ? 'pt-1' : ''}>
              <span className={mode === 'tooltip' ? 'text-xs text-text-secondary block mb-1' : 'text-sm font-semibold mb-2 text-text-primary uppercase tracking-wide block'}>
                {label}:
              </span>
              <div className="flex flex-wrap gap-1">
                {value.map((item, i) => (
                  <Badge key={i} variant="outline" className="text-xs py-0">
                    {String(item)}
                  </Badge>
                ))}
              </div>
            </div>
          );
        }

        // PERCENT rendering (progress bar)
        if (valueType === 'percent' && typeof value === 'number') {
          const colorClass = key.includes('confidence') ? 'bg-success' : key.includes('excitement') ? 'bg-accent' : 'bg-primary';
          return (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">{label}:</span>
              <div className="flex items-center gap-2">
                <div className={mode === 'tooltip' ? 'w-16 bg-beige/50 rounded-full h-1.5' : 'w-24 bg-beige rounded-full h-2'}>
                  <div className={`${colorClass} ${mode === 'tooltip' ? 'h-1.5' : 'h-2'} rounded-full`} style={{ width: `${value * 100}%` }} />
                </div>
                <span className="text-xs font-semibold text-text-primary">{Math.round(value * 100)}%</span>
              </div>
            </div>
          );
        }

        // DATE rendering
        if (valueType === 'date') {
          return (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">{label}:</span>
              <span className="text-xs font-semibold text-text-primary">{formatDate(String(value))}</span>
            </div>
          );
        }

        // BOOLEAN rendering
        if (valueType === 'boolean') {
          return (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">{label}:</span>
              <Badge variant={value ? 'default' : 'outline'} className="text-xs py-0">
                {value ? 'Yes' : 'No'}
              </Badge>
            </div>
          );
        }

        // NUMBER rendering
        if (valueType === 'number' && typeof value === 'number') {
          const formattedValue = key.includes('money') || key.includes('invested') ? `$${value}` : value;
          return (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">{label}:</span>
              <span className="text-xs font-semibold text-text-primary">{formattedValue}</span>
            </div>
          );
        }

        // STRING rendering (default) - varies by mode
        if (mode === 'tooltip') {
          // Tooltip: short inline format
          const displayValue = String(value).length > 40 ? `${String(value).slice(0, 40)}...` : String(value);
          return (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs text-text-secondary">{label}:</span>
              <span className="text-xs font-semibold text-text-primary">{displayValue}</span>
            </div>
          );
        } else {
          // Panel: full text block format
          return (
            <div key={key}>
              <h4 className="text-sm font-semibold mb-2 text-text-primary uppercase tracking-wide">{label}</h4>
              <p className="text-text-secondary text-sm leading-relaxed">{String(value)}</p>
            </div>
          );
        }
      })}
    </>
  );
}
