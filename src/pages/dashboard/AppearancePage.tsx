import { useTranslation } from "react-i18next";
import { Palette, Sun, Moon, Monitor } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";
import { ThemeToggleFull } from "@/components/shared/ThemeToggle";
import { cn } from "@/lib/utils";

export function AppearancePage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader title={t("pages.appearance.title")} description={t("pages.appearance.subtitle")} icon={Palette} />

      <Card hover="lift">
        <CardHeader><CardTitle>{t("pages.appearance.theme")}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { icon: Sun, label: t("nav.switchLight"), color: "bg-amber-100" },
              { icon: Moon, label: t("nav.switchDark"), color: "bg-indigo-900" },
              { icon: Monitor, label: t("nav.switchSystem"), color: "bg-gradient-to-br from-amber-100 to-indigo-900" },
            ].map((theme) => {
              const Icon = theme.icon;
              return (
                <button key={theme.label} className="flex flex-col items-center gap-3 rounded-xl border border-[var(--color-border)] p-5 transition-all hover:border-[var(--color-primary)] hover:bg-[var(--color-surface-2)]">
                  <div className={cn("flex size-16 items-center justify-center rounded-2xl", theme.color)}>
                    <Icon className="size-7 text-[var(--color-fg)]" />
                  </div>
                  <span className="text-sm font-medium text-[var(--color-fg)]">{theme.label}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-4">
            <ThemeToggleFull />
          </div>
        </CardContent>
      </Card>

      <Card hover="lift">
        <CardHeader><CardTitle>{t("pages.appearance.language")}</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between">
          <p className="text-sm text-[var(--color-fg-muted)]">{t("pages.appearance.languageDesc")}</p>
          <LanguageSwitcher />
        </CardContent>
      </Card>
    </div>
  );
}
