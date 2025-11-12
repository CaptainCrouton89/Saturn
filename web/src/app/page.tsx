"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GraphData } from "@/components/graph/types";
import { Loader2, MessageCircle, Mic, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

// Dynamically import KnowledgeGraph to avoid SSR issues
const KnowledgeGraph = dynamic(() => import("@/components/graph/KnowledgeGraph"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[500px] items-center justify-center rounded-xl bg-gradient-to-br from-white/50 to-beige/50 backdrop-blur-sm">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  ),
});

// Waitlist form component for reusability
function WaitlistForm({ variant = "default" }: { variant?: "default" | "cta" }) {
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
    } catch (error) {
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

// Hook for scroll animations
function useScrollAnimation() {
  const ref = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return { ref, isVisible };
}

export default function Home() {
  const problemSection = useScrollAnimation();
  const differentiatorSection = useScrollAnimation();
  const useCaseSection = useScrollAnimation();
  const howItWorksSection = useScrollAnimation();
  const graphSection = useScrollAnimation();

  // Simple demo graph data showing the new node types
  const graphData = useMemo((): GraphData => ({
    nodes: [
      { id: '1', name: 'Sarah', type: 'Person', val: 15 },
      { id: '2', name: 'Career Growth', type: 'Concept', val: 12 },
      { id: '3', name: 'Morning Conversation', type: 'Source', val: 8 },
      { id: '4', name: 'Tech Startup', type: 'Entity', val: 10 },
      { id: '5', name: 'Action Plan', type: 'Artifact', val: 9 },
    ],
    links: [
      { source: '1', target: '2', label: 'thinks_about' },
      { source: '3', target: '1', label: 'mentions' },
      { source: '3', target: '2', label: 'mentions' },
      { source: '2', target: '4', label: 'involves' },
      { source: '5', target: '3', label: 'sourced_from' },
    ]
  }), []);

  return (
    <div className="min-h-screen bg-cream">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-cream to-beige px-4 py-32 text-center md:px-8 md:py-48">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-6 animate-fade-in font-heading text-4xl font-bold leading-tight text-primary md:text-6xl">
            Your smart best friend. Always there to think things through.
          </h1>
          <p className="mb-12 animate-fade-in text-xl leading-relaxed text-text-secondary md:text-2xl" style={{ animationDelay: "0.1s" }}>
            Cosmo is the AI companion that actually knows you—and that you actually enjoy talking to.
          </p>

          <div className="animate-fade-in" style={{ animationDelay: "0.2s" }}>
            <WaitlistForm />
          </div>
        </div>
      </section>

      {/* Problem Recognition Section */}
      <section
        ref={problemSection.ref}
        className={`bg-beige px-4 py-16 transition-all duration-700 md:px-8 md:py-24 ${
          problemSection.isVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
        }`}
      >
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="mb-6 font-heading text-3xl font-bold text-primary md:text-4xl">
            You've seen the AI therapist. You've seen the AI coach.
          </h2>
          <p className="text-lg leading-relaxed text-text-primary">
            The space is crowded with AI companions that talk like bad essay writers.
            They're not fun to talk to. They don't remember what you told them last week.
            They give you the same generic advice you could've Googled.
            You deserve better.
          </p>
        </div>
      </section>

      {/* The Differentiator Section - 3 Criteria */}
      <section
        ref={differentiatorSection.ref}
        className={`bg-white px-4 py-16 transition-all duration-700 md:px-8 md:py-24 ${
          differentiatorSection.isVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
        }`}
      >
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-4 text-center font-heading text-3xl font-bold text-primary md:text-4xl">
            Why do you go to a specific friend for advice?
          </h2>

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {[
              {
                number: 1,
                title: "They're smart",
                description: "They give you real insight, not generic platitudes like \"you should meditate\" or \"follow your heart.\"",
                delay: "0s"
              },
              {
                number: 2,
                title: "They know you",
                description: "No need to re-explain your entire life situation every time. They remember the context.",
                delay: "0.1s"
              },
              {
                number: 3,
                title: "You like talking to them",
                description: "The conversation itself is engaging, not a chore. You actually enjoy the interaction.",
                delay: "0.2s"
              }
            ].map((item) => (
              <div
                key={item.number}
                className="text-center transition-all duration-500"
                style={{
                  transitionDelay: differentiatorSection.isVisible ? item.delay : "0s",
                  opacity: differentiatorSection.isVisible ? 1 : 0,
                  transform: differentiatorSection.isVisible ? "translateY(0)" : "translateY(20px)"
                }}
              >
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent text-2xl font-bold text-white">
                  {item.number}
                </div>
                <h3 className="mb-3 font-heading text-xl font-bold">{item.title}</h3>
                <p className="text-text-secondary">{item.description}</p>
              </div>
            ))}
          </div>

          <p className="mt-12 text-center text-lg leading-relaxed text-text-secondary">
            Most AI companions nail #1, vaguely gesture at #2, and completely miss #3.
            <span className="font-semibold text-primary"> Cosmo is built for all three.</span>
          </p>
        </div>
      </section>

      {/* Use Case Examples Section */}
      <section
        ref={useCaseSection.ref}
        className={`bg-cream px-4 py-16 transition-all duration-700 md:px-8 md:py-24 ${
          useCaseSection.isVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
        }`}
      >
        <div className="mx-auto max-w-7xl">
          <h2 className="mb-4 text-center font-heading text-3xl font-bold text-primary md:text-4xl">
            Real life is complicated. Cosmo gets it.
          </h2>

          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Work Drama Card */}
            <Card className="transition-all duration-500 hover:-translate-y-1 hover:shadow-lg">
              <CardContent className="p-6">
                <CardTitle className="mb-4 text-primary">Work Drama</CardTitle>
                <p className="mb-4 italic text-text-secondary">
                  "Should I escalate this conflict with my manager or wait until after Q1 reviews?"
                </p>
                <CardDescription className="mb-6">
                  Cosmo remembers your promotion timeline, your manager's communication style, and past workplace dynamics to help you navigate sensitive situations.
                </CardDescription>
                <div className="rounded-md border-l-4 border-accent bg-beige p-4 text-sm">
                  <p className="mb-2 font-semibold text-primary">Example conversation:</p>
                  <div className="space-y-2">
                    <p>
                      <span className="font-semibold text-secondary">You:</span>{" "}
                      <span className="italic">"I'm so frustrated with how Tom handled the meeting today."</span>
                    </p>
                    <p>
                      <span className="font-semibold text-secondary">Cosmo:</span>{" "}
                      <span className="italic">"Is this the same pattern you mentioned last month—where he interrupts you in front of the team? Or something different?"</span>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Relationship Decision Card */}
            <Card className="transition-all duration-500 hover:-translate-y-1 hover:shadow-lg">
              <CardContent className="p-6">
                <CardTitle className="mb-4 text-primary">Relationship Decision</CardTitle>
                <p className="mb-4 italic text-text-secondary">
                  "My ex just joined my company. Do I take the role on their team?"
                </p>
                <CardDescription className="mb-6">
                  Complex decisions that blend emotional and practical considerations. Cosmo helps you think through implications without giving generic advice.
                </CardDescription>
                <div className="rounded-md border-l-4 border-accent bg-beige p-4 text-sm">
                  <p className="mb-2 font-semibold text-primary">Example conversation:</p>
                  <div className="space-y-2">
                    <p>
                      <span className="font-semibold text-secondary">Cosmo:</span>{" "}
                      <span className="italic">"Last time we talked about boundaries with Sarah, you said being in the same space made things harder. How does this feel different—or does it?"</span>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Career Transition Card */}
            <Card className="transition-all duration-500 hover:-translate-y-1 hover:shadow-lg">
              <CardContent className="p-6">
                <CardTitle className="mb-4 text-primary">Career Transition</CardTitle>
                <p className="mb-4 italic text-text-secondary">
                  "I'm thinking about leaving my stable job to start something."
                </p>
                <CardDescription className="mb-6">
                  Major life decisions require deep reflection. Cosmo remembers your values, risk tolerance, and financial situation to ask the right questions.
                </CardDescription>
                <div className="rounded-md border-l-4 border-accent bg-beige p-4 text-sm">
                  <p className="mb-2 font-semibold text-primary">Example conversation:</p>
                  <div className="space-y-2">
                    <p>
                      <span className="font-semibold text-secondary">Cosmo:</span>{" "}
                      <span className="italic">"Two months ago you said you wanted work that felt meaningful. Is this the itch, or are you running from something at your current job?"</span>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section
        ref={howItWorksSection.ref}
        className={`bg-white px-4 py-16 transition-all duration-700 md:px-8 md:py-24 ${
          howItWorksSection.isVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
        }`}
      >
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-4 text-center font-heading text-3xl font-bold text-primary md:text-4xl">
            Built on memory, not just models
          </h2>

          <div className="mt-16 flex flex-col gap-12 md:flex-row md:items-start md:justify-between">
            {[
              { number: 1, icon: Mic, title: "You talk", description: "Open the app, start speaking. No setup, no prompts.", delay: "0s" },
              { number: 2, icon: MessageCircle, title: "Cosmo asks questions", description: "Drawing on everything it knows about your life to ask the right things.", delay: "0.15s" },
              { number: 3, icon: Sparkles, title: "Clarity emerges", description: "Through conversation, not through generic advice.", delay: "0.3s" }
            ].map((step) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.number}
                  className="relative flex-1 text-center transition-all duration-500"
                  style={{
                    transitionDelay: howItWorksSection.isVisible ? step.delay : "0s",
                    opacity: howItWorksSection.isVisible ? 1 : 0,
                    transform: howItWorksSection.isVisible ? "translateY(0)" : "translateY(20px)"
                  }}
                >
                  <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary text-3xl font-bold text-white">
                    {step.number}
                  </div>
                  <div className="mb-4 text-4xl">
                    <Icon className="mx-auto h-12 w-12 text-accent" />
                  </div>
                  <h3 className="mb-2 font-heading text-xl font-bold">{step.title}</h3>
                  <p className="text-text-secondary">{step.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Knowledge Graph Visualization Section */}
      <section
        ref={graphSection.ref}
        className={`bg-gradient-to-br from-beige to-cream px-4 py-16 transition-all duration-700 md:px-8 md:py-24 ${
          graphSection.isVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
        }`}
      >
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-center font-heading text-3xl font-bold text-primary md:text-4xl">
            It builds a living map of your life
          </h2>
          <p className="mx-auto mb-12 max-w-3xl text-center text-lg leading-relaxed text-text-secondary">
            Cosmo remembers the people in your life, your ongoing projects, recurring themes, and how they all connect.
            Every conversation makes it smarter about you.
          </p>

          {/* Interactive Knowledge Graph */}
          <div className="relative">
            <KnowledgeGraph data={graphData} width={1200} height={800} />
          </div>

          {/* Graph Legend */}
          <div className="mt-8 flex flex-wrap justify-center gap-6">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded-full bg-node-people"></div>
              <span className="text-sm text-text-secondary">People</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded-full bg-node-projects"></div>
              <span className="text-sm text-text-secondary">Projects</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded-full bg-node-ideas"></div>
              <span className="text-sm text-text-secondary">Ideas</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded-full bg-node-topics"></div>
              <span className="text-sm text-text-secondary">Topics</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded-full" style={{ backgroundColor: '#5F6F65' }}></div>
              <span className="text-sm text-text-secondary">You</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded-full" style={{ backgroundColor: '#C9C5BC' }}></div>
              <span className="text-sm text-text-secondary">Conversations</span>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="bg-primary px-4 py-16 text-center md:px-8 md:py-24">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-6 font-heading text-3xl font-bold text-white md:text-5xl">
            Stop scrolling. Start thinking.
          </h2>
          <p className="mb-12 text-xl text-white/90">
            Join the waitlist for early access.
          </p>

          <WaitlistForm variant="cta" />
        </div>
      </section>

      {/* Simple Footer */}
      <footer className="bg-cream px-4 py-8 text-center md:px-8">
        <div className="mb-4">
          <Link href="/upload">
            <Button variant="outline" size="sm" className="text-text-secondary hover:text-primary">
              Upload Content
            </Button>
          </Link>
        </div>
        <p className="text-sm text-text-secondary">
          Made with care for better conversations.
        </p>
      </footer>
    </div>
  );
}
