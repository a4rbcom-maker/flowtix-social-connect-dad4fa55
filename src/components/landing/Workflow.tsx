import { useTranslation } from "react-i18next";
import { Link2, Settings2, Bot, BarChart3 } from "lucide-react";
import { Section, SectionHeading } from "@/components/ui/section";

export function Workflow() {
  const { t } = useTranslation();

  const steps = [
    { key: "connect", icon: Link2, num: "01" },
    { key: "configure", icon: Settings2, num: "02" },
    { key: "automate", icon: Bot, num: "03" },
    { key: "analyze", icon: BarChart3, num: "04" },
  ] as const;

  return (
    <Section className="bg-[var(--color-bg-elevated)]">
      <div className="container-page">
        <SectionHeading
          badge={t("workflow.badge")}
          title={t("workflow.title")}
          subtitle={t("workflow.subtitle")}
        />

        <div className="relative mt-14">
          {/* Connecting line */}
          <div className="absolute inset-x-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-[var(--color-border-strong)] to-transparent lg:block" aria-hidden />

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(({ key, icon: Icon, num }) => (
              <div key={key} className="relative flex flex-col items-center text-center">
                <div className="relative z-10 flex size-14 items-center justify-center rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-primary-soft)] shadow-[var(--shadow-md)]">
                  <Icon className="size-6" aria-hidden />
                  <span className="absolute -top-2 -end-2 flex size-6 items-center justify-center rounded-full gradient-brand text-[0.65rem] font-bold text-white">
                    {num}
                  </span>
                </div>
                <h3 className="mt-5 text-base font-bold">{t(`workflow.steps.${key}.title`)}</h3>
                <p className="mt-2 text-sm text-[var(--color-fg-muted)]">
                  {t(`workflow.steps.${key}.desc`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}
