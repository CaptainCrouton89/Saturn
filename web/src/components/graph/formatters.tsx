import { Badge } from '@/components/ui/badge';

/**
 * Smart formatting utilities for displaying arbitrary graph data
 */

// Format key for display (snake_case -> Title Case)
export function formatKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

// Smart formatting for different value types based on key patterns and value types
export function formatValue(key: string, value: unknown): React.ReactNode {
  if (value === null || value === undefined) return null;

  const keyLower = key.toLowerCase();

  // Handle dates
  if ((keyLower.includes('_at') || keyLower.includes('date')) && typeof value === 'string') {
    try {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return (
          <span className="text-sm font-medium text-text-secondary">
            {date.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </span>
        );
      }
    } catch {
      return <span className="text-sm font-medium">{String(value)}</span>;
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
    return <span className={`text-sm font-medium ${sentimentColor}`}>{sentimentLabel}</span>;
  }

  // Handle boolean as badge
  if (typeof value === 'boolean') {
    return (
      <Badge variant={value ? 'default' : 'secondary'} className="text-xs py-0">
        {value ? 'Yes' : 'No'}
      </Badge>
    );
  }

  // Handle counts/frequencies
  if ((keyLower.includes('count') || keyLower.includes('frequency')) && typeof value === 'number') {
    return <span className="text-sm font-medium">{value} times</span>;
  }

  // Handle priority
  if (keyLower === 'priority' && typeof value === 'number') {
    return <span className="text-sm font-medium">#{value}</span>;
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
    return <p className="text-sm text-text-secondary mt-0.5 leading-relaxed">{value}</p>;
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

  // Handle nested objects/content
  if (typeof value === 'object') {
    const objValue = value as Record<string, unknown>;

    // Special handling for content objects with type and content/output fields
    if ('type' in objValue && ('content' in objValue || 'output' in objValue)) {
      const contentKey = 'content' in objValue ? 'content' : 'output';
      const content = objValue[contentKey];

      // Render content preview
      const renderContent = (): string | null => {
        if (!content) return null;

        if (typeof content === 'string') {
          return content.length > 300 ? content.slice(0, 300) + '...' : content;
        }

        return JSON.stringify(content, null, 2);
      };

      const contentPreview = renderContent();

      return (
        <div className="space-y-2">
          <Badge variant="secondary" className="text-xs py-0">
            {String(objValue.type)}
          </Badge>
          {contentPreview && (
            <div className="bg-beige/20 rounded-md p-3 text-xs text-text-secondary font-mono whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
              {contentPreview}
            </div>
          )}
        </div>
      );
    }

    // Default object handling
    return (
      <div className="bg-beige/20 rounded-md p-2 text-xs text-text-secondary font-mono whitespace-pre-wrap break-words max-h-[150px] overflow-y-auto">
        {JSON.stringify(value, null, 2)}
      </div>
    );
  }

  // Default: just display the value
  return <span className="text-sm font-medium">{String(value)}</span>;
}

// Check if a field should be displayed as full-width (vs compact row)
export function isFullWidthField(key: string, value: unknown): boolean {
  if (!value) return false;

  const keyLower = key.toLowerCase();

  // Long text fields
  if (typeof value === 'string') {
    return (
      (keyLower.includes('note') ||
        keyLower.includes('description') ||
        keyLower.includes('why_') ||
        keyLower.includes('how_') ||
        keyLower === 'role' ||
        keyLower.includes('situation') ||
        keyLower.includes('history') ||
        keyLower.includes('personality') ||
        keyLower.includes('expertise') ||
        keyLower.includes('interests') ||
        keyLower.includes('appearance')) &&
      value.length > 40
    );
  }

  // Objects and arrays
  if (typeof value === 'object') {
    return true;
  }

  return false;
}

// Check if field should be prominently displayed (like a badge at the top)
export function isProminentField(key: string): boolean {
  const keyLower = key.toLowerCase();
  return keyLower === 'is_owner' || keyLower === 'canonical_name';
}

// Get display priority for sorting fields (lower = higher priority)
export function getFieldPriority(key: string): number {
  const keyLower = key.toLowerCase();

  // Metadata fields (timestamps, IDs) should be last
  if (
    keyLower.includes('_at') ||
    keyLower.includes('_id') ||
    keyLower === 'created' ||
    keyLower === 'updated'
  ) {
    return 1000;
  }

  // Important identity/status fields first
  if (
    keyLower.includes('canonical') ||
    keyLower.includes('is_owner') ||
    keyLower === 'type' ||
    keyLower === 'status'
  ) {
    return 0;
  }

  // Descriptive fields
  if (keyLower.includes('description') || keyLower.includes('appearance')) {
    return 10;
  }

  // Content fields
  if (keyLower.includes('situation') || keyLower.includes('history')) {
    return 20;
  }

  // Everything else in the middle
  return 50;
}
