import { useI18n } from "@/lib/i18n";
import { useInView } from "@/hooks/use-in-view";

export function PricingSection() {
  const { t, dir } = useI18n();
  const { ref, isInView } = useInView();

  return (
    <section id="pricing" dir={dir} className="py-20 md:py-28">
      <div ref={ref} className="mx-auto max-w-7xl px-4">
        <div className={`mb-16 text-center transition-all duration-700 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <span className="mb-4 inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary">
            {dir === "rtl" ? "💎 الباقات" : "💎 Plans"}
          </span>
          <h2 className="text-3xl font-bold text-foreground md:text-5xl">{t.pricing.title}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t.pricing.subtitle}</p>
        </div>

        <div className="grid gap-8 md:grid-cols-3 items-start">
          {t.pricing.plans.map((plan, i) => {
            const isPopular = i === 1;
            return (
              <div
                key={i}
                className={`card-tilt relative rounded-2xl border p-8 transition-all duration-500 ${
                  isPopular
                    ? "animated-border border-transparent bg-gradient-to-br from-slate-100 via-gray-50 to-slate-100 shadow-lg shadow-gray-200/50 md:scale-105"
                    : "border-border/50 bg-card/60 hover:border-primary/30 hover:shadow-primary/5"
                } ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}
                style={{ transitionDelay: isInView ? `${150 + i * 150}ms` : "0ms" }}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-primary to-primary/80 px-5 py-1.5 text-xs font-semibold text-white shadow-md shadow-primary/20 animate-gradient-shift">
                    {t.pricing.popular}
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="text-xl font-semibold text-foreground">{plan.name}</h3>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-5xl font-extrabold text-foreground">{plan.price}</span>
                    <span className="text-sm text-muted-foreground">{plan.currency} {t.pricing.monthly}</span>
                  </div>
                </div>
                <ul className="mb-8 space-y-3">
                  {plan.features.map((f, fi) => (
                    <li
                      key={fi}
                      className={`flex items-center gap-2 text-sm text-muted-foreground transition-all duration-300 ${
                        isInView ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4"
                      }`}
                      style={{ transitionDelay: isInView ? `${300 + i * 150 + fi * 60}ms` : "0ms" }}
                    >
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <svg className="h-3 w-3 text-primary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  className={`group w-full overflow-hidden relative rounded-xl py-3.5 text-sm font-semibold transition-all duration-300 hover:scale-[1.02] ${
                    isPopular
                      ? "bg-primary text-white shadow-md shadow-primary/20 hover:shadow-lg hover:bg-primary/90"
                      : "border border-border bg-background text-foreground hover:bg-accent hover:border-primary/30"
                  }`}
                >
                  <span className="relative z-10">{t.pricing.cta}</span>
                  {isPopular && (
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
