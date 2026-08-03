import { useTranslation } from "react-i18next";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Database, Clock, Users, Loader2,
  Activity, Download, Pause, FileText, RefreshCw,
} from "lucide-react";
import { PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const timeline = [
  { id: "1", event: "Job created", status: "info", time: "2026-07-20 15:00" },
  { id: "2", event: "Connecting to Facebook session", status: "info", time: "2026-07-20 15:00" },
  { id: "3", event: "Started extracting group members", status: "info", time: "2026-07-20 15:01" },
  { id: "4", event: "Extracted 1,000 members", status: "success", time: "2026-07-20 15:05" },
  { id: "5", event: "Extracted 3,000 members", status: "success", time: "2026-07-20 15:12" },
  { id: "6", event: "Extracted 5,200 members", status: "success", time: "2026-07-20 15:18" },
];

const timelineColors = {
  info: "bg-[var(--color-primary)]",
  success: "bg-[var(--color-success)]",
  error: "bg-[var(--color-error)]",
};

export function JobDetailsPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const progress = 52;

  return (
    <div className="space-y-6">
      <Link to="/dashboard/extraction" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("extraction.backToTools")}
      </Link>

      <PageHeader
        title={t("extraction.job.title")}
        description={`${t("extraction.job.jobId")}: ${id ?? "sim-001"}`}
        icon={Database}
        action={
          <div className="flex gap-2">
            <Button variant="secondary"><Download className="size-4" />{t("extraction.job.export")}</Button>
            <Button variant="outline"><Pause className="size-4" />{t("extraction.job.pause")}</Button>
          </div>
        }
      />

      {/* Job status banner */}
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pt-6">
          <div className="flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)]">
              <Loader2 className="size-6 animate-spin text-[var(--color-primary)]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-[var(--color-fg)]">Group Members — Tech Community</h2>
                <Badge variant="primary">{t("extraction.job.status.running")}</Badge>
              </div>
              <p className="text-sm text-[var(--color-fg-muted)]">{t("extraction.job.startedAt")}: 2026-07-20 15:00</p>
            </div>
          </div>
          <div className="text-center sm:text-end">
            <p className="text-3xl font-extrabold text-[var(--color-primary)]">{progress}%</p>
            <p className="text-xs text-[var(--color-fg-subtle)]">{t("extraction.job.extracting")}</p>
          </div>
        </CardContent>
        <div className="h-2 w-full bg-[var(--color-surface-2)]">
          <div className="h-full gradient-brand transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
      </Card>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("extraction.job.extracted")} value="5,200" icon={Users} />
        <StatCard label={t("extraction.job.skipped")} value="42" icon={RefreshCw} />
        <StatCard label={t("extraction.job.failed")} value="3" icon={Activity} />
        <StatCard label={t("extraction.job.elapsed")} value="18m" icon={Clock} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Job Info */}
        <Card>
          <CardHeader><CardTitle>{t("extraction.job.info")}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow label={t("extraction.fields.type")} value={t("extraction.tools.groupMembers.title")} />
            <InfoRow label={t("extraction.fields.session")} value="Marketing Account" />
            <InfoRow label={t("extraction.fields.url")} value="facebook.com/groups/tech-community" mono />
            <InfoRow label={t("extraction.advanced.skipDuplicates")} value={t("common.enabled")} />
            <InfoRow label={t("extraction.advanced.retryFailed")} value={t("common.enabled")} />
          </CardContent>
        </Card>

        {/* Timeline */}
        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Activity className="size-5 text-[var(--color-fg-muted)]" />
            <CardTitle>{t("extraction.job.timeline")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {timeline.map((item, idx) => (
              <div key={item.id} className="flex items-start gap-3 animate-[fade-up_0.3s_ease-out]" style={{ animationDelay: `${idx * 0.08}s` }}>
                <div className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", timelineColors[item.status as keyof typeof timelineColors])} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-fg)]">{item.event}</p>
                  <p className="text-xs text-[var(--color-fg-subtle)]">{item.time}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Results preview */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><FileText className="size-5 text-[var(--color-fg-muted)]" />{t("extraction.job.preview")}</CardTitle>
          <Button variant="ghost" size="sm"><Download className="size-3.5" />{t("extraction.job.export")}</Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="py-2.5 px-3 text-start font-semibold text-[var(--color-fg-muted)]">#</th>
                  <th className="py-2.5 px-3 text-start font-semibold text-[var(--color-fg-muted)]">{t("extraction.job.col.name")}</th>
                  <th className="py-2.5 px-3 text-start font-semibold text-[var(--color-fg-muted)]">{t("extraction.job.col.profileId")}</th>
                  <th className="py-2.5 px-3 text-start font-semibold text-[var(--color-fg-muted)]">{t("extraction.job.col.joined")}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { name: "Ahmed Al-Zahrani", id: "1000xxxx234", joined: "2023-05-12" },
                  { name: "Sara Al-Otaibi", id: "1000xxxx567", joined: "2023-06-20" },
                  { name: "Khalid Al-Mansour", id: "1000xxxx890", joined: "2023-08-01" },
                  { name: "Noura Al-Qahtani", id: "1000xxxx123", joined: "2023-09-15" },
                  { name: "Faisal Al-Dossari", id: "1000xxxx456", joined: "2023-11-03" },
                ].map((row, i) => (
                  <tr key={i} className="border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-2)]">
                    <td className="py-2.5 px-3 text-[var(--color-fg-subtle)]">{i + 1}</td>
                    <td className="py-2.5 px-3 font-medium text-[var(--color-fg)]">{row.name}</td>
                    <td className="py-2.5 px-3 font-mono text-xs text-[var(--color-fg-muted)]">{row.id}</td>
                    <td className="py-2.5 px-3 text-[var(--color-fg-muted)]">{row.joined}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-center text-xs text-[var(--color-fg-subtle)]">{t("extraction.job.showing")} 5 {t("extraction.job.of")} 5,200</p>
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--color-fg-subtle)]">{label}</span>
      <span className={cn("font-medium text-[var(--color-fg)]", mono && "font-mono text-xs")}>{value}</span>
    </div>
  );
}
