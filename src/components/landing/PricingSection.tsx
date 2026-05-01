import { useI18n } from "@/lib/i18n";
import { useInView } from "@/hooks/use-in-view";

export function PricingSection() {
  const { t, dir } = useI18n();
  const { ref, isInView } = useInView();

  return (
    <section id="pricing" dir={dir} className="py-20 md:py-28">
      <div ref={ref} className="mx-auto max-w-7xl px-4">
        <div className={`mb-16 text-center transition-all duration-700 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <h2 className="text-3xl font-bold text-foreground md:text-5xl">{t.pricing.title}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t.pricing.subtitle}</p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {t.pricing.plans.map((plan, i) => {
            const isPopular = i === 1;
            return (
              <div
                key={i}
                className={`relative rounded-2xl border p-8 transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl ${
                  isPopular
                    ? "border-primary bg-gradient-to-b from-primary/5 to-transparent shadow-xl shadow-primary/10 scale-105 hover:shadow-primary/20"
                    : "border-border/50 bg-card/50 hover:border-primary/30 hover:shadow-primary/5"
                } ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
                style={{ transitionDelay: isInView ? `${150 + i * 150}ms` : "0ms" }}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-primary to-blue-600 px-4 py-1 text-xs font-semibold text-white animate-gradient-shift">
                    {t.pricing.popular}
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="text-xl font-semibold text-foreground">{plan.name}</h3>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold text-foreground">{plan.price}</span>
                    <span className="text-sm text-muted-foreground">{plan.currency} {t.pricing.monthly}</span>
                  </div>
                </div>
                <ul className="mb-8 space-y-3">
                  {plan.features.map((f, fi) => (
                    <li key={fi} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <svg className="h-4 w-4 shrink-0 text-primary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  className={`w-full rounded-xl py-3 text-sm font-semibold transition-all duration-300 hover:scale-105 ${
                    isPopular
                      ? "bg-gradient-to-r from-primary to-blue-600 text-white shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/40"
                      : "border border-border bg-background text-foreground hover:bg-accent hover:border-primary/30"
                  }`}
                >
                  {t.pricing.cta}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
