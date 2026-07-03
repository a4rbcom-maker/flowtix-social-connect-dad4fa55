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
import { getAdminWhatsappOverview } from "@/lib/admin.functions";
import {
  adminListUserWaSessions,
  adminCleanupUserWaSession,
  adminBulkCleanupFlowtixDisconnected,
  adminListUsersWithBadWaSessions,
  adminSendWaTestMessage,
  adminSearchUsersForWaCleanup,
  adminGetWaSessionEvents,
} from "@/lib/admin.functions";

import { toast } from "sonner";
import { Send, X, History, ChevronDown, ChevronUp } from "lucide-react";


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

          <BulkCleanupCard t={t} />
          <SessionCleanupCard t={t} />

        </div>
      )}
    </AdminLayout>
  );
}

/* ---------------- Bulk cleanup (Flowtix-only) ---------------- */

function BulkCleanupCard({ t }: { t: (ar: string, en: string) => string }) {
  const [minAgeDays, setMinAgeDays] = useState(3);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof adminBulkCleanupFlowtixDisconnected>> | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const dryRun = useMutation({
    mutationFn: () =>
      adminBulkCleanupFlowtixDisconnected({ data: { minAgeDays, dryRun: true } }),
    onSuccess: (res) => {
      setPreview(res);
      setConfirmText("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const execute = useMutation({
    mutationFn: () =>
      adminBulkCleanupFlowtixDisconnected({ data: { minAgeDays, dryRun: false } }),
    onSuccess: (res) => {
      const remaining = res.remainingTotal ?? 0;
      if (remaining > 0) {
        toast.warning(
          t(
            `تم حذف ${res.bridgeDeleted} جلسة، وما زال ${remaining} ظاهرين بعد إعادة الفحص`,
            `Deleted ${res.bridgeDeleted} sessions; ${remaining} still remain after re-check`,
          ),
        );
        setPreview({
          dryRun: true,
          dbCandidateCount: res.remainingDbCandidateCount ?? 0,
          bridgeCandidateCount: res.remainingBridgeCandidateCount ?? 0,
          uniqueCandidateCount: remaining,
          bridgeError: res.bridgeError,
          preview: res.remainingPreview ?? [],
        });
      } else {
        toast.success(
          t(
            `تم التنظيف بالكامل — حُذف ${res.bridgeDeleted} من البريدج و ${res.dbDeleted} من قاعدة البيانات`,
            `Cleanup complete — deleted ${res.bridgeDeleted} on bridge and ${res.dbDeleted} in DB`,
          ),
        );
        setPreview(null);
      }
      if (res.bridgeFailed && res.bridgeFailed > 0) {
        toast.warning(
          t(`فشل حذف ${res.bridgeFailed} جلسة`, `${res.bridgeFailed} sessions failed to delete`),
        );
      }
      setConfirmText("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalCount = preview?.uniqueCandidateCount ?? preview?.bridgeCandidateCount ?? 0;

  const CONFIRM_WORD = "FLOWTIX";

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500/15 to-amber-500/5 text-amber-600 dark:text-amber-400 flex items-center justify-center">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-lg">
            {t("تنظيف جماعي للجلسات المفصولة", "Bulk cleanup of disconnected sessions")}
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t(
              "يحذف فقط الجلسات بادئة \"flowtix-\" المفصولة منذ فترة. لا يمس Bot-Xtra أو Xtra.",
              'Deletes only "flowtix-" prefixed sessions disconnected for a while. Never touches Bot-Xtra or Xtra.',
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm">
          {t("الأقدم من (أيام):", "Older than (days):")}
        </label>
        <input
          type="number"
          min={0}
          max={90}
          value={minAgeDays}
          onChange={(e) => {
            setMinAgeDays(Math.max(0, Math.min(90, Number(e.target.value) || 0)));
            setPreview(null);
          }}
          className="w-20 border border-border rounded-lg px-2 py-1 text-sm bg-background"
        />
        <button
          onClick={() => dryRun.mutate()}
          disabled={dryRun.isPending}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
        >
          {dryRun.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {t("معاينة (بدون حذف)", "Preview (no delete)")}
        </button>
      </div>

      {preview && (
        <div className="border border-border rounded-xl p-4 bg-background/50 space-y-3">
          {preview.bridgeError && (
            <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>{t("البريدج غير متاح:", "Bridge unavailable:")} {preview.bridgeError}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">{t("جلسات في قاعدة البيانات", "DB rows")}</div>
              <div className="text-2xl font-bold">{preview.dbCandidateCount ?? 0}</div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">{t("جلسات على البريدج", "Bridge sessions")}</div>
              <div className="text-2xl font-bold">{preview.bridgeCandidateCount ?? 0}</div>
            </div>
          </div>

          {preview.preview && preview.preview.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                {t("عرض أول 20 معرّف", "Show first 20 IDs")}
              </summary>
              <ul className="mt-2 space-y-0.5 font-mono text-[10px] max-h-40 overflow-y-auto">
                {preview.preview.map((id) => (
                  <li key={id} className="truncate">{id}</li>
                ))}
              </ul>
            </details>
          )}

          {totalCount > 0 ? (
            <div className="space-y-2 pt-2 border-t border-border">
              <label className="text-sm font-medium block">
                {t(
                  `للتأكيد اكتب "${CONFIRM_WORD}" ثم اضغط حذف`,
                  `Type "${CONFIRM_WORD}" to confirm, then click delete`,
                )}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={CONFIRM_WORD}
                  className="flex-1 border border-border rounded-lg px-3 py-2 text-sm bg-background font-mono"
                />
                <button
                  onClick={() => execute.mutate()}
                  disabled={confirmText !== CONFIRM_WORD || execute.isPending}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {execute.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  {t(`احذف ${totalCount} جلسة`, `Delete ${totalCount} sessions`)}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
              <CheckCircle2 className="h-4 w-4" />
              <span>{t("لا شيء للحذف — الكل نظيف ✨", "Nothing to delete — all clean ✨")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Session cleanup (per user) ---------------- */



function SessionCleanupCard({ t }: { t: (ar: string, en: string) => string }) {
  const [selectedUser, setSelectedUser] = useState<{ id: string; full_name: string | null } | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const qc = useQueryClient();

  const badUsersQ = useQuery({
    queryKey: ["admin", "wa-cleanup", "bad-users"],
    queryFn: () => adminListUsersWithBadWaSessions(),
    refetchInterval: 30_000,
    enabled: searchTerm.length === 0,
  });

  const searchQ = useQuery({
    queryKey: ["admin", "wa-cleanup", "search", searchTerm],
    queryFn: () => adminSearchUsersForWaCleanup({ data: { query: searchTerm } }),
    enabled: searchTerm.length > 0,
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
          `تم — البريدج: ${res.bridgeDeleted ? "✓" : "✗"} / DB: ${res.dbDeleted ? "✓" : "—"}`,
          `Done — bridge: ${res.bridgeDeleted ? "✓" : "✗"} / db: ${res.dbDeleted ? "✓" : "—"}`,
        ),
      );
      qc.invalidateQueries({ queryKey: ["admin", "wa-cleanup", "sessions", selectedUser?.id] });
      qc.invalidateQueries({ queryKey: ["admin", "wa-cleanup", "bad-users"] });
      qc.invalidateQueries({ queryKey: ["admin", "wa-cleanup", "search"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isSearching = searchTerm.length > 0;
  const activeQ = isSearching ? searchQ : badUsersQ;
  const users = activeQ.data?.users ?? [];

  const submitSearch = () => setSearchTerm(searchInput.trim());
  const clearSearch = () => {
    setSearchInput("");
    setSearchTerm("");
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-red-500/15 to-red-500/5 text-red-600 dark:text-red-400 flex items-center justify-center">
          <Trash2 className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-lg">
            {isSearching
              ? t("نتائج البحث", "Search results")
              : t("مستخدمون بجلسات مش شغالة", "Users with problematic sessions")}
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t(
              "ابحث بالاسم أو user_id أو رقم الهاتف — أو اترك الحقل فارغًا لعرض الجلسات المعلّقة تلقائيًا.",
              "Search by name, user_id, or phone — or leave empty to auto-list problematic sessions.",
            )}
          </p>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="h-4 w-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitSearch();
              if (e.key === "Escape") clearSearch();
            }}
            placeholder={t("اسم، user_id، أو رقم هاتف…", "Name, user_id, or phone…")}
            className="w-full ps-9 pe-9 py-2 text-sm border border-border rounded-lg bg-background"
          />
          {searchInput && (
            <button
              onClick={clearSearch}
              className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={t("مسح", "Clear")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={submitSearch}
          disabled={!searchInput.trim() || searchQ.isFetching}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {searchQ.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {t("بحث", "Search")}
        </button>
      </div>

      {activeQ.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : users.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-3">
          <CheckCircle2 className="h-4 w-4" />
          <span>
            {isSearching
              ? t("مفيش نتائج مطابقة", "No matching users")
              : t("كل المستخدمين جلساتهم شغالة ✨", "Everyone's sessions are healthy ✨")}
          </span>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden max-h-80 overflow-y-auto">
          <ul className="divide-y divide-border">
            {users.map((u) => {
              const isSelected = selectedUser?.id === u.userId;
              const ageDays = u.oldest
                ? Math.floor((Date.now() - Date.parse(u.oldest)) / 86_400_000)
                : 0;
              return (
                <li key={u.userId}>
                  <button
                    onClick={() => setSelectedUser({ id: u.userId, full_name: u.full_name })}
                    className={`w-full text-start px-3 py-2.5 text-sm hover:bg-muted flex items-center justify-between gap-2 ${
                      isSelected ? "bg-primary/10" : ""
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{u.full_name || u.userId.slice(0, 8)}</div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate">{u.userId}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {u.qr > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                          {u.qr} QR
                        </span>
                      )}
                      {u.disconnected > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30">
                          {u.disconnected} {t("مفصولة", "offline")}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {ageDays > 0 ? `${ageDays}${t("ي", "d")}` : t("جديد", "new")}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {selectedUser && (
        <div className="border border-border rounded-xl p-4 space-y-3 bg-background/50">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="font-semibold truncate">{selectedUser.full_name || selectedUser.id}</div>
              <div className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{selectedUser.id}</div>
            </div>
            <button
              onClick={() => setSelectedUser(null)}
              className="text-xs text-muted-foreground hover:text-foreground shrink-0"
            >
              {t("إغلاق", "Close")}
            </button>
          </div>

          {sessionsQ.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : sessionsQ.data ? (
            <>
              <SessionsList
                t={t}
                userId={selectedUser.id}
                data={sessionsQ.data}
                onDelete={(id) => {
                  if (confirm(t(`تأكيد حذف الجلسة ${id}?`, `Confirm delete session ${id}?`))) {
                    cleanup.mutate(id);
                  }
                }}
                deleting={cleanup.isPending ? cleanup.variables : null}
              />
              <TestSendCard t={t} userId={selectedUser.id} sessionsData={sessionsQ.data} />
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}



function SessionsList({
  t,
  userId,
  data,
  onDelete,
  deleting,
}: {
  t: (ar: string, en: string) => string;
  userId: string;
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
          <div key={r.session_id} className="border border-border rounded-lg bg-card overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs truncate">{r.session_id}</div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${badgeTone}`}>
                    {r.status ?? "unknown"}
                  </span>
                  {r.phone && <span className="text-xs text-muted-foreground">{r.phone}</span>}
                  <span className="text-[10px] text-muted-foreground">
                    {r.inDb ? "DB✓" : "DB✗"} · {r.inBridge ? "Bridge✓" : "Bridge✗"}
                  </span>
                  {r.updated_at && (
                    <span className="text-[10px] text-muted-foreground">
                      {t("آخر تحديث:", "updated:")} {formatWhen(r.updated_at)}
                    </span>
                  )}
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
            {r.inDb && (
              <SessionEventsHistory t={t} userId={userId} sessionId={r.session_id} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Session events history (per session) ---------------- */

function statusTone(s: string | null | undefined): string {
  if (!s) return "bg-muted text-muted-foreground border-border";
  if (s === "connected") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  if (s === "qr" || s === "pairing") return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
  if (s === "disconnected" || s === "logged_out" || s === "error") return "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30";
  return "bg-muted text-muted-foreground border-border";
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.round(diffMs / 60_000);
    if (mins < 1) return "الآن";
    if (mins < 60) return `${mins}د`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}س`;
    const days = Math.round(hrs / 24);
    if (days < 30) return `${days}ي`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

function SessionEventsHistory({
  t,
  userId,
  sessionId,
}: {
  t: (ar: string, en: string) => string;
  userId: string;
  sessionId: string;
}) {
  const [open, setOpen] = useState(false);
  const eventsQ = useQuery({
    queryKey: ["admin", "wa-cleanup", "events", userId, sessionId],
    queryFn: () => adminGetWaSessionEvents({ data: { userId, sessionId, limit: 50 } }),
    enabled: open,
  });
  const events = eventsQ.data?.events ?? [];

  return (
    <div className="border-t border-border bg-background/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <History className="h-3.5 w-3.5" />
          {t("سجل تغيّر الحالة", "Status change history")}
          {events.length > 0 && <span className="opacity-60">({events.length})</span>}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="px-3 pb-3">
          {eventsQ.isLoading ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </div>
          ) : events.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">
              {t("لا توجد أحداث مسجّلة لهذه الجلسة.", "No recorded events for this session.")}
            </div>
          ) : (
            <ol className="relative ps-4 space-y-2 max-h-64 overflow-y-auto pt-1">
              {events.map((e, i) => (
                <li key={e.id} className="relative">
                  <span
                    className={`absolute -start-4 top-1.5 h-2 w-2 rounded-full border ${statusTone(e.to_status).split(" ")[0]} border-current`}
                    aria-hidden
                  />
                  {i < events.length - 1 && (
                    <span className="absolute -start-[13px] top-3 bottom-[-8px] w-px bg-border" aria-hidden />
                  )}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {e.from_status && (
                      <>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${statusTone(e.from_status)}`}>
                          {e.from_status}
                        </span>
                        <span className="text-[10px] text-muted-foreground">→</span>
                      </>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${statusTone(e.to_status)}`}>
                      {e.to_status ?? "?"}
                    </span>
                    <span className="text-[10px] text-muted-foreground ms-auto">
                      {formatWhen(e.created_at)}
                    </span>
                  </div>
                  {(e.source || e.reason || e.bridge_event) && (
                    <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      {[e.source, e.bridge_event, e.reason].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Test send (per user) ---------------- */



function TestSendCard({
  t,
  userId,
  sessionsData,
}: {
  t: (ar: string, en: string) => string;
  userId: string;
  sessionsData: Awaited<ReturnType<typeof adminListUserWaSessions>>;
}) {
  const connected = sessionsData.bridgeSessions.find((b) => b.connected);
  const connectedId = connected?.id ?? null;

  const [to, setTo] = useState("");
  const [text, setText] = useState("");

  const send = useMutation({
    mutationFn: () =>
      adminSendWaTestMessage({
        data: {
          userId,
          to: to.trim(),
          text: text.trim() || undefined,
          sessionId: connectedId ?? undefined,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        t(
          `تم الإرسال إلى ${res.to} — ${res.providerMessageId ? "ID: " + res.providerMessageId : "بدون معرّف مزوّد"}`,
          `Sent to ${res.to} — ${res.providerMessageId ? "ID: " + res.providerMessageId : "no provider id"}`,
        ),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disabled = !connectedId || send.isPending || to.trim().length < 6;

  return (
    <div className="border border-border rounded-xl p-3 bg-background/60 space-y-2">
      <div className="flex items-center gap-2">
        <Send className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">
          {t("رسالة اختبار فورية", "Instant test message")}
        </span>
      </div>
      {!connectedId ? (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          {t(
            "لا توجد جلسة متصلة لهذا المستخدم — اطلب منه مسح QR أولاً.",
            "No connected session — ask the user to scan a QR first.",
          )}
        </div>
      ) : (
        <div className="text-[11px] text-muted-foreground font-mono truncate">
          {t("من الجلسة:", "from session:")} {connectedId}
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="tel"
          inputMode="numeric"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={t("رقم المستلم بالكود الدولي (2010...)", "Recipient phone with country code")}
          className="flex-1 border border-border rounded-lg px-3 py-2 text-sm bg-background"
        />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("نص اختياري — يوجد افتراضي", "Optional text — default provided")}
          className="flex-[2] border border-border rounded-lg px-3 py-2 text-sm bg-background"
        />
        <button
          onClick={() => {
            if (!/^\+?[0-9]{6,}$/.test(to.trim())) {
              toast.error(t("رقم غير صالح", "Invalid phone"));
              return;
            }
            send.mutate();
          }}
          disabled={disabled}
          className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {t("إرسال", "Send")}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t(
          "الردود القادمة من المستلم تُسجَّل في محادثات الوكيل تلقائيًا عبر الويبهوك.",
          "Replies from the recipient are automatically linked to the agent via the webhook.",
        )}
      </p>
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
