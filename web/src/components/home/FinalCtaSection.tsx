import { WaitlistForm } from "@/components/home/WaitlistForm";

export function FinalCtaSection() {
  return (
    <section className="bg-primary px-4 py-16 text-center md:px-8 md:py-24">
      <div className="mx-auto max-w-3xl">
        <h2 className="mb-6 font-heading text-3xl font-bold text-white md:text-5xl">
          Stop scrolling. Start thinking.
        </h2>
        <p className="mb-12 text-xl text-white/90">Join the waitlist for early access.</p>

        <WaitlistForm variant="cta" />
      </div>
    </section>
  );
}
