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
                className={`relative rounded-2xl border p-8 transition-all duration-500 ease-out hover:-translate-y-1 ${
                  isPopular ? "md:scale-105" : ""
                } ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}
                style={{
                  transitionDelay: isInView ? `${150 + i * 150}ms` : "0ms",
                  background: isPopular
                    ? "var(--pricing-popular-bg)"
                    : "var(--pricing-card-bg)",
                  borderColor: isPopular
                    ? "var(--pricing-popular-border)"
                    : "var(--pricing-card-border)",
                  boxShadow: isPopular
                    ? "0 8px 30px -8px oklch(0.55 0.15 270 / 0.12)"
                    : "0 2px 12px -4px oklch(0.5 0.05 270 / 0.06)",
                }}
              >
                {isPopular && (
                  <div
                    className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm"
                    style={{ background: "var(--primary)" }}
                  >
                    {t.pricing.popular}
                  </div>
                )}
                <div className="mb-6">
                  <h3
                    className="text-xl font-semibold"
                    style={{ color: isPopular ? "var(--pricing-popular-text)" : "var(--foreground)" }}
                  >
                    {plan.name}
                  </h3>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span
                      className="text-5xl font-extrabold"
                      style={{ color: isPopular ? "var(--pricing-popular-text)" : "var(--foreground)" }}
                    >
                      {plan.price}
                    </span>
                    <span
                      className="text-sm"
                      style={{ color: isPopular ? "var(--pricing-popular-muted)" : "var(--muted-foreground)" }}
                    >
                      {plan.currency} {t.pricing.monthly}
                    </span>
                  </div>
                </div>
                <ul className="mb-8 space-y-3">
                  {plan.features.map((f, fi) => (
                    <li
                      key={fi}
                      className={`flex items-center gap-2 text-sm transition-all duration-300 ${
                        isInView ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4"
                      }`}
                      style={{
                        transitionDelay: isInView ? `${300 + i * 150 + fi * 60}ms` : "0ms",
                        color: isPopular ? "var(--pricing-popular-muted)" : "var(--muted-foreground)",
                      }}
                    >
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <svg className="h-3 w-3 text-primary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  className={`group w-full overflow-hidden relative rounded-xl py-3.5 text-sm font-semibold transition-all duration-500 ease-out active:scale-[0.98] ${
                    isPopular
                      ? "bg-primary text-primary-foreground hover:opacity-90"
                      : "border text-foreground hover:bg-accent"
                  }`}
                  style={{
                    borderColor: isPopular ? undefined : "var(--pricing-card-border)",
                    background: isPopular ? undefined : "var(--pricing-card-bg)",
                  }}
                >
                  <span className="relative z-10">{t.pricing.cta}</span>
                  {isPopular && (
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-1000 ease-out group-hover:translate-x-full" />
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
