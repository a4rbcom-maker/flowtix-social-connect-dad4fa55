import { useTranslation } from "react-i18next";
import { LayoutDashboard, Users, Database, TrendingUp, Download, Activity, Sparkles, Clock, AlertCircle, CheckCircle2, Loader2, ArrowRight, BarChart3, Globe, MessageSquare, ThumbsUp, Calendar, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { StatCard, SectionHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/authProvider";
import { cn } from "@/lib/utils";

const recentTasks = [
  { id: "1", name: "Group Members — Tech Community", status: "completed", count: "1,240", time: "2m ago", type: "group" },
  { id: "2", name: "Page Data — FlowTix Official", status: "running", count: "856 / 5,000", time: "5m ago", type: "page" },
  { id: "3", name: "Post Interactions — Campaign #12", status: "completed", count: "3,102", time: "1h ago", type: "post" },
  { id: "4", name: "Messenger Contacts — Inbox", status: "queued", count: "—", time: "2h ago", type: "messenger" },
];

const activityTimeline = [
  { id: "1", icon: CheckCircle2, accent: "success" as const, titleKey: "pages.dashboard.activity.extractionCompleted", descKey: "pages.dashboard.activity.extractionCompletedDesc", timeKey: "pages.dashboard.activity.justNow" },
  { id: "2", icon: Database, accent: "primary" as const, titleKey: "pages.dashboard.activity.newTaskScheduled", descKey: "pages.dashboard.activity.newTaskScheduledDesc", timeKey: "pages.dashboard.activity.minutesAgo" },
  { id: "3", icon: AlertCircle, accent: "warning" as const, titleKey: "pages.dashboard.activity.sessionNeedsReconnection", descKey: "pages.dashboard.activity.sessionNeedsReconnectionDesc", timeKey: "pages.dashboard.activity.hoursAgo" },
  { id: "4", icon: CheckCircle2, accent: "success" as const, titleKey: "pages.dashboard.activity.exportDownloaded", descKey: "pages.dashboard.activity.exportDownloadedDesc", timeKey: "pages.dashboard.activity.hoursAgo2" },
  { id: "5", icon: Users, accent: "info" as const, titleKey: "pages.dashboard.activity.teamMemberJoined", descKey: "pages.dashboard.activity.teamMemberJoinedDesc", timeKey: "pages.dashboard.activity.daysAgo" },
];

const statusConfig = {
  completed: { variant: "success" as const, icon: CheckCircle2, label: "pages.dashboard.status.completed" },
  running: { variant: "primary" as const, icon: Loader2, label: "pages.dashboard.status.running" },
  queued: { variant: "warning" as const, icon: Clock, label: "pages.dashboard.status.queued" },
} as const;

const typeIcons: Record<string, typeof Users> = {
  group: Users,
  page: Globe,
  post: ThumbsUp,
  messenger: MessageSquare,
};

const typeAccents: Record<string, { bg: string; text: string }> = {
  group: { bg: "bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)]", text: "text-[var(--color-primary-soft)]" },
  page: { bg: "bg-[color-mix(in_oklab,var(--color-info)_12%,transparent)]", text: "text-[var(--color-info)]" },
  post: { bg: "bg-[color-mix(in_oklab,var(--color-secondary)_12%,transparent)]", text: "text-[var(--color-secondary-soft)]" },
  messenger: { bg: "bg-[color-mix(in_oklab,var(--color-success)_12%,transparent)]", text: "text-[var(--color-success)]" },
};

const timelineAccents: Record<string, { bg: string; text: string; ring: string }> = {
  success: { bg: "bg-[var(--color-success)]", text: "text-[var(--color-success)]", ring: "ring-[color-mix(in_oklab,var(--color-success)_25%,transparent)]" },
  primary: { bg: "bg-[var(--color-primary)]", text: "text-[var(--color-primary-soft)]", ring: "ring-[color-mix(in_oklab,var(--color-primary)_25%,transparent)]" },
  warning: { bg: "bg-[var(--color-warning)]", text: "text-[var(--color-warning)]", ring: "ring-[color-mix(in_oklab,var(--color-warning)_25%,transparent)]" },
  info: { bg: "bg-[var(--color-info)]", text: "text-[var(--color-info)]", ring: "ring-[color-mix(in_oklab,var(--color-info)_25%,transparent)]" },
  error: { bg: "bg-[var(--color-error)]", text: "text-[var(--color-error)]", ring: "ring-[color-mix(in_oklab,var(--color-error)_25%,transparent)]" },
};

function getGreetingKey(hour: number): "morning" | "afternoon" | "evening" {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function DashboardOverviewPage() {
  const { t } = useTranslation();
  const { profile } = useAuth();

  const hour = new Date().getHours();
  const greetingKey = getGreetingKey(hour);
  const userName = profile?.full_name || t("common.search");

  return (
    <div className="space-y-6 animate-[fade-up_0.4s_ease-out]">
      {/* ─── Premium Hero Header ─── */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-surface)] via-[var(--color-surface)] to-[var(--color-surface-2)] p-6 shadow-[var(--shadow-sm)] sm:p-8">
        <div className="pointer-events-none absolute -top-24 -end-20 size-60 rounded-full bg-gradient-to-br from-[var(--color-primary)]/15 to-transparent blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-16 -start-16 size-40 rounded-full bg-gradient-to-tr from-[var(--color-secondary)]/15 to-transparent blur-2xl" aria-hidden />
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-[0.04] [mask-image:radial-gradient(ellipse_at_top_left,black,transparent_70%)]" aria-hidden />

        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <div className="absolute inset-0 rounded-2xl gradient-brand opacity-30 blur-lg" aria-hidden />
              <div className="relative flex size-14 items-center justify-center rounded-2xl gradient-brand text-white shadow-[0_8px_24px_-8px_rgba(109,94,252,0.6)]">
                <LayoutDashboard className="size-6" aria-hidden />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-fg)] sm:text-3xl">
                {t(`pages.dashboard.greeting.${greetingKey}`)}, {userName} 👋
              </h1>
              <p className="mt-1 text-sm text-[var(--color-fg-muted)] sm:text-base">
                {t("pages.dashboard.greeting.suffix")}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button asChild variant="primary" size="lg" className="gap-2 shadow-[0_8px_24px_-8px_rgba(109,94,252,0.6)]">
              <Link to="/dashboard/facebook/sessions">
                <Sparkles className="size-4" />
                {t("pages.dashboard.startExtraction")}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* ─── Color-coded Stat Cards with Sparklines ─── */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("pages.dashboard.totalExtractions")}
          value="12,840"
          icon={Database}
          accent="primary"
          trend={{ value: "12%", positive: true }}
          sparkline={[40, 55, 48, 62, 58, 72, 85, 90]}
        />
        <StatCard
          label={t("pages.dashboard.activeTasks")}
          value="3"
          icon={Activity}
          accent="warning"
          sparkline={[12, 8, 15, 10, 6, 4, 3, 3]}
        />
        <StatCard
          label={t("pages.dashboard.dataPoints")}
          value="84.2K"
          icon={TrendingUp}
          accent="success"
          trend={{ value: "8%", positive: true }}
          sparkline={[30, 45, 50, 55, 60, 70, 75, 84]}
        />
        <StatCard
          label={t("pages.dashboard.exports")}
          value="156"
          icon={Download}
          accent="info"
          trend={{ value: "23%", positive: true }}
          sparkline={[20, 28, 35, 42, 55, 80, 120, 156]}
        />
      </div>

      {/* ─── Two-column: Recent Tasks + Quick Actions ─── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Tasks */}
        <Card className="lg:col-span-2" hover="lift">
          <div className="flex items-center justify-between p-5">
            <SectionHeader
              title={t("pages.dashboard.recentTasks")}
              icon={Clock}
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link to="/dashboard/tasks">{t("common.viewAll")}</Link>
                </Button>
              }
            />
          </div>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {recentTasks.map((task) => {
                const TypeIcon = typeIcons[task.type] || Users;
                const accent = typeAccents[task.type] || typeAccents.group;
                const status = statusConfig[task.status as keyof typeof statusConfig];
                const StatusIcon = status.icon;

                return (
                  <div
                    key={task.id}
                    className="group flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 transition-all duration-200 hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-sm)]"
                  >
                    <div className={cn("flex size-10 items-center justify-center rounded-lg shrink-0", accent.bg, accent.text)}>
                      <TypeIcon className="size-4" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--color-fg)]">{task.name}</p>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)]">
                        <Clock className="size-3" aria-hidden />
                        <span>{task.time}</span>
                        <span className="text-[var(--color-border-strong)]">·</span>
                        <span className="font-semibold text-[var(--color-fg)]">{task.count}</span>
                        <span>{t("pages.dashboard.records")}</span>
                      </div>
                    </div>
                    <Badge variant={status.variant} className="gap-1 shrink-0">
                      <StatusIcon className={cn("size-3", task.status === "running" && "animate-spin")} aria-hidden />
                      {t(status.label)}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions — 2x2 colorful grid */}
        <Card hover="lift">
          <div className="p-5">
            <SectionHeader title={t("pages.dashboard.quickActions")} icon={Zap} />
          </div>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { icon: Users, label: t("pages.dashboard.extractGroupMembers"), to: "/dashboard/facebook/group-members", accent: "primary" as const },
                { icon: Globe, label: t("pages.dashboard.extractPageData"), to: "/dashboard/facebook/pages", accent: "info" as const },
                { icon: Download, label: t("pages.dashboard.exportData"), to: "/dashboard/export", accent: "success" as const },
                { icon: Activity, label: t("pages.dashboard.viewTasks"), to: "/dashboard/tasks", accent: "warning" as const },
              ].map((action) => {
                const Icon = action.icon;
                const a = typeAccents[action.accent === "primary" ? "group" : action.accent === "info" ? "page" : action.accent === "success" ? "messenger" : "post"];
                return (
                  <Link
                    key={action.to}
                    to={action.to}
                    className="group flex flex-col items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-md)]"
                  >
                    <div className={cn("flex size-10 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110", a.bg, a.text)}>
                      <Icon className="size-4" aria-hidden />
                    </div>
                    <span className="text-[0.72rem] font-medium text-[var(--color-fg)] leading-tight line-clamp-2">{action.label}</span>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Bottom row: Activity Timeline + Quick Insights ─── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Activity Timeline */}
        <Card className="lg:col-span-2" hover="lift">
          <div className="p-5">
            <SectionHeader title={t("pages.dashboard.activity.title")} description={t("pages.dashboard.activity.subtitle")} icon={Activity} />
          </div>
          <CardContent className="pt-0">
            <ol className="relative ms-3 border-s-2 border-dashed border-[var(--color-border)] space-y-1.5">
              {activityTimeline.map((event) => {
                const Icon = event.icon;
                const accent = timelineAccents[event.accent];
                return (
                  <li key={event.id} className="relative ms-5 ps-2 pb-4">
                    <span
                      className={cn(
                        "absolute -start-[2.4rem] top-0 flex size-7 items-center justify-center rounded-full ring-4",
                        accent.bg,
                        accent.ring,
                        accent.text,
                      )}
                    >
                      <Icon className="size-3.5 text-white" aria-hidden />
                    </span>
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                      <p className="text-sm font-semibold text-[var(--color-fg)]">{t(event.titleKey)}</p>
                      <span className="shrink-0 text-xs text-[var(--color-fg-subtle)]">{t(event.timeKey)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">{t(event.descKey)}</p>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        {/* Quick Insights */}
        <Card hover="lift" className="overflow-hidden">
          <div className="relative bg-gradient-to-br from-[color-mix(in_oklab,var(--color-primary)_8%,transparent)] to-transparent p-5">
            <SectionHeader title={t("pages.dashboard.insight.title")} icon={BarChart3} />
          </div>
          <CardContent className="space-y-3 pt-0">
            {/* Top group */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="flex size-7 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--color-primary)_15%,transparent)] text-[var(--color-primary-soft)]">
                  <Users className="size-3.5" aria-hidden />
                </span>
                <p className="text-xs font-semibold text-[var(--color-fg)]">{t("pages.dashboard.insight.topGroup")}</p>
              </div>
              <p className="text-sm font-bold text-[var(--color-fg)] truncate">Tech Community</p>
              <div className="mt-2 flex items-center gap-1.5">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                  <div className="h-full rounded-full gradient-brand" style={{ width: "78%" }} />
                </div>
                <span className="text-[0.65rem] font-bold text-[var(--color-primary-soft)]">78%</span>
              </div>
            </div>

            {/* Busiest day */}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="flex size-7 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--color-secondary)_15%,transparent)] text-[var(--color-secondary-soft)]">
                  <Calendar className="size-3.5" aria-hidden />
                </span>
                <p className="text-xs font-semibold text-[var(--color-fg)]">{t("pages.dashboard.insight.busiest")}</p>
              </div>
              <p className="text-sm font-bold text-[var(--color-fg)]">Wednesday</p>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold text-[var(--color-secondary-soft)]">2,840</span>
                <span className="text-[0.65rem] text-[var(--color-fg-muted)]">{t("pages.dashboard.insight.thisWeek")}</span>
              </div>
            </div>

            {/* Health */}
            <div className="rounded-xl border border-[var(--color-success)]/20 bg-[color-mix(in_oklab,var(--color-success)_6%,transparent)] p-3">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-lg bg-[var(--color-success)] text-white">
                  <CheckCircle2 className="size-3.5" aria-hidden />
                </span>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-[var(--color-fg)]">{t("pages.dashboard.insight.systemHealth")}</p>
                  <p className="text-[0.65rem] text-[var(--color-fg-muted)]">{t("pages.dashboard.insight.allOperational")}</p>
                </div>
                <span className="flex size-2 rounded-full bg-[var(--color-success)] animate-pulse" aria-hidden />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
