'use client';

import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface SearchBarProps {
  onQuery: (query: string) => void;
  onClear: () => void;
  isLoading?: boolean;
  disabled?: boolean;
}

export default function SearchBar({ onQuery, onClear, isLoading = false, disabled = false }: SearchBarProps) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && !isLoading && !disabled) {
      onQuery(query.trim());
    }
  };

  const handleClear = () => {
    setQuery('');
    onClear();
  };

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-3">
      <Textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Enter Cypher query... (e.g., MATCH (p:Person) RETURN p LIMIT 10)"
        disabled={isLoading || disabled}
        className="font-mono text-sm"
        autoFocus
      />

      <div className="flex gap-2">
        <Button type="submit" disabled={!query.trim() || isLoading || disabled}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Running...
            </>
          ) : (
            'Run Query'
          )}
        </Button>

        {query && (
          <Button type="button" variant="outline" onClick={handleClear} disabled={isLoading}>
            Clear
          </Button>
        )}
      </div>
    </form>
  );
}
