import { useI18n } from "@/lib/i18n";

export function WaveDivider({ flip = false, className = "" }: { flip?: boolean; className?: string }) {
  return (
    <div className={`w-full overflow-hidden leading-[0] ${flip ? "rotate-180" : ""} ${className}`}>
      <svg
        viewBox="0 0 1440 80"
        preserveAspectRatio="none"
        className="w-full h-12 md:h-16"
        fill="none"
      >
        <path
          d="M0,40 C240,80 480,0 720,40 C960,80 1200,0 1440,40 L1440,80 L0,80 Z"
          className="fill-accent/30"
        />
        <path
          d="M0,50 C360,80 720,20 1080,50 C1260,65 1380,35 1440,50 L1440,80 L0,80 Z"
          className="fill-accent/20"
        />
      </svg>
    </div>
  );
}

export function TrustedBySection() {
  const { dir } = useI18n();
  const brands = [
    "Facebook Groups",
    "WhatsApp Business",
    "Meta API",
    "AI Powered",
    "Cloud Hosted",
    "SSL Secured",
    "24/7 Support",
    "99.9% Uptime",
  ];

  return (
    <section dir="ltr" className="overflow-hidden py-8 border-y border-border/30 bg-accent/20">
      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-accent/20 to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-accent/20 to-transparent z-10 pointer-events-none" />
        <div className="animate-marquee flex gap-12 whitespace-nowrap">
          {[...brands, ...brands].map((brand, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground/60"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-primary/40" />
              {brand}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CTASection() {
  const { t, dir } = useI18n();

  return (
    <section dir={dir} className="relative py-20 md:py-28 overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-blue-500/5 to-violet-500/5" />
      <div className="pointer-events-none absolute inset-0">
        <div className="animate-float absolute top-1/4 left-1/3 h-72 w-72 rounded-full bg-primary/10 blur-[100px]" />
        <div className="animate-float-reverse absolute bottom-1/4 right-1/3 h-56 w-56 rounded-full bg-blue-500/10 blur-[80px]" />
      </div>

      <div className="relative mx-auto max-w-3xl px-4 text-center">
        <h2 className="text-3xl font-bold text-foreground md:text-5xl">
          {dir === "rtl" ? "جاهز تبدأ؟" : "Ready to Get Started?"}
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          {dir === "rtl"
            ? "ابدأ تجربتك المجانية الآن وشوف الفرق بنفسك"
            : "Start your free trial now and see the difference yourself"}
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="/login"
            className="group relative inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-blue-600 px-10 py-4 text-lg font-semibold text-white shadow-xl shadow-primary/25 transition-all duration-300 hover:shadow-2xl hover:shadow-primary/40 hover:scale-105 hover:-translate-y-1"
          >
            <span className="relative z-10">{dir === "rtl" ? "ابدأ مجاناً الآن" : "Start Free Now"}</span>
            <svg className="relative z-10 h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
            </svg>
            <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-600 to-primary opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          </a>
          <span className="text-sm text-muted-foreground">
            {dir === "rtl" ? "✨ بدون بطاقة ائتمان" : "✨ No credit card required"}
          </span>
        </div>
      </div>
    </section>
  );
}
