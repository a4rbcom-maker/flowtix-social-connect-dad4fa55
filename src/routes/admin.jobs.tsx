import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ListChecks,
  PlayCircle,
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
  RefreshCw,
  Trash2,
  Search,
  Facebook,
  Send,
  Loader2,
  AlertCircle,
  PauseCircle,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import {
  getAdminJobsOverview,
  retryAdminJob,
  cancelAdminJob,
  deleteAdminJob,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/jobs")({ ssr: false, component: AdminJobsPage });

const STATUS_OPTIONS = [
  { value: "", ar: "كل الحالات", en: "All statuses" },
  { value: "running", ar: "قيد التشغيل", en: "Running" },
  { value: "pending", ar: "في الانتظار", en: "Pending" },
  { value: "scheduled", ar: "مجدول", en: "Scheduled" },
  { value: "completed", ar: "مكتمل", en: "Completed" },
  { value: "failed", ar: "فشل", en: "Failed" },
  { value: "cancelled", ar: "ملغي", en: "Cancelled" },
  { value: "paused", ar: "متوقف", en: "Paused" },
];

const KIND_OPTIONS = [
  { value: "all", ar: "الكل", en: "All" },
  { value: "fb", ar: "فيسبوك", en: "Facebook" },
  { value: "bulk", ar: "إرسال جماعي", en: "Bulk" },
];

function StatusBadge({ status, lang }: { status: string; lang: "ar" | "en" }) {
  const map: Record<string, { ar: string; en: string; cls: string; Icon: typeof CheckCircle2 }> = {
    running: { ar: "قيد التشغيل", en: "Running", cls: "bg-blue-500/10 text-blue-600 border-blue-500/30", Icon: PlayCircle },
    pending: { ar: "في الانتظار", en: "Pending", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30", Icon: Clock },
    scheduled: { ar: "مجدول", en: "Scheduled", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30", Icon: Clock },
    completed: { ar: "مكتمل", en: "Completed", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", Icon: CheckCircle2 },
    failed: { ar: "فشل", en: "Failed", cls: "bg-rose-500/10 text-rose-600 border-rose-500/30", Icon: XCircle },
    cancelled: { ar: "ملغي", en: "Cancelled", cls: "bg-muted text-muted-foreground border-border", Icon: Ban },
    paused: { ar: "متوقف", en: "Paused", cls: "bg-purple-500/10 text-purple-600 border-purple-500/30", Icon: PauseCircle },
  };
  const s = map[status] ?? { ar: status, en: status, cls: "bg-muted text-muted-foreground border-border", Icon: AlertCircle };
  const Icon = s.Icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${s.cls}`}>
      <Icon className="h-3 w-3" />
      {lang === "ar" ? s.ar : s.en}
    </span>
  );
}

function KindBadge({ kind, lang }: { kind: "fb" | "bulk"; lang: "ar" | "en" }) {
  const Icon = kind === "fb" ? Facebook : Send;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${kind === "fb" ? "bg-blue-500/10 text-blue-600" : "bg-violet-500/10 text-violet-600"}`}>
      <Icon className="h-3 w-3" />
      {kind === "fb" ? (lang === "ar" ? "فيسبوك" : "FB") : (lang === "ar" ? "جماعي" : "Bulk")}
    </span>
  );
}

function fmt(date: string | null, lang: "ar" | "en"): string {
  if (!date) return "—";
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return lang === "ar" ? "الآن" : "now";
  if (mins < 60) return lang === "ar" ? `منذ ${mins}د` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return lang === "ar" ? `منذ ${hrs}س` : `${hrs}h ago`;
  return d.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US");
}

function AdminJobsPage() {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState<"all" | "fb" | "bulk">("all");
  const [search, setSearch] = useState("");

  const fetchJobs = useServerFn(getAdminJobsOverview);
  const retryFn = useServerFn(retryAdminJob);
  const cancelFn = useServerFn(cancelAdminJob);
  const deleteFn = useServerFn(deleteAdminJob);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin", "jobs", status, kind, search],
    queryFn: () => fetchJobs({ data: { status, kind, search, limit: 150 } }),
    refetchInterval: 15_000,
  });

  const totals = data?.totals;
  const jobs = useMemo(() => data?.jobs ?? [], [data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "jobs"] });

  const retryMut = useMutation({
    mutationFn: (args: { id: string; kind: "fb" | "bulk" }) => retryFn({ data: args }),
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم إعادة جدولة المهمة" : "Job re-queued");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: (args: { id: string; kind: "fb" | "bulk" }) => cancelFn({ data: args }),
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم إلغاء المهمة" : "Job cancelled");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (args: { id: string; kind: "fb" | "bulk" }) => deleteFn({ data: args }),
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم حذف المهمة" : "Job deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const kpis = [
    { label: lang === "ar" ? "كل المهام" : "Total jobs", value: totals?.total ?? 0, Icon: ListChecks, color: "from-primary/20 to-primary/5 text-primary" },
    { label: lang === "ar" ? "قيد التشغيل" : "Running", value: totals?.running ?? 0, Icon: PlayCircle, color: "from-blue-500/20 to-blue-500/5 text-blue-600" },
    { label: lang === "ar" ? "في الانتظار" : "Pending", value: totals?.pending ?? 0, Icon: Clock, color: "from-amber-500/20 to-amber-500/5 text-amber-600" },
    { label: lang === "ar" ? "مكتملة" : "Completed", value: totals?.completed ?? 0, Icon: CheckCircle2, color: "from-emerald-500/20 to-emerald-500/5 text-emerald-600" },
    { label: lang === "ar" ? "فشل" : "Failed", value: totals?.failed ?? 0, Icon: XCircle, color: "from-rose-500/20 to-rose-500/5 text-rose-600" },
    { label: lang === "ar" ? "ملغية" : "Cancelled", value: totals?.cancelled ?? 0, Icon: Ban, color: "from-muted-foreground/20 to-muted-foreground/5 text-muted-foreground" },
  ];

  return (
    <AdminLayout title={lang === "ar" ? "إدارة المهام" : "Jobs Management"}>
      <div className="space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {kpis.map((k) => {
            const Icon = k.Icon;
            return (
              <div key={k.label} className={`rounded-2xl border border-border bg-gradient-to-br ${k.color} p-4 backdrop-blur-xl`}>
                <div className="flex items-center justify-between">
                  <Icon className="h-5 w-5 opacity-80" />
                  <span className="text-2xl font-bold tabular-nums">{k.value.toLocaleString()}</span>
                </div>
                <div className="mt-2 text-xs font-medium opacity-80">{k.label}</div>
              </div>
            );
          })}
        </div>

        {/* Aggregated counts */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="rounded-xl border border-border bg-card/70 p-3 flex items-center justify-between">
            <span className="text-muted-foreground">{lang === "ar" ? "مهام فيسبوك" : "Facebook jobs"}</span>
            <span className="font-bold text-blue-600">{totals?.fb_count ?? 0}</span>
          </div>
          <div className="rounded-xl border border-border bg-card/70 p-3 flex items-center justify-between">
            <span className="text-muted-foreground">{lang === "ar" ? "إرسال جماعي" : "Bulk jobs"}</span>
            <span className="font-bold text-violet-600">{totals?.bulk_count ?? 0}</span>
          </div>
          <div className="rounded-xl border border-border bg-card/70 p-3 flex items-center justify-between">
            <span className="text-muted-foreground">{lang === "ar" ? "إجمالي المعالج" : "Items processed"}</span>
            <span className="font-bold text-emerald-600">{(totals?.total_processed ?? 0).toLocaleString()}</span>
          </div>
          <div className="rounded-xl border border-border bg-card/70 p-3 flex items-center justify-between">
            <span className="text-muted-foreground">{lang === "ar" ? "إجمالي الفشل" : "Items failed"}</span>
            <span className="font-bold text-rose-600">{(totals?.total_failed ?? 0).toLocaleString()}</span>
          </div>
        </div>

        {/* Filters */}
        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-4 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === "ar" ? "بحث بالعنوان أو المستخدم أو المعرف…" : "Search title, user, or ID…"}
              className="w-full ps-10 pe-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex gap-2">
            {KIND_OPTIONS.map((k) => (
              <button
                key={k.value}
                onClick={() => setKind(k.value as "all" | "fb" | "bulk")}
                className={`px-3 py-2 rounded-lg text-xs font-semibold border transition ${kind === k.value ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:text-foreground"}`}
              >
                {lang === "ar" ? k.ar : k.en}
              </button>
            ))}
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 rounded-lg bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{lang === "ar" ? s.ar : s.en}</option>
            ))}
          </select>
          <button
            onClick={() => refetch()}
            className="px-3 py-2 rounded-lg bg-muted hover:bg-muted/70 text-sm flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            {lang === "ar" ? "تحديث" : "Refresh"}
          </button>
        </div>

        {/* Jobs table */}
        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="font-bold flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-primary" />
              {lang === "ar" ? "كل المهام" : "All Jobs"}
              <span className="text-xs text-muted-foreground font-normal">({jobs.length})</span>
            </h2>
          </div>
          {isLoading ? (
            <div className="p-12 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              {lang === "ar" ? "لا توجد مهام مطابقة للفلاتر" : "No jobs match the filters"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-start px-4 py-2 font-medium">{lang === "ar" ? "النوع" : "Kind"}</th>
                    <th className="text-start px-4 py-2 font-medium">{lang === "ar" ? "العنوان" : "Title"}</th>
                    <th className="text-start px-4 py-2 font-medium">{lang === "ar" ? "المستخدم" : "User"}</th>
                    <th className="text-start px-4 py-2 font-medium">{lang === "ar" ? "الحالة" : "Status"}</th>
                    <th className="text-start px-4 py-2 font-medium">{lang === "ar" ? "التقدم" : "Progress"}</th>
                    <th className="text-start px-4 py-2 font-medium">{lang === "ar" ? "أُنشئ" : "Created"}</th>
                    <th className="text-end px-4 py-2 font-medium">{lang === "ar" ? "إجراءات" : "Actions"}</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => {
                    const canCancel = j.status === "running" || j.status === "pending" || j.status === "scheduled" || j.status === "paused";
                    const canRetry = j.status === "failed" || j.status === "cancelled";
                    return (
                      <tr key={`${j.kind}-${j.id}`} className="border-t border-border hover:bg-muted/30">
                        <td className="px-4 py-3"><KindBadge kind={j.kind} lang={lang} /></td>
                        <td className="px-4 py-3">
                          <div className="font-medium truncate max-w-[240px]">{j.title}</div>
                          {j.error_message && (
                            <div className="text-[11px] text-rose-600 truncate max-w-[240px] mt-0.5" title={j.error_message}>
                              {j.error_message}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                              {(j.user?.full_name?.[0] ?? "?").toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-medium truncate max-w-[140px]">{j.user?.full_name ?? "—"}</div>
                              <div className="text-[10px] text-muted-foreground uppercase">{j.user?.plan ?? "free"}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={j.status} lang={lang} /></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 min-w-[140px]">
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full ${j.status === "failed" ? "bg-rose-500" : j.status === "completed" ? "bg-emerald-500" : "bg-primary"}`}
                                style={{ width: `${Math.min(100, j.progress)}%` }}
                              />
                            </div>
                            <span className="text-[11px] tabular-nums text-muted-foreground w-16 text-end">
                              {j.processed}/{j.total || "?"}
                            </span>
                          </div>
                          {j.kind === "bulk" && j.failed > 0 && (
                            <div className="text-[10px] text-rose-600 mt-0.5">
                              {lang === "ar" ? `فشل ${j.failed}` : `${j.failed} failed`}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmt(j.created_at, lang)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {canRetry && (
                              <button
                                onClick={() => retryMut.mutate({ id: j.id, kind: j.kind })}
                                disabled={retryMut.isPending}
                                className="p-1.5 rounded-md hover:bg-primary/10 text-primary disabled:opacity-50"
                                title={lang === "ar" ? "إعادة المحاولة" : "Retry"}
                              >
                                <RefreshCw className="h-4 w-4" />
                              </button>
                            )}
                            {canCancel && (
                              <button
                                onClick={() => {
                                  if (confirm(lang === "ar" ? "تأكيد إلغاء المهمة؟" : "Cancel this job?")) {
                                    cancelMut.mutate({ id: j.id, kind: j.kind });
                                  }
                                }}
                                disabled={cancelMut.isPending}
                                className="p-1.5 rounded-md hover:bg-amber-500/10 text-amber-600 disabled:opacity-50"
                                title={lang === "ar" ? "إلغاء" : "Cancel"}
                              >
                                <Ban className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => {
                                if (confirm(lang === "ar" ? "حذف المهمة نهائياً؟" : "Delete this job permanently?")) {
                                  deleteMut.mutate({ id: j.id, kind: j.kind });
                                }
                              }}
                              disabled={deleteMut.isPending}
                              className="p-1.5 rounded-md hover:bg-rose-500/10 text-rose-600 disabled:opacity-50"
                              title={lang === "ar" ? "حذف" : "Delete"}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
