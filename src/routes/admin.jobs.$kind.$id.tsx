import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  RefreshCw,
  Ban,
  Trash2,
  Download,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  PlayCircle,
  PauseCircle,
  Facebook,
  Send,
  User as UserIcon,
  Calendar,
  Activity,
  ListChecks,
  ScrollText,
  Search,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import {
  getAdminJobDetail,
  retryAdminJob,
  cancelAdminJob,
  deleteAdminJob,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/jobs/$kind/$id")({
  ssr: false,
  component: AdminJobDetailPage,
});

function StatusBadge({ status, lang }: { status: string; lang: "ar" | "en" }) {
  const map: Record<string, { ar: string; en: string; cls: string; Icon: typeof CheckCircle2 }> = {
    running: { ar: "قيد التشغيل", en: "Running", cls: "bg-blue-500/10 text-blue-600 border-blue-500/30", Icon: PlayCircle },
    pending: { ar: "في الانتظار", en: "Pending", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30", Icon: Clock },
    scheduled: { ar: "مجدول", en: "Scheduled", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30", Icon: Clock },
    completed: { ar: "مكتمل", en: "Completed", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", Icon: CheckCircle2 },
    success: { ar: "نجاح", en: "Success", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30", Icon: CheckCircle2 },
    failed: { ar: "فشل", en: "Failed", cls: "bg-rose-500/10 text-rose-600 border-rose-500/30", Icon: XCircle },
    cancelled: { ar: "ملغي", en: "Cancelled", cls: "bg-muted text-muted-foreground border-border", Icon: Ban },
    paused: { ar: "متوقف", en: "Paused", cls: "bg-purple-500/10 text-purple-600 border-purple-500/30", Icon: PauseCircle },
    skipped: { ar: "متخطى", en: "Skipped", cls: "bg-muted text-muted-foreground border-border", Icon: AlertCircle },
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

function fmtDate(d: string | null, lang: "ar" | "en"): string {
  if (!d) return "—";
  return new Date(d).toLocaleString(lang === "ar" ? "ar-EG" : "en-US");
}

function duration(start: string | null, end: string | null, lang: "ar" | "en"): string {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.max(0, Math.floor((e - s) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const r = sec % 60;
  if (h > 0) return lang === "ar" ? `${h}س ${m}د` : `${h}h ${m}m`;
  if (m > 0) return lang === "ar" ? `${m}د ${r}ث` : `${m}m ${r}s`;
  return lang === "ar" ? `${r}ث` : `${r}s`;
}

function Section({ title, icon: Icon, children, action }: { title: string; icon: typeof ListChecks; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="font-bold flex items-center gap-2 text-sm">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function AdminJobDetailPage() {
  const { lang, dir } = useI18n();
  const { kind, id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const jobKind = (kind === "bulk" ? "bulk" : "fb") as "fb" | "bulk";

  const fetchDetail = useServerFn(getAdminJobDetail);
  const retryFn = useServerFn(retryAdminJob);
  const cancelFn = useServerFn(cancelAdminJob);
  const deleteFn = useServerFn(deleteAdminJob);

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["admin", "jobs", "detail", jobKind, id],
    queryFn: () => fetchDetail({ data: { id, kind: jobKind } }),
    refetchInterval: 10_000,
  });

  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "jobs"] });

  const retryMut = useMutation({
    mutationFn: () => retryFn({ data: { id, kind: jobKind } }),
    onSuccess: () => { toast.success(lang === "ar" ? "تم إعادة الجدولة" : "Re-queued"); invalidate(); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelMut = useMutation({
    mutationFn: () => cancelFn({ data: { id, kind: jobKind } }),
    onSuccess: () => { toast.success(lang === "ar" ? "تم الإلغاء" : "Cancelled"); invalidate(); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: () => deleteFn({ data: { id, kind: jobKind } }),
    onSuccess: () => { toast.success(lang === "ar" ? "تم الحذف" : "Deleted"); invalidate(); navigate({ to: "/admin/jobs" }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = useMemo(() => {
    if (!data) return [] as Array<{ id: string; target: string; status: string; error: string | null; detail: string | null; at: string }>;
    if (data.kind === "fb") {
      return (data.results ?? []).map((r) => ({
        id: r.id,
        target: r.target ?? "—",
        status: r.status,
        error: r.error,
        detail: r.data_json,
        at: r.created_at,
      }));
    }
    return (data.recipients ?? []).map((r) => ({
      id: r.id,
      target: `${r.name} • ${r.phone}`,
      status: r.status,
      error: r.error_message,
      detail: null,
      at: r.sent_at ?? r.created_at,
    }));
  }, [data]);

  const filteredItems = useMemo(() => {
    let out = items;
    if (statusFilter) out = out.filter((i) => i.status === statusFilter);
    if (filter) {
      const s = filter.toLowerCase();
      out = out.filter((i) => i.target.toLowerCase().includes(s) || (i.error?.toLowerCase().includes(s) ?? false));
    }
    return out;
  }, [items, filter, statusFilter]);

  const downloadCsv = () => {
    const rows = [
      ["target", "status", "error", "at"],
      ...items.map((i) => [i.target, i.status, i.error ?? "", i.at]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-${id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <AdminLayout title={lang === "ar" ? "تفاصيل المهمة" : "Job Details"}>
        <div className="p-12 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </AdminLayout>
    );
  }

  if (error || !data) {
    return (
      <AdminLayout title={lang === "ar" ? "تفاصيل المهمة" : "Job Details"}>
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6 text-center">
          <AlertCircle className="h-8 w-8 text-rose-500 mx-auto mb-2" />
          <p className="text-sm">{(error as Error)?.message ?? (lang === "ar" ? "لم يتم العثور على المهمة" : "Job not found")}</p>
          <Link to="/admin/jobs" className="mt-4 inline-flex items-center gap-2 text-primary text-sm">
            <ArrowLeft className="h-4 w-4" />
            {lang === "ar" ? "العودة للمهام" : "Back to jobs"}
          </Link>
        </div>
      </AdminLayout>
    );
  }

  const j = data.job;
  const isFb = data.kind === "fb";
  const total = isFb ? (j as { total_items: number }).total_items : (j as { total_recipients: number }).total_recipients;
  const processed = isFb ? (j as { processed_items: number }).processed_items : ((j as { sent_count: number }).sent_count + (j as { failed_count: number }).failed_count);
  const progress = isFb ? (j as { progress: number }).progress : (total > 0 ? Math.round((processed / total) * 100) : 0);
  const canCancel = ["running", "pending", "scheduled", "paused"].includes(j.status);
  const canRetry = ["failed", "cancelled"].includes(j.status);

  const statusOptions = isFb
    ? [
        { v: "", ar: "الكل", en: "All" },
        { v: "success", ar: "ناجحة", en: "Success" },
        { v: "failed", ar: "فاشلة", en: "Failed" },
        { v: "skipped", ar: "متخطاة", en: "Skipped" },
      ]
    : [
        { v: "", ar: "الكل", en: "All" },
        { v: "success", ar: "تم الإرسال", en: "Sent" },
        { v: "failed", ar: "فشل", en: "Failed" },
        { v: "pending", ar: "في الانتظار", en: "Pending" },
      ];

  return (
    <AdminLayout title={lang === "ar" ? "تفاصيل المهمة" : "Job Details"}>
      <div className="space-y-5" dir={dir}>
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Link to="/admin/jobs" className="mt-1 p-2 rounded-lg hover:bg-muted">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${isFb ? "bg-blue-500/10 text-blue-600" : "bg-violet-500/10 text-violet-600"}`}>
                  {isFb ? <Facebook className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                  {isFb ? (lang === "ar" ? "فيسبوك" : "Facebook") : (lang === "ar" ? "إرسال جماعي" : "Bulk send")}
                </span>
                <StatusBadge status={j.status} lang={lang} />
              </div>
              <h1 className="text-xl font-bold truncate max-w-[600px]">
                {isFb ? (j as { job_type: string }).job_type : (j as { title: string }).title}
              </h1>
              <div className="text-xs text-muted-foreground font-mono mt-1">{j.id}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()} className="px-3 py-2 rounded-lg bg-muted hover:bg-muted/70 text-sm flex items-center gap-2">
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              {lang === "ar" ? "تحديث" : "Refresh"}
            </button>
            {canRetry && (
              <button onClick={() => retryMut.mutate()} disabled={retryMut.isPending} className="px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 text-sm flex items-center gap-2 disabled:opacity-50">
                <RefreshCw className="h-4 w-4" />
                {lang === "ar" ? "إعادة المحاولة" : "Retry"}
              </button>
            )}
            {canCancel && (
              <button onClick={() => { if (confirm(lang === "ar" ? "إلغاء المهمة؟" : "Cancel job?")) cancelMut.mutate(); }} disabled={cancelMut.isPending} className="px-3 py-2 rounded-lg bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 text-sm flex items-center gap-2 disabled:opacity-50">
                <Ban className="h-4 w-4" />
                {lang === "ar" ? "إلغاء" : "Cancel"}
              </button>
            )}
            <button onClick={() => { if (confirm(lang === "ar" ? "حذف نهائي؟" : "Delete permanently?")) deleteMut.mutate(); }} disabled={deleteMut.isPending} className="px-3 py-2 rounded-lg bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 text-sm flex items-center gap-2 disabled:opacity-50">
              <Trash2 className="h-4 w-4" />
              {lang === "ar" ? "حذف" : "Delete"}
            </button>
          </div>
        </div>

        {/* Progress + stats */}
        <div className="rounded-2xl border border-border bg-card/70 p-5 space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="font-semibold">{lang === "ar" ? "التقدم" : "Progress"}</span>
              <span className="tabular-nums text-muted-foreground">{processed}/{total || "?"} • {progress}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className={`h-full ${j.status === "failed" ? "bg-rose-500" : j.status === "completed" ? "bg-emerald-500" : "bg-primary"}`} style={{ width: `${Math.min(100, progress)}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 p-3">
              <div className="text-xs opacity-80">{lang === "ar" ? "نجاح" : "Success"}</div>
              <div className="text-xl font-bold tabular-nums">{data.counts.success}</div>
            </div>
            <div className="rounded-xl bg-rose-500/10 text-rose-700 dark:text-rose-400 p-3">
              <div className="text-xs opacity-80">{lang === "ar" ? "فشل" : "Failed"}</div>
              <div className="text-xl font-bold tabular-nums">{data.counts.failed}</div>
            </div>
            <div className="rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400 p-3">
              <div className="text-xs opacity-80">{lang === "ar" ? "في الانتظار / متخطى" : "Pending / Skipped"}</div>
              <div className="text-xl font-bold tabular-nums">
                {("pending" in data.counts ? data.counts.pending : 0) + (data.counts.skipped ?? 0)}
              </div>
            </div>
            <div className="rounded-xl bg-primary/10 text-primary p-3">
              <div className="text-xs opacity-80">{lang === "ar" ? "المدة" : "Duration"}</div>
              <div className="text-xl font-bold tabular-nums">{duration(j.started_at, j.completed_at, lang)}</div>
            </div>
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid md:grid-cols-2 gap-4">
          <Section title={lang === "ar" ? "المالك" : "Owner"} icon={UserIcon}>
            <div className="p-4 flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center font-bold text-primary">
                {(data.user?.full_name?.[0] ?? "?").toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="font-semibold truncate">{data.user?.full_name ?? "—"}</div>
                <div className="text-xs text-muted-foreground uppercase">{data.user?.plan ?? "free"}</div>
                <Link to="/admin/users" className="text-xs text-primary hover:underline mt-1 inline-block">
                  {lang === "ar" ? "عرض المستخدم" : "View user"}
                </Link>
              </div>
            </div>
          </Section>

          <Section title={lang === "ar" ? "التوقيتات" : "Timeline"} icon={Calendar}>
            <div className="p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{lang === "ar" ? "تم الإنشاء" : "Created"}</span><span className="tabular-nums">{fmtDate(j.created_at, lang)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{lang === "ar" ? "مجدول في" : "Scheduled"}</span><span className="tabular-nums">{fmtDate(j.scheduled_at, lang)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{lang === "ar" ? "بدأ في" : "Started"}</span><span className="tabular-nums">{fmtDate(j.started_at, lang)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{lang === "ar" ? "اكتمل في" : "Completed"}</span><span className="tabular-nums">{fmtDate(j.completed_at, lang)}</span></div>
              {!isFb && (
                <div className="flex justify-between"><span className="text-muted-foreground">{lang === "ar" ? "الإرسال التالي" : "Next send"}</span><span className="tabular-nums">{fmtDate((j as { next_send_at: string | null }).next_send_at, lang)}</span></div>
              )}
            </div>
          </Section>

          {isFb && data.campaign && (
            <Section title={lang === "ar" ? "الحملة المرتبطة" : "Linked Campaign"} icon={Activity}>
              <div className="p-4 space-y-1 text-sm">
                <div className="font-semibold">{data.campaign.name}</div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <StatusBadge status={data.campaign.status as string} lang={lang} />
                  <span className="text-muted-foreground">{data.campaign.target_kind}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                  <div className="rounded bg-muted p-2"><div className="text-muted-foreground">{lang === "ar" ? "الإجمالي" : "Total"}</div><div className="font-bold">{data.campaign.total_targets}</div></div>
                  <div className="rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 p-2"><div className="opacity-80">{lang === "ar" ? "نجاح" : "Success"}</div><div className="font-bold">{data.campaign.success_count}</div></div>
                  <div className="rounded bg-rose-500/10 text-rose-700 dark:text-rose-400 p-2"><div className="opacity-80">{lang === "ar" ? "فشل" : "Failed"}</div><div className="font-bold">{data.campaign.failed_count}</div></div>
                </div>
              </div>
            </Section>
          )}

          {isFb && data.account && (
            <Section title={lang === "ar" ? "حساب البوت" : "Bot Account"} icon={UserIcon}>
              <div className="p-4 space-y-1 text-sm">
                <div className="font-semibold">{data.account.display_name}</div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <StatusBadge status={data.account.status as string} lang={lang} />
                  <span className="text-muted-foreground">{data.account.auth_method}</span>
                </div>
                {data.account.last_error && (
                  <div className="text-xs text-rose-600 mt-2 break-words">{data.account.last_error}</div>
                )}
              </div>
            </Section>
          )}
        </div>

        {/* Error banner */}
        {j.error_message && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 flex items-start gap-3">
            <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="font-semibold text-rose-700 dark:text-rose-400 text-sm mb-1">{lang === "ar" ? "خطأ المهمة" : "Job error"}</div>
              <pre className="text-xs whitespace-pre-wrap break-words text-rose-700 dark:text-rose-300">{j.error_message}</pre>
            </div>
          </div>
        )}

        {/* Payload / message */}
        <Section title={isFb ? (lang === "ar" ? "حمولة المهمة" : "Payload") : (lang === "ar" ? "محتوى الرسالة" : "Message content")} icon={ScrollText}>
          <div className="p-4">
            {isFb ? (
              <pre className="text-xs bg-muted/40 rounded-lg p-3 overflow-auto max-h-72 whitespace-pre-wrap break-words font-mono">
                {(j as { payload_json: string }).payload_json}
              </pre>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">{lang === "ar" ? "النص" : "Text"}</div>
                  <pre className="text-sm bg-muted/40 rounded-lg p-3 whitespace-pre-wrap break-words">{(j as { message: string }).message}</pre>
                </div>
                {(j as { image_url: string | null }).image_url && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">{lang === "ar" ? "صورة" : "Image"}</div>
                    <img src={(j as { image_url: string }).image_url} alt="" className="max-h-48 rounded-lg border border-border" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded bg-muted p-2"><div className="text-muted-foreground">{lang === "ar" ? "القناة" : "Channel"}</div><div className="font-bold">{(j as { channel: string }).channel}</div></div>
                  <div className="rounded bg-muted p-2"><div className="text-muted-foreground">{lang === "ar" ? "الفاصل بين الإرسال" : "Interval"}</div><div className="font-bold">{(j as { interval_seconds: number }).interval_seconds}s</div></div>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* Per-target log */}
        <Section
          title={isFb ? (lang === "ar" ? "سجل الخطوات" : "Step log") : (lang === "ar" ? "سجل المستلمين" : "Recipients log")}
          icon={ListChecks}
          action={
            <button onClick={downloadCsv} className="text-xs flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted hover:bg-muted/70">
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
          }
        >
          <div className="p-3 flex flex-wrap gap-2 border-b border-border">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute top-1/2 -translate-y-1/2 start-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={lang === "ar" ? "بحث في الهدف أو الخطأ…" : "Search target or error…"}
                className="w-full ps-8 pe-3 py-1.5 rounded-md bg-background border border-border text-xs"
              />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-2 py-1.5 rounded-md bg-background border border-border text-xs">
              {statusOptions.map((s) => <option key={s.v} value={s.v}>{lang === "ar" ? s.ar : s.en}</option>)}
            </select>
            <span className="text-xs text-muted-foreground self-center">{filteredItems.length} / {items.length}</span>
          </div>
          {filteredItems.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {lang === "ar" ? "لا توجد عناصر بعد" : "No entries yet"}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground sticky top-0">
                  <tr>
                    <th className="text-start px-4 py-2 font-medium">{lang === "ar" ? "الهدف" : "Target"}</th>
                    <th className="text-start px-4 py-2 font-medium">{lang === "ar" ? "الحالة" : "Status"}</th>
                    <th className="text-start px-4 py-2 font-medium">{lang === "ar" ? "التفاصيل / الخطأ" : "Details / Error"}</th>
                    <th className="text-start px-4 py-2 font-medium whitespace-nowrap">{lang === "ar" ? "الوقت" : "Time"}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((i) => (
                    <tr key={i.id} className="border-t border-border hover:bg-muted/30 align-top">
                      <td className="px-4 py-2 font-mono text-xs break-all max-w-[240px]">{i.target}</td>
                      <td className="px-4 py-2"><StatusBadge status={i.status} lang={lang} /></td>
                      <td className="px-4 py-2 text-xs max-w-[400px]">
                        {i.error ? (
                          <span className="text-rose-600 break-words">{i.error}</span>
                        ) : i.detail ? (
                          <code className="text-muted-foreground break-words">{i.detail.slice(0, 200)}{i.detail.length > 200 ? "…" : ""}</code>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(i.at, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Related attempts (FB only) */}
        {isFb && "related_attempts" in data && data.related_attempts.length > 0 && (
          <Section title={lang === "ar" ? "المحاولات السابقة لنفس الحملة" : "Previous attempts (same campaign)"} icon={RefreshCw}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-start px-4 py-2 font-medium">ID</th>
                    <th className="text-start px-4 py-2 font-medium">{lang === "ar" ? "الحالة" : "Status"}</th>
                    <th className="text-start px-4 py-2 font-medium">{lang === "ar" ? "التقدم" : "Progress"}</th>
                    <th className="text-start px-4 py-2 font-medium">{lang === "ar" ? "خطأ" : "Error"}</th>
                    <th className="text-start px-4 py-2 font-medium">{lang === "ar" ? "أُنشئت" : "Created"}</th>
                    <th className="text-end px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.related_attempts.map((r) => (
                    <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-4 py-2 font-mono text-[11px]">{r.id.slice(0, 8)}…</td>
                      <td className="px-4 py-2"><StatusBadge status={r.status} lang={lang} /></td>
                      <td className="px-4 py-2 text-xs tabular-nums">{r.processed_items}/{r.total_items || "?"} • {r.progress}%</td>
                      <td className="px-4 py-2 text-xs text-rose-600 max-w-[280px] truncate" title={r.error_message ?? ""}>{r.error_message ?? "—"}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.created_at, lang)}</td>
                      <td className="px-4 py-2 text-end">
                        <Link to="/admin/jobs/$kind/$id" params={{ kind: "fb", id: r.id }} className="text-xs text-primary hover:underline">
                          {lang === "ar" ? "عرض" : "Open"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* Admin actions audit */}
        <Section title={lang === "ar" ? "إجراءات الإدارة على هذه المهمة" : "Admin actions on this job"} icon={ScrollText}>
          {data.audit.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا توجد إجراءات إدارية مسجلة" : "No admin actions recorded"}</div>
          ) : (
            <ul className="divide-y divide-border">
              {data.audit.map((a) => (
                <li key={a.id} className="px-4 py-3 flex items-start gap-3 text-sm">
                  <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                    {a.action.includes("retry") ? <RefreshCw className="h-4 w-4" /> : a.action.includes("cancel") ? <Ban className="h-4 w-4" /> : a.action.includes("delete") ? <Trash2 className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{a.action}</span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(a.created_at, lang)}</span>
                    </div>
                    <code className="text-[11px] text-muted-foreground break-all">{a.payload_json}</code>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </AdminLayout>
  );
}
