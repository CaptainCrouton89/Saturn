"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CreateSourceResponse } from "@/lib/api";
import { Loader2, Upload } from "lucide-react";
import { useState } from "react";

/** Character limit. The backend accepts 1–500,000 characters; this form is the stricter surface. */
const CONTENT_LIMIT = 50000;

export type UploadStatus = "idle" | "loading" | "success" | "error";

interface FormData {
  content: string;
  source_type: string;
}

interface FormErrors {
  content?: string;
  source_type?: string;
  general?: string;
}

interface UploadFormProps {
  status: UploadStatus;
  onStatusChange: (status: UploadStatus) => void;
  onSuccess: (sourceId: string) => void;
}

export function UploadForm({ status, onStatusChange, onSuccess }: UploadFormProps) {
  const [formData, setFormData] = useState<FormData>({
    content: "",
    source_type: "voice-memo",
  });
  const [errors, setErrors] = useState<FormErrors>({});

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

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

    if (!validateForm()) {
      return;
    }

    onStatusChange("loading");
    setErrors({});

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: formData.content,
          source_type: formData.source_type,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        onStatusChange("error");
        setErrors({ general: data.error || "Failed to upload content" });
        return;
      }

      onStatusChange("success");
      onSuccess((data as CreateSourceResponse).source_id);

      // Clear form on success
      setFormData({
        content: "",
        source_type: "voice-memo",
      });
    } catch {
      onStatusChange("error");
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
    <form onSubmit={handleSubmit}>
      {/* General Error */}
      {errors.general && (
        <div className="mb-6 rounded-lg border-l-4 border-destructive bg-destructive/10 p-4">
          <p className="text-sm text-destructive">✗ {errors.general}</p>
        </div>
      )}

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
  );
}
