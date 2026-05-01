import { useI18n } from "@/lib/i18n";

export function PricingSection() {
  const { t, dir } = useI18n();

  return (
    <section id="pricing" dir={dir} className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-16 text-center">
          <h2 className="text-3xl font-bold text-foreground md:text-5xl">{t.pricing.title}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t.pricing.subtitle}</p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {t.pricing.plans.map((plan, i) => {
            const isPopular = i === 1;
            return (
              <div
                key={i}
                className={`relative rounded-2xl border p-8 transition-all ${
                  isPopular
                    ? "border-primary bg-gradient-to-b from-primary/5 to-transparent shadow-xl shadow-primary/10 scale-105"
                    : "border-border/50 bg-card/50 hover:border-primary/30"
                }`}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-primary to-blue-600 px-4 py-1 text-xs font-semibold text-white">
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
                  className={`w-full rounded-xl py-3 text-sm font-semibold transition-all ${
                    isPopular
                      ? "bg-gradient-to-r from-primary to-blue-600 text-white shadow-lg shadow-primary/25 hover:shadow-xl"
                      : "border border-border bg-background text-foreground hover:bg-accent"
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
