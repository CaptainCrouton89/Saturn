"use client";

import { StatusCard } from "@/components/upload/StatusCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { useSourceStatus } from "@/hooks/useSourceStatus";
import { ArrowLeft, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

function StatusShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
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
        <div className="mx-auto max-w-3xl">{children}</div>
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
}

export default function StatusPage() {
  const params = useParams();
  const sourceId = params.id as string;
  const { source, loadingState, errorMessage, refetch } = useSourceStatus(sourceId);

  if (loadingState === "loading") {
    return (
      <StatusShell title="Upload Status">
        <Card className="shadow-lg">
          <CardContent className="flex flex-col items-center justify-center p-16 text-center">
            <Loader2 className="mb-4 h-12 w-12 animate-spin text-primary" />
            <p className="text-lg text-text-secondary">Loading status...</p>
          </CardContent>
        </Card>
      </StatusShell>
    );
  }

  if (loadingState === "not_found") {
    return (
      <StatusShell title="Upload Not Found">
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
      </StatusShell>
    );
  }

  if (loadingState === "error") {
    return (
      <StatusShell title="Upload Status">
        <Card className="shadow-lg">
          <CardContent className="p-8 text-center">
            <XCircle className="mx-auto mb-4 h-16 w-16 text-destructive" />
            <CardTitle className="mb-4 text-2xl text-primary">Error Loading Status</CardTitle>
            <CardDescription className="mb-6 text-base">{errorMessage}</CardDescription>
            <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
              <Button onClick={refetch}>Try Again</Button>
              <Button asChild variant="outline">
                <Link href="/upload">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Upload
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </StatusShell>
    );
  }

  if (!source) return null;

  return (
    <StatusShell title="Upload Status" subtitle="Track the processing of your content">
      <StatusCard source={source} />
    </StatusShell>
  );
}
