import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Server, CheckCircle2, XCircle, Clock, RefreshCw, AlertTriangle } from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import { getVpsWorkerStatus } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/vps")({
  ssr: false,
  component: AdminVpsPage,
});

function fmtAgo(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function statusColor(status: string): string {
  switch (status) {
    case "running":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
    case "completed":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
    case "failed":
      return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
    case "pending":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
    case "cancelled":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function AdminVpsPage() {
  const { lang } = useI18n();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const fetchStatus = useServerFn(getVpsWorkerStatus);

  const q = useQuery({
    queryKey: ["admin", "vps-status"],
    queryFn: () => fetchStatus(),
    refetchInterval: 5000,
    staleTime: 0,
  });

  const now = Date.now();
  const workers = q.data?.workers ?? [];
  const jobs = q.data?.recentJobs ?? [];
  const counts = q.data?.counts;

  return (
    <AdminLayout title={t("VPS Worker", "VPS Worker")}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{t("حالة الـ VPS Worker", "VPS worker status")}</h2>
            <p className="text-sm text-muted-foreground">
              {t(
                "يتحدّث كل 5 ثوانٍ. النبضة تُسجَّل مع كل استدعاء لـ next-job.",
                "Auto-refreshes every 5s. Heartbeat is recorded on every next-job poll.",
              )}
            </p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-accent"
            onClick={() => q.refetch()}
          >
            <RefreshCw className="w-4 h-4" />
            {t("تحديث", "Refresh")}
          </button>
        </div>

        {/* Counters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label={t("قيد التشغيل", "Running")} value={counts?.running ?? 0} icon={<RefreshCw className="w-4 h-4 text-blue-600" />} />
          <Kpi label={t("في الانتظار", "Pending")} value={counts?.pending ?? 0} icon={<Clock className="w-4 h-4 text-amber-600" />} />
          <Kpi label={t("تمت (24س)", "Completed 24h")} value={counts?.completed_24h ?? 0} icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />} />
          <Kpi label={t("فشلت (24س)", "Failed 24h")} value={counts?.failed_24h ?? 0} icon={<XCircle className="w-4 h-4 text-red-600" />} />
        </div>

        {/* Workers / PM2 status */}
        <section className="rounded-xl border bg-card">
          <header className="px-4 py-3 border-b flex items-center gap-2">
            <Server className="w-4 h-4" />
            <h3 className="font-semibold text-sm">{t("العمّال (PM2 processes)", "Workers (PM2 processes)")}</h3>
          </header>
          {q.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">{t("جاري التحميل…", "Loading…")}</div>
          ) : workers.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              {t(
                "لا توجد نبضات بعد. تأكّد من تشغيل الـ VPS worker (pm2 status flowtix-bot-worker).",
                "No heartbeats yet. Make sure the VPS worker is running (pm2 status flowtix-bot-worker).",
              )}
            </div>
          ) : (
            <div className="divide-y">
              {workers.map((w) => {
                const ageMs = now - new Date(w.last_seen_at).getTime();
                const online = ageMs < 30_000;
                const stale = !online && ageMs < 120_000;
                return (
                  <div key={w.worker_name} className="p-4 flex flex-wrap items-center gap-4">
                    <span
                      className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${
                        online
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : stale
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                          : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${online ? "bg-emerald-500" : stale ? "bg-amber-500" : "bg-red-500"}`} />
                      {online ? t("متصل", "Online") : stale ? t("متأخر", "Stale") : t("غير متصل", "Offline")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{w.worker_name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {w.version ?? "—"} · {w.capabilities?.length ?? 0} caps
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("آخر ظهور:", "Last seen:")} {fmtAgo(w.last_seen_at, now)} {t("مضت", "ago")}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Recent jobs */}
        <section className="rounded-xl border bg-card">
          <header className="px-4 py-3 border-b">
            <h3 className="font-semibold text-sm">{t("آخر المهام", "Recent jobs")}</h3>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="text-start px-3 py-2">ID</th>
                  <th className="text-start px-3 py-2">{t("النوع", "Type")}</th>
                  <th className="text-start px-3 py-2">{t("الحالة", "Status")}</th>
                  <th className="text-start px-3 py-2">{t("التقدّم", "Progress")}</th>
                  <th className="text-start px-3 py-2">{t("أنشئت", "Created")}</th>
                  <th className="text-start px-3 py-2">{t("خطأ", "Error")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.map((j: any) => (
                  <tr key={j.id}>
                    <td className="px-3 py-2 font-mono text-xs">{String(j.id).slice(0, 8)}</td>
                    <td className="px-3 py-2">{j.job_type}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${statusColor(j.status)}`}>{j.status}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {j.processed_items ?? 0}/{j.total_items ?? 0} ({j.progress ?? 0}%)
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtAgo(j.created_at, now)}</td>
                    <td className="px-3 py-2 text-xs text-red-600 max-w-[280px] truncate" title={j.error_message ?? ""}>
                      {j.error_message ?? "—"}
                    </td>
                  </tr>
                ))}
                {jobs.length === 0 && !q.isLoading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground text-sm">
                      {t("لا توجد مهام.", "No jobs.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}

function Kpi({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}
