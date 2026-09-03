"use client";

import { UploadForm, type UploadStatus } from "@/components/upload/UploadForm";
import { UploadSuccess } from "@/components/upload/UploadSuccess";
import { Card, CardContent } from "@/components/ui/card";
import { useSession } from "@/hooks/useSession";
import Link from "next/link";
import { useState } from "react";

export default function UploadPage() {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [sourceId, setSourceId] = useState<string>("");

  // The API route reads the same Supabase session from its cookies and forwards
  // that access token to the backend; this only guards the page.
  useSession();

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <section className="bg-gradient-to-br from-cream to-beige px-4 py-16 text-center md:px-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-4 font-heading text-4xl font-bold leading-tight text-primary md:text-5xl">
            Upload Content
          </h1>
          <p className="text-lg leading-relaxed text-text-secondary md:text-xl">
            Add transcripts, notes, or documents to your knowledge graph
          </p>
        </div>
      </section>

      {/* Form Section */}
      <section className="px-4 py-12 md:px-8">
        <div className="mx-auto max-w-3xl">
          <Card className="shadow-lg">
            <CardContent className="p-8">
              {status === "success" ? (
                <UploadSuccess
                  sourceId={sourceId}
                  onUploadAnother={() => {
                    setStatus("idle");
                    setSourceId("");
                  }}
                />
              ) : (
                <UploadForm status={status} onStatusChange={setStatus} onSuccess={setSourceId} />
              )}
            </CardContent>
          </Card>

          {/* Help Text */}
          {status === "idle" && (
            <div className="mt-8 text-center">
              <p className="text-sm text-text-secondary">
                Your content will be processed asynchronously and added to your knowledge graph.
              </p>
            </div>
          )}
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
