import { useTranslation } from "react-i18next";
import { Lock, FileCheck, KeyRound, ScrollText } from "lucide-react";
import { Section, SectionHeading } from "@/components/ui/section";
import { Card } from "@/components/ui/card";

export function Security() {
  const { t } = useTranslation();

  const items = [
    { key: "encryption", icon: Lock },
    { key: "compliance", icon: FileCheck },
    { key: "access", icon: KeyRound },
    { key: "audit", icon: ScrollText },
  ] as const;

  return (
    <Section>
      <div className="container-page">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="relative order-2 lg:order-1">
            <div className="pointer-events-none absolute -inset-6 rounded-3xl bg-radial-glow blur-2xl" aria-hidden />
            <Card className="relative overflow-hidden p-8">
              <div className="flex items-center justify-center">
                <div className="relative flex size-48 items-center justify-center">
                  <div className="absolute inset-0 rounded-full border border-[var(--color-border-strong)] animate-[pulse-glow_4s_ease-in-out_infinite]" />
                  <div className="absolute inset-6 rounded-full border border-[var(--color-border-strong)] opacity-60" />
                  <div className="absolute inset-12 rounded-full border border-[var(--color-border-strong)] opacity-40" />
                  <div className="flex size-20 items-center justify-center rounded-full gradient-brand text-white shadow-[var(--shadow-glow)]">
                    <Lock className="size-8" aria-hidden />
                  </div>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-3 gap-3 text-center">
                {["AES-256", "GDPR", "SOC 2"].map((badge) => (
                  <div key={badge} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-2 text-xs font-semibold text-[var(--color-fg-muted)]">
                    {badge}
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="order-1 lg:order-2">
            <SectionHeading
              badge={t("security.badge")}
              title={t("security.title")}
              subtitle={t("security.subtitle")}
              align="start"
            />
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {items.map(({ key, icon: Icon }) => (
                <div key={key} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--color-success)_12%,transparent)] text-[var(--color-success)]">
                    <Icon className="size-5" aria-hidden />
                  </div>
                  <h3 className="mt-4 text-sm font-bold">{t(`security.items.${key}.title`)}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-fg-muted)]">
                    {t(`security.items.${key}.desc`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
