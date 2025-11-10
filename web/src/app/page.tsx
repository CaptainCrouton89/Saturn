"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { useState } from "react";
import { Mic, MessageCircle, Sparkles } from "lucide-react";

export default function Home() {
  const [email, setEmail] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Implement actual waitlist API call
    if (email && email.includes("@")) {
      setShowSuccess(true);
      setEmail("");
      setTimeout(() => setShowSuccess(false), 5000);
    }
  };

  return (
    <div className="min-h-screen bg-cream">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-cream to-beige px-4 py-32 text-center md:px-8 md:py-48">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-6 font-heading text-4xl font-bold leading-tight text-primary md:text-6xl">
            Your smart best friend. Always there to think things through.
          </h1>
          <p className="mb-12 text-xl leading-relaxed text-text-secondary md:text-2xl">
            Cosmo is the AI companion that actually knows you—and that you actually enjoy talking to.
          </p>

          <form onSubmit={handleSubmit} className="mx-auto flex max-w-2xl flex-col gap-4 sm:flex-row">
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="flex-1 text-lg"
            />
            <Button type="submit" size="lg" className="sm:w-auto">
              Join Waitlist
            </Button>
          </form>

          {showSuccess && (
            <div className="mt-6 rounded-lg border-l-4 border-success bg-success/10 p-4 text-success">
              ✓ You're on the list! We'll be in touch soon.
            </div>
          )}
        </div>
      </section>

      {/* Problem Recognition Section */}
      <section className="bg-beige px-4 py-16 md:px-8 md:py-24">
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
      <section className="bg-white px-4 py-16 md:px-8 md:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-4 text-center font-heading text-3xl font-bold text-primary md:text-4xl">
            Why do you go to a specific friend for advice?
          </h2>

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <div className="text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent text-2xl font-bold text-white">
                1
              </div>
              <h3 className="mb-3 font-heading text-xl font-bold">They're smart</h3>
              <p className="text-text-secondary">
                They give you real insight, not generic platitudes like "you should meditate" or "follow your heart."
              </p>
            </div>

            <div className="text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent text-2xl font-bold text-white">
                2
              </div>
              <h3 className="mb-3 font-heading text-xl font-bold">They know you</h3>
              <p className="text-text-secondary">
                No need to re-explain your entire life situation every time. They remember the context.
              </p>
            </div>

            <div className="text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent text-2xl font-bold text-white">
                3
              </div>
              <h3 className="mb-3 font-heading text-xl font-bold">You like talking to them</h3>
              <p className="text-text-secondary">
                The conversation itself is engaging, not a chore. You actually enjoy the interaction.
              </p>
            </div>
          </div>

          <p className="mt-12 text-center text-lg leading-relaxed text-text-secondary">
            Most AI companions nail #1, vaguely gesture at #2, and completely miss #3.
            <span className="font-semibold text-primary"> Cosmo is built for all three.</span>
          </p>
        </div>
      </section>

      {/* Use Case Examples Section */}
      <section className="bg-cream px-4 py-16 md:px-8 md:py-24">
        <div className="mx-auto max-w-7xl">
          <h2 className="mb-4 text-center font-heading text-3xl font-bold text-primary md:text-4xl">
            Real life is complicated. Cosmo gets it.
          </h2>

          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {/* Work Drama Card */}
            <Card className="transition-all hover:shadow-lg hover:-translate-y-1">
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
            <Card className="transition-all hover:shadow-lg hover:-translate-y-1">
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
            <Card className="transition-all hover:shadow-lg hover:-translate-y-1">
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
      <section className="bg-white px-4 py-16 md:px-8 md:py-24">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-4 text-center font-heading text-3xl font-bold text-primary md:text-4xl">
            Built on memory, not just models
          </h2>

          <div className="mt-16 flex flex-col gap-12 md:flex-row md:items-start md:justify-between">
            <div className="relative flex-1 text-center">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary text-3xl font-bold text-white">
                1
              </div>
              <div className="mb-4 text-4xl">
                <Mic className="mx-auto h-12 w-12 text-accent" />
              </div>
              <h3 className="mb-2 font-heading text-xl font-bold">You talk</h3>
              <p className="text-text-secondary">
                Open the app, start speaking. No setup, no prompts.
              </p>
            </div>

            <div className="hidden md:flex md:items-center md:justify-center md:self-center">
              <span className="text-4xl text-accent">→</span>
            </div>

            <div className="relative flex-1 text-center">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary text-3xl font-bold text-white">
                2
              </div>
              <div className="mb-4 text-4xl">
                <MessageCircle className="mx-auto h-12 w-12 text-accent" />
              </div>
              <h3 className="mb-2 font-heading text-xl font-bold">Cosmo asks questions</h3>
              <p className="text-text-secondary">
                Drawing on everything it knows about your life to ask the right things.
              </p>
            </div>

            <div className="hidden md:flex md:items-center md:justify-center md:self-center">
              <span className="text-4xl text-accent">→</span>
            </div>

            <div className="relative flex-1 text-center">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary text-3xl font-bold text-white">
                3
              </div>
              <div className="mb-4 text-4xl">
                <Sparkles className="mx-auto h-12 w-12 text-accent" />
              </div>
              <h3 className="mb-2 font-heading text-xl font-bold">Clarity emerges</h3>
              <p className="text-text-secondary">
                Through conversation, not through generic advice.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Knowledge Graph Visualization Section */}
      <section className="bg-gradient-to-br from-beige to-cream px-4 py-16 md:px-8 md:py-24">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-4 text-center font-heading text-3xl font-bold text-primary md:text-4xl">
            It builds a living map of your life
          </h2>
          <p className="mx-auto mb-12 max-w-3xl text-center text-lg leading-relaxed text-text-secondary">
            Cosmo remembers the people in your life, your ongoing projects, recurring themes, and how they all connect.
            Every conversation makes it smarter about you.
          </p>

          {/* Placeholder for graph visualization - to be implemented with D3.js/SVG later */}
          <div className="relative min-h-[500px] overflow-hidden rounded-xl bg-gradient-to-br from-white/50 to-beige/50 p-8 backdrop-blur-sm">
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="mb-6 text-6xl">🗺️</div>
                <p className="text-lg text-text-secondary">
                  Interactive knowledge graph visualization coming soon
                </p>
              </div>
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

          <form onSubmit={handleSubmit} className="mx-auto flex max-w-2xl flex-col gap-4 sm:flex-row">
            <Input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="flex-1 bg-white text-lg"
            />
            <Button
              type="submit"
              size="lg"
              variant="secondary"
              className="bg-accent text-white hover:bg-accent/90 sm:w-auto"
            >
              Join Waitlist
            </Button>
          </form>

          {showSuccess && (
            <div className="mt-6 rounded-lg border-l-4 border-success bg-white/10 p-4 text-white">
              ✓ You're on the list! We'll be in touch soon.
            </div>
          )}
        </div>
      </section>

      {/* Simple Footer */}
      <footer className="bg-cream px-4 py-8 text-center md:px-8">
        <p className="text-sm text-text-secondary">
          Made with care for better conversations.
        </p>
      </footer>
    </div>
  );
}
