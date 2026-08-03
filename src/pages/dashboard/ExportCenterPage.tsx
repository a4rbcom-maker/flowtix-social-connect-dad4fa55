import { useTranslation } from "react-i18next";
import { Download, FileText, Clock, HardDrive } from "lucide-react";
import { PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const exports = [
  { id: "1", name: "group_members_tech_community.csv", size: "2.4 MB", format: "CSV", date: "2m ago", status: "ready" },
  { id: "2", name: "page_data_flowtix_official.xlsx", size: "1.8 MB", format: "XLSX", date: "1h ago", status: "ready" },
  { id: "3", name: "post_interactions_campaign12.json", size: "5.2 MB", format: "JSON", date: "3h ago", status: "ready" },
  { id: "4", name: "messenger_contacts_export.csv", size: "820 KB", format: "CSV", date: "1d ago", status: "expired" },
  { id: "5", name: "group_members_marketing.csv", size: "1.1 MB", format: "CSV", date: "2d ago", status: "ready" },
];

export function ExportCenterPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader title={t("pages.export.title")} description={t("pages.export.subtitle")} icon={Download} />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("pages.export.totalExports")} value="156" icon={Download} trend={{ value: "23%", positive: true }} />
        <StatCard label={t("pages.export.ready")} value="148" icon={FileText} />
        <StatCard label={t("pages.export.expired")} value="8" icon={Clock} />
        <StatCard label={t("pages.export.totalSize")} value="342 MB" icon={HardDrive} />
      </div>

      <Card hover="lift">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t("pages.export.recentExports")}</CardTitle>
          <Button variant="ghost" size="sm">{t("pages.export.exportAll")}</Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {exports.map((exp) => (
            <div key={exp.id} className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] p-3 transition-colors hover:bg-[var(--color-surface-2)]">
              <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-fg-muted)] shrink-0">
                <FileText className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--color-fg)]">{exp.name}</p>
                <p className="text-xs text-[var(--color-fg-subtle)]">{exp.size} • {exp.format} • {exp.date}</p>
              </div>
              <Badge variant={exp.status === "ready" ? "success" : "default"}>{t(`pages.export.status.${exp.status}`)}</Badge>
              {exp.status === "ready" && (
                <Button variant="secondary" size="sm" className="shrink-0">
                  <Download className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
