import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";
import { Navbar } from "@/components/landing/Navbar";
import { HeroSection } from "@/components/landing/HeroSection";
import { LazyOnView } from "@/components/LazyOnView";
import { useScrollProgress } from "@/hooks/use-in-view";
import {
  TrustedBySkeleton,
  StatsStripSkeleton,
  CardsGridSkeleton,
  PricingSkeleton,
  TestimonialsSkeleton,
  FAQSkeleton,
  CTASkeleton,
  FooterSkeleton,
  DividerSkeleton,
} from "@/components/landing/SectionSkeletons";

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

      <LazyOnView rootMargin="600px" minHeight={120} fallback={<TrustedBySkeleton />}>
        <TrustedBySection />
      </LazyOnView>

      <LazyOnView rootMargin="500px" minHeight={180} fallback={<StatsStripSkeleton />}>
        <StatsStrip />
      </LazyOnView>

      <LazyOnView rootMargin="400px" minHeight={600} fallback={<CardsGridSkeleton count={6} />}>
        <FeaturesSection />
      </LazyOnView>

      <LazyOnView rootMargin="300px" minHeight={80} fallback={<DividerSkeleton />}>
        <WaveDivider />
      </LazyOnView>

      <LazyOnView rootMargin="400px" minHeight={500} fallback={<CardsGridSkeleton count={4} />}>
        <HowItWorksSection />
      </LazyOnView>

      <LazyOnView rootMargin="300px" minHeight={80} fallback={<DividerSkeleton />}>
        <WaveDivider flip />
      </LazyOnView>

      <LazyOnView rootMargin="400px" minHeight={500} fallback={<CardsGridSkeleton count={3} />}>
        <ComparisonSection />
      </LazyOnView>

      <LazyOnView rootMargin="400px" minHeight={600} fallback={<PricingSkeleton />}>
        <PricingSection />
      </LazyOnView>

      <LazyOnView rootMargin="400px" minHeight={500} fallback={<TestimonialsSkeleton />}>
        <TestimonialsSection />
      </LazyOnView>

      <LazyOnView rootMargin="300px" minHeight={80} fallback={<DividerSkeleton />}>
        <WaveDivider />
      </LazyOnView>

      <LazyOnView rootMargin="400px" minHeight={400} fallback={<FAQSkeleton />}>
        <FAQSection />
      </LazyOnView>

      <LazyOnView rootMargin="300px" minHeight={80} fallback={<DividerSkeleton />}>
        <WaveDivider flip />
      </LazyOnView>

      <LazyOnView rootMargin="400px" minHeight={300} fallback={<CTASkeleton />}>
        <CTASection />
      </LazyOnView>

      <LazyOnView rootMargin="300px" minHeight={400} fallback={<FooterSkeleton />}>
        <Footer />
      </LazyOnView>
    </div>
  );
}
