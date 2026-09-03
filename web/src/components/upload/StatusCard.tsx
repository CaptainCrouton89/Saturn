"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { SourceStatus } from "@/lib/api";
import { ArrowLeft, CheckCircle2, Clock, Eye, Loader2 } from "lucide-react";
import Link from "next/link";

/**
 * The source row carries no processing-status column: the pipeline's only
 * persisted marks are entities_extracted and neo4j_synced_at, and nothing is
 * written when a run fails. So there are two observable states, not four.
 */
type ProcessingState = "pending" | "processed";

function processingState(source: SourceStatus): ProcessingState {
  return source.entities_extracted ? "processed" : "pending";
}

function formatRelativeTime(timestamp: string): string {
  const diffSeconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return "just now";
  if (diffMinutes === 1) return "1 minute ago";
  if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
  if (diffHours === 1) return "1 hour ago";
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return "1 day ago";
  return `${diffDays} days ago`;
}

function truncateContent(content: string, maxLength: number = 500): string {
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength) + "...";
}

function StatusBadge({ state }: { state: ProcessingState }) {
  return state === "processed" ? (
    <Badge variant="secondary" className="flex items-center gap-2 bg-green-100 text-green-700">
      <CheckCircle2 className="h-4 w-4" />
      Processed
    </Badge>
  ) : (
    <Badge variant="secondary" className="flex items-center gap-2 bg-blue-100 text-blue-700">
      <Clock className="h-4 w-4" />
      Queued or Processing
    </Badge>
  );
}

const STATUS_DESCRIPTION: Record<ProcessingState, string> = {
  processed: "Entities were extracted from this upload and written to your knowledge graph.",
  pending:
    "This upload is in the queue or being processed. The backend records no failure state for a source, so an upload whose processing failed also stays on this state.",
};

export function StatusCard({ source }: { source: SourceStatus }) {
  const state = processingState(source);

  return (
    <Card className="shadow-lg">
      <CardContent className="p-8">
        <div className="mb-6 flex items-center justify-between">
          <StatusBadge state={state} />
          <span className="text-sm text-text-secondary">
            Uploaded {formatRelativeTime(source.created_at)}
          </span>
        </div>

        <p className="mb-6 text-base text-text-secondary">{STATUS_DESCRIPTION[state]}</p>

        <div className="mb-6">
          <h3 className="mb-2 font-semibold text-primary">Source ID</h3>
          <p className="font-mono text-sm text-text-secondary">{source.id}</p>
        </div>

        {source.summary && (
          <div className="mb-6">
            <h3 className="mb-2 font-semibold text-primary">Summary</h3>
            <p className="text-sm text-text-secondary">{source.summary}</p>
          </div>
        )}

        <div className="mb-6">
          <h3 className="mb-2 font-semibold text-primary">Content Preview</h3>
          <div className="rounded-lg bg-beige p-4">
            <p className="whitespace-pre-wrap text-sm text-text-secondary">
              {truncateContent(source.content)}
            </p>
          </div>
        </div>

        {state === "processed" && (
          <div className="mb-6 rounded-lg border-l-4 border-success bg-success/10 p-4">
            <p className="mb-2 font-semibold text-success">Processing Complete</p>
            <div className="space-y-1 text-sm text-text-secondary">
              <p>Entities extracted: yes</p>
              {source.neo4j_synced_at ? (
                <p>Synced to knowledge graph: {formatRelativeTime(source.neo4j_synced_at)}</p>
              ) : (
                <p>Not yet marked as synced to the knowledge graph.</p>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4 sm:flex-row">
          {state === "processed" && (
            <Button asChild>
              <Link href="/viewer">
                <Eye className="mr-2 h-4 w-4" />
                View Graph
              </Link>
            </Button>
          )}

          <Button asChild variant="outline">
            <Link href="/upload">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {state === "processed" ? "Upload Another" : "Back to Upload"}
            </Link>
          </Button>

          {state === "pending" && (
            <div className="flex items-center gap-2 text-sm text-text-secondary sm:ml-auto">
              <Loader2 className="h-4 w-4 animate-spin" />
              Auto-refreshing every 3 seconds
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
