import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Users,
  Send,
  Clock,
  Facebook,
  MessageCircle,
  Layers,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  CalendarClock,
  Trash2,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { toast } from "sonner";
import { fetchFacebookGroups, getFacebookConnection } from "@/lib/facebook.functions";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/control")({
  ssr: false,
  component: ControlPanel,
});

type SendLog = Tables<"send_log">;
type Scheduled = Tables<"scheduled_messages">;

interface FbGroup {
  id: string;
  name: string;
  member_count?: number;
  privacy?: string;
}

type Channel = "facebook" | "whatsapp" | "bulk" | "system";
type Status = "pending" | "processing" | "success" | "failed";

function ControlPanel() {
  const { user, loading: authLoading } = useAuth();
  const { lang, dir } = useI18n();
  const navigate = useNavigate();

  const [fbConnected, setFbConnected] = useState<boolean | null>(null);
  const [groups, setGroups] = useState<FbGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [logs, setLogs] = useState<SendLog[]>([]);
  const [scheduled, setScheduled] = useState<Scheduled[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const t = lang === "ar"
    ? {
        title: "لوحة تحكم العميل",
        subtitle: "نظرة شاملة على جروباتك ورسائلك المجدولة وحالة الإرسال لكل قناة",
        groups: "جروبات فيسبوك",
        groupsDesc: "الجروبات المستوردة من حسابك",
        importGroups: "استيراد الجروبات",
        importing: "جاري الاستيراد...",
        notConnected: "حسابك غير مرتبط بفيسبوك",
        connectFirst: "اربط الحساب",
        noGroups: "لم يتم استيراد أي جروبات بعد",
        members: "عضو",
        scheduled: "الرسائل المجدولة",
        scheduledDesc: "رسائل ستُرسل في الوقت المحدد تلقائياً",
        noScheduled: "لا توجد رسائل مجدولة حالياً",
        addSchedule: "جدولة رسالة",
        recipients: "مستلم",
        cancel: "إلغاء",
        cancelled: "تم الإلغاء",
        deleteConfirm: "هل تريد إلغاء هذه الرسالة المجدولة؟",
        statusByChannel: "حالة الإرسال حسب القناة",
        statusDesc: "إجمالي العمليات في كل قناة (آخر 100 عملية)",
        facebook: "فيسبوك",
        whatsapp: "واتساب",
        bulk: "إرسال جماعي",
        system: "النظام",
        success: "نجح",
        failed: "فشل",
        processing: "قيد المعالجة",
        pending: "قيد الانتظار",
        total: "الإجمالي",
        viewActivity: "عرض السجل الكامل",
        viewAll: "عرض الكل",
        scheduledStatus: { scheduled: "مجدولة", sending: "قيد الإرسال", sent: "أُرسلت", failed: "فشلت", cancelled: "ملغاة" } as Record<string, string>,
        empty: "ابدأ بربط حسابك واستيراد جروباتك من صفحة فيسبوك",
        refresh: "تحديث",
      }
    : {
        title: "Control Panel",
        subtitle: "A complete view of your groups, scheduled messages, and send status per channel",
        groups: "Facebook Groups",
        groupsDesc: "Groups imported from your account",
        importGroups: "Import Groups",
        importing: "Importing...",
        notConnected: "Facebook is not connected",
        connectFirst: "Connect now",
        noGroups: "No groups imported yet",
        members: "members",
        scheduled: "Scheduled Messages",
        scheduledDesc: "Messages that will be sent automatically at the scheduled time",
        noScheduled: "No scheduled messages",
        addSchedule: "Schedule a message",
        recipients: "recipients",
        cancel: "Cancel",
        cancelled: "Cancelled",
        deleteConfirm: "Cancel this scheduled message?",
        statusByChannel: "Send status by channel",
        statusDesc: "Operation totals per channel (latest 100 entries)",
        facebook: "Facebook",
        whatsapp: "WhatsApp",
        bulk: "Bulk send",
        system: "System",
        success: "Success",
        failed: "Failed",
        processing: "Processing",
        pending: "Pending",
        total: "Total",
        viewActivity: "View full activity log",
        viewAll: "View all",
        scheduledStatus: { scheduled: "Scheduled", sending: "Sending", sent: "Sent", failed: "Failed", cancelled: "Cancelled" } as Record<string, string>,
        empty: "Start by connecting your account and importing groups from the Facebook page",
        refresh: "Refresh",
      };

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [user, authLoading, navigate]);

  const callServerFn = async <T,>(fn: (opts: never) => Promise<T>, body?: unknown): Promise<T> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return fn({
      data: body,
      headers: { Authorization: `Bearer ${session.access_token}` },
    } as never);
  };

  // Initial load: connection + scheduled + recent logs
  const loadData = async () => {
    if (!user) return;
    setLoadingData(true);
    try {
      const [connRes, schedRes, logsRes] = await Promise.all([
        callServerFn(getFacebookConnection).catch(() => ({ connection: null })),
        supabase
          .from("scheduled_messages")
          .select("*")
          .eq("user_id", user.id)
          .order("scheduled_at", { ascending: true })
          .limit(20),
        supabase
          .from("send_log")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      setFbConnected(!!connRes.connection);
      setScheduled(schedRes.data ?? []);
      setLogs(logsRes.data ?? []);
    } catch (err) {
      console.error("Load control panel data failed", err);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Realtime: refresh logs/scheduled on any change
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`control-panel:${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "send_log", filter: `user_id=eq.${user.id}` }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "scheduled_messages", filter: `user_id=eq.${user.id}` }, loadData)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleImportGroups = async () => {
    setLoadingGroups(true);
    try {
      const res = await callServerFn(fetchFacebookGroups);
      setGroups(res.groups);
      toast.success(
        lang === "ar" ? `تم استيراد ${res.groups.length} جروب` : `Imported ${res.groups.length} groups`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Import failed";
      toast.error(msg);
    } finally {
      setLoadingGroups(false);
    }
  };

  const cancelSchedule = async (id: string) => {
    if (!confirm(t.deleteConfirm)) return;
    const { error } = await supabase
      .from("scheduled_messages")
      .update({ status: "cancelled" })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t.cancelled);
    loadData();
  };

  // Aggregate logs per channel
  const channelStats = useMemo(() => {
    const channels: Channel[] = ["facebook", "whatsapp", "bulk", "system"];
    return channels.map((c) => {
      const items = logs.filter((l) => l.channel === c);
      const counts: Record<Status, number> = { pending: 0, processing: 0, success: 0, failed: 0 };
      for (const l of items) counts[l.status as Status] = (counts[l.status as Status] ?? 0) + 1;
      return { channel: c, total: items.length, counts };
    });
  }, [logs]);

  const channelMeta: Record<Channel, { icon: typeof Facebook; label: string; gradient: string }> = {
    facebook: { icon: Facebook, label: t.facebook, gradient: "from-[oklch(0.55_0.22_260)] to-[oklch(0.62_0.27_295)]" },
    whatsapp: { icon: MessageCircle, label: t.whatsapp, gradient: "from-green-500 to-emerald-600" },
    bulk: { icon: Layers, label: t.bulk, gradient: "from-orange-500 to-amber-500" },
    system: { icon: TrendingUp, label: t.system, gradient: "from-slate-500 to-slate-700" },
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(lang === "ar" ? "ar-EG" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  if (authLoading || !user) return null;

  return (
    <DashboardLayout title={t.title}>
      <div dir={dir} className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">{t.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
          </div>
          <button
            onClick={loadData}
            disabled={loadingData}
            className="inline-flex items-center gap-2 self-start rounded-xl border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-60"
          >
            {loadingData ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t.refresh}
          </button>
        </div>

        {/* Send status by channel */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-foreground">{t.statusByChannel}</h3>
              <p className="text-xs text-muted-foreground">{t.statusDesc}</p>
            </div>
            <Link to="/dashboard/activity" className="text-sm font-semibold text-primary hover:underline">
              {t.viewActivity} →
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {channelStats.map(({ channel, total, counts }) => {
              const meta = channelMeta[channel];
              const Icon = meta.icon;
              const successRate = total > 0 ? Math.round((counts.success / total) * 100) : 0;
              return (
                <div key={channel} className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${meta.gradient} text-white shadow-sm`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">{meta.label}</p>
                      <p className="text-xs text-muted-foreground">{t.total}: {total}</p>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all"
                      style={{ width: `${successRate}%` }}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <StatChip icon={CheckCircle2} label={t.success} value={counts.success} color="text-green-600 dark:text-green-400" />
                    <StatChip icon={XCircle} label={t.failed} value={counts.failed} color="text-destructive" />
                    <StatChip icon={Loader2} label={t.processing} value={counts.processing} color="text-primary" />
                    <StatChip icon={Clock} label={t.pending} value={counts.pending} color="text-muted-foreground" />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Two columns: Groups + Scheduled */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Groups */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <div>
                  <h3 className="font-semibold text-foreground">{t.groups}</h3>
                  <p className="text-xs text-muted-foreground">{t.groupsDesc}</p>
                </div>
              </div>
              {fbConnected && (
                <button
                  onClick={handleImportGroups}
                  disabled={loadingGroups}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {loadingGroups ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {loadingGroups ? t.importing : t.importGroups}
                </button>
              )}
            </div>

            {fbConnected === false && (
              <div className="rounded-xl border border-dashed border-border bg-background/50 p-6 text-center">
                <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-sm text-foreground">{t.notConnected}</p>
                <Link
                  to="/dashboard/facebook"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  {t.connectFirst}
                </Link>
              </div>
            )}

            {fbConnected && groups.length === 0 && (
              <div className="rounded-xl border border-dashed border-border bg-background/50 p-6 text-center text-sm text-muted-foreground">
                {t.noGroups}
              </div>
            )}

            {groups.length > 0 && (
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {groups.map((g) => (
                  <div key={g.id} className="flex items-center gap-3 rounded-lg border border-border bg-background/50 p-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Users className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{g.name}</p>
                      {typeof g.member_count === "number" && (
                        <p className="text-xs text-muted-foreground">
                          {g.member_count.toLocaleString()} {t.members}
                        </p>
                      )}
                    </div>
                    {g.privacy && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {g.privacy}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {fbConnected && (
              <Link
                to="/dashboard/facebook/groups"
                className="mt-3 inline-block text-xs font-semibold text-primary hover:underline"
              >
                {t.viewAll} →
              </Link>
            )}
          </section>

          {/* Scheduled messages */}
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-semibold text-foreground">{t.scheduled}</h3>
                <p className="text-xs text-muted-foreground">{t.scheduledDesc}</p>
              </div>
            </div>

            {scheduled.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-background/50 p-6 text-center text-sm text-muted-foreground">
                {t.noScheduled}
              </div>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {scheduled.map((m) => {
                  const meta = channelMeta[(m.channel as Channel) ?? "system"];
                  const Icon = meta.icon;
                  const recipientCount = Array.isArray(m.recipients) ? m.recipients.length : 0;
                  const statusColor =
                    m.status === "sent" ? "bg-green-500/10 text-green-600 dark:text-green-400"
                    : m.status === "failed" ? "bg-destructive/10 text-destructive"
                    : m.status === "cancelled" ? "bg-muted text-muted-foreground"
                    : m.status === "sending" ? "bg-primary/10 text-primary"
                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400";
                  return (
                    <div key={m.id} className="rounded-lg border border-border bg-background/50 p-3">
                      <div className="flex items-start gap-3">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${meta.gradient} text-white`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{m.title}</p>
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{m.message}</p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {formatDate(m.scheduled_at)}
                            </span>
                            {recipientCount > 0 && (
                              <span className="text-muted-foreground">• {recipientCount} {t.recipients}</span>
                            )}
                            <span className={`rounded-full px-2 py-0.5 font-medium ${statusColor}`}>
                              {t.scheduledStatus[m.status] ?? m.status}
                            </span>
                          </div>
                        </div>
                        {(m.status === "scheduled" || m.status === "sending") && (
                          <button
                            onClick={() => cancelSchedule(m.id)}
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            aria-label={t.cancel}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}

function StatChip({
  icon: Icon, label, value, color,
}: { icon: typeof CheckCircle2; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-background/60 px-2 py-1.5">
      <Icon className={`h-3.5 w-3.5 ${color}`} />
      <span className="text-muted-foreground">{label}</span>
      <span className={`ms-auto font-bold ${color}`}>{value}</span>
    </div>
  );
}

// Suppress unused imports warnings for icons consumed dynamically above
void Send; void XCircle; void Loader2;
