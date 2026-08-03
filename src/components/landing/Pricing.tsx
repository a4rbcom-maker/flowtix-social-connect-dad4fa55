import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Check, Sparkles, Loader2 } from "lucide-react";
import { Section, SectionHeading } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import { usePublicPlans } from "@/hooks/usePublicPlans";

export function Pricing() {
  const { t } = useTranslation();
  const [yearly, setYearly] = useState(false);
  const { data: allPlans, isLoading } = usePublicPlans();

  const plans = useMemo(() => {
    if (!allPlans) return [];
    return allPlans.filter((p) => p.plan_interval === (yearly ? "yearly" : "monthly"));
  }, [allPlans, yearly]);

  return (
    <Section id="pricing" className="scroll-mt-20">
      <div className="container-page">
        <SectionHeading
          badge={t("pricing.badge")}
          title={t("pricing.title")}
          subtitle={t("pricing.subtitle")}
        />

        <div className="mt-8 flex items-center justify-center gap-3">
          <span className={cn("text-sm font-medium", !yearly ? "text-[var(--color-fg)]" : "text-[var(--color-fg-subtle)]")}>
            {t("pricing.monthly")}
          </span>
          <button
            onClick={() => setYearly((v) => !v)}
            role="switch"
            aria-checked={yearly}
            aria-label={t("pricing.yearly")}
            className="relative h-7 w-12 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] transition-colors"
          >
            <span
              className={cn(
                "absolute top-1 size-5 rounded-full gradient-brand transition-transform duration-300",
                yearly ? "translate-x-6 rtl:-translate-x-6" : "translate-x-1 rtl:-translate-x-1",
              )}
            />
          </button>
          <span className={cn("text-sm font-medium", yearly ? "text-[var(--color-fg)]" : "text-[var(--color-fg-subtle)]")}>
            {t("pricing.yearly")}
          </span>
          <Badge variant="success" className="inline-flex">{t("pricing.save")}</Badge>
        </div>

        <div className="mt-10 grid gap-5 sm:mt-12 sm:gap-6 lg:grid-cols-3">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 sm:rounded-3xl sm:p-7 animate-pulse">
                <div className="mb-5 space-y-3"><div className="h-5 w-24 rounded bg-[var(--color-surface-3)]" /><div className="h-4 w-40 rounded bg-[var(--color-surface-3)]" /></div>
                <div className="mb-6 space-y-2"><div className="h-10 w-28 rounded bg-[var(--color-surface-3)]" /><div className="h-4 w-16 rounded bg-[var(--color-surface-3)]" /></div>
                <div className="h-10 w-full rounded-lg bg-[var(--color-surface-3)]" />
                <div className="mt-7 space-y-3">{Array.from({ length: 4 }).map((_, j) => (<div key={j} className="h-4 w-full rounded bg-[var(--color-surface-3)]" />))}</div>
              </div>
            ))
          ) : plans.length === 0 ? (
            <div className="col-span-full py-12 text-center text-[var(--color-fg-muted)]">
              <Loader2 className="mx-auto size-8 animate-spin mb-3" />
              <p>{t("pricing.noPlans")}</p>
            </div>
          ) : (
            plans.map((plan) => {
              const popular = plan.is_popular ?? false;
              return (
                <div
                  key={plan.id}
                  className={cn(
                    "relative flex flex-col rounded-2xl border p-5 sm:rounded-3xl sm:p-7 transition-all duration-300",
                    popular
                      ? "border-[var(--color-primary)] bg-[var(--color-surface)] shadow-[var(--shadow-glow)] lg:-translate-y-3"
                      : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-strong)]",
                  )}
                >
                  {popular && (
                    <div className="absolute -top-3 inset-x-0 flex justify-center">
                      <Badge variant="primary" className="shadow-[var(--shadow-md)]">
                        <Sparkles className="size-3.5" aria-hidden />
                        {t("pricing.mostPopular")}
                      </Badge>
                    </div>
                  )}

                  <div className="mb-5">
                    <h3 className="text-lg font-bold">{plan.name}</h3>
                    <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{plan.description}</p>
                  </div>

                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-extrabold tracking-tight">{formatCurrency(plan.price_cents, plan.currency)}</span>
                    <span className="mb-1.5 text-sm text-[var(--color-fg-muted)]">
                      {yearly ? t("pricing.perYear") : t("pricing.perMonth")}
                    </span>
                  </div>

                  <Button asChild variant={popular ? "primary" : "secondary"} className="mt-6 w-full">
                    <Link to="/auth/register">{t("pricing.cta")}</Link>
                  </Button>

                  {plan.features.length > 0 && (
                    <ul className="mt-7 space-y-3">
                      {plan.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm">
                          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--color-success)_15%,transparent)] text-[var(--color-success)]">
                            <Check className="size-3.5" aria-hidden />
                          </span>
                          <span className="text-[var(--color-fg-muted)]">{f}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </Section>
  );
}