import { useTranslation } from "react-i18next";
import { UserPlus, FileBarChart, Users, Megaphone, ShoppingBag, LineChart } from "lucide-react";
import { Section, SectionHeading } from "@/components/ui/section";
import { cn } from "@/lib/utils";

export function FacebookTools() {
  const { t } = useTranslation();

  const items = [
    { key: "leads", icon: UserPlus },
    { key: "pages", icon: FileBarChart },
    { key: "groups", icon: Users },
    { key: "ads", icon: Megaphone },
    { key: "marketplace", icon: ShoppingBag },
    { key: "insights", icon: LineChart },
  ] as const;

  return (
    <Section>
      <div className="container-page">
        <SectionHeading
          badge={t("facebook.badge")}
          title={t("facebook.title")}
          subtitle={t("facebook.subtitle")}
        />

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ key, icon: Icon }, i) => (
            <div
              key={key}
              className={cn(
                "group relative bg-[var(--color-surface)] p-7 transition-colors hover:bg-[var(--color-surface-2)]",
                i % 2 === 1 && "sm:bg-[var(--color-bg-elevated)]",
              )}
            >
              <div className="flex items-center gap-4">
                <div className="flex size-12 items-center justify-center rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-fg)] transition-all duration-300 group-hover:gradient-brand group-hover:text-white group-hover:border-transparent">
                  <Icon className="size-5" aria-hidden />
                </div>
                <h3 className="text-base font-bold">{t(`facebook.items.${key}.title`)}</h3>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-[var(--color-fg-muted)]">
                {t(`facebook.items.${key}.desc`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
