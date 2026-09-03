'use client';

import { NODE_TYPES, NodeType } from '@/components/graph/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface GraphFiltersProps {
  nameFilter: string;
  onNameFilterChange: (value: string) => void;
  selectedNodeTypes: Set<NodeType>;
  onToggleNodeType: (type: NodeType) => void;
}

export function GraphFilters({
  nameFilter,
  onNameFilterChange,
  selectedNodeTypes,
  onToggleNodeType
}: GraphFiltersProps) {
  return (
    <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
      <div className="space-y-4">
        <div>
          <label htmlFor="name-filter" className="mb-2 block text-sm font-medium text-primary">
            Filter by Name
          </label>
          <Input
            id="name-filter"
            type="text"
            placeholder="Filter nodes by name..."
            value={nameFilter}
            onChange={(e) => onNameFilterChange(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-primary">Node Types</label>
          <div className="flex flex-wrap gap-2">
            {NODE_TYPES.map((type) => (
              <Button
                key={type}
                variant={selectedNodeTypes.has(type) ? 'default' : 'outline'}
                size="sm"
                onClick={() => onToggleNodeType(type)}
                className="text-xs"
              >
                {type}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
