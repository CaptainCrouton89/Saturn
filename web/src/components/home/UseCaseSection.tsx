"use client";

import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { useScrollAnimation } from "@/hooks/useScrollAnimation";

interface UseCase {
  title: string;
  prompt: string;
  description: string;
  exchange: Array<{ speaker: "You" | "Cosmo"; line: string }>;
}

const USE_CASES: UseCase[] = [
  {
    title: "Work Drama",
    prompt: "\"Should I escalate this conflict with my manager or wait until after Q1 reviews?\"",
    description:
      "Cosmo remembers your promotion timeline, your manager's communication style, and past workplace dynamics to help you navigate sensitive situations.",
    exchange: [
      { speaker: "You", line: "\"I'm so frustrated with how Tom handled the meeting today.\"" },
      {
        speaker: "Cosmo",
        line: "\"Is this the same pattern you mentioned last month—where he interrupts you in front of the team? Or something different?\"",
      },
    ],
  },
  {
    title: "Relationship Decision",
    prompt: "\"My ex just joined my company. Do I take the role on their team?\"",
    description:
      "Complex decisions that blend emotional and practical considerations. Cosmo helps you think through implications without giving generic advice.",
    exchange: [
      {
        speaker: "Cosmo",
        line: "\"Last time we talked about boundaries with Sarah, you said being in the same space made things harder. How does this feel different—or does it?\"",
      },
    ],
  },
  {
    title: "Career Transition",
    prompt: "\"I'm thinking about leaving my stable job to start something.\"",
    description:
      "Major life decisions require deep reflection. Cosmo remembers your values, risk tolerance, and financial situation to ask the right questions.",
    exchange: [
      {
        speaker: "Cosmo",
        line: "\"Two months ago you said you wanted work that felt meaningful. Is this the itch, or are you running from something at your current job?\"",
      },
    ],
  },
];

export function UseCaseSection() {
  const { ref, isVisible } = useScrollAnimation();

  return (
    <section
      ref={ref}
      className={`bg-cream px-4 py-16 transition-all duration-700 md:px-8 md:py-24 ${
        isVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
      }`}
    >
      <div className="mx-auto max-w-7xl">
        <h2 className="mb-4 text-center font-heading text-3xl font-bold text-primary md:text-4xl">
          Real life is complicated. Cosmo gets it.
        </h2>

        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {USE_CASES.map((useCase) => (
            <Card
              key={useCase.title}
              className="transition-all duration-500 hover:-translate-y-1 hover:shadow-lg"
            >
              <CardContent className="p-6">
                <CardTitle className="mb-4 text-primary">{useCase.title}</CardTitle>
                <p className="mb-4 italic text-text-secondary">{useCase.prompt}</p>
                <CardDescription className="mb-6">{useCase.description}</CardDescription>
                <div className="rounded-md border-l-4 border-accent bg-beige p-4 text-sm">
                  <p className="mb-2 font-semibold text-primary">Example conversation:</p>
                  <div className="space-y-2">
                    {useCase.exchange.map((turn) => (
                      <p key={turn.speaker}>
                        <span className="font-semibold text-secondary">{`${turn.speaker}:`}</span>{" "}
                        <span className="italic">{turn.line}</span>
                      </p>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
