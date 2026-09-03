"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Clock, ArrowLeft, Eye } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ApiError, getSourceStatus, type SourceStatus } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

type LoadingState = "loading" | "loaded" | "error" | "not_found";

const POLL_INTERVAL_MS = 3000;

/**
 * The source row carries no processing-status column: the pipeline's only
 * persisted marks are entities_extracted and neo4j_synced_at, and nothing is
 * written when a run fails. So there are two observable states, not four.
 */
type ProcessingState = "pending" | "processed";

function processingState(source: SourceStatus): ProcessingState {
  return source.entities_extracted ? "processed" : "pending";
}

export default function StatusPage() {
  const params = useParams();
  const sourceId = params.id as string;

  const [token, setToken] = useState<string | null>(null);
  const [source, setSource] = useState<SourceStatus | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [polling, setPolling] = useState(true);

  // The status route is behind authenticateToken and scopes the row to the
  // caller, so the page needs the signed-in session's access token.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        window.location.href = "/login";
        return;
      }
      setToken(session.access_token);
    });
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getSourceStatus(sourceId, token);
      setSource(data);
      setLoadingState("loaded");
      if (processingState(data) === "processed") setPolling(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setLoadingState("not_found");
        setPolling(false);
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : "Failed to fetch status");
      setLoadingState("error");
    }
  }, [sourceId, token]);

  // Poll until the pipeline marks the source extracted.
  useEffect(() => {
    if (!token || !sourceId || !polling) return;

    fetchStatus();
    const intervalId = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [token, sourceId, polling, fetchStatus]);

  const formatRelativeTime = (timestamp: string): string => {
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
  };

  const truncateContent = (content: string, maxLength: number = 500): string => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + "...";
  };

  const renderStatusBadge = (state: ProcessingState) =>
    state === "processed" ? (
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

  const renderStatusDescription = (state: ProcessingState) =>
    state === "processed"
      ? "Entities were extracted from this upload and written to your knowledge graph."
      : "This upload is in the queue or being processed. The backend records no failure state for a source, so an upload whose processing failed also stays on this state.";

  const shell = (title: string, subtitle: string | null, body: React.ReactNode) => (
    <div className="min-h-screen bg-cream">
      <section className="bg-gradient-to-br from-cream to-beige px-4 py-16 text-center md:px-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-4 font-heading text-4xl font-bold leading-tight text-primary md:text-5xl">
            {title}
          </h1>
          {subtitle && (
            <p className="text-lg leading-relaxed text-text-secondary md:text-xl">{subtitle}</p>
          )}
        </div>
      </section>

      <section className="px-4 py-12 md:px-8">
        <div className="mx-auto max-w-3xl">{body}</div>
      </section>

      <footer className="bg-cream px-4 py-8 text-center md:px-8">
        <p className="text-sm text-text-secondary">
          <Link href="/" className="text-primary hover:underline">
            ← Back to Home
          </Link>
        </p>
      </footer>
    </div>
  );

  if (loadingState === "loading") {
    return shell(
      "Upload Status",
      null,
      <Card className="shadow-lg">
        <CardContent className="flex flex-col items-center justify-center p-16 text-center">
          <Loader2 className="mb-4 h-12 w-12 animate-spin text-primary" />
          <p className="text-lg text-text-secondary">Loading status...</p>
        </CardContent>
      </Card>
    );
  }

  if (loadingState === "not_found") {
    return shell(
      "Upload Not Found",
      null,
      <Card className="shadow-lg">
        <CardContent className="p-8 text-center">
          <XCircle className="mx-auto mb-4 h-16 w-16 text-destructive" />
          <CardTitle className="mb-4 text-2xl text-primary">Upload Not Found</CardTitle>
          <CardDescription className="mb-6 text-base">
            This upload does not exist, or it belongs to another account.
          </CardDescription>
          <Button asChild>
            <Link href="/upload">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Upload
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loadingState === "error") {
    return shell(
      "Upload Status",
      null,
      <Card className="shadow-lg">
        <CardContent className="p-8 text-center">
          <XCircle className="mx-auto mb-4 h-16 w-16 text-destructive" />
          <CardTitle className="mb-4 text-2xl text-primary">Error Loading Status</CardTitle>
          <CardDescription className="mb-6 text-base">{errorMessage}</CardDescription>
          <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
            <Button onClick={fetchStatus}>Try Again</Button>
            <Button asChild variant="outline">
              <Link href="/upload">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Upload
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!source) return null;

  const state = processingState(source);

  return shell(
    "Upload Status",
    "Track the processing of your content",
    <Card className="shadow-lg">
      <CardContent className="p-8">
        <div className="mb-6 flex items-center justify-between">
          {renderStatusBadge(state)}
          <span className="text-sm text-text-secondary">
            Uploaded {formatRelativeTime(source.created_at)}
          </span>
        </div>

        <p className="mb-6 text-base text-text-secondary">{renderStatusDescription(state)}</p>

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
