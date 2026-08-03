import { useTranslation } from "react-i18next";
import { Database, Bot, BarChart3, Clock, Download, ShieldCheck } from "lucide-react";
import { Section, SectionHeading } from "@/components/ui/section";
import { Card } from "@/components/ui/card";

export function CoreFeatures() {
  const { t } = useTranslation();

  const items = [
    { key: "extraction", icon: Database },
    { key: "automation", icon: Bot },
    { key: "analytics", icon: BarChart3 },
    { key: "scheduling", icon: Clock },
    { key: "export", icon: Download },
    { key: "security", icon: ShieldCheck },
  ] as const;

  return (
    <Section id="features" className="scroll-mt-20">
      <div className="container-page">
        <SectionHeading
          badge={t("features.badge")}
          title={t("features.title")}
          subtitle={t("features.subtitle")}
        />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ key, icon: Icon }) => (
            <Card key={key} className="card-hover group relative overflow-hidden p-6">
              <div className="pointer-events-none absolute -end-8 -top-8 size-28 rounded-full bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100" aria-hidden />
              <div className="relative flex size-12 items-center justify-center rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-primary-soft)] transition-colors group-hover:border-[var(--color-primary)] group-hover:text-[var(--color-primary-soft)]">
                <Icon className="size-6" aria-hidden />
              </div>
              <h3 className="relative mt-5 text-lg font-bold tracking-tight">
                {t(`features.items.${key}.title`)}
              </h3>
              <p className="relative mt-2 text-sm leading-relaxed text-[var(--color-fg-muted)]">
                {t(`features.items.${key}.desc`)}
              </p>
            </Card>
          ))}
        </div>
      </div>
    </Section>
  );
}
