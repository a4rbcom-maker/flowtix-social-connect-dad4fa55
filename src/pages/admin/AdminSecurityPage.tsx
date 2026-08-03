import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Shield, ShieldCheck, ShieldAlert, UserX, Activity, Clock, AlertTriangle,
  CheckCircle2, XCircle, RefreshCw, ArrowRight, Eye,
} from "lucide-react";
import { StatCard, SectionHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useAdminSecurityOverview, useAdminAuditLogs } from "@/hooks/useAdmin";

export function AdminSecurityPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: overview, isLoading, isError, error } = useAdminSecurityOverview();
  const { data: recentLogs } = useAdminAuditLogs({ limit: 5 });

  const rlsOk = overview ? overview.rls.tables_without_rls.length === 0 : false;
  const extOk = overview ? overview.extensions.in_public_schema === 0 : false;
  const coverage = overview?.rls.coverage_pct ?? 0;

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ["admin-security-overview"] });
    toast({ type: "success", title: t("admin.security.refresh") });
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <AlertTriangle className="size-12 text-[var(--color-error)]" />
        <p className="text-sm text-[var(--color-fg-muted)]">{(error as Error)?.message ?? t("common.error")}</p>
        <Button variant="outline" onClick={handleRefresh}>{t("admin.security.refresh")}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-[fade-up_0.4s_ease-out]">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-surface)] via-[var(--color-surface)] to-[var(--color-surface-2)] p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <div className="pointer-events-none absolute -top-24 -end-20 size-60 rounded-full bg-gradient-to-br from-[var(--color-primary)]/15 to-transparent blur-3xl" aria-hidden />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <div className="absolute inset-0 rounded-2xl gradient-brand opacity-30 blur-lg" aria-hidden />
              <div className="relative flex size-14 items-center justify-center rounded-2xl gradient-brand text-white shadow-[0_8px_24px_-8px_rgba(109,94,252,0.6)]">
                <Shield className="size-6" aria-hidden />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-fg)] sm:text-3xl">
                {t("admin.security.title")}
              </h1>
              <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t("admin.security.description")}</p>
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          </div>
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      ) : overview ? (
        <>
          {/* RLS Health Banner */}
          <div className={cn(
            "rounded-xl border p-4",
            coverage >= 90 ? "border-[color-mix(in_oklab,var(--color-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-success)_6%,transparent)]" :
            coverage >= 70 ? "border-[color-mix(in_oklab,var(--color-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_6%,transparent)]" :
            "border-[color-mix(in_oklab,var(--color-error)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-error)_6%,transparent)]"
          )}>
            <div className="flex items-center gap-3">
              <div className={cn("flex size-10 items-center justify-center rounded-xl", coverage >= 90 ? "bg-[var(--color-success)]" : coverage >= 70 ? "bg-[var(--color-warning)]" : "bg-[var(--color-error)]")}>
                {coverage >= 90 ? <ShieldCheck className="size-5 text-white" /> : <AlertTriangle className="size-5 text-white" />}
              </div>
              <div>
                <p className="text-lg font-bold text-[var(--color-fg)]">{overview.rls.coverage_pct}% {t("admin.security.coverageLabel")}</p>
                {!rlsOk && <p className="text-xs text-[var(--color-fg-muted)]">{t("admin.security.tablesAtRisk", { count: overview.rls.tables_without_rls.length })}</p>}
              </div>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <StatCard label={t("admin.security.coverageLabel")} value={`${overview.rls.coverage_pct}%`} icon={ShieldCheck} accent={coverage >= 90 ? "success" : coverage >= 70 ? "warning" : "error"} />
            <StatCard label={t("admin.security.suspendedUsers")} value={overview.users.suspended} icon={UserX} accent="warning" />
            <StatCard label={t("admin.security.admins")} value={overview.users.admins} icon={ShieldAlert} accent="info" />
            <StatCard label={t("admin.security.events24h")} value={
              overview.events_24h.logins + overview.events_24h.suspensions + overview.events_24h.role_changes + overview.events_24h.password_changes + overview.events_24h.admin_actions
            } icon={Activity} accent="secondary" />
          </div>

          {/* Security Checks + Recent Activity */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Security Checks */}
            <Card hover="lift" className="overflow-hidden">
              <div className="bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)] p-5 border-b border-[var(--color-border)] flex items-center justify-between">
                <SectionHeader title={t("admin.security.checksTitle")} icon={ShieldCheck} />
                <Button variant="ghost" size="sm" onClick={handleRefresh}><RefreshCw className="size-4" /></Button>
              </div>
              <CardContent className="space-y-3 pt-4">
                {[
                  { label: t("admin.security.checkRls"), ok: rlsOk, detail: rlsOk ? null : overview.rls.tables_without_rls.join(", ") },
                  { label: t("admin.security.checkExtensions"), ok: extOk, detail: extOk ? null : overview.extensions.names.join(", ") },
                  { label: t("admin.security.checkFailedLogins"), ok: false, detail: t("admin.security.notConfigured"), info: true },
                  { label: t("admin.security.check2fa"), ok: false, detail: t("admin.security.requiresIntegration"), info: true },
                ].map((check) => (
                  <div key={check.label} className="flex items-start justify-between rounded-lg border border-[var(--color-border)] p-3">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-[var(--color-fg)]">{check.label}</span>
                      {check.detail && <p className="mt-0.5 text-xs text-[var(--color-fg-muted)] truncate">{check.detail}</p>}
                    </div>
                    <Badge variant={check.info ? "default" : check.ok ? "success" : "error"} className="shrink-0">
                      {check.info ? null : check.ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                      {check.ok ? t("admin.security.passed") : check.info ? check.detail : t("admin.security.failed")}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Recent Security Activity */}
            <Card hover="lift" className="overflow-hidden">
              <div className="bg-[color-mix(in_oklab,var(--color-warning)_6%,transparent)] p-5 border-b border-[var(--color-border)]">
                <SectionHeader title={t("admin.security.recentActivity")} icon={Clock} />
              </div>
              <CardContent className="space-y-2 pt-4">
                {recentLogs && recentLogs.length > 0 ? (
                  recentLogs.slice(0, 5).map((log) => (
                    <div key={log.id} className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] p-2.5">
                      <Activity className="size-4 text-[var(--color-fg-muted)] shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--color-fg)]">{log.action}</p>
                        <p className="text-xs text-[var(--color-fg-subtle)]">{log.description}</p>
                      </div>
                      <span className="text-xs text-[var(--color-fg-muted)] shrink-0">{log.created_at ? new Date(log.created_at).toLocaleTimeString() : ""}</span>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <Eye className="size-8 text-[var(--color-fg-subtle)]" />
                    <p className="text-sm text-[var(--color-fg-muted)]">{t("admin.auditLogs.searchPlaceholder", "No security events")}</p>
                  </div>
                )}
                <Link to="/admin/audit-logs" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:underline pt-2">
                  {t("admin.security.viewAllLogs")} <ArrowRight className="size-3 rtl:rotate-180" />
                </Link>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
