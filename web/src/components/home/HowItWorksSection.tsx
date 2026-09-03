"use client";

import { useScrollAnimation } from "@/hooks/useScrollAnimation";
import { MessageCircle, Mic, Sparkles } from "lucide-react";

const STEPS = [
  { number: 1, icon: Mic, title: "You talk", description: "Open the app, start speaking. No setup, no prompts.", delay: "0s" },
  { number: 2, icon: MessageCircle, title: "Cosmo asks questions", description: "Drawing on everything it knows about your life to ask the right things.", delay: "0.15s" },
  { number: 3, icon: Sparkles, title: "Clarity emerges", description: "Through conversation, not through generic advice.", delay: "0.3s" },
];

export function HowItWorksSection() {
  const { ref, isVisible } = useScrollAnimation();

  return (
    <section
      ref={ref}
      className={`bg-white px-4 py-16 transition-all duration-700 md:px-8 md:py-24 ${
        isVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
      }`}
    >
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-4 text-center font-heading text-3xl font-bold text-primary md:text-4xl">
          Built on memory, not just models
        </h2>

        <div className="mt-16 flex flex-col gap-12 md:flex-row md:items-start md:justify-between">
          {STEPS.map((step) => {
            const Icon = step.icon;
            return (
              <div
                key={step.number}
                className="relative flex-1 text-center transition-all duration-500"
                style={{
                  transitionDelay: isVisible ? step.delay : "0s",
                  opacity: isVisible ? 1 : 0,
                  transform: isVisible ? "translateY(0)" : "translateY(20px)",
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
  );
}
