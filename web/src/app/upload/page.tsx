"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import Link from "next/link";

interface FormData {
  title: string;
  label: string;
  content: string;
}

interface FormErrors {
  title?: string;
  label?: string;
  content?: string;
  general?: string;
}

type FormStatus = "idle" | "loading" | "success" | "error";

export default function UploadPage() {
  const [formData, setFormData] = useState<FormData>({
    title: "",
    label: "",
    content: "",
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<FormStatus>("idle");
  const [jobId, setJobId] = useState<string>("");

  // Character limits
  const TITLE_LIMIT = 200;
  const LABEL_LIMIT = 200;
  const CONTENT_LIMIT = 50000;

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.title.trim()) {
      newErrors.title = "Title is required";
    } else if (formData.title.length > TITLE_LIMIT) {
      newErrors.title = `Title must be ${TITLE_LIMIT} characters or less`;
    }

    if (formData.label.length > LABEL_LIMIT) {
      newErrors.label = `Label must be ${LABEL_LIMIT} characters or less`;
    }

    if (!formData.content.trim()) {
      newErrors.content = "Content is required";
    } else if (formData.content.length > CONTENT_LIMIT) {
      newErrors.content = `Content must be ${CONTENT_LIMIT} characters or less`;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setStatus("loading");
    setErrors({});

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: formData.title,
          label: formData.label.trim() ? formData.label : undefined,
          content: formData.content,
          user_id: "test-user-id", // Hardcoded for MVP
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setStatus("error");
        setErrors({ general: data.error || "Failed to upload content" });
        return;
      }

      setStatus("success");
      setJobId(data.job_id);

      // Clear form on success
      setFormData({
        title: "",
        label: "",
        content: "",
      });
    } catch (error) {
      setStatus("error");
      setErrors({ general: "An unexpected error occurred. Please try again." });
    }
  };

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // Clear field-specific error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  const isFormDisabled = status === "loading";

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
                // Success State
                <div className="text-center">
                  <div className="mb-6 flex justify-center">
                    <CheckCircle2 className="h-16 w-16 text-success" />
                  </div>
                  <CardTitle className="mb-4 text-2xl text-primary">
                    Upload Successful!
                  </CardTitle>
                  <CardDescription className="mb-6 text-base">
                    Your content has been queued for processing.
                  </CardDescription>
                  <div className="mb-8 rounded-lg border-l-4 border-success bg-success/10 p-4 text-left">
                    <p className="mb-2 font-semibold text-primary">Job ID:</p>
                    <p className="font-mono text-sm text-text-secondary">{jobId}</p>
                  </div>
                  <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
                    <Button asChild>
                      <Link href={`/upload/status/${jobId}`}>
                        View Status
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setStatus("idle");
                        setJobId("");
                      }}
                    >
                      Upload Another
                    </Button>
                  </div>
                </div>
              ) : (
                // Form State
                <form onSubmit={handleSubmit}>
                  {/* General Error */}
                  {errors.general && (
                    <div className="mb-6 rounded-lg border-l-4 border-destructive bg-destructive/10 p-4">
                      <p className="text-sm text-destructive">✗ {errors.general}</p>
                    </div>
                  )}

                  {/* Title Field */}
                  <div className="mb-6">
                    <Label htmlFor="title">
                      Title <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="title"
                      type="text"
                      placeholder="e.g., Morning Journal Entry - Jan 15"
                      value={formData.title}
                      onChange={(e) => handleInputChange("title", e.target.value)}
                      disabled={isFormDisabled}
                      aria-invalid={!!errors.title}
                      className={errors.title ? "border-destructive" : ""}
                    />
                    <div className="mt-1 flex justify-between">
                      <span className={`text-sm ${errors.title ? "text-destructive" : "text-muted-foreground"}`}>
                        {errors.title || " "}
                      </span>
                      <span className={`text-sm ${formData.title.length > TITLE_LIMIT ? "text-destructive" : "text-muted-foreground"}`}>
                        {formData.title.length}/{TITLE_LIMIT}
                      </span>
                    </div>
                  </div>

                  {/* Label Field */}
                  <div className="mb-6">
                    <Label htmlFor="label">Label (optional)</Label>
                    <Input
                      id="label"
                      type="text"
                      placeholder="e.g., journal, meeting-notes, book-summary"
                      value={formData.label}
                      onChange={(e) => handleInputChange("label", e.target.value)}
                      disabled={isFormDisabled}
                      aria-invalid={!!errors.label}
                      className={errors.label ? "border-destructive" : ""}
                    />
                    <div className="mt-1 flex justify-between">
                      <span className={`text-sm ${errors.label ? "text-destructive" : "text-muted-foreground"}`}>
                        {errors.label || " "}
                      </span>
                      <span className={`text-sm ${formData.label.length > LABEL_LIMIT ? "text-destructive" : "text-muted-foreground"}`}>
                        {formData.label.length}/{LABEL_LIMIT}
                      </span>
                    </div>
                  </div>

                  {/* Content Field */}
                  <div className="mb-6">
                    <Label htmlFor="content">
                      Content <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id="content"
                      placeholder="Paste your transcript, notes, or document content here..."
                      value={formData.content}
                      onChange={(e) => handleInputChange("content", e.target.value)}
                      disabled={isFormDisabled}
                      aria-invalid={!!errors.content}
                      className={`min-h-[300px] ${errors.content ? "border-destructive" : ""}`}
                    />
                    <div className="mt-1 flex justify-between">
                      <span className={`text-sm ${errors.content ? "text-destructive" : "text-muted-foreground"}`}>
                        {errors.content || " "}
                      </span>
                      <span className={`text-sm ${formData.content.length > CONTENT_LIMIT ? "text-destructive" : "text-muted-foreground"}`}>
                        {formData.content.length}/{CONTENT_LIMIT.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      size="lg"
                      disabled={isFormDisabled}
                      className="w-full sm:w-auto"
                    >
                      {status === "loading" ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="mr-2 h-4 w-4" />
                          Upload Content
                        </>
                      )}
                    </Button>
                  </div>
                </form>
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
