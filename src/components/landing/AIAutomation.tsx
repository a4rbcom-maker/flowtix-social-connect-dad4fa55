import { useTranslation } from "react-i18next";
import { Brain, TrendingUp, Workflow } from "lucide-react";
import { Section, SectionHeading } from "@/components/ui/section";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function AIAutomation() {
  const { t } = useTranslation();

  const items = [
    { key: "smart", icon: Brain },
    { key: "predict", icon: TrendingUp },
    { key: "auto", icon: Workflow },
  ] as const;

  return (
    <Section id="automation" className="scroll-mt-20 bg-[var(--color-bg-elevated)]">
      <div className="container-page">
        <div className="grid items-center gap-8 lg:gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              badge={t("ai.badge")}
              title={t("ai.title")}
              subtitle={t("ai.subtitle")}
              align="start"
            />
            <div className="mt-8 space-y-3 lg:mt-10 lg:space-y-4">
              {items.map(({ key, icon: Icon }) => (
                <Card key={key} className="card-hover flex items-start gap-3 p-4 sm:gap-4 sm:p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl gradient-brand text-white shadow-[var(--shadow-glow)] sm:size-11">
                    <Icon className="size-5" aria-hidden />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold sm:text-base">{t(`ai.items.${key}.title`)}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--color-fg-muted)] sm:text-sm">
                      {t(`ai.items.${key}.desc`)}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="pointer-events-none absolute -inset-4 rounded-3xl bg-radial-glow blur-2xl" aria-hidden />
            <Card className="relative overflow-hidden p-4 sm:p-6 lg:p-8">
              <div className="flex items-center justify-between">
                <Badge variant="primary">
                  <span className="size-1.5 animate-[pulse-glow_2s_ease-in-out_infinite] rounded-full bg-[var(--color-success)]" />
                  AI Engine
                </Badge>
                <span className="text-xs text-[var(--color-fg-subtle)]">v2.4</span>
              </div>

              <div className="relative mt-4 flex h-44 items-center justify-center sm:mt-6 sm:h-64">
                <svg viewBox="0 0 320 240" className="h-full w-full" aria-hidden>
                  <g stroke="url(#g)" strokeWidth="1.2" opacity="0.4">
                    {[0, 1, 2, 3].map((i) =>
                      [0, 1, 2].map((j) =>
                        [0, 1, 2, 3].map((k) => (
                          <line key={`${i}-${j}-${k}`} x1={40 + i * 80} y1={40 + j * 60} x2={40 + (i + 1) * 80} y2={40 + k * 60} />
                        )),
                      ),
                    )}
                  </g>
                  <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="var(--color-primary)" />
                      <stop offset="100%" stopColor="var(--color-secondary)" />
                    </linearGradient>
                  </defs>
                  {[0, 1, 2, 3, 4].map((col) =>
                    [0, 1, 2, 3].slice(0, col === 0 || col === 4 ? 2 : 3).map((row) => (
                      <circle
                        key={`${col}-${row}`}
                        cx={40 + col * 80}
                        cy={40 + row * 60 + (col === 0 || col === 4 ? 60 : 0)}
                        r="4"
                        fill="var(--color-primary-soft)"
                      />
                    )),
                  )}
                </svg>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2 sm:gap-3">
                {[
                  { label: "Accuracy", value: "98.4%" },
                  { label: "Speed", value: "1.2ms" },
                  { label: "Models", value: "24" },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5 text-center sm:p-3">
                    <p className="text-base font-bold gradient-text sm:text-lg">{s.value}</p>
                    <p className="text-[0.65rem] text-[var(--color-fg-subtle)] sm:text-xs">{s.label}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </Section>
  );
}
