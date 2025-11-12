'use client';

import { Card, CardContent } from '@/components/ui/card';

interface QueryResultsSummaryProps {
  nodeCount: number;
  linkCount: number;
  error?: string;
}

export default function QueryResultsSummary({ nodeCount, linkCount, error }: QueryResultsSummaryProps) {
  if (error) {
    return (
      <Card className="border-error bg-error/5">
        <CardContent className="p-4">
          <div className="text-sm text-error">
            <strong>Error:</strong> {error}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (nodeCount === 0 && linkCount === 0) {
    return null;
  }

  return (
    <Card className="border-success/30 bg-success/5">
      <CardContent className="p-4">
        <div className="text-sm text-success">
          <strong>Query Results:</strong> {nodeCount} nodes and {linkCount} relationships
        </div>
      </CardContent>
    </Card>
  );
}
