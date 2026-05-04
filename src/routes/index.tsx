import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/landing/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { PricingSection } from "@/components/landing/PricingSection";
import { FAQSection } from "@/components/landing/FAQSection";
import { Footer } from "@/components/landing/Footer";
import { TrustedBySection, CTASection, WaveDivider } from "@/components/landing/ExtraSections";
import { StatsStrip, TestimonialsSection, ComparisonSection } from "@/components/landing/PremiumSections";
import { useScrollProgress } from "@/hooks/use-in-view";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const progress = useScrollProgress();

  return (
    <div className="min-h-screen bg-background">
      {/* Scroll progress bar */}
      <div className="scroll-progress" style={{ width: `${progress * 100}%` }} />
      <Navbar />
      <HeroSection />
      <TrustedBySection />
      <FeaturesSection />
      <WaveDivider />
      <HowItWorksSection />
      <WaveDivider flip />
      <PricingSection />
      <WaveDivider />
      <FAQSection />
      <WaveDivider flip />
      <CTASection />
      <Footer />
    </div>
  );
}
