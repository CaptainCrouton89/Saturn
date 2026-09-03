import { DifferentiatorSection } from "@/components/home/DifferentiatorSection";
import { FinalCtaSection } from "@/components/home/FinalCtaSection";
import { GraphSection } from "@/components/home/GraphSection";
import { HeroSection } from "@/components/home/HeroSection";
import { HowItWorksSection } from "@/components/home/HowItWorksSection";
import { ProblemSection } from "@/components/home/ProblemSection";
import { UseCaseSection } from "@/components/home/UseCaseSection";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-cream">
      <HeroSection />
      <ProblemSection />
      <DifferentiatorSection />
      <UseCaseSection />
      <HowItWorksSection />
      <GraphSection />
      <FinalCtaSection />

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
