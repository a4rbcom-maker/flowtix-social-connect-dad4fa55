import { Helmet } from "react-helmet-async";
import { Navbar } from "./Navbar";
import { Hero } from "./Hero";
import { TrustedBy } from "./TrustedBy";
import { ProductPreview } from "./ProductPreview";
import { CoreFeatures } from "./CoreFeatures";
import { AIAutomation } from "./AIAutomation";
import { FacebookTools } from "./FacebookTools";
import { Workflow } from "./Workflow";
import { Security } from "./Security";
import { Metrics } from "./Metrics";
import { Testimonials } from "./Testimonials";
import { Pricing } from "./Pricing";
import { FAQ } from "./FAQ";
import { FinalCTA } from "./FinalCTA";
import { Footer } from "./Footer";

const SEO = {
  title: "FlowTix — استخراج بيانات فيسبوك بالذكاء الاصطناعي | أتمتة وتحليلات",
  description: "منصة FlowTix لاستخراج بيانات فيسبوك بالذكاء الاصطناعي — استخرج أعضاء الجروبات، بيانات الصفحات، تفاعلات المنشورات، جهات الماسنجر. أتمتة واتساب، تحليلات، واجهة عربية كاملة. جرب مجاناً.",
  url: "https://flowtix.tools",
  image: "https://flowtix.tools/og-image.png",
  keywords: "استخراج بيانات فيسبوك, Facebook data extraction, استخراج أعضاء الجروبات, أتمتة فيسبوك, Facebook automation, واتساب أتمتة, AI Facebook tools",
};

export function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <Helmet>
        <title>{SEO.title}</title>
        <meta name="description" content={SEO.description} />
        <meta name="keywords" content={SEO.keywords} />
        <link rel="canonical" href={SEO.url} />

        <meta property="og:title" content={SEO.title} />
        <meta property="og:description" content={SEO.description} />
        <meta property="og:url" content={SEO.url} />
        <meta property="og:image" content={SEO.image} />
        <meta property="og:type" content="website" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={SEO.title} />
        <meta name="twitter:description" content={SEO.description} />
        <meta name="twitter:image" content={SEO.image} />
      </Helmet>
      <Navbar />
      <main>
        <Hero />
        <TrustedBy />
        <ProductPreview />
        <CoreFeatures />
        <AIAutomation />
        <FacebookTools />
        <Workflow />
        <Security />
        <Metrics />
        <Testimonials />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
