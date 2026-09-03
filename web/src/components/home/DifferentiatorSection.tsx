"use client";

import { useScrollAnimation } from "@/hooks/useScrollAnimation";

const CRITERIA = [
  {
    number: 1,
    title: "They're smart",
    description:
      "They give you real insight, not generic platitudes like \"you should meditate\" or \"follow your heart.\"",
    delay: "0s",
  },
  {
    number: 2,
    title: "They know you",
    description:
      "No need to re-explain your entire life situation every time. They remember the context.",
    delay: "0.1s",
  },
  {
    number: 3,
    title: "You like talking to them",
    description: "The conversation itself is engaging, not a chore. You actually enjoy the interaction.",
    delay: "0.2s",
  },
];

export function DifferentiatorSection() {
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
          Why do you go to a specific friend for advice?
        </h2>

        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {CRITERIA.map((item) => (
            <div
              key={item.number}
              className="text-center transition-all duration-500"
              style={{
                transitionDelay: isVisible ? item.delay : "0s",
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? "translateY(0)" : "translateY(20px)",
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
  );
}
