import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Navbar } from "@/components/landing/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { useScrollProgress } from "@/hooks/use-in-view";

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
      <Suspense fallback={<div className="h-32" />}>
        <TrustedBySection />
        <StatsStrip />
        <FeaturesSection />
        <WaveDivider />
        <HowItWorksSection />
        <WaveDivider flip />
        <ComparisonSection />
        <PricingSection />
        <TestimonialsSection />
        <WaveDivider />
        <FAQSection />
        <WaveDivider flip />
        <CTASection />
        <Footer />
      </Suspense>
    </div>
  );
}
