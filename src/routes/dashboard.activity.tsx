import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  MessageCircle,
  Facebook,
  Send,
  Settings,
  Trash2,
  RefreshCw,
  Search,
  CheckCheck,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useSendNotifications } from "@/hooks/useSendNotifications";
import { markAllRead, type SendChannel, type SendLogRow, type SendStatus } from "@/lib/notifications";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard/activity")({
  component: ActivityPage,
});

type ChannelFilter = "all" | SendChannel;
type StatusFilter = "all" | SendStatus;

function ActivityPage() {
  const { user, loading: authLoading } = useAuth();
  const { lang, dir } = useI18n();
  const { refresh } = useSendNotifications();
  const [rows, setRows] = useState<SendLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const t = lang === "ar"
    ? {
        title: "سجل النشاط",
        subtitle: "كل عمليات الإرسال (واتساب، فيسبوك، الإرسال الجماعي) في مكان واحد مع تحديثات لحظية",
        all: "الكل",
        whatsapp: "واتساب",
        facebook: "فيسبوك",
        bulk: "جماعي",
        system: "النظام",
        statusAll: "كل الحالات",
        success: "نجح",
        failed: "فشل",
        processing: "قيد المعالجة",
        pending: "في الانتظار",
        searchPh: "بحث في العنوان أو المستلم...",
        refresh: "تحديث",
        markAll: "تعليم الكل كمقروء",
        clearAll: "حذف السجل",
        confirmClear: "هل تريد حذف كل سجلات النشاط؟ لا يمكن التراجع.",
        cleared: "تم حذف السجل",
        empty: "لا توجد سجلات تطابق الفلترة",
        emptyDesc: "جرّب تغيير الفلاتر أو ابدأ أول عملية إرسال",
        total: "الإجمالي",
        successC: "نجحت",
        failedC: "فشلت",
        pendingC: "جارية",
        time: "الوقت",
        type: "النوع",
        action: "العملية",
        recipient: "المستلم",
        details: "التفاصيل",
        statusCol: "الحالة",
      }
    : {
        title: "Activity Log",
        subtitle: "All send activity (WhatsApp, Facebook, Bulk) in one place with live updates",
        all: "All",
        whatsapp: "WhatsApp",
        facebook: "Facebook",
        bulk: "Bulk",
        system: "System",
        statusAll: "All statuses",
        success: "Success",
        failed: "Failed",
        processing: "Processing",
        pending: "Pending",
        searchPh: "Search title or recipient...",
        refresh: "Refresh",
        markAll: "Mark all read",
        clearAll: "Clear log",
        confirmClear: "Delete the entire activity log? This cannot be undone.",
        cleared: "Log cleared",
        empty: "No records match your filters",
        emptyDesc: "Try changing the filters or trigger your first send",
        total: "Total",
        successC: "Success",
        failedC: "Failed",
        pendingC: "In progress",
        time: "Time",
        type: "Type",
        action: "Action",
        recipient: "Recipient",
        details: "Details",
        statusCol: "Status",
      };

  const fetchRows = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("send_log")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500);
    setRows(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (user) fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Live realtime updates for this page
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`activity_page:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "send_log", filter: `user_id=eq.${user.id}` },
        () => fetchRows()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (channel !== "all" && r.channel !== channel) return false;
      if (status !== "all" && r.status !== status) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.title} ${r.recipient ?? ""} ${r.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, channel, status, search]);

  const stats = useMemo(() => {
    return {
      total: rows.length,
      success: rows.filter((r) => r.status === "success").length,
      failed: rows.filter((r) => r.status === "failed").length,
      pending: rows.filter((r) => r.status === "pending" || r.status === "processing").length,
    };
  }, [rows]);

  const handleClear = async () => {
    if (!user) return;
    if (!confirm(t.confirmClear)) return;
    const { error } = await supabase.from("send_log").delete().eq("user_id", user.id);
    if (error) toast.error(error.message);
    else {
      toast.success(t.cleared);
      setRows([]);
      refresh();
    }
  };

  if (authLoading || !user) {
    return (
      <DashboardLayout title={t.title}>
        <div className="flex justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  const channelOptions: { v: ChannelFilter; label: string }[] = [
    { v: "all", label: t.all },
    { v: "whatsapp", label: t.whatsapp },
    { v: "facebook", label: t.facebook },
    { v: "bulk", label: t.bulk },
    { v: "system", label: t.system },
  ];
  const statusOptions: { v: StatusFilter; label: string; color: string }[] = [
    { v: "all", label: t.statusAll, color: "" },
    { v: "success", label: t.success, color: "text-green-600" },
    { v: "failed", label: t.failed, color: "text-destructive" },
    { v: "processing", label: t.processing, color: "text-blue-600" },
    { v: "pending", label: t.pending, color: "text-amber-600" },
  ];

  return (
    <DashboardLayout title={t.title}>
      <div dir={dir} className="space-y-6">
        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/10 via-card to-[oklch(0.66_0.26_320)]/10 p-6">
          <div className="absolute -end-10 -top-10 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-white shadow-lg">
                <Activity className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">{t.title}</h2>
                <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">{t.subtitle}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={fetchRows}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> {t.refresh}
              </button>
              <button
                onClick={() => markAllRead(user.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/15"
              >
                <CheckCheck className="h-4 w-4" /> {t.markAll}
              </button>
              <button
                onClick={handleClear}
                className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" /> {t.clearAll}
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label={t.total} value={stats.total} color="from-slate-500 to-slate-700" icon={Activity} />
          <StatCard label={t.successC} value={stats.success} color="from-green-500 to-emerald-600" icon={CheckCircle2} />
          <StatCard label={t.failedC} value={stats.failed} color="from-red-500 to-rose-600" icon={XCircle} />
          <StatCard label={t.pendingC} value={stats.pending} color="from-blue-500 to-cyan-600" icon={Loader2} />
        </div>

        {/* Filters */}
        <div className="rounded-2xl border border-border/50 bg-card p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.searchPh}
                className="w-full rounded-xl border border-input bg-background ps-10 pe-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {channelOptions.map((opt) => (
                <button
                  key={opt.v}
                  onClick={() => setChannel(opt.v)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    channel === opt.v
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                      : "border border-border bg-background text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            >
              {statusOptions.map((o) => (
                <option key={o.v} value={o.v}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* List */}
        <div className="overflow-hidden rounded-2xl border border-border/50 bg-card">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Activity className="h-6 w-6 text-muted-foreground/60" />
              </div>
              <p className="mt-4 text-base font-semibold text-foreground">{t.empty}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t.emptyDesc}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {filtered.map((row) => (
                <ActivityRow key={row.id} row={row} t={t} lang={lang} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function StatCard({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: typeof Activity;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-5 transition-all hover:shadow-lg">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br ${color} text-white shadow-md`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-3xl font-bold text-foreground">{value}</p>
    </div>
  );
}

const channelMeta: Record<SendChannel, { icon: typeof Facebook; color: string; label: { ar: string; en: string } }> = {
  whatsapp: { icon: MessageCircle, color: "from-green-500 to-emerald-600", label: { ar: "واتساب", en: "WhatsApp" } },
  facebook: { icon: Facebook, color: "from-primary to-[oklch(0.66_0.26_320)]", label: { ar: "فيسبوك", en: "Facebook" } },
  bulk: { icon: Send, color: "from-orange-500 to-amber-500", label: { ar: "جماعي", en: "Bulk" } },
  system: { icon: Settings, color: "from-slate-500 to-slate-700", label: { ar: "النظام", en: "System" } },
};

function ActivityRow({
  row,
  t,
  lang,
}: {
  row: SendLogRow;
  t: { success: string; failed: string; processing: string; pending: string };
  lang: "ar" | "en";
}) {
  const meta = channelMeta[row.channel as SendChannel] ?? channelMeta.system;
  const Icon = meta.icon;
  const status = row.status as SendStatus;
  return (
    <li className={`flex items-start gap-4 p-4 transition-colors hover:bg-accent/30 ${!row.read ? "bg-primary/5" : ""}`}>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${meta.color} text-white shadow-md`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-sm ${!row.read ? "font-bold text-foreground" : "font-semibold text-foreground/90"}`}>
            {row.title}
          </p>
          <StatusBadge status={status} t={t} />
          <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {meta.label[lang]}
          </span>
        </div>
        {row.recipient && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            <span className="font-medium text-foreground/70">→</span> {row.recipient}
          </p>
        )}
        {(row.description || row.error_message) && (
          <p className={`mt-1 text-xs ${row.error_message ? "text-destructive" : "text-muted-foreground"}`}>
            {row.error_message || row.description}
          </p>
        )}
        <p className="mt-1.5 text-[10px] text-muted-foreground/70">
          {new Date(row.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}
        </p>
      </div>
    </li>
  );
}

function StatusBadge({
  status,
  t,
}: {
  status: SendStatus;
  t: { success: string; failed: string; processing: string; pending: string };
}) {
  if (status === "success")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-bold text-green-700 dark:text-green-400">
        <CheckCircle2 className="h-3 w-3" /> {t.success}
      </span>
    );
  if (status === "failed")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
        <XCircle className="h-3 w-3" /> {t.failed}
      </span>
    );
  if (status === "processing")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:text-blue-400">
        <Loader2 className="h-3 w-3 animate-spin" /> {t.processing}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
      <Clock className="h-3 w-3" /> {t.pending}
    </span>
  );
}
