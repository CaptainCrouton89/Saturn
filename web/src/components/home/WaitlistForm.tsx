"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { useState } from "react";

export function WaitlistForm({ variant = "default" }: { variant?: "default" | "cta" }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        setStatus({ type: "error", message: data.error || "Failed to join waitlist" });
        return;
      }

      setStatus({ type: "success", message: "You're on the list!" });
      setEmail("");

      // Clear success message after 5 seconds
      setTimeout(() => setStatus(null), 5000);
    } catch {
      setStatus({ type: "error", message: "An unexpected error occurred. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="mx-auto flex max-w-2xl flex-col gap-4 sm:flex-row">
        <Input
          type="email"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={loading}
          className={`flex-1 text-lg ${variant === "cta" ? "bg-white" : ""}`}
        />
        <Button
          type="submit"
          size="lg"
          disabled={loading}
          variant={variant === "cta" ? "secondary" : "default"}
          className={variant === "cta" ? "bg-accent text-white hover:bg-accent/90 sm:w-auto" : "sm:w-auto"}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Joining...
            </>
          ) : (
            "Join Waitlist"
          )}
        </Button>
      </form>

      {status && (
        <div
          className={`mt-6 rounded-lg border-l-4 p-4 ${
            status.type === "success"
              ? variant === "cta"
                ? "border-white bg-white/90 text-primary"
                : "border-success bg-success/10 text-success"
              : variant === "cta"
              ? "border-white bg-white/90 text-error"
              : "border-error bg-error/10 text-error"
          }`}
        >
          {status.type === "success" ? "✓" : "✗"} {status.message}
        </div>
      )}
    </div>
  );
}
