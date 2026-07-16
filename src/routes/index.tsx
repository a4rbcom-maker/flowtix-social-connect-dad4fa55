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

const SITE_URL = "https://flowtixtools.com";
const TITLE = "Flowtix Tools — أقوى منصة للتجارة الاجتماعية | فيسبوك وواتساب";
const DESC = "أدر أعمالك على فيسبوك وواتساب بذكاء اصطناعي. إرسال جماعي للجروبات، بوت واتساب احترافي، ومتابعة العملاء من مكان واحد.";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { name: "keywords", content: "تجارة اجتماعية, فيسبوك جروبات, واتساب بوت, إرسال جماعي, Flowtix, social commerce, WhatsApp bot" },
      { name: "robots", content: "index, follow, max-image-preview:large" },
      { name: "theme-color", content: "#9b5cf6" },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "ar_AR" },
      { property: "og:site_name", content: "Flowtix Tools" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: SITE_URL },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
    ],
    links: [
      { rel: "canonical", href: SITE_URL },
      { rel: "alternate", hrefLang: "ar", href: SITE_URL },
      { rel: "alternate", hrefLang: "x-default", href: SITE_URL },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Flowtix Tools",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          description: DESC,
          url: SITE_URL,
          offers: { "@type": "Offer", priceCurrency: "USD", price: "0" },
          aggregateRating: { "@type": "AggregateRating", ratingValue: "4.9", ratingCount: "120" },
        }),
      },
    ],
  }),
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
