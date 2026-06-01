import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Facebook,
  Users,
  Bot,
  Megaphone,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  Search,
  TrendingUp,
  AlertTriangle,
  Mail,
  Crown,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import { getAdminFacebookOverview } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/facebook")({
  ssr: false,
  component: AdminFacebookPage,
});

const REFRESH_MS = 30_000;

function AdminFacebookPage() {
  const { lang } = useI18n();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["admin", "facebook", "overview"],
    queryFn: () => getAdminFacebookOverview(),
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
        (u.connection?.email ?? "").toLowerCase().includes(s) ||
        (u.connection?.name ?? "").toLowerCase().includes(s),
    );
  }, [q.data, search]);

  return (
    <AdminLayout title={t("مراقبة فيسبوك", "Facebook Monitoring")}>
      {q.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={Users}
              label={t("مستخدمون نشطون", "Active users")}
              value={totals?.users_with_fb ?? 0}
              tone="primary"
              hint={t("لديهم بيانات فيسبوك", "with FB data")}
            />
            <KpiCard
              icon={Facebook}
              label={t("ربط فيسبوك", "FB connections")}
              value={totals?.connections ?? 0}
              tone="blue"
            />
            <KpiCard
              icon={Bot}
              label={t("حسابات البوت", "Bot accounts")}
              value={totals?.bot_accounts ?? 0}
              hint={`${totals?.bot_accounts_active ?? 0} ${t("نشط", "active")}`}
              tone="emerald"
            />
            <KpiCard
              icon={Megaphone}
              label={t("الحملات", "Campaigns")}
              value={totals?.campaigns_total ?? 0}
              hint={`${totals?.campaigns_running ?? 0} ${t("قيد التشغيل", "running")}`}
              tone="violet"
            />
            <KpiCard
              icon={Activity}
              label={t("مهام قيد التنفيذ", "Jobs running")}
              value={totals?.jobs_running ?? 0}
              tone="amber"
            />
            <KpiCard
              icon={AlertTriangle}
              label={t("مهام فاشلة", "Failed jobs")}
              value={totals?.jobs_failed ?? 0}
              tone="red"
            />
          </div>

          {/* Search */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="relative">
              <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("ابحث باسم المستخدم أو البريد...", "Search by name or email...")}
                className="w-full rounded-lg border border-input bg-background py-2.5 ps-10 pe-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          {/* Per-user table */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 className="font-bold text-base">{t("النشاط لكل مستخدم", "Per-user Activity")}</h2>
              <span className="text-xs text-muted-foreground">{filteredUsers.length} {t("مستخدم", "users")}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr className="text-xs uppercase tracking-wider">
                    <Th>{t("المستخدم", "User")}</Th>
                    <Th>{t("ربط FB", "FB connect")}</Th>
                    <Th>{t("حسابات البوت", "Bot accts")}</Th>
                    <Th>{t("الحملات", "Campaigns")}</Th>
                    <Th>{t("نجاح / فشل", "OK / Fail")}</Th>
                    <Th>{t("مهام نشطة", "Active jobs")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-muted-foreground">
                        {t("لا توجد بيانات", "No data yet")}
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => (
                      <tr key={u.user_id} className="border-t border-border hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={u.full_name} url={u.avatar_url} />
                            <div className="min-w-0">
                              <div className="font-medium truncate flex items-center gap-1.5">
                                {u.full_name || t("بدون اسم", "Unnamed")}
                                {u.plan && u.plan !== "free" && (
                                  <Crown className="h-3.5 w-3.5 text-amber-500" />
                                )}
                              </div>
                              {u.connection?.email && (
                                <div className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                                  <Mail className="h-3 w-3" />
                                  {u.connection.email}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {u.connection ? (
                            <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2.5 py-1 text-xs font-medium">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {u.connection.name || t("متصل", "Connected")}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                              <XCircle className="h-3.5 w-3.5" />
                              {t("غير متصل", "Not connected")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-semibold">{u.bot_accounts}</span>
                          {u.bot_accounts_active > 0 && (
                            <span className="ms-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                              ({u.bot_accounts_active} {t("نشط", "active")})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-semibold">{u.campaigns_total}</span>
                          {u.campaigns_running > 0 && (
                            <span className="ms-1.5 text-xs text-primary">
                              ({u.campaigns_running} {t("شغّال", "running")})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                              <TrendingUp className="h-3 w-3" />
                              {u.sent_success}
                            </span>
                            <span className="text-muted-foreground">/</span>
                            <span className="inline-flex items-center gap-1 text-red-500">
                              <XCircle className="h-3 w-3" />
                              {u.sent_failed}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {u.jobs_running > 0 ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 px-2.5 py-1 text-xs font-medium">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {u.jobs_running}
                            </span>
                          ) : u.jobs_failed > 0 ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 text-red-600 px-2.5 py-1 text-xs font-medium">
                              <AlertTriangle className="h-3 w-3" />
                              {u.jobs_failed} {t("فشل", "failed")}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Two columns: recent campaigns + recent jobs */}
          <div className="grid lg:grid-cols-2 gap-6">
            <RecentCampaigns rows={q.data?.recentCampaigns ?? []} t={t} />
            <RecentJobs rows={q.data?.recentJobs ?? []} t={t} />
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

/* ---------------- helpers ---------------- */

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

type Tone = "primary" | "blue" | "emerald" | "violet" | "amber" | "red";
const TONE_BG: Record<Tone, string> = {
  primary: "from-primary/15 to-primary/5 text-primary",
  blue: "from-blue-500/15 to-blue-500/5 text-blue-600 dark:text-blue-400",
  emerald: "from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-400",
  violet: "from-violet-500/15 to-violet-500/5 text-violet-600 dark:text-violet-400",
  amber: "from-amber-500/15 to-amber-500/5 text-amber-600 dark:text-amber-400",
  red: "from-red-500/15 to-red-500/5 text-red-600 dark:text-red-400",
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
          <div className="text-2xl font-bold leading-tight">{value.toLocaleString()}</div>
          {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
        </div>
      </div>
    </motion.div>
  );
}

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  total_targets: number | null;
  done_targets: number | null;
  success_count: number | null;
  failed_count: number | null;
  created_at: string;
  user: { full_name: string | null; avatar_url: string | null; plan: string | null } | null;
};

function RecentCampaigns({ rows, t }: { rows: CampaignRow[]; t: (ar: string, en: string) => string }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="font-bold text-base flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-primary" />
          {t("أحدث الحملات", "Recent campaigns")}
        </h2>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
      </div>
      <div className="divide-y divide-border max-h-[420px] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{t("لا توجد حملات", "No campaigns yet")}</div>
        ) : (
          rows.map((c) => {
            const pct = c.total_targets ? Math.round(((c.done_targets ?? 0) / c.total_targets) * 100) : 0;
            return (
              <div key={c.id} className="px-5 py-3 hover:bg-muted/30 transition-colors">
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <div className="min-w-0 flex items-center gap-2">
                    <Avatar name={c.user?.full_name ?? null} url={c.user?.avatar_url ?? null} />
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{c.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {c.user?.full_name ?? t("غير معروف", "Unknown")}
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={c.status} t={t} />
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{c.done_targets ?? 0}/{c.total_targets ?? 0}</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-emerald-600 dark:text-emerald-400">✓ {c.success_count ?? 0}</span>
                  <span className="text-red-500">✗ {c.failed_count ?? 0}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

type JobRow = {
  id: string;
  job_type: string;
  status: string;
  progress: number | null;
  total_items: number | null;
  processed_items: number | null;
  created_at: string;
  error_message: string | null;
  user: { full_name: string | null; avatar_url: string | null; plan: string | null } | null;
};

function RecentJobs({ rows, t }: { rows: JobRow[]; t: (ar: string, en: string) => string }) {
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <h2 className="font-bold text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          {t("أحدث المهام", "Recent jobs")}
        </h2>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
      </div>
      <div className="divide-y divide-border max-h-[420px] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{t("لا توجد مهام", "No jobs yet")}</div>
        ) : (
          rows.map((j) => (
            <div key={j.id} className="px-5 py-3 hover:bg-muted/30 transition-colors">
              <div className="flex items-center justify-between gap-3 mb-1">
                <div className="min-w-0 flex items-center gap-2">
                  <Avatar name={j.user?.full_name ?? null} url={j.user?.avatar_url ?? null} />
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{j.job_type}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {j.user?.full_name ?? t("غير معروف", "Unknown")} ·{" "}
                      {new Date(j.created_at).toLocaleString(t("ar-EG", "en-US"))}
                    </div>
                  </div>
                </div>
                <StatusBadge status={j.status} t={t} />
              </div>
              {j.error_message && (
                <div className="mt-1 text-[11px] text-red-500 line-clamp-1">{j.error_message}</div>
              )}
              {(j.total_items ?? 0) > 0 && (
                <div className="text-[11px] text-muted-foreground mt-1">
                  {j.processed_items ?? 0}/{j.total_items} ({j.progress ?? 0}%)
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, t }: { status: string; t: (ar: string, en: string) => string }) {
  const map: Record<string, { cls: string; ar: string; en: string }> = {
    running: { cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400", ar: "قيد التشغيل", en: "Running" },
    pending: { cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400", ar: "بانتظار", en: "Pending" },
    queued: { cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400", ar: "بالطابور", en: "Queued" },
    completed: { cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", ar: "مكتمل", en: "Done" },
    failed: { cls: "bg-red-500/10 text-red-600 dark:text-red-400", ar: "فشل", en: "Failed" },
    paused: { cls: "bg-muted text-muted-foreground", ar: "متوقف", en: "Paused" },
    draft: { cls: "bg-muted text-muted-foreground", ar: "مسودة", en: "Draft" },
  };
  const m = map[status] ?? { cls: "bg-muted text-muted-foreground", ar: status, en: status };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${m.cls}`}>
      {t(m.ar, m.en)}
    </span>
  );
}
