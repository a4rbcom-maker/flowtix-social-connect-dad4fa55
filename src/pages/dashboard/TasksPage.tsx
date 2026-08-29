import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, Link } from "react-router-dom";
import { ListChecks, Activity, CheckCircle2, Loader2, PauseCircle, Clock, AlertTriangle, Square, Download, Zap, ArrowRight, Send, Search, Users, Globe, ThumbsUp, MessageSquare, Database, Trash2 } from "lucide-react";
import { PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/state";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useExtractionJobs, useCancelExtraction, useForceStopJob, useExportResults, useDeleteExtraction } from "@/hooks/useExtractionJobs";
import type { ExportFormat } from "@/lib/extraction/types";

interface FlatJob {
  id: string; name: string; type: string; source: string; status: string;
  result_count: number; error?: string; created_at: string; isPublish: boolean;
  progress?: any;
  config?: any;
}

type Status = "all" | "active" | "completed" | "stopped" | "failed";

const statusConfig: Record<string, { variant: "primary" | "success" | "warning" | "default" | "error"; icon: typeof Loader2; animate?: boolean }> = {
  running: { variant: "primary", icon: Loader2, animate: true },
  completed: { variant: "success", icon: CheckCircle2 },
  queued: { variant: "warning", icon: Clock },
  paused: { variant: "default", icon: PauseCircle },
  failed: { variant: "error", icon: AlertTriangle },
  canceled: { variant: "warning", icon: Square },
};

const typeAccents: Record<string, { bg: string; text: string; ring: string }> = {
  "group-members": { bg: "bg-[color-mix(in_oklab,var(--color-primary)_14%,transparent)]", text: "text-[var(--color-primary-soft)]", ring: "ring-[color-mix(in_oklab,var(--color-primary)_25%,transparent)]" },
  "page-followers": { bg: "bg-[color-mix(in_oklab,var(--color-info)_14%,transparent)]", text: "text-[var(--color-info)]", ring: "ring-[color-mix(in_oklab,var(--color-info)_25%,transparent)]" },
  "post-comments": { bg: "bg-[color-mix(in_oklab,var(--color-secondary)_14%,transparent)]", text: "text-[var(--color-secondary-soft)]", ring: "ring-[color-mix(in_oklab,var(--color-secondary)_25%,transparent)]" },
  "post-reactions": { bg: "bg-[color-mix(in_oklab,var(--color-secondary)_14%,transparent)]", text: "text-[var(--color-secondary-soft)]", ring: "ring-[color-mix(in_oklab,var(--color-secondary)_25%,transparent)]" },
  "messenger-contacts": { bg: "bg-[color-mix(in_oklab,var(--color-success)_14%,transparent)]", text: "text-[var(--color-success)]", ring: "ring-[color-mix(in_oklab,var(--color-success)_25%,transparent)]" },
  publish: { bg: "bg-[color-mix(in_oklab,var(--color-warning)_14%,transparent)]", text: "text-[var(--color-warning)]", ring: "ring-[color-mix(in_oklab,var(--color-warning)_25%,transparent)]" },
  default: { bg: "bg-[var(--color-surface-2)]", text: "text-[var(--color-fg-muted)]", ring: "ring-[var(--color-border)]" },
};

const typeIcons: Record<string, typeof Users> = {
  "group-members": Users,
  "page-followers": Globe,
  "post-comments": ThumbsUp,
  "post-reactions": ThumbsUp,
  "messenger-contacts": MessageSquare,
  publish: Send,
};

function getTypeAccent(type: string) {
  if (type === "publish") return typeAccents.publish;
  return typeAccents[type] || typeAccents.default;
}

/** Messaging is available for every Facebook extraction path with results;
 *  Instagram DMs are a different (unimplemented) channel. */
function canMessage(job: FlatJob): boolean {
  return !job.isPublish && job.result_count > 0 && !String(job.type).startsWith("ig_");
}

function getTypeIcon(type: string) {
  if (type === "publish") return Send;
  return typeIcons[type] || Database;
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "الآن";
  if (diffMin < 60) return `قبل ${diffMin} د`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `قبل ${diffHr} س`;
  const diffDay = Math.floor(diffHr / 24);
  return `قبل ${diffDay} يوم`;
}

export function TasksPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: extractionJobs, isLoading: loadingExtract } = useExtractionJobs();
  const cancelMutation = useCancelExtraction();
  const forceStopMutation = useForceStopJob();
  const exportMutation = useExportResults();
  const deleteMutation = useDeleteExtraction();

  const [publishJobs, setPublishJobs] = useState<FlatJob[]>([]);
  const [filter, setFilter] = useState<Status>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FlatJob | null>(null);
  const [exportingJob, setExportingJob] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await (supabase as any).from("publish_jobs").select("*").order("created_at", { ascending: false }).limit(50);
        if (data) {
          setPublishJobs(data.map((j: any) => ({
            id: j.id, name: j.name || "نشر جماعي", type: "publish",
            source: `نشر في ${j.config?.group_ids?.length || 0} جروب`,
            status: j.status,
            result_count: (j.progress?.published || 0) + (j.progress?.failed || 0) + (j.progress?.skipped || 0),
            created_at: j.created_at, isPublish: true,
          })));
        }
      } catch {}
    })();
  }, []);

  const extractMapped: FlatJob[] = (extractionJobs ?? []).map((j: any) => ({
    id: j.id, name: j.name, type: j.type, source: j.source, status: j.status,
    result_count: j.result_count || 0, error: j.error, created_at: j.created_at, isPublish: false,
    progress: j.progress,
    config: j.config,
  }));

  const realJobs: FlatJob[] = [...extractMapped, ...publishJobs].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  // Group by status
  const activeJobs = useMemo(() => realJobs.filter(j => j.status === "running" || j.status === "queued" || j.status === "paused"), [realJobs]);
  const completedJobs = useMemo(() => realJobs.filter(j => j.status === "completed"), [realJobs]);
  const stoppedJobs = useMemo(() => realJobs.filter(j => j.status === "canceled"), [realJobs]);
  const failedJobs = useMemo(() => realJobs.filter(j => j.status === "failed"), [realJobs]);

  // Apply filter + search
  const filteredJobs = useMemo(() => {
    let jobs = realJobs;
    if (filter === "active") jobs = activeJobs;
    else if (filter === "completed") jobs = completedJobs;
    else if (filter === "stopped") jobs = stoppedJobs;
    else if (filter === "failed") jobs = failedJobs;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      jobs = jobs.filter(j => j.name.toLowerCase().includes(q) || j.source?.toLowerCase().includes(q) || j.type?.toLowerCase().includes(q));
    }
    return jobs;
  }, [realJobs, activeJobs, completedJobs, failedJobs, filter, searchQuery]);

  function handleStop(jobId: string) {
    cancelMutation.mutate(jobId, {
      onSuccess: () => { setCancelTarget(null); toast({ type: "success", title: t("pages.tasks.stopDone") }); },
      onError: (err) => { toast({ type: "error", title: t("common.error"), description: err.message }); },
    });
  }

  function handleExport(jobId: string, format: ExportFormat) {
    setExportingJob(jobId);
    exportMutation.mutate({ jobId, format }, {
      onSuccess: () => { setExportingJob(null); toast({ type: "success", title: t("extract.exportStarted") }); },
      onError: (err) => { setExportingJob(null); toast({ type: "error", title: t("extract.exportFailed"), description: err.message }); },
    });
  }

  async function handleExportBoth(jobId: string) {
    setExportingJob(jobId);
    try {
      await exportMutation.mutateAsync({ jobId, format: "csv" });
      await exportMutation.mutateAsync({ jobId, format: "xlsx" });
      toast({ type: "success", title: t("extract.exportStarted") });
    } catch (err) {
      toast({ type: "error", title: t("extract.exportFailed"), description: err instanceof Error ? err.message : String(err) });
    } finally {
      setExportingJob(null);
    }
  }

  function handleDelete(jobId: string) {
    deleteMutation.mutate(jobId, {
      onSuccess: () => {
        setDeleteTarget(null);
        toast({ type: "success", title: t("pages.tasks.deleted") });
      },
      onError: (err) => {
        toast({ type: "error", title: t("common.error"), description: err.message });
      },
    });
  }

  // Render a job row
  function renderJob(job: FlatJob) {
    const cfg = statusConfig[job.status ?? "queued"] ?? statusConfig.queued;
    const StatusIcon = cfg.icon;
    const accent = getTypeAccent(job.type);
    const TypeIcon = getTypeIcon(job.type);
    const isActive = job.status === "running" || job.status === "queued";
    const isEnriching = job.progress?.phase === "enriching";
    // Live progress (running/paused extraction jobs): shows a real progress bar
    // with counts + coverage so an active job never looks "stuck".
    const pExtracted = Number(job.progress?.extracted ?? 0) || 0;
    const pTotal = Number(job.progress?.total ?? 0) || 0;
    const showProgress = !job.isPublish && (job.status === "running" || job.status === "paused") && (pExtracted > 0 || pTotal > 0 || isEnriching);
    const progressPct = pTotal > 0 ? Math.min(100, Math.round((pExtracted / pTotal) * 100)) : null;
    // Downloads are meaningful as soon as a run settles and produced rows —
    // while enrichment is still running we hide the buttons and show a "preparing" callout instead.
    const canDownload =
      !job.isPublish &&
      job.result_count > 0 &&
      (job.status === "completed" || ((job.status === "canceled" || job.status === "failed") && job.result_count > 0));
    const createdAt = job.created_at ? formatRelativeTime(new Date(job.created_at)) : "";

    return (
      <div
        key={job.id}
        className="group relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-all duration-200 hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-md)]"
      >
        {/* Status accent strip on the left */}
        <div className={cn(
          "absolute inset-y-0 start-0 w-1 transition-all duration-200 group-hover:w-1.5",
          job.status === "completed" && "bg-[var(--color-success)]",
          job.status === "failed" && "bg-[var(--color-error)]",
          job.status === "running" && "bg-[var(--color-primary)]",
          job.status === "queued" && "bg-[var(--color-warning)]",
          (job.status === "canceled" || job.status === "paused") && "bg-[var(--color-fg-subtle)]",
        )} aria-hidden />

        <div className="flex items-start justify-between gap-3 ps-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn("flex size-11 items-center justify-center rounded-xl ring-1 shrink-0", accent.bg, accent.text, accent.ring)}>
              <TypeIcon className="size-4.5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--color-fg)]">{job.name || job.type || ""}</p>
              <p className="text-xs text-[var(--color-fg-muted)] truncate">{job.isPublish ? `نشر جماعي • ${job.result_count} جروب` : job.source?.substring(0, 60) || ""}</p>
              {!showProgress && job.result_count > 0 && (
                <p className="mt-0.5 text-xs">
                  <span className="font-semibold tabular-nums text-[var(--color-fg)]">{job.result_count.toLocaleString()}</span>{" "}
                  <span className="text-[var(--color-fg-subtle)]">{t("pages.tasks.results")}</span>
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge variant={cfg.variant} className="gap-1">
              {cfg.animate ? <StatusIcon className="size-3 animate-spin" aria-hidden /> : <StatusIcon className="size-3" aria-hidden />}
              {t(`pages.tasks.status.${job.status}` as any)}
            </Badge>
            <span className="flex items-center gap-1 text-[0.7rem] text-[var(--color-fg-subtle)]" title={new Date(job.created_at).toLocaleString()}>
              <Clock className="size-3" aria-hidden />
              {createdAt}
            </span>
          </div>
        </div>

        {/* Live progress strip: counts + coverage bar + phase — makes any active job readable at a glance */}
        {showProgress && (
          <div className="ms-0 sm:ms-14 mt-3">
            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 font-medium text-[var(--color-fg-muted)]">
                {isEnriching && <Loader2 className="size-3 animate-spin text-[var(--color-primary)]" aria-hidden />}
                {t(isEnriching ? "pages.tasks.phase_enriching" : `pages.tasks.phase_${job.progress?.phase ?? "extracting"}` as any)}
              </span>
              <span className="font-semibold tabular-nums text-[var(--color-fg)]">
                {pExtracted.toLocaleString()}
                {pTotal > 0 && <span className="text-[var(--color-fg-subtle)]"> / {pTotal.toLocaleString()}</span>}
                {progressPct !== null && <span className="ms-1.5 text-[var(--color-primary-soft)]">{progressPct}%</span>}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-3)]" role="progressbar" aria-valuenow={progressPct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
              <div
                className={cn("h-full rounded-full transition-all duration-500", progressPct === null || progressPct < 100 ? "bg-[var(--color-primary)]" : "bg-[var(--color-success)]")}
                style={{ width: `${progressPct === null ? (isEnriching ? 100 : 8) : Math.max(3, progressPct)}%` }}
              />
            </div>
          </div>
        )}

        {job.status === "failed" && job.error && (
          <div className="ms-0 sm:ms-14 mt-3 flex items-start gap-2 rounded-lg border border-[var(--color-error)]/20 bg-[color-mix(in_oklab,var(--color-error)_5%,transparent)] p-2.5 text-xs text-[var(--color-error)]">
            <AlertTriangle className="size-3.5 shrink-0 mt-0.5" aria-hidden />
            <span className="line-clamp-2">{job.error}</span>
          </div>
        )}

        {/* Stop reason message when coverage is below target */}
        {job.progress?.stop_reason && (job.status === "completed" || job.status === "canceled" || job.status === "paused") && (
          <div className="ms-0 sm:ms-14 mt-2 flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/20 bg-[color-mix(in_oklab,var(--color-warning)_5%,transparent)] p-2.5 text-xs text-[var(--color-warning)]">
            <AlertTriangle className="size-3.5 shrink-0 mt-0.5" aria-hidden />
            <span>{t(`pages.tasks.stopReason_${job.progress.stop_reason}` as any)}</span>
          </div>
        )}

        {/* Enrichment in progress: download unlocks once it settles */}
        {isEnriching && (
          <div className="ms-0 sm:ms-14 mt-2 flex items-center gap-2.5 rounded-xl border border-[var(--color-primary)]/25 bg-[color-mix(in_oklab,var(--color-primary)_8%,transparent)] px-3.5 py-2.5 text-xs">
            <Loader2 className="size-4 shrink-0 animate-spin text-[var(--color-primary)]" aria-hidden />
            <span className="text-[var(--color-fg)]">{t("pages.tasks.enriching")}</span>
          </div>
        )}

        {/* Action footer */}
        <div className="ms-0 sm:ms-14 mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">
          {isActive && !job.isPublish && (
            <Button variant="ghost" size="sm" onClick={() => setCancelTarget(job.id)} disabled={cancelMutation.isPending} className="text-[var(--color-fg-muted)] hover:text-[var(--color-warning)]">
              <Square className="size-3.5" />{t("pages.tasks.stop")}
            </Button>
          )}
          {(job.status === "paused" || job.status === "running") && !job.isPublish && (
            <Button variant="ghost" size="sm" onClick={() => forceStopMutation.mutate(job.id)} disabled={forceStopMutation.isPending} className="text-[var(--color-fg-muted)] hover:text-[var(--color-error)]">
              {forceStopMutation.isPending && forceStopMutation.variables === job.id ? <Loader2 className="size-3.5 animate-spin" /> : <AlertTriangle className="size-3.5" />}
              {t("pages.tasks.forceStop")}
            </Button>
          )}
          {job.status === "running" && job.progress?.phase && !showProgress && (
            <div className="ms-0 sm:ms-14 mt-2 flex items-center gap-1.5 text-xs font-medium text-[var(--color-primary-soft)]">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              {t(`pages.tasks.phase_${job.progress.phase}` as any)}
            </div>
          )}
          {canDownload && !isEnriching && (
            <>
              <Button variant="primary" size="sm" onClick={() => handleExportBoth(job.id)} disabled={exportMutation.isPending}>
                {exportingJob === job.id ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}CSV + Excel
              </Button>
              <Button variant="secondary" size="sm" onClick={() => handleExport(job.id, "json")} disabled={exportMutation.isPending}>
                <Download className="size-3.5" />JSON
              </Button>
              {canMessage(job) ? (
                <Button variant="primary" size="sm" onClick={() => navigate(`/dashboard/messenger/compose/${job.id}`)}>
                  <Send className="size-3.5" />{t("pages.tasks.sendMessage")}
                </Button>
              ) : String(job.type).startsWith("ig_") && job.result_count > 0 && !job.isPublish ? (
                <Button variant="ghost" size="sm" disabled title={t("messaging.igUnsupported")}>
                  <Send className="size-3.5" />{t("pages.tasks.sendMessage")}
                </Button>
              ) : null}
            </>
          )}
          {job.status === "failed" && (
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard/facebook/extract-members")}>
              <Zap className="size-3.5" />{t("pages.tasks.retry")}
            </Button>
          )}
          {!isActive && !job.isPublish && (
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(job)} disabled={deleteMutation.isPending} className="text-[var(--color-fg-muted)] hover:text-[var(--color-error)] ms-auto">
              {deleteMutation.isPending && deleteMutation.variables === job.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              {t("pages.tasks.delete")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Render a status section
  function renderSection(title: string, jobs: FlatJob[], icon: typeof Activity, accent: "primary" | "success" | "warning" | "error", emptyMsg?: string) {
    if (jobs.length === 0 && !emptyMsg) return null;
    const accentMap = {
      primary: "bg-[color-mix(in_oklab,var(--color-primary)_10%,transparent)] text-[var(--color-primary-soft)]",
      success: "bg-[color-mix(in_oklab,var(--color-success)_10%,transparent)] text-[var(--color-success)]",
      warning: "bg-[color-mix(in_oklab,var(--color-warning)_10%,transparent)] text-[var(--color-warning)]",
      error: "bg-[color-mix(in_oklab,var(--color-error)_10%,transparent)] text-[var(--color-error)]",
    } as const;
    const SectionIcon = icon;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <span className={cn("flex size-8 items-center justify-center rounded-lg", accentMap[accent])}>
            <SectionIcon className="size-4" aria-hidden />
          </span>
          <h3 className="text-sm font-bold text-[var(--color-fg)]">{title}</h3>
          <span className={cn("flex size-6 items-center justify-center rounded-full text-[0.65rem] font-bold", accentMap[accent])}>
            {jobs.length}
          </span>
          {jobs.length > 5 && (
            <span className="text-xs text-[var(--color-fg-subtle)]">{t("pages.tasks.showingFirst", { count: 5 })}</span>
          )}
        </div>
        {jobs.length === 0 && emptyMsg && (
          <p className="ms-10 text-xs text-[var(--color-fg-subtle)]">{emptyMsg}</p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {jobs.slice(0, 10).map(renderJob)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-[fade-up_0.4s_ease-out]">
      <PageHeader
        title={t("pages.tasks.title")}
        description={t("pages.tasks.subtitle")}
        icon={ListChecks}
        action={
          <Button asChild variant="primary" size="lg" className="gap-2">
            <Link to="/dashboard/facebook/extract-members">
              <Zap className="size-4" />
              {t("extraction.start")}
              <ArrowRight className="size-4 rtl:rotate-180" />
            </Link>
          </Button>
        }
      />

      {/* ─── Stats ─── */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("pages.tasks.active")}
          value={String(activeJobs.length)}
          icon={Activity}
          accent="warning"
          sparkline={activeJobs.length > 0 ? [3, 5, 4, 6, 5, 4, activeJobs.length, activeJobs.length] : [3, 5, 4, 3, 2, 1, 0, 0]}
        />
        <StatCard
          label={t("pages.tasks.completed")}
          value={String(completedJobs.length)}
          icon={CheckCircle2}
          accent="success"
          trend={{ value: completedJobs.length > 0 ? "12%" : "0%", positive: true }}
        />
        <StatCard
          label={t("pages.tasks.failed")}
          value={String(failedJobs.length)}
          icon={AlertTriangle}
          accent="error"
        />
        <StatCard
          label={t("pages.tasks.total")}
          value={String(realJobs.length)}
          icon={ListChecks}
          accent="primary"
        />
      </div>

      {/* ─── Filter tabs + Search ─── */}
      <Card hover="none">
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Tabs */}
          <div className="-mx-1 flex flex-wrap gap-1 overflow-x-auto rounded-lg bg-[var(--color-surface-2)] p-1 sm:mx-0 w-fit max-w-full">
            {([
              { key: "all" as const, label: t("common.viewAll"), count: realJobs.length },
              { key: "active" as const, label: t("pages.tasks.active"), count: activeJobs.length, accent: "warning" as const },
              { key: "completed" as const, label: t("pages.tasks.completed"), count: completedJobs.length, accent: "success" as const },
              { key: "stopped" as const, label: t("pages.tasks.stopped"), count: stoppedJobs.length, accent: "warning" as const },
              { key: "failed" as const, label: t("pages.tasks.failed"), count: failedJobs.length, accent: "error" as const },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
                  filter === tab.key
                    ? "bg-[var(--color-bg)] text-[var(--color-fg)] shadow-sm"
                    : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                )}
              >
                {tab.label}
                <span className={cn(
                  "rounded-full px-1.5 py-0.5 text-[0.65rem] font-bold",
                  filter === tab.key ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-3)] text-[var(--color-fg-muted)]",
                )}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
          {/* Search */}
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-fg-subtle)]" aria-hidden />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("pages.tasks.search")}
              className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] ps-9 pe-3 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] transition-colors focus:border-[var(--color-primary)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/10"
            />
          </div>
        </CardContent>
      </Card>

      {/* ─── Content ─── */}
      {loadingExtract ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : filter === "all" ? (
        <div className="space-y-6">
          {renderSection(`${t("pages.tasks.activeTasks")}`, activeJobs, Activity, "primary", t("pages.tasks.noActive"))}
          {renderSection(`${t("pages.tasks.completed")} (${t("pages.dashboard.recentTasks")})`, completedJobs.slice(0, 5), CheckCircle2, "success")}
          {renderSection(`${t("pages.tasks.stopped")}`, stoppedJobs, Square, "warning")}
          {renderSection(`${t("pages.tasks.failed")}`, failedJobs, AlertTriangle, "error", t("pages.tasks.noFailed"))}
        </div>
      ) : filteredJobs.length === 0 ? (
        <EmptyState
          title={t("pages.tasks.noJobs")}
          description={t("pages.tasks.noJobsDesc")}
          icon={ListChecks}
          action={
            <Button onClick={() => navigate("/dashboard/facebook/extract-members")} size="lg" className="gap-2">
              <Zap className="size-4" />{t("extraction.start")}<ArrowRight className="size-4 rtl:rotate-180" />
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filteredJobs.slice(0, 20).map(renderJob)}
        </div>
      )}

      {/* ─── Stop Dialog ─── */}
      <Dialog open={!!cancelTarget} onClose={() => setCancelTarget(null)}>
        <DialogHeader><DialogTitle>{t("pages.tasks.stopConfirm")}</DialogTitle><DialogClose onClose={() => setCancelTarget(null)} /></DialogHeader>
        <DialogBody>
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-warning)_12%,transparent)]"><Square className="size-8 text-[var(--color-warning)]" /></div>
            <p className="text-sm text-[var(--color-fg-muted)]">{t("pages.tasks.stopDesc")}</p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setCancelTarget(null)}>{t("common.cancel")}</Button>
          <Button variant="warning" disabled={cancelMutation.isPending} onClick={() => cancelTarget && handleStop(cancelTarget)}>
            {cancelMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
            {t("pages.tasks.stop")}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ─── Delete Job Dialog (permanent — job + results) ─── */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="size-4 text-[var(--color-error)]" />
            {t("pages.tasks.deleteConfirmTitle")}
          </DialogTitle>
          <DialogClose onClose={() => setDeleteTarget(null)} />
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col items-center gap-4 py-2 text-center">
            <p className="text-sm font-medium text-[var(--color-fg)]">{deleteTarget?.name || deleteTarget?.type}</p>
            <p className="text-sm text-[var(--color-fg-muted)]">{t("pages.tasks.deleteConfirmBody", { count: deleteTarget?.result_count ?? 0 })}</p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDeleteTarget(null)}>{t("common.cancel")}</Button>
          <Button variant="danger" disabled={deleteMutation.isPending} onClick={() => deleteTarget && handleDelete(deleteTarget.id)}>
            {deleteMutation.isPending && deleteMutation.variables === deleteTarget?.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {t("pages.tasks.delete")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
