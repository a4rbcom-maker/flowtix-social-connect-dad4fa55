import { useTranslation } from "react-i18next";
import { CreditCard, Package, Gauge, ArrowUpCircle } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const usage = [
  { label: "pages.subscription.usage.extractions", used: 12840, total: 100000, unit: "" },
  { label: "pages.subscription.usage.facebookAccounts", used: 4, total: 10, unit: "" },
  { label: "pages.subscription.usage.exports", used: 156, total: 500, unit: "" },
];

export function SubscriptionPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader title={t("pages.subscription.title")} description={t("pages.subscription.subtitle")} icon={CreditCard} action={<Button><ArrowUpCircle className="size-4" />{t("pages.subscription.upgrade")}</Button>} />

      <Card className="overflow-hidden" hover="lift">
        <div className="gradient-brand p-6 text-white relative overflow-hidden">
          <div className="pointer-events-none absolute -top-12 -end-12 size-40 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <div className="relative flex items-center justify-between">
            <div>
              <Badge className="bg-white/20 border-white/30 text-white">{t("pages.subscription.currentPlan")}</Badge>
              <h2 className="mt-2 text-2xl font-extrabold">{t("pages.subscription.plans.pro")}</h2>
              <p className="mt-1 text-sm text-white/80">{t("pages.subscription.plans.proDesc")}</p>
            </div>
            <div className="flex size-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm ring-1 ring-white/20">
              <Package className="size-7 text-white" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-4 text-sm">
            <span className="text-white/80">{t("pages.subscription.renewsOn")} 2026-08-20</span>
            <span className="text-white/60">•</span>
            <span className="text-white/80">$79 {t("pages.subscription.perMonth")}</span>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <Card>
          <CardContent className="text-center pt-6">
            <Gauge className="mx-auto size-8 text-[var(--color-primary)]" />
            <p className="mt-2 text-2xl font-extrabold text-[var(--color-fg)]">12,840</p>
            <p className="text-xs text-[var(--color-fg-muted)]">{t("pages.subscription.usageLabel")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="text-center pt-6">
            <Package className="mx-auto size-8 text-[var(--color-success)]" />
            <p className="mt-2 text-2xl font-extrabold text-[var(--color-fg)]">$79</p>
            <p className="text-xs text-[var(--color-fg-muted)]">{t("pages.subscription.monthlyCost")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="text-center pt-6">
            <ArrowUpCircle className="mx-auto size-8 text-[var(--color-warning)]" />
            <p className="mt-2 text-2xl font-extrabold text-[var(--color-fg)]">87,160</p>
            <p className="text-xs text-[var(--color-fg-muted)]">{t("pages.subscription.remaining")}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("pages.subscription.usageDetails")}</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          {usage.map((u) => {
            const pct = Math.round((u.used / u.total) * 100);
            return (
              <div key={u.label}>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="font-medium text-[var(--color-fg)]">{t(u.label)}</span>
                  <span className="text-[var(--color-fg-muted)]">{u.used.toLocaleString()} / {u.total.toLocaleString()}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                  <div className={`h-full rounded-full transition-all duration-500 ${pct > 80 ? "bg-[var(--color-error)]" : pct > 50 ? "bg-[var(--color-warning)]" : "gradient-brand"}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
