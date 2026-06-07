import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Users,
  Facebook,
  MessageCircle,
  Sparkles,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  Send,
  UserPlus,
  Activity,
  Zap,
  Loader2,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import {
  getAdminKpis,
  getAdminTimeseries,
  getRecentActivity,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/")({
  ssr: false,
  component: AdminOverviewPage,
});

const PIE_COLORS = ["hsl(var(--primary))", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6"];

function AdminOverviewPage() {
  const { lang } = useI18n();
  const { user } = useAuth();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);

  const kpisQ = useQuery({ queryKey: ["admin", "kpis"], queryFn: () => getAdminKpis(), staleTime: 30_000, enabled: !!user, retry: false });
  const tsQ = useQuery({
    queryKey: ["admin", "timeseries", 30],
    queryFn: () => getAdminTimeseries({ data: { days: 30 } }),
    staleTime: 60_000,
    enabled: !!user,
    retry: false,
  });
  const actQ = useQuery({ queryKey: ["admin", "activity"], queryFn: () => getRecentActivity(), staleTime: 20_000, refetchInterval: 30_000, enabled: !!user, retry: false });


  const k = (kpisQ.data?.kpis ?? {}) as Record<string, number | Record<string, number>>;
  const num = (key: string) => Number((k[key] as number) ?? 0);

  const plansData = useMemo(() => {
    const dist = (k.plans_distribution as Record<string, number>) ?? {};
    return Object.entries(dist).map(([name, value]) => ({ name, value: Number(value) }));
  }, [k.plans_distribution]);

  const series = tsQ.data?.rows ?? [];

  const kpiCards = [
    {
      icon: Users,
      label: t("إجمالي المستخدمين", "Total Users"),
      value: num("users_total"),
      delta: num("users_new_7d"),
      deltaLabel: t("جديد هذا الأسبوع", "new this week"),
      gradient: "from-violet-500 to-purple-600",
    },
    {
      icon: UserPlus,
      label: t("جدد آخر 30 يوم", "New (30d)"),
      value: num("users_new_30d"),
      delta: num("users_new_7d"),
      deltaLabel: t("منهم هذا الأسبوع", "this week"),
      gradient: "from-blue-500 to-cyan-500",
    },
    {
      icon: Facebook,
      label: t("ربط فيسبوك", "FB Connections"),
      value: num("fb_connections"),
      delta: num("fb_bot_accounts"),
      deltaLabel: t("حساب بوت", "bot accounts"),
      gradient: "from-blue-600 to-indigo-600",
    },
    {
      icon: MessageCircle,
      label: t("جلسات واتساب", "WA Sessions"),
      value: num("wa_sessions_total"),
      delta: num("wa_sessions_active"),
      deltaLabel: t("نشطة", "active"),
      gradient: "from-emerald-500 to-green-600",
    },
    {
      icon: Send,
      label: t("رسائل اليوم", "Messages Today"),
      value: num("messages_today"),
      delta: num("messages_7d"),
      deltaLabel: t("خلال 7 أيام", "in 7 days"),
      gradient: "from-amber-500 to-orange-500",
    },
    {
      icon: CheckCircle2,
      label: t("نجاح الإرسال (7ي)", "Send Success (7d)"),
      value: num("send_log_success_7d"),
      delta: num("send_log_failed_7d"),
      deltaLabel: t("فشل", "failed"),
      gradient: "from-green-500 to-emerald-600",
    },
    {
      icon: Activity,
      label: t("مهام جارية", "Running Jobs"),
      value: num("fb_jobs_running") + num("bulk_jobs_running"),
      delta: num("bulk_jobs_running"),
      deltaLabel: t("جماعية", "bulk"),
      gradient: "from-pink-500 to-rose-600",
    },
    {
      icon: Sparkles,
      label: t("استدعاءات AI (7ي)", "AI Calls (7d)"),
      value: num("ai_calls_7d"),
      delta: num("ai_tokens_7d"),
      deltaLabel: t("توكن", "tokens"),
      gradient: "from-fuchsia-500 to-purple-600",
    },
  ];

  return (
    <AdminLayout title={t("نظرة عامة", "Overview")}>
      {/* KPIs */}
      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
        className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4"
      >
        {kpiCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={i}
              variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
              className="relative overflow-hidden rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-4 hover:shadow-2xl hover:shadow-primary/10 transition-all hover:-translate-y-0.5"
            >
              <div className={`absolute inset-0 opacity-5 bg-gradient-to-br ${card.gradient}`} />
              <div className="relative">
                <div className="flex items-center justify-between mb-3">
                  <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${card.gradient} flex items-center justify-center shadow-lg`}>
                    <Icon className="h-5 w-5 text-white" />
                  </div>
                  {kpisQ.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
                <div className="text-2xl md:text-3xl font-bold tracking-tight">
                  {card.value.toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">{card.label}</div>
                <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <TrendingUp className="h-3 w-3 text-emerald-500" />
                  <span className="font-semibold text-foreground">{card.delta.toLocaleString()}</span>
                  <span>{card.deltaLabel}</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        {/* Users growth */}
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold">{t("نمو المستخدمين", "User Growth")}</h3>
              <p className="text-xs text-muted-foreground">{t("آخر 30 يوم", "Last 30 days")}</p>
            </div>
            <Zap className="h-4 w-4 text-primary" />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                <defs>
                  <linearGradient id="userGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                />
                <Area type="monotone" dataKey="new_users" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#userGrad)" name={t("مستخدمون", "Users")} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Plans distribution */}
        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-5">
          <h3 className="font-bold mb-1">{t("توزيع الباقات", "Plans Distribution")}</h3>
          <p className="text-xs text-muted-foreground mb-4">{t("حسب نوع الاشتراك", "By subscription type")}</p>
          <div className="h-48">
            {plansData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={plansData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={4}>
                    {plansData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                {t("لا بيانات", "No data")}
              </div>
            )}
          </div>
          <div className="space-y-1.5 mt-2">
            {plansData.map((p, i) => (
              <div key={p.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="capitalize">{p.name}</span>
                </div>
                <span className="font-semibold">{p.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Messages bar + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold">{t("أداء الإرسال", "Sending Performance")}</h3>
              <p className="text-xs text-muted-foreground">{t("نجاح vs فشل آخر 30 يوم", "Success vs Failed (30d)")}</p>
            </div>
            <div className="flex gap-3 text-xs">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> {t("نجاح", "Success")}</span>
              <span className="flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 text-red-500" /> {t("فشل", "Failed")}</span>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12 }} />
                <Bar dataKey="send_success" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} name={t("نجاح", "Success")} />
                <Bar dataKey="send_failed" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} name={t("فشل", "Failed")} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Activity feed */}
        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold">{t("نشاط مباشر", "Live Activity")}</h3>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {t("مباشر", "Live")}
            </div>
          </div>
          <div className="space-y-2 overflow-y-auto max-h-[260px] pr-1">
            {actQ.isLoading && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {actQ.data?.events.map((e) => {
              const kindMap: Record<string, { label: string; color: string; icon: typeof Users }> = {
                signup: { label: t("تسجيل جديد", "New signup"), color: "text-blue-500", icon: UserPlus },
                campaign: { label: t("حملة", "Campaign"), color: "text-purple-500", icon: Send },
                job: { label: t("مهمة", "Job"), color: "text-amber-500", icon: Activity },
                send: { label: t("إرسال", "Send"), color: "text-emerald-500", icon: CheckCircle2 },
              };
              const meta = kindMap[e.kind] ?? kindMap.signup;
              const Icon = meta.icon;
              return (
                <div key={`${e.kind}-${e.id}`} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className={`h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0 ${meta.color}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{e.title}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <span>{meta.label}</span>
                      {e.status && <span>· {e.status}</span>}
                      <span>· {new Date(e.at).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {actQ.data && actQ.data.events.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-6">{t("لا نشاط حديث", "No recent activity")}</div>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
