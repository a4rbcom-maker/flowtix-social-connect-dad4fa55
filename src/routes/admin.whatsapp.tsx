import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useState } from "react";
import {
  Users,
  Smartphone,
  Inbox,
  Bot,
  ArrowDownLeft,
  ArrowUpRight,
  QrCode,
  Sparkles,
  Loader2,
  Search,
  Trash2,
  ShieldAlert,
  CheckCircle2,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import { getAdminWhatsappOverview, listAdminUsers } from "@/lib/admin.functions";
import {
  adminListUserWaSessions,
  adminCleanupUserWaSession,
} from "@/lib/admin.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/whatsapp")({
  ssr: false,
  component: AdminWhatsappPage,
});

const REFRESH_MS = 30_000;

function AdminWhatsappPage() {
  const { lang } = useI18n();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);

  const q = useQuery({
    queryKey: ["admin", "whatsapp", "overview"],
    queryFn: () => getAdminWhatsappOverview(),
    refetchInterval: REFRESH_MS,
  });

  const totals = q.data?.totals;

  return (
    <AdminLayout title={t("تقارير واتساب", "WhatsApp Reports")}>
      {q.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* KPI cards — reports only */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={Users} label={t("مستخدمون نشطون", "Active users")} value={totals?.users_with_wa ?? 0} tone="primary" hint={t("لديهم بيانات واتساب", "with WA data")} />
            <KpiCard icon={Smartphone} label={t("جلسات متصلة", "Connected sessions")} value={totals?.sessions_connected ?? 0} hint={`${totals?.sessions ?? 0} ${t("إجمالي", "total")}`} tone="emerald" />
            <KpiCard icon={QrCode} label={t("بانتظار مسح QR", "Waiting for QR")} value={totals?.sessions_qr ?? 0} tone="amber" />
            <KpiCard icon={Inbox} label={t("محادثات", "Conversations")} value={totals?.conversations ?? 0} hint={`${totals?.unread_total ?? 0} ${t("غير مقروء", "unread")}`} tone="blue" />
            <KpiCard icon={ArrowDownLeft} label={t("رسائل واردة (24س)", "Inbound (24h)")} value={totals?.msgs_in_24h ?? 0} tone="violet" />
            <KpiCard icon={ArrowUpRight} label={t("رسائل صادرة (24س)", "Outbound (24h)")} value={totals?.msgs_out_24h ?? 0} tone="cyan" />
            <KpiCard icon={Bot} label={t("ردود الذكاء (7أ)", "AI replies (7d)")} value={totals?.ai_calls_7d ?? 0} hint={`${totals?.ai_errors_7d ?? 0} ${t("خطأ", "errors")}`} tone="violet" />
            <KpiCard icon={Sparkles} label={t("توكِنز الذكاء (7أ)", "AI tokens (7d)")} value={totals?.ai_tokens_7d ?? 0} tone="amber" />
          </div>

          <SessionCleanupCard t={t} />
        </div>
      )}
    </AdminLayout>
  );
}

/* ---------------- Session cleanup ---------------- */

function SessionCleanupCard({ t }: { t: (ar: string, en: string) => string }) {
  const [search, setSearch] = useState("");
  const [selectedUser, setSelectedUser] = useState<{ id: string; full_name: string | null } | null>(null);
  const qc = useQueryClient();

  const usersQ = useQuery({
    queryKey: ["admin", "wa-cleanup", "users", search],
    queryFn: () => listAdminUsers({ data: { search, limit: 20 } }),
    enabled: search.trim().length >= 2,
  });

  const sessionsQ = useQuery({
    queryKey: ["admin", "wa-cleanup", "sessions", selectedUser?.id],
    queryFn: () => adminListUserWaSessions({ data: { userId: selectedUser!.id } }),
    enabled: !!selectedUser,
  });

  const cleanup = useMutation({
    mutationFn: (sessionId: string) =>
      adminCleanupUserWaSession({ data: { userId: selectedUser!.id, sessionId } }),
    onSuccess: (res) => {
      toast.success(
        t(
          `تم الحذف — البريدج: ${res.bridgeDeleted ? "✓" : "✗"} / قاعدة البيانات: ${res.dbDeleted ? "✓" : "—"}`,
          `Deleted — bridge: ${res.bridgeDeleted ? "✓" : "✗"} / db: ${res.dbDeleted ? "✓" : "—"}`,
        ),
      );
      qc.invalidateQueries({ queryKey: ["admin", "wa-cleanup", "sessions", selectedUser?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-red-500/15 to-red-500/5 text-red-600 dark:text-red-400 flex items-center justify-center">
          <Trash2 className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-lg">{t("تنظيف جلسات مستخدم", "Cleanup user WA sessions")}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t(
              "احذف جلسات واتساب معلّقة أو مفصولة لمستخدم معيّن. آمن — لا يمس جلسات Bot-Xtra أو Xtra.",
              "Delete stuck/disconnected WA sessions for a specific user. Safe — never touches Bot-Xtra or Xtra tenants.",
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 border border-border rounded-xl px-3 py-2 bg-background">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("ابحث باسم المستخدم…", "Search by full name…")}
          className="flex-1 bg-transparent outline-none text-sm"
        />
      </div>

      {search.trim().length >= 2 && usersQ.data && (
        <div className="border border-border rounded-xl overflow-hidden">
          {usersQ.data.rows.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">{t("لا نتائج", "No results")}</div>
          ) : (
            <ul className="divide-y divide-border">
              {usersQ.data.rows.map((u) => (
                <li key={u.id}>
                  <button
                    onClick={() => setSelectedUser({ id: u.id, full_name: u.full_name })}
                    className={`w-full text-start px-3 py-2 text-sm hover:bg-muted flex items-center justify-between ${
                      selectedUser?.id === u.id ? "bg-primary/10" : ""
                    }`}
                  >
                    <span className="font-medium">{u.full_name || u.id.slice(0, 8)}</span>
                    <span className="text-xs text-muted-foreground">
                      {u.wa.connected}/{u.wa.count} {t("متصلة", "connected")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selectedUser && (
        <div className="border border-border rounded-xl p-4 space-y-3 bg-background/50">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">{selectedUser.full_name || selectedUser.id}</div>
              <div className="text-xs text-muted-foreground font-mono mt-0.5">{selectedUser.id}</div>
            </div>
            <button
              onClick={() => setSelectedUser(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t("إغلاق", "Close")}
            </button>
          </div>

          {sessionsQ.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : sessionsQ.data ? (
            <SessionsList
              t={t}
              data={sessionsQ.data}
              onDelete={(id) => {
                if (confirm(t(`تأكيد حذف الجلسة ${id}?`, `Confirm delete session ${id}?`))) {
                  cleanup.mutate(id);
                }
              }}
              deleting={cleanup.isPending ? cleanup.variables : null}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function SessionsList({
  t,
  data,
  onDelete,
  deleting,
}: {
  t: (ar: string, en: string) => string;
  data: Awaited<ReturnType<typeof adminListUserWaSessions>>;
  onDelete: (id: string) => void;
  deleting: string | null | undefined;
}) {
  // Merge DB + bridge into a single view keyed by session_id
  type Row = {
    session_id: string;
    inDb: boolean;
    inBridge: boolean;
    status: string | null;
    phone: string | null;
    connected: boolean;
    updated_at: string | null;
  };
  const map = new Map<string, Row>();
  for (const r of data.dbSessions) {
    map.set(r.session_id, {
      session_id: r.session_id,
      inDb: true,
      inBridge: false,
      status: r.status,
      phone: r.phone_number ?? null,
      connected: r.status === "connected",
      updated_at: r.updated_at,
    });
  }
  for (const b of data.bridgeSessions) {
    const existing = map.get(b.id);
    if (existing) {
      existing.inBridge = true;
      existing.connected = b.connected;
      existing.phone = existing.phone ?? b.phone;
    } else {
      map.set(b.id, {
        session_id: b.id,
        inDb: false,
        inBridge: true,
        status: b.connected ? "connected" : "bridge_only",
        phone: b.phone,
        connected: b.connected,
        updated_at: null,
      });
    }
  }
  const rows = Array.from(map.values());

  if (data.bridgeError) {
    return (
      <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
        <ShieldAlert className="h-4 w-4" />
        <span>{t("تعذّر الاتصال بالبريدج:", "Bridge unreachable:")} {data.bridgeError}</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
        <CheckCircle2 className="h-4 w-4" />
        <span>{t("لا توجد جلسات لهذا المستخدم — نظيف ✨", "No sessions for this user — clean ✨")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const isDeleting = deleting === r.session_id;
        const badgeTone = r.connected
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
          : r.status === "qr"
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
            : "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30";
        return (
          <div key={r.session_id} className="flex items-center justify-between gap-3 border border-border rounded-lg p-3 bg-card">
            <div className="min-w-0 flex-1">
              <div className="font-mono text-xs truncate">{r.session_id}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${badgeTone}`}>
                  {r.status ?? "unknown"}
                </span>
                {r.phone && <span className="text-xs text-muted-foreground">{r.phone}</span>}
                <span className="text-[10px] text-muted-foreground">
                  {r.inDb ? "DB✓" : "DB✗"} · {r.inBridge ? "Bridge✓" : "Bridge✗"}
                </span>
              </div>
            </div>
            <button
              onClick={() => onDelete(r.session_id)}
              disabled={isDeleting || r.connected}
              title={r.connected ? t("لا يمكن حذف جلسة متصلة", "Cannot delete a connected session") : ""}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {t("حذف", "Delete")}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- helpers ---------------- */

function formatNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return n.toString();
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
