"use client";

import { Button } from "@/components/ui/button";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";

interface UploadSuccessProps {
  sourceId: string;
  onUploadAnother: () => void;
}

export function UploadSuccess({ sourceId, onUploadAnother }: UploadSuccessProps) {
  return (
    <div className="text-center">
      <div className="mb-6 flex justify-center">
        <CheckCircle2 className="h-16 w-16 text-success" />
      </div>
      <CardTitle className="mb-4 text-2xl text-primary">Upload Successful!</CardTitle>
      <CardDescription className="mb-6 text-base">
        Your content has been queued for processing.
      </CardDescription>
      <div className="mb-8 rounded-lg border-l-4 border-success bg-success/10 p-4 text-left">
        <p className="mb-2 font-semibold text-primary">Source ID:</p>
        <p className="font-mono text-sm text-text-secondary">{sourceId}</p>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
        <Button asChild>
          <Link href={`/upload/status/${sourceId}`}>View Status</Link>
        </Button>
        <Button variant="outline" onClick={onUploadAnother}>
          Upload Another
        </Button>
      </div>
    </div>
  );
}
