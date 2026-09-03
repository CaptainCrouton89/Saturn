"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { SourceStatus } from "@/lib/api";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Eye,
  HelpCircle,
  Loader2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

/**
 * The lifecycle the pipeline persists on the source row, plus "unrecorded" for
 * the null status carried by rows created before the lifecycle columns existed.
 * Those rows were never backfilled and nothing will ever update them, so their
 * outcome is genuinely unknown rather than pending.
 */
type LifecycleState = "queued" | "processing" | "completed" | "failed" | "unrecorded";

interface LifecyclePresentation {
  label: string;
  variant: React.ComponentProps<typeof Badge>["variant"];
  icon: LucideIcon;
  iconClassName?: string;
  description: string;
}

const LIFECYCLE: Record<LifecycleState, LifecyclePresentation> = {
  queued: {
    label: "Queued",
    variant: "secondary",
    icon: Clock,
    description: "This upload is waiting in the processing queue. Nothing has been extracted from it yet.",
  },
  processing: {
    label: "Processing",
    variant: "info",
    icon: Loader2,
    iconClassName: "animate-spin",
    description: "The pipeline is reading this upload and extracting entities right now.",
  },
  completed: {
    label: "Completed",
    variant: "success",
    icon: CheckCircle2,
    description: "The pipeline finished processing this upload.",
  },
  failed: {
    label: "Failed",
    variant: "destructive",
    icon: XCircle,
    description: "The pipeline stopped on an error while processing this upload.",
  },
  unrecorded: {
    label: "Status Not Recorded",
    variant: "outline",
    icon: HelpCircle,
    description:
      "This upload predates the processing-status column, so its outcome was never written down. What is below is everything Saturn knows about it, and it will not change.",
  },
};

function lifecycleState(source: SourceStatus): LifecycleState {
  return source.processing_status ?? "unrecorded";
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

function StatusBadge({ state }: { state: LifecycleState }) {
  const { label, variant, icon: Icon, iconClassName } = LIFECYCLE[state];
  return (
    <Badge variant={variant} className="flex items-center gap-2">
      <Icon className={iconClassName} />
      {label}
    </Badge>
  );
}

export function StatusCard({ source }: { source: SourceStatus }) {
  const state = lifecycleState(source);
  const inFlight = state === "queued" || state === "processing";

  return (
    <Card className="shadow-lg">
      <CardContent className="p-8">
        <div className="mb-6 flex items-center justify-between">
          <StatusBadge state={state} />
          <span className="text-sm text-text-secondary">
            Uploaded {formatRelativeTime(source.created_at)}
          </span>
        </div>

        <p className="mb-6 text-base text-text-secondary">{LIFECYCLE[state].description}</p>

        {state === "failed" && (
          <div className="mb-6 rounded-lg border-l-4 border-destructive bg-destructive/10 p-4">
            <p className="mb-2 font-semibold text-destructive">Processing Error</p>
            <p className="whitespace-pre-wrap font-mono text-sm text-text-secondary">
              {source.error_message ?? "The pipeline recorded no error message for this failure."}
            </p>
          </div>
        )}

        <div className="mb-6">
          <h3 className="mb-2 font-semibold text-primary">Source ID</h3>
          <p className="font-mono text-sm text-text-secondary">{source.id}</p>
        </div>

        {source.attempt_count > 0 && (
          <div className="mb-6">
            <h3 className="mb-2 font-semibold text-primary">Processing Attempts</h3>
            <p className="text-sm text-text-secondary">
              {source.attempt_count === 1 ? "1 attempt" : `${source.attempt_count} attempts`}
            </p>
          </div>
        )}

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

        <div
          className={
            source.entities_extracted
              ? "mb-6 rounded-lg border-l-4 border-success bg-success/10 p-4"
              : "mb-6 rounded-lg border-l-4 border-border bg-beige p-4"
          }
        >
          <p
            className={
              source.entities_extracted ? "mb-2 font-semibold text-success" : "mb-2 font-semibold text-primary"
            }
          >
            Knowledge Graph
          </p>
          <div className="space-y-1 text-sm text-text-secondary">
            <p>Entities extracted: {source.entities_extracted ? "yes" : "no"}</p>
            {source.neo4j_synced_at ? (
              <p>Synced to knowledge graph: {formatRelativeTime(source.neo4j_synced_at)}</p>
            ) : (
              <p>Not yet marked as synced to the knowledge graph.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          {source.entities_extracted && (
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
              {inFlight ? "Back to Upload" : "Upload Another"}
            </Link>
          </Button>

          {inFlight && (
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
