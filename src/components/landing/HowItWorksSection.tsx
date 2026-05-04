import { useI18n } from "@/lib/i18n";
import { useInView } from "@/hooks/use-in-view";

export function HowItWorksSection() {
  const { t, dir } = useI18n();
  const { ref, isInView } = useInView();

  const stepIcons = [
    <svg key="s1" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    <svg key="s2" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
    <svg key="s3" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>,
  ];

  return (
    <section id="how-it-works" dir={dir} className="py-12 md:py-16 bg-accent/30">
      <div ref={ref} className="mx-auto max-w-7xl px-4">
        <div className={`mb-16 text-center transition-all duration-700 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <span className="mb-4 inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary">
            {dir === "rtl" ? "🎯 خطوات البدء" : "🎯 Getting Started"}
          </span>
          <h2 className="text-3xl font-bold text-foreground md:text-5xl">{t.howItWorks.title}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t.howItWorks.subtitle}</p>
        </div>

        <div className="relative grid gap-8 md:grid-cols-3">
          {/* Connecting line (desktop) */}
          <div className="absolute top-12 left-[16.67%] right-[16.67%] hidden md:block">
            <div
              className={`h-0.5 w-full transition-all duration-1500 ${
                isInView ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0"
              }`}
              style={{
                background: "linear-gradient(90deg, oklch(0.48 0.27 288 / 0.5), oklch(0.65 0.22 295 / 0.3), oklch(0.48 0.27 288 / 0.5))",
                transitionDelay: isInView ? "400ms" : "0ms",
                transformOrigin: dir === "rtl" ? "right" : "left",
              }}
            />
          </div>

          {t.howItWorks.steps.map((step, i) => (
            <div
              key={i}
              className={`relative text-center transition-all duration-600 ${
                isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
              style={{ transitionDelay: isInView ? `${200 + i * 200}ms` : "0ms" }}
            >
              <div className="relative mx-auto mb-6">
                {/* Outer glow ring */}
                <div className={`absolute inset-0 mx-auto h-20 w-20 rounded-full ${isInView ? "animate-glow-ring" : ""}`} style={{ animationDelay: `${i * 0.5}s` }} />
                <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary text-white shadow-xl shadow-primary/25 transition-all duration-300 hover:scale-110 hover:shadow-2xl hover:shadow-primary/40">
                  {stepIcons[i]}
                  {/* Step number badge */}
                  <div className="absolute -top-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-background border-2 border-primary text-xs font-bold text-primary">
                    {i + 1}
                  </div>
                </div>
              </div>
              <h3 className="mb-2 text-xl font-semibold text-foreground">{step.title}</h3>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
