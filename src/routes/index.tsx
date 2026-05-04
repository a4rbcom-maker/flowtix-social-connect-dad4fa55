import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";
import { Navbar } from "@/components/landing/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { LazyOnView } from "@/components/LazyOnView";
import { useScrollProgress } from "@/hooks/use-in-view";

// Each section is its own chunk, fetched only when scrolled near.
const FeaturesSection = lazy(() => import("@/components/landing/FeaturesSection").then(m => ({ default: m.FeaturesSection })));
const HowItWorksSection = lazy(() => import("@/components/landing/HowItWorksSection").then(m => ({ default: m.HowItWorksSection })));
const PricingSection = lazy(() => import("@/components/landing/PricingSection").then(m => ({ default: m.PricingSection })));
const FAQSection = lazy(() => import("@/components/landing/FAQSection").then(m => ({ default: m.FAQSection })));
const Footer = lazy(() => import("@/components/landing/Footer").then(m => ({ default: m.Footer })));
const TrustedBySection = lazy(() => import("@/components/landing/ExtraSections").then(m => ({ default: m.TrustedBySection })));
const CTASection = lazy(() => import("@/components/landing/ExtraSections").then(m => ({ default: m.CTASection })));
const WaveDivider = lazy(() => import("@/components/landing/ExtraSections").then(m => ({ default: m.WaveDivider })));
const StatsStrip = lazy(() => import("@/components/landing/PremiumSections").then(m => ({ default: m.StatsStrip })));
const TestimonialsSection = lazy(() => import("@/components/landing/PremiumSections").then(m => ({ default: m.TestimonialsSection })));
const ComparisonSection = lazy(() => import("@/components/landing/PremiumSections").then(m => ({ default: m.ComparisonSection })));

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const progress = useScrollProgress();

  return (
    <div className="min-h-screen bg-background">
      <div className="scroll-progress" style={{ width: `${progress * 100}%` }} />
      <Navbar />
      <HeroSection />

      {/* Section right under hero — preload sooner */}
      <LazyOnView rootMargin="600px" minHeight={120}>
        <TrustedBySection />
      </LazyOnView>

      <LazyOnView rootMargin="500px" minHeight={180}>
        <StatsStrip />
      </LazyOnView>

      <LazyOnView rootMargin="400px" minHeight={600}>
        <FeaturesSection />
      </LazyOnView>

      <LazyOnView rootMargin="300px" minHeight={80}>
        <WaveDivider />
      </LazyOnView>

      <LazyOnView rootMargin="400px" minHeight={500}>
        <HowItWorksSection />
      </LazyOnView>

      <LazyOnView rootMargin="300px" minHeight={80}>
        <WaveDivider flip />
      </LazyOnView>

      <LazyOnView rootMargin="400px" minHeight={500}>
        <ComparisonSection />
      </LazyOnView>

      <LazyOnView rootMargin="400px" minHeight={600}>
        <PricingSection />
      </LazyOnView>

      <LazyOnView rootMargin="400px" minHeight={500}>
        <TestimonialsSection />
      </LazyOnView>

      <LazyOnView rootMargin="300px" minHeight={80}>
        <WaveDivider />
      </LazyOnView>

      <LazyOnView rootMargin="400px" minHeight={400}>
        <FAQSection />
      </LazyOnView>

      <LazyOnView rootMargin="300px" minHeight={80}>
        <WaveDivider flip />
      </LazyOnView>

      <LazyOnView rootMargin="400px" minHeight={300}>
        <CTASection />
      </LazyOnView>

      <LazyOnView rootMargin="300px" minHeight={400}>
        <Footer />
      </LazyOnView>
    </div>
  );
}
