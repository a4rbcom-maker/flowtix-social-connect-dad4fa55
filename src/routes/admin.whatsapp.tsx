import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import {
  MessageCircle,
  Users,
  Smartphone,
  Inbox,
  Bot,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle,
  QrCode,
  Crown,
  Sparkles,
  Hash,
  Wifi,
  WifiOff,
  RefreshCw,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import { getAdminWhatsappOverview } from "@/lib/admin.functions";
import { pingWaBridge, type WaBridgeHealth } from "@/lib/wa.functions";

export const Route = createFileRoute("/admin/whatsapp")({
  ssr: false,
  component: AdminWhatsappPage,
});


const REFRESH_MS = 20_000;

function AdminWhatsappPage() {
  const { lang } = useI18n();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["admin", "whatsapp", "overview"],
    queryFn: () => getAdminWhatsappOverview(),
    refetchInterval: REFRESH_MS,
  });

  const totals = q.data?.totals;
  const filteredUsers = useMemo(() => {
    const list = q.data?.users ?? [];
    if (!search.trim()) return list;
    const s = search.toLowerCase();
    return list.filter(
      (u) =>
        (u.full_name ?? "").toLowerCase().includes(s) ||
        (u.session?.phone ?? "").toLowerCase().includes(s),
    );
  }, [q.data, search]);

  return (
    <AdminLayout title={t("مراقبة واتساب", "WhatsApp Monitoring")}>
      {q.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          <BridgeHealthCard t={t} lang={lang} />
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={Users}
              label={t("مستخدمون نشطون", "Active users")}
              value={totals?.users_with_wa ?? 0}
              tone="primary"
              hint={t("لديهم بيانات واتساب", "with WA data")}
            />

            <KpiCard
              icon={Smartphone}
              label={t("جلسات متصلة", "Connected sessions")}
              value={totals?.sessions_connected ?? 0}
              hint={`${totals?.sessions ?? 0} ${t("إجمالي", "total")}`}
              tone="emerald"
            />
            <KpiCard
              icon={QrCode}
              label={t("بانتظار مسح QR", "Waiting for QR")}
              value={totals?.sessions_qr ?? 0}
              tone="amber"
            />
            <KpiCard
              icon={Inbox}
              label={t("محادثات", "Conversations")}
              value={totals?.conversations ?? 0}
              hint={`${totals?.unread_total ?? 0} ${t("غير مقروء", "unread")}`}
              tone="blue"
            />
            <KpiCard
              icon={ArrowDownLeft}
              label={t("رسائل واردة (24س)", "Inbound (24h)")}
              value={totals?.msgs_in_24h ?? 0}
              tone="violet"
            />
            <KpiCard
              icon={ArrowUpRight}
              label={t("رسائل صادرة (24س)", "Outbound (24h)")}
              value={totals?.msgs_out_24h ?? 0}
              tone="cyan"
            />
            <KpiCard
              icon={Bot}
              label={t("ردود الذكاء (7أ)", "AI replies (7d)")}
              value={totals?.ai_calls_7d ?? 0}
              hint={`${totals?.ai_errors_7d ?? 0} ${t("خطأ", "errors")}`}
              tone="violet"
            />
            <KpiCard
              icon={Sparkles}
              label={t("توكِنز الذكاء (7أ)", "AI tokens (7d)")}
              value={totals?.ai_tokens_7d ?? 0}
              tone="amber"
            />
          </div>

          {/* Hourly traffic chart */}
          <HourlyChart data={q.data?.hourly ?? []} t={t} />

          {/* Recent messages */}
          <RecentMessages rows={q.data?.recentMessages ?? []} t={t} />
        </div>
      )}
    </AdminLayout>
  );
}

/* ---------------- helpers ---------------- */

function formatNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return n.toString();
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-start px-4 py-3 font-semibold">{children}</th>;
}

function Avatar({ name, url }: { name: string | null; url: string | null }) {
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  if (url) return <img src={url} alt={name ?? ""} className="h-9 w-9 rounded-full object-cover border border-border" />;
  return (
    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary/20 to-[oklch(0.66_0.26_320)]/20 flex items-center justify-center text-sm font-bold text-primary border border-primary/20">
      {initial}
    </div>
  );
}

type Tone = "primary" | "blue" | "emerald" | "violet" | "amber" | "red" | "cyan";
const TONE_BG: Record<Tone, string> = {
  primary: "from-primary/15 to-primary/5 text-primary",
  blue: "from-blue-500/15 to-blue-500/5 text-blue-600 dark:text-blue-400",
  emerald: "from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-400",
  violet: "from-violet-500/15 to-violet-500/5 text-violet-600 dark:text-violet-400",
  amber: "from-amber-500/15 to-amber-500/5 text-amber-600 dark:text-amber-400",
  red: "from-red-500/15 to-red-500/5 text-red-600 dark:text-red-400",
  cyan: "from-cyan-500/15 to-cyan-500/5 text-cyan-600 dark:text-cyan-400",
};

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  hint?: string;
  tone: Tone;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card p-4 hover:shadow-md transition-shadow"
    >
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${TONE_BG[tone]} flex items-center justify-center`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground truncate">{label}</div>
          <div className="text-2xl font-bold leading-tight">{formatNum(value)}</div>
          {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
        </div>
      </div>
    </motion.div>
  );
}

function SessionStatusBadge({ status, t }: { status: string | null; t: (ar: string, en: string) => string }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
        <XCircle className="h-3.5 w-3.5" />
        {t("لا توجد جلسة", "No session")}
      </span>
    );
  }
  const map: Record<string, { cls: string; icon: React.ComponentType<{ className?: string }>; ar: string; en: string }> = {
    connected: { cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", icon: CheckCircle2, ar: "متصل", en: "Connected" },
    connecting: { cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400", icon: Loader2, ar: "جاري الاتصال", en: "Connecting" },
    qr: { cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400", icon: QrCode, ar: "بانتظار QR", en: "Awaiting QR" },
    disconnected: { cls: "bg-muted text-muted-foreground", icon: XCircle, ar: "غير متصل", en: "Disconnected" },
  };
  const m = map[status] ?? { cls: "bg-muted text-muted-foreground", icon: Activity, ar: status, en: status };
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${m.cls}`}>
      <Icon className={`h-3.5 w-3.5 ${status === "connecting" ? "animate-spin" : ""}`} />
      {t(m.ar, m.en)}
    </span>
  );
}

function HourlyChart({ data, t }: { data: Array<{ hour: number; in: number; out: number }>; t: (ar: string, en: string) => string }) {
  const max = Math.max(1, ...data.map((d) => d.in + d.out));
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          {t("حركة الرسائل آخر 24 ساعة", "Message traffic — last 24h")}
        </h2>
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-violet-500" />
            {t("وارد", "Inbound")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-cyan-500" />
            {t("صادر", "Outbound")}
          </span>
        </div>
      </div>
      <div className="flex items-end gap-1 h-32">
        {data.map((d, i) => {
          const total = d.in + d.out;
          const totalPct = (total / max) * 100;
          const inPct = total ? (d.in / total) * 100 : 0;
          return (
            <div key={i} className="flex-1 flex flex-col justify-end group relative">
              <div
                className="w-full rounded-t flex flex-col-reverse overflow-hidden bg-muted/40"
                style={{ height: `${Math.max(2, totalPct)}%` }}
                title={`${total} (${d.in} in / ${d.out} out)`}
              >
                <div className="bg-violet-500" style={{ height: `${inPct}%` }} />
                <div className="bg-cyan-500 flex-1" />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5 px-0.5">
        <span>-24h</span>
        <span>-18h</span>
        <span>-12h</span>
        <span>-6h</span>
        <span>{t("الآن", "now")}</span>
      </div>
    </div>
  );
}

type ConvRow = {
  id: string;
  contact_name: string | null;
  contact_phone: string | null;
  last_message_text: string | null;
  last_message_at: string;
  unread_count: number;
  ai_enabled: boolean;
  user: { full_name: string | null; avatar_url: string | null; plan: string | null } | null;
};

function RecentConversations({ rows, t }: { rows: ConvRow[]; t: (ar: string, en: string) => string }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="font-bold text-base flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" />
          {t("أحدث المحادثات", "Recent conversations")}
        </h2>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
      </div>
      <div className="divide-y divide-border max-h-[420px] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{t("لا توجد محادثات", "No conversations yet")}</div>
        ) : (
          rows.map((c) => (
            <div key={c.id} className="px-5 py-3 hover:bg-muted/30 transition-colors">
              <div className="flex items-center justify-between gap-3 mb-1">
                <div className="min-w-0 flex items-center gap-2 flex-1">
                  <Avatar name={c.contact_name ?? c.contact_phone} url={null} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate flex items-center gap-1.5">
                      {c.contact_name || c.contact_phone || t("غير معروف", "Unknown")}
                      {c.ai_enabled && <Bot className="h-3 w-3 text-violet-500" />}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {c.user?.full_name ?? t("غير معروف", "Unknown")}
                    </div>
                  </div>
                </div>
                {c.unread_count > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                    {c.unread_count}
                  </span>
                )}
              </div>
              {c.last_message_text && (
                <div className="text-xs text-muted-foreground line-clamp-1 ps-11">
                  {c.last_message_text}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}


type MsgRow = {
  id: string;
  direction: string;
  remote_jid: string;
  msg_type: string;
  text_body: string | null;
  created_at: string;
  user: { full_name: string | null; avatar_url: string | null; plan: string | null } | null;
};

function RecentMessages({ rows, t }: { rows: MsgRow[]; t: (ar: string, en: string) => string }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="font-bold text-base flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" />
          {t("آخر الرسائل (مباشر)", "Latest messages (live)")}
        </h2>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
      </div>
      <div className="divide-y divide-border max-h-[360px] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{t("لا توجد رسائل", "No messages yet")}</div>
        ) : (
          rows.map((m) => (
            <div key={m.id} className="px-5 py-2.5 hover:bg-muted/30 transition-colors flex items-center gap-3">
              <span className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${m.direction === "in" ? "bg-violet-500/10 text-violet-600 dark:text-violet-400" : "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"}`}>
                {m.direction === "in" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium truncate">{m.user?.full_name ?? "—"}</span>
                  <span className="text-muted-foreground font-mono truncate">{m.remote_jid.split("@")[0]}</span>
                  {m.msg_type !== "text" && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{m.msg_type}</span>
                  )}
                </div>
                {m.text_body && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">{m.text_body}</div>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {new Date(m.created_at).toLocaleTimeString(t("ar-EG", "en-US"), { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function BridgeHealthCard({
  t,
  lang,
}: {
  t: (ar: string, en: string) => string;
  lang: "ar" | "en";
}) {
  const pingFn = useServerFn(pingWaBridge);
  const q = useQuery<WaBridgeHealth>({
    queryKey: ["admin", "wa-bridge", "health"],
    queryFn: () => pingFn(),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const mut = useMutation({
    mutationFn: () => pingFn(),
    onSuccess: (data) => {
      q.refetch();
      if (data.ok) {
        toast.success(t("البريدج متصل ✓", "Bridge is online ✓"), {
          description: `${data.latencyMs}ms${data.version ? ` · v${data.version}` : ""}`,
        });
      } else {
        toast.error(t("تعذّر الوصول للبريدج", "Bridge unreachable"), {
          description: data.error ?? undefined,
        });
      }
    },
    onError: (e: Error) =>
      toast.error(t("فشل الفحص", "Health check failed"), { description: e.message }),
  });

  const h = q.data;
  const loading = q.isLoading || mut.isPending;
  const online = !!h?.ok;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-xl ${
              online
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {online ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">
              {t("حالة بريدج واتساب — Bot-Xtra", "WhatsApp Bridge — Bot-Xtra")}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t(
                "اتصال الخادم الذي يستضيف جلسات واتساب.",
                "Connection to the server hosting WhatsApp sessions.",
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              online
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
            }`}
          >
            {online ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {online ? t("متصل", "Online") : t("غير متصل", "Offline")}
          </span>
          <button
            type="button"
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] px-4 text-xs font-semibold text-primary-foreground shadow hover:opacity-95 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${mut.isPending ? "animate-spin" : ""}`} />
            {t("فحص الاتصال", "Test connection")}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <ConfigRow
          icon={QrCode}
          label={t("مفتاح API", "API Key")}
          value={h?.hasApiKey ? t("مُهيّأ", "Configured") : t("غير مُهيّأ", "Missing")}
          ok={!!h?.hasApiKey}
        />
        <ConfigRow
          icon={Activity}
          label={t("سر الـ Webhook", "Webhook secret")}
          value={h?.hasWebhookSecret ? t("مُهيّأ", "Configured") : t("غير مُهيّأ", "Missing")}
          ok={!!h?.hasWebhookSecret}
        />
        <ConfigRow
          icon={Sparkles}
          label={t("زمن الاستجابة", "Latency")}
          value={
            h
              ? online
                ? `${h.latencyMs} ms${h.version ? ` · v${h.version}` : ""}`
                : (h.error ?? t("غير متاح", "Unavailable"))
              : "—"
          }
          ok={online}
        />
      </div>

      {!online && h && (
        <p
          className="mt-3 text-xs text-rose-600 dark:text-rose-400"
          dir={lang === "ar" ? "rtl" : "ltr"}
        >
          {t(
            "تأكّد أن قيم WA_BRIDGE_URL / WA_BRIDGE_API_KEY صحيحة في إعدادات الأسرار.",
            "Verify WA_BRIDGE_URL / WA_BRIDGE_API_KEY are set correctly in project secrets.",
          )}
        </p>
      )}
    </motion.div>
  );
}

function ConfigRow({
  icon: Icon,
  label,
  value,
  ok,
  monospace,
}: {
  icon: typeof Wifi;
  label: string;
  value: string;
  ok: boolean;
  monospace?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-background/60 p-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div
        className={`mt-1.5 truncate text-sm ${ok ? "text-foreground" : "text-muted-foreground"} ${monospace ? "font-mono" : "font-medium"}`}
        dir="ltr"
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
