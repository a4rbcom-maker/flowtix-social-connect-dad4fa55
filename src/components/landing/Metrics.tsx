import { useTranslation } from "react-i18next";
import { Section } from "@/components/ui/section";

export function Metrics() {
  const { t } = useTranslation();

  const metrics = [
    { value: "99.9%", label: t("metrics.uptime") },
    { value: "8.2M+", label: t("metrics.processed") },
    { value: "12.4k", label: t("metrics.users") },
    { value: "98%", label: t("metrics.satisfaction") },
  ];

  return (
    <Section>
      <div className="container-page">
        <div className="relative overflow-hidden rounded-3xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
          <div className="pointer-events-none absolute inset-0 bg-radial-glow opacity-60" aria-hidden />
          <div className="relative grid divide-y divide-[var(--color-border)] sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
            {metrics.map((m, i) => (
              <div key={i} className="px-8 py-12 text-center">
                <p className="text-4xl font-extrabold tracking-tight gradient-text sm:text-5xl">
                  {m.value}
                </p>
                <p className="mt-2 text-sm text-[var(--color-fg-muted)]">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
