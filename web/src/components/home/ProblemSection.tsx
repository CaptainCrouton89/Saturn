"use client";

import { useScrollAnimation } from "@/hooks/useScrollAnimation";

export function ProblemSection() {
  const { ref, isVisible } = useScrollAnimation();

  return (
    <section
      ref={ref}
      className={`bg-beige px-4 py-16 transition-all duration-700 md:px-8 md:py-24 ${
        isVisible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
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
  );
}
