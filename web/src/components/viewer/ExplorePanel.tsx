'use client';

import { GraphData } from '@/components/graph/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Session } from '@/hooks/useSession';
import { executeExplore, generateExploreQuery } from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

interface ExplorePanelProps {
  session: Session;
  /** The Explore tool JSON; owned by the page so clearing resets it. */
  input: string;
  onInputChange: (value: string) => void;
  onResult: (data: GraphData) => void;
  onError: (message: string | null) => void;
  hasResult: boolean;
  onClear: () => void;
}

export function ExplorePanel({
  session,
  input,
  onInputChange,
  onResult,
  onError,
  hasResult,
  onClear
}: ExplorePanelProps) {
  const [queryDescription, setQueryDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExecutingExplore, setIsExecutingExplore] = useState(false);

  const handleGenerateQuery = async () => {
    if (!queryDescription.trim()) {
      onError('Please enter a query description');
      return;
    }

    setIsGenerating(true);
    onError(null);

    try {
      const result = await generateExploreQuery(queryDescription.trim(), session.token);
      onInputChange(JSON.stringify(result.json, null, 2));
      setQueryDescription('');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Query generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExecuteExplore = async () => {
    if (!input.trim()) {
      onError('Please enter explore tool JSON input');
      return;
    }

    setIsExecutingExplore(true);
    onError(null);

    try {
      const parsed = JSON.parse(input.trim());

      onResult(
        await executeExplore(
          {
            userId: session.userId,
            queries: parsed.queries,
            textMatches: parsed.text_matches,
            returnExplanations: parsed.return_explanations
          },
          session.token
        )
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Explore execution failed');
    } finally {
      setIsExecutingExplore(false);
    }
  };

  return (
    <>
      {/* Query Generator */}
      <div className="rounded-xl border border-border bg-gradient-to-br from-primary/5 to-primary/10 p-6 shadow-sm">
        <h2 className="mb-2 font-heading text-lg font-semibold text-primary">AI Query Generator</h2>
        <p className="mb-4 text-sm text-text-secondary">
          Describe what you want to find in natural language, and the backend generates the Explore input below
        </p>
        <div className="space-y-4">
          <div>
            <label htmlFor="query-description" className="mb-2 block text-sm font-medium text-primary">
              What would you like to find?
            </label>
            <Input
              id="query-description"
              type="text"
              placeholder="e.g., 'Find all people Sarah knows' or 'Search for career-related topics'"
              value={queryDescription}
              onChange={(e) => setQueryDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isGenerating) {
                  handleGenerateQuery();
                }
              }}
            />
          </div>
          <Button onClick={handleGenerateQuery} disabled={isGenerating || !queryDescription.trim()}>
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              'Generate Explore Query'
            )}
          </Button>
        </div>
      </div>

      {/* Explore Tool Input */}
      <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-heading text-lg font-semibold text-primary">Explore Tool (Semantic Search)</h2>
        <div className="space-y-4">
          <div>
            <label htmlFor="explore-input" className="mb-2 block text-sm font-medium text-primary">
              Enter Explore Tool JSON
            </label>
            <Textarea
              id="explore-input"
              placeholder={`{
  "queries": [
    {"query": "career planning", "threshold": 0.6}
  ],
  "text_matches": ["Sarah"],
  "return_explanations": true
}`}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              rows={8}
              className="font-mono text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleExecuteExplore} disabled={isExecutingExplore || !input.trim()}>
              {isExecutingExplore ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Executing...
                </>
              ) : (
                'Execute Explore'
              )}
            </Button>
            {hasResult && (
              <Button variant="outline" onClick={onClear}>
                Clear Results
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
