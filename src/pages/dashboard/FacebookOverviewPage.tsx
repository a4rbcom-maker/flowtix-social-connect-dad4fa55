import { useTranslation } from "react-i18next";
import { Facebook, Users, FileText, TrendingUp, MessagesSquare, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const tools = [
  { key: "groupMembers", icon: Users, to: "/dashboard/facebook/group-members", desc: "Extract members from Facebook groups", count: "1,240 extracted" },
  { key: "pages", icon: FileText, to: "/dashboard/facebook/pages", desc: "Page followers and managed pages data", count: "856 pages" },
  { key: "posts", icon: TrendingUp, to: "/dashboard/facebook/posts", desc: "Post interactions and comments", count: "3,102 posts" },
  { key: "messenger", icon: MessagesSquare, to: "/dashboard/facebook/messenger", desc: "Extract messenger contacts", count: "420 contacts" },
];

export function FacebookOverviewPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader title={t("pages.facebook.title")} description={t("pages.facebook.subtitle")} icon={Facebook} />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {tools.map((tool) => {
          const Icon = tool.icon;
          return (
            <Card key={tool.key} className="card-hover">
              <CardContent className="flex items-start gap-4 pt-6">
                <div className="flex size-12 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] text-[var(--color-primary)] shrink-0">
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold text-[var(--color-fg)]">{t(`pages.facebook.tools.${tool.key}`)}</h3>
                  <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t(`pages.facebook.tools.${tool.key}Desc`)}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--color-fg-subtle)]">{tool.count}</span>
                    <Button asChild variant="secondary" size="sm">
                      <Link to={tool.to}>{t("common.start")}<ArrowRight className="size-3.5 rtl:rotate-180" /></Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
