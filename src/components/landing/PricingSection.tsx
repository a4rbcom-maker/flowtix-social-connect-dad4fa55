import { useI18n } from "@/lib/i18n";
import { useInView } from "@/hooks/use-in-view";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

type LandingPlan = {
  id: string;
  name_ar: string;
  name_en: string;
  price: number;
  currency: string;
  billing_period: string;
  features_ar: string[];
  features_en: string[];
  is_popular: boolean;
  sort_order: number;
};

export function PricingSection() {
  const { t, dir, lang } = useI18n();
  const { ref, isInView } = useInView();

  const { data: plans, isLoading } = useQuery({
    queryKey: ["public", "plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans" as never)
        .select("id,name_ar,name_en,price,currency,billing_period,features_ar,features_en,is_popular,sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as LandingPlan[];
    },
    staleTime: 60_000,
  });

  const list = plans ?? [];

  return (
    <section id="pricing" dir={dir} className="py-12 md:py-16">
      <div ref={ref} className="mx-auto max-w-7xl px-4">
        <div className={`mb-16 text-center transition-all duration-700 ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>
          <span className="mb-4 inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary">
            {dir === "rtl" ? "💎 الباقات" : "💎 Plans"}
          </span>
          <h2 className="text-3xl font-bold text-foreground md:text-5xl">{t.pricing.title}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t.pricing.subtitle}</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : list.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">
            {dir === "rtl" ? "لا توجد باقات متاحة حالياً." : "No plans available right now."}
          </p>
        ) : (
          <div className={`grid gap-8 items-start ${list.length === 1 ? "max-w-md mx-auto" : list.length === 2 ? "md:grid-cols-2 max-w-3xl mx-auto" : "md:grid-cols-3"}`}>
            {list.map((plan, i) => {
              const isPopular = plan.is_popular;
              const name = lang === "ar" ? plan.name_ar : plan.name_en;
              const features = lang === "ar" ? plan.features_ar : plan.features_en;
              const periodLabel =
                plan.billing_period === "yearly"
                  ? (dir === "rtl" ? "/ سنوياً" : "/ year")
                  : plan.billing_period === "lifetime"
                  ? (dir === "rtl" ? "مدى الحياة" : "lifetime")
                  : t.pricing.monthly;
              return (
                <div
                  key={plan.id}
                  className={`relative rounded-2xl border p-8 transition-all duration-500 ease-out hover:-translate-y-1 ${
                    isPopular ? "md:scale-105" : ""
                  } ${isInView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"}`}
                  style={{
                    transitionDelay: isInView ? `${150 + i * 150}ms` : "0ms",
                    background: isPopular ? "var(--pricing-popular-bg)" : "var(--pricing-card-bg)",
                    borderColor: isPopular ? "var(--pricing-popular-border)" : "var(--pricing-card-border)",
                    boxShadow: isPopular
                      ? "0 8px 30px -8px oklch(0.53 0.27 290 / 0.18)"
                      : "0 2px 12px -4px oklch(0.5 0.05 290 / 0.06)",
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
                      {name}
                    </h3>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span
                        className="text-5xl font-extrabold"
                        style={{ color: isPopular ? "var(--pricing-popular-text)" : "var(--foreground)" }}
                      >
                        {Number(plan.price).toLocaleString()}
                      </span>
                      <span
                        className="text-sm"
                        style={{ color: isPopular ? "var(--pricing-popular-muted)" : "var(--muted-foreground)" }}
                      >
                        {plan.currency} {periodLabel}
                      </span>
                    </div>
                  </div>
                  <ul className="mb-8 space-y-3">
                    {features.map((f, fi) => (
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
                  <Link
                    to="/login"
                    className={`btn-luxury-base w-full text-sm inline-flex items-center justify-center ${
                      isPopular ? "btn-luxury" : "btn-luxury-outline"
                    }`}
                  >
                    <span>{t.pricing.cta}</span>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
