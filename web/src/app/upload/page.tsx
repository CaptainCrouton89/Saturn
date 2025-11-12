"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, CheckCircle2 } from "lucide-react";
import { useState, useEffect } from "react";
import Link from "next/link";
import { fetchUsers, type User } from "@/lib/api";

interface FormData {
  title: string;
  label: string;
  content: string;
  source_type: string;
}

interface FormErrors {
  title?: string;
  label?: string;
  content?: string;
  source_type?: string;
  general?: string;
}

type FormStatus = "idle" | "loading" | "success" | "error";

export default function UploadPage() {
  // User selection state
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [formData, setFormData] = useState<FormData>({
    title: "",
    label: "",
    content: "",
    source_type: "voice-memo",
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<FormStatus>("idle");
  const [jobId, setJobId] = useState<string>("");

  // Load users on mount
  useEffect(() => {
    async function loadUsers() {
      try {
        setLoadingUsers(true);
        const userList = await fetchUsers();
        setUsers(userList);
        if (userList.length > 0) {
          setSelectedUserId(userList[0].id);
        }
      } catch (err) {
        setErrors({ general: err instanceof Error ? err.message : "Failed to load users" });
      } finally {
        setLoadingUsers(false);
      }
    }
    loadUsers();
  }, []);

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

    if (!formData.source_type) {
      newErrors.source_type = "Source type is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedUserId) {
      setErrors({ general: "Please select a user" });
      return;
    }

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
          source_type: formData.source_type,
          user_id: selectedUserId,
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
        source_type: "voice-memo",
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

                  {/* User Selector */}
                  <div className="mb-6">
                    <Label htmlFor="user-select">
                      User <span className="text-destructive">*</span>
                    </Label>
                    <select
                      id="user-select"
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                      disabled={loadingUsers || users.length === 0 || isFormDisabled}
                      className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loadingUsers ? (
                        <option>Loading users...</option>
                      ) : users.length === 0 ? (
                        <option>No users available</option>
                      ) : (
                        users.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name || user.id}
                          </option>
                        ))
                      )}
                    </select>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Select which user&apos;s knowledge graph to add this content to
                    </p>
                  </div>

                  {/* Source Type Selector */}
                  <div className="mb-6">
                    <Label htmlFor="source-type">
                      Content Type <span className="text-destructive">*</span>
                    </Label>
                    <select
                      id="source-type"
                      value={formData.source_type}
                      onChange={(e) => handleInputChange("source_type", e.target.value)}
                      disabled={isFormDisabled}
                      className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="voice-memo">Voice Memo</option>
                      <option value="meeting">Meeting Notes</option>
                      <option value="journal">Journal Entry</option>
                      <option value="book-summary">Book Summary</option>
                      <option value="article">Article/Reading</option>
                      <option value="conversation">Conversation Transcript</option>
                      <option value="other">Other</option>
                    </select>
                    {errors.source_type && (
                      <p className="mt-1 text-sm text-destructive">{errors.source_type}</p>
                    )}
                    {!errors.source_type && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        What kind of content are you uploading?
                      </p>
                    )}
                  </div>

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
