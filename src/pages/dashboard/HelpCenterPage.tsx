import { useTranslation } from "react-i18next";
import { LifeBuoy, Search, BookOpen, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const categories = [
  { key: "gettingStarted", count: 12 },
  { key: "facebookExtraction", count: 24 },
  { key: "automation", count: 18 },
  { key: "billing", count: 9 },
  { key: "security", count: 15 },
  { key: "troubleshooting", count: 31 },
];

const popular = [
  { title: "pages.help.articles.howToConnect", time: "3 min read" },
  { title: "pages.help.articles.groupExtraction", time: "5 min read" },
  { title: "pages.help.articles.scheduleTasks", time: "4 min read" },
  { title: "pages.help.articles.exportData", time: "2 min read" },
  { title: "pages.help.articles.apiKeys", time: "6 min read" },
];

export function HelpCenterPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader title={t("pages.help.title")} description={t("pages.help.subtitle")} icon={LifeBuoy} />

      <Card hover="lift" className="overflow-hidden">
        <div className="gradient-brand p-6 text-center text-white sm:p-10 relative overflow-hidden">
          <div className="pointer-events-none absolute -top-20 -end-20 size-60 rounded-full bg-white/10 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-16 -start-16 size-40 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <div className="relative flex size-16 mx-auto items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm ring-1 ring-white/20">
            <LifeBuoy className="size-7" />
          </div>
          <h2 className="mt-4 text-xl font-extrabold sm:text-2xl">{t("pages.help.searchTitle")}</h2>
          <p className="mt-1 text-sm text-white/80">{t("pages.help.searchSubtitle")}</p>
          <div className="relative mx-auto mt-5 max-w-md">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-fg-muted)]" />
            <Input placeholder={t("pages.help.searchPlaceholder")} className="bg-[var(--color-bg-elevated)] text-[var(--color-fg)] ps-9" />
          </div>
        </div>
      </Card>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat) => (
          <Card key={cat.key} hover="lift" className="cursor-pointer">
            <CardContent className="flex items-center gap-3 pt-6">
              <div className="flex size-10 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] text-[var(--color-primary)] shrink-0">
                <BookOpen className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--color-fg)]">{t(`pages.help.categories.${cat.key}`)}</p>
                <p className="text-xs text-[var(--color-fg-subtle)]">{cat.count} {t("pages.help.articlesLabel")}</p>
              </div>
              <ChevronRight className="size-4 text-[var(--color-fg-subtle)] rtl:rotate-180" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card hover="lift">
        <CardContent className="space-y-2 pt-6">
          <h3 className="mb-3 text-base font-bold text-[var(--color-fg)]">{t("pages.help.popular")}</h3>
          {popular.map((art, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] p-3 transition-colors hover:bg-[var(--color-surface-2)] cursor-pointer">
              <span className="text-sm font-medium text-[var(--color-fg)]">{t(art.title)}</span>
              <span className="text-xs text-[var(--color-fg-subtle)]">{art.time}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card hover="lift" className="overflow-hidden">
        <div className="relative flex flex-col items-center justify-between gap-3 p-6 sm:flex-row bg-gradient-to-r from-[color-mix(in_oklab,var(--color-primary)_5%,transparent)] to-transparent">
          <div>
            <h3 className="font-bold text-[var(--color-fg)]">{t("pages.help.contactTitle")}</h3>
            <p className="text-sm text-[var(--color-fg-muted)]">{t("pages.help.contactDesc")}</p>
          </div>
          <Button asChild variant="primary"><Link to="/dashboard/support/contact">{t("pages.help.contactButton")}</Link></Button>
        </div>
      </Card>
    </div>
  );
}
