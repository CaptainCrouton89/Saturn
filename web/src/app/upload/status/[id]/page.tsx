"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Clock, ArrowLeft, Eye } from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

interface InformationDump {
  id: string;
  user_id: string;
  title: string;
  label: string | null;
  content: string;
  created_at: string;
  processing_status: "queued" | "processing" | "completed" | "failed";
  entities_extracted: boolean;
  neo4j_synced_at: string | null;
  error_message: string | null;
}

type LoadingState = "loading" | "loaded" | "error" | "not_found";

export default function StatusPage() {
  const params = useParams();
  const dumpId = params.id as string;

  const [dump, setDump] = useState<InformationDump | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const fetchStatus = async () => {
    try {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
      if (!apiBaseUrl) {
        throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured");
      }

      const response = await fetch(`${apiBaseUrl}/api/information-dumps/${dumpId}`);

      if (response.status === 404) {
        setLoadingState("not_found");
        return;
      }

      if (!response.ok) {
        const data = await response.json();
        setErrorMessage(data.error ? data.error : "Failed to fetch status");
        setLoadingState("error");
        return;
      }

      const data: InformationDump = await response.json();
      setDump(data);
      setLoadingState("loaded");
    } catch (error) {
      setErrorMessage("Network error - could not connect to server");
      setLoadingState("error");
    }
  };

  // Polling effect
  useEffect(() => {
    if (!dumpId) return;

    // Initial fetch
    fetchStatus();

    // Set up polling interval
    const intervalId = setInterval(() => {
      if (dump?.processing_status === "queued" || dump?.processing_status === "processing") {
        fetchStatus();
      } else {
        clearInterval(intervalId);
      }
    }, 3000);

    // Cleanup on unmount
    return () => clearInterval(intervalId);
  }, [dumpId, dump?.processing_status]);

  // Format relative time
  const formatRelativeTime = (timestamp: string): string => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
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

  // Truncate content preview
  const truncateContent = (content: string, maxLength: number = 500): string => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + "...";
  };

  // Render status badge
  const renderStatusBadge = (status: InformationDump["processing_status"]) => {
    switch (status) {
      case "queued":
        return (
          <Badge variant="secondary" className="flex items-center gap-2 bg-blue-100 text-blue-700">
            <Clock className="h-4 w-4" />
            Queued for Processing
          </Badge>
        );
      case "processing":
        return (
          <Badge variant="secondary" className="flex items-center gap-2 bg-yellow-100 text-yellow-700">
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing
          </Badge>
        );
      case "completed":
        return (
          <Badge variant="secondary" className="flex items-center gap-2 bg-green-100 text-green-700">
            <CheckCircle2 className="h-4 w-4" />
            Complete
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="flex items-center gap-2">
            <XCircle className="h-4 w-4" />
            Failed
          </Badge>
        );
    }
  };

  // Render status description
  const renderStatusDescription = (status: InformationDump["processing_status"]) => {
    switch (status) {
      case "queued":
        return "Your content is in the queue and will be processed shortly.";
      case "processing":
        return "Extracting entities from your content and updating your knowledge graph...";
      case "completed":
        return "Your content has been processed and added to your knowledge graph.";
      case "failed":
        return "An error occurred while processing your content.";
    }
  };

  // Loading state
  if (loadingState === "loading") {
    return (
      <div className="min-h-screen bg-cream">
        {/* Header */}
        <section className="bg-gradient-to-br from-cream to-beige px-4 py-16 text-center md:px-8">
          <div className="mx-auto max-w-4xl">
            <h1 className="mb-4 font-heading text-4xl font-bold leading-tight text-primary md:text-5xl">
              Upload Status
            </h1>
          </div>
        </section>

        {/* Loading Content */}
        <section className="px-4 py-12 md:px-8">
          <div className="mx-auto max-w-3xl">
            <Card className="shadow-lg">
              <CardContent className="flex flex-col items-center justify-center p-16 text-center">
                <Loader2 className="mb-4 h-12 w-12 animate-spin text-primary" />
                <p className="text-lg text-text-secondary">Loading status...</p>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    );
  }

  // Not found state
  if (loadingState === "not_found") {
    return (
      <div className="min-h-screen bg-cream">
        {/* Header */}
        <section className="bg-gradient-to-br from-cream to-beige px-4 py-16 text-center md:px-8">
          <div className="mx-auto max-w-4xl">
            <h1 className="mb-4 font-heading text-4xl font-bold leading-tight text-primary md:text-5xl">
              Upload Not Found
            </h1>
          </div>
        </section>

        {/* Error Content */}
        <section className="px-4 py-12 md:px-8">
          <div className="mx-auto max-w-3xl">
            <Card className="shadow-lg">
              <CardContent className="p-8 text-center">
                <XCircle className="mx-auto mb-4 h-16 w-16 text-destructive" />
                <CardTitle className="mb-4 text-2xl text-primary">Upload Not Found</CardTitle>
                <CardDescription className="mb-6 text-base">
                  The upload you're looking for doesn't exist or may have been deleted.
                </CardDescription>
                <Button asChild>
                  <Link href="/upload">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Upload
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    );
  }

  // Error state
  if (loadingState === "error") {
    return (
      <div className="min-h-screen bg-cream">
        {/* Header */}
        <section className="bg-gradient-to-br from-cream to-beige px-4 py-16 text-center md:px-8">
          <div className="mx-auto max-w-4xl">
            <h1 className="mb-4 font-heading text-4xl font-bold leading-tight text-primary md:text-5xl">
              Upload Status
            </h1>
          </div>
        </section>

        {/* Error Content */}
        <section className="px-4 py-12 md:px-8">
          <div className="mx-auto max-w-3xl">
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
          </div>
        </section>
      </div>
    );
  }

  // Success state - show dump details
  if (!dump) return null;

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <section className="bg-gradient-to-br from-cream to-beige px-4 py-16 text-center md:px-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-4 font-heading text-4xl font-bold leading-tight text-primary md:text-5xl">
            Upload Status
          </h1>
          <p className="text-lg leading-relaxed text-text-secondary md:text-xl">
            Track the processing of your content
          </p>
        </div>
      </section>

      {/* Status Content */}
      <section className="px-4 py-12 md:px-8">
        <div className="mx-auto max-w-3xl">
          <Card className="shadow-lg">
            <CardContent className="p-8">
              {/* Status Badge */}
              <div className="mb-6 flex items-center justify-between">
                {renderStatusBadge(dump.processing_status)}
                <span className="text-sm text-text-secondary">
                  Uploaded {formatRelativeTime(dump.created_at)}
                </span>
              </div>

              {/* Status Description */}
              <p className="mb-6 text-base text-text-secondary">
                {renderStatusDescription(dump.processing_status)}
              </p>

              {/* Title and Label */}
              <div className="mb-6">
                <h2 className="mb-2 text-2xl font-bold text-primary">{dump.title}</h2>
                {dump.label && (
                  <Badge variant="outline" className="text-sm">
                    {dump.label}
                  </Badge>
                )}
              </div>

              {/* Content Preview */}
              <div className="mb-6">
                <h3 className="mb-2 font-semibold text-primary">Content Preview</h3>
                <div className="rounded-lg bg-beige p-4">
                  <p className="whitespace-pre-wrap text-sm text-text-secondary">
                    {truncateContent(dump.content)}
                  </p>
                </div>
              </div>

              {/* Error Message (if failed) */}
              {dump.processing_status === "failed" && dump.error_message && (
                <div className="mb-6 rounded-lg border-l-4 border-destructive bg-destructive/10 p-4">
                  <p className="font-semibold text-destructive">Error Details:</p>
                  <p className="mt-1 text-sm text-destructive">{dump.error_message}</p>
                </div>
              )}

              {/* Processing Details */}
              {dump.processing_status === "completed" && (
                <div className="mb-6 rounded-lg border-l-4 border-success bg-success/10 p-4">
                  <p className="mb-2 font-semibold text-success">Processing Complete</p>
                  <div className="space-y-1 text-sm text-text-secondary">
                    <p>Entities extracted: {dump.entities_extracted ? "Yes" : "No"}</p>
                    {dump.neo4j_synced_at && (
                      <p>Synced to knowledge graph: {formatRelativeTime(dump.neo4j_synced_at)}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col gap-4 sm:flex-row">
                {dump.processing_status === "completed" && (
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
                    {dump.processing_status === "completed" ? "Upload Another" : "Back to Upload"}
                  </Link>
                </Button>

                {/* Auto-refresh indicator for queued/processing */}
                {(dump.processing_status === "queued" || dump.processing_status === "processing") && (
                  <div className="flex items-center gap-2 text-sm text-text-secondary sm:ml-auto">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Auto-refreshing every 3 seconds
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Simple Footer */}
      <footer className="bg-cream px-4 py-8 text-center md:px-8">
        <p className="text-sm text-text-secondary">
          <Link href="/" className="text-primary hover:underline">
            ← Back to Home
          </Link>
        </p>
      </footer>
    </div>
  );
}
