import { WaitlistForm } from "@/components/home/WaitlistForm";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-cream to-beige px-4 py-32 text-center md:px-8 md:py-48">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-6 animate-fade-in font-heading text-4xl font-bold leading-tight text-primary md:text-6xl">
          Your smart best friend. Always there to think things through.
        </h1>
        <p
          className="mb-12 animate-fade-in text-xl leading-relaxed text-text-secondary md:text-2xl"
          style={{ animationDelay: "0.1s" }}
        >
          Cosmo is the AI companion that actually knows you—and that you actually enjoy talking to.
        </p>

        <div className="animate-fade-in" style={{ animationDelay: "0.2s" }}>
          <WaitlistForm />
        </div>
      </div>
    </section>
  );
}
