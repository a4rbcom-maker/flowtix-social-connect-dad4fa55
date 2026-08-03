import { useTranslation } from "react-i18next";
import { LayoutDashboard, Users, Shield, Activity, Clock, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { StatCard, SectionHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function AdminOverviewPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6 animate-[fade-up_0.4s_ease-out]">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-surface)] via-[var(--color-surface)] to-[var(--color-surface-2)] p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <div className="pointer-events-none absolute -top-24 -end-20 size-60 rounded-full bg-gradient-to-br from-[var(--color-primary)]/15 to-transparent blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-16 -start-16 size-40 rounded-full bg-gradient-to-tr from-[var(--color-secondary)]/15 to-transparent blur-2xl" aria-hidden />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <div className="absolute inset-0 rounded-2xl gradient-brand opacity-30 blur-lg" aria-hidden />
              <div className="relative flex size-14 items-center justify-center rounded-2xl gradient-brand text-white shadow-[0_8px_24px_-8px_rgba(109,94,252,0.6)]">
                <LayoutDashboard className="size-6" aria-hidden />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-fg)] sm:text-3xl">
                {t("admin.overview", "Admin Overview")} 👋
              </h1>
              <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t("admin.desc", "Monitor platform health and manage resources")}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("admin.users.title")} value="1" icon={Users} accent="primary" />
        <StatCard label={t("admin.stats.admins", "Admins")} value="1" icon={Shield} accent="success" />
        <StatCard label={t("admin.stats.activity24h", "24h Activity")} value="0" icon={Activity} accent="warning" />
      </div>

      {/* Quick Actions + Recent */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card hover="lift" className="lg:col-span-2">
          <div className="p-5"><SectionHeader title={t("admin.quickActions", "Quick Actions")} icon={Sparkles} /></div>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Users, label: t("admin.users.title"), to: "/admin/users", color: "bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] text-[var(--color-primary-soft)]" },
                { icon: Shield, label: t("admin.security.title"), to: "/admin/security", color: "bg-[color-mix(in_oklab,var(--color-success)_12%,transparent)] text-[var(--color-success)]" },
                { icon: Clock, label: t("admin.auditLogs.title"), to: "/admin/audit-logs", color: "bg-[color-mix(in_oklab,var(--color-warning)_12%,transparent)] text-[var(--color-warning)]" },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.to} to={item.to} className="group flex flex-col items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center transition-all hover:-translate-y-0.5 hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-md)]">
                    <div className={`flex size-12 items-center justify-center rounded-xl transition-transform group-hover:scale-110 ${item.color}`}>
                      <Icon className="size-5" />
                    </div>
                    <span className="text-sm font-semibold text-[var(--color-fg)]">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* System Status */}
        <Card hover="lift" className="overflow-hidden">
          <div className="bg-[color-mix(in_oklab,var(--color-success)_6%,transparent)] p-5 border-b border-[var(--color-border)]">
            <SectionHeader title={t("admin.status.title", "System Status")} icon={Activity} />
          </div>
          <CardContent className="space-y-3 pt-4">
            {[
              { label: t("admin.status.auth", "Authentication"), ok: true },
              { label: t("admin.status.db", "Database"), ok: true },
              { label: t("admin.status.api", "API Gateway"), ok: true },
              { label: t("admin.status.extraction", "Extraction Service"), ok: false, detail: "Offline" },
            ].map((svc) => (
              <div key={svc.label} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] p-3">
                <span className="text-sm font-medium text-[var(--color-fg)]">{svc.label}</span>
                <Badge variant={svc.ok ? "success" : "error"} className="gap-1">
                  <span className={`size-1.5 rounded-full ${svc.ok ? "bg-[var(--color-success)]" : "bg-[var(--color-error)]"}`} />
                  {svc.ok ? t("common.enabled") : svc.detail || t("common.disabled")}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
