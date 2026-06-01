import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { ShieldCheck, Crown, UserCog, Activity, Loader2, ScrollText, Users } from "lucide-react";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import { getAdminSecurityOverview } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/security")({ ssr: false, component: SecurityPage });

function SecurityPage() {
  const { lang, dir } = useI18n();
  const fetchFn = useServerFn(getAdminSecurityOverview);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "security"],
    queryFn: () => fetchFn(),
    refetchInterval: 30000,
  });

  const chartData = useMemo(() => (data?.topActions ?? []).map((a) => ({ name: a.action, count: a.count })), [data]);

  if (isLoading || !data) {
    return <AdminLayout title={lang === "ar" ? "الأمان" : "Security"}><div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></AdminLayout>;
  }

  const kpis = [
    { label: lang === "ar" ? "السوبر أدمن" : "Super Admins", value: data.totals.admins, icon: Crown, color: "text-amber-500 bg-amber-500/10" },
    { label: lang === "ar" ? "المشرفون" : "Moderators", value: data.totals.moderators, icon: UserCog, color: "text-sky-500 bg-sky-500/10" },
    { label: lang === "ar" ? "إجمالي المستخدمين" : "Total Users", value: data.totals.totalUsers, icon: Users, color: "text-primary bg-primary/10" },
    { label: lang === "ar" ? "إجراءات (24س)" : "Actions (24h)", value: data.totals.actions24h, icon: Activity, color: "text-emerald-500 bg-emerald-500/10" },
  ];

  return (
    <AdminLayout title={lang === "ar" ? "الأمان والصلاحيات" : "Security & Access"}>
      <div dir={dir} className="space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {kpis.map((k, i) => (
            <motion.div key={k.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{k.label}</span>
                <div className={`rounded-lg p-2 ${k.color}`}><k.icon className="h-4 w-4" /></div>
              </div>
              <div className="text-3xl font-bold mt-2">{k.value.toLocaleString()}</div>
            </motion.div>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {/* Admins list */}
          <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold flex items-center gap-2"><Crown className="h-4 w-4 text-amber-500" /> {lang === "ar" ? "السوبر أدمن" : "Super Admins"}</h3>
              <Link to="/admin/users" className="text-xs text-primary hover:underline">{lang === "ar" ? "إدارة" : "Manage"}</Link>
            </div>
            <div className="space-y-2">
              {data.admins.length === 0 && <p className="text-sm text-muted-foreground">{lang === "ar" ? "لا يوجد" : "None"}</p>}
              {data.admins.map((a: any) => (
                <div key={a.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40">
                  {a.profile?.avatar_url ? (
                    <img src={a.profile.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold">{a.profile?.full_name?.[0] ?? "?"}</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{a.profile?.full_name ?? "—"}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{a.user_id.slice(0, 8)}</div>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600">ADMIN</span>
                </div>
              ))}
            </div>
            {data.moderators.length > 0 && (
              <>
                <h4 className="font-semibold text-sm mt-5 mb-2 flex items-center gap-2"><UserCog className="h-3.5 w-3.5 text-sky-500" /> {lang === "ar" ? "المشرفون" : "Moderators"}</h4>
                <div className="space-y-2">
                  {data.moderators.map((m: any) => (
                    <div key={m.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40 text-sm">
                      <div className="h-7 w-7 rounded-full bg-sky-500/20 flex items-center justify-center text-xs font-bold">{m.profile?.full_name?.[0] ?? "?"}</div>
                      <span className="flex-1 truncate">{m.profile?.full_name ?? m.user_id.slice(0, 8)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Top actions chart */}
          <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-5">
            <h3 className="font-bold flex items-center gap-2 mb-4"><Activity className="h-4 w-4 text-primary" /> {lang === "ar" ? "أكثر الإجراءات (آخر 100)" : "Top Actions (last 100)"}</h3>
            {chartData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{lang === "ar" ? "لا توجد بيانات" : "No data"}</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Recent audit */}
        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between">
            <h3 className="font-bold flex items-center gap-2"><ScrollText className="h-4 w-4 text-primary" /> {lang === "ar" ? "أحدث إجراءات الأدمن" : "Recent Admin Actions"}</h3>
            <Link to="/admin/logs" className="text-xs text-primary hover:underline">{lang === "ar" ? "السجل الكامل" : "Full log"}</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 font-semibold text-start">{lang === "ar" ? "الوقت" : "Time"}</th>
                  <th className="px-4 py-3 font-semibold text-start">{lang === "ar" ? "الأدمن" : "Admin"}</th>
                  <th className="px-4 py-3 font-semibold text-start">{lang === "ar" ? "الإجراء" : "Action"}</th>
                  <th className="px-4 py-3 font-semibold text-start">{lang === "ar" ? "الهدف" : "Target"}</th>
                </tr>
              </thead>
              <tbody>
                {data.audit.slice(0, 30).map((r: any) => (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{new Date(r.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</td>
                    <td className="px-4 py-2.5 font-medium">{r.admin?.full_name ?? r.admin_user_id.slice(0, 8)}</td>
                    <td className="px-4 py-2.5"><span className="px-2 py-1 rounded bg-primary/10 text-primary text-xs font-mono">{r.action}</span></td>
                    <td className="px-4 py-2.5 text-xs">{r.target?.full_name ?? r.target_id ?? "—"}</td>
                  </tr>
                ))}
                {data.audit.length === 0 && <tr><td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">{lang === "ar" ? "لا توجد إجراءات" : "No actions"}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent users */}
        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-5">
          <h3 className="font-bold flex items-center gap-2 mb-4"><Users className="h-4 w-4 text-primary" /> {lang === "ar" ? "أحدث المستخدمين" : "Newest Users"}</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.recentUsers.map((u: any) => (
              <div key={u.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background/60">
                {u.avatar_url ? <img src={u.avatar_url} className="h-10 w-10 rounded-full object-cover" alt="" /> : <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center font-bold">{u.full_name?.[0] ?? "?"}</div>}
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{u.full_name ?? "—"}</div>
                  <div className="text-[10px] text-muted-foreground">{new Date(u.created_at).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US")} • {u.plan ?? "free"}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
