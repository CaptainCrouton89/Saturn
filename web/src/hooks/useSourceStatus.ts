"use client";

import { useSession } from "@/hooks/useSession";
import { ApiError, getSourceStatus, type SourceStatus } from "@/lib/api";
import { useCallback, useEffect, useState } from "react";

export type SourceStatusLoadingState = "loading" | "loaded" | "error" | "not_found";

const POLL_INTERVAL_MS = 3000;

interface UseSourceStatusResult {
  source: SourceStatus | null;
  loadingState: SourceStatusLoadingState;
  errorMessage: string;
  refetch: () => void;
}

/**
 * Polls GET /api/information-dumps/:id with the signed-in session's token while
 * the source's processing_status can still change — that is, while it is queued
 * or processing. A terminal status (completed, failed), a null status (a row
 * predating the lifecycle columns, which nothing will ever update), and a 404
 * (missing row, or one owned by another account) each stop the polling; a
 * transient error does not.
 */
export function useSourceStatus(sourceId: string): UseSourceStatusResult {
  const session = useSession();
  const [source, setSource] = useState<SourceStatus | null>(null);
  const [loadingState, setLoadingState] = useState<SourceStatusLoadingState>("loading");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [polling, setPolling] = useState(true);

  const token = session?.token ?? null;

  const fetchStatus = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getSourceStatus(sourceId, token);
      setSource(data);
      setLoadingState("loaded");
      const stillMoving = data.processing_status === "queued" || data.processing_status === "processing";
      if (!stillMoving) setPolling(false);
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

  useEffect(() => {
    if (!token || !sourceId || !polling) return;

    fetchStatus();
    const intervalId = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [token, sourceId, polling, fetchStatus]);

  return { source, loadingState, errorMessage, refetch: fetchStatus };
}
