import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Users, Clock, Zap, AlertTriangle, Download, Globe, Plug,
  Activity, CheckCircle2, Loader2, Play,
  ArrowRight, Filter, Pencil,
  MessageSquare, ThumbsUp, Layers,
  Square, TrendingUp, Gauge, Navigation, RefreshCw,
} from "lucide-react";
import { PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InputIcon } from "@/components/ui/input-icon";
import { Checkbox } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useAudioNotification } from "@/hooks/useAudioNotification";
import { useSessions } from "@/hooks/useFbSessions";
import { FbMultiSessionSelector } from "@/components/extraction/FbMultiSessionSelector";
import {
  useStartExtraction,
  useContinueExtraction,
  useCancelExtraction,
  useExportResults,
  useExtractionJobs,
} from "@/hooks/useExtractionJobs";
import { extractionRepository } from "@/lib/extraction/extraction-repository";
import type { MemberSourceType, ExtractionJob, ExportFormat } from "@/lib/extraction/types";

interface SourceOption {
  key: MemberSourceType;
  icon: typeof Users;
  titleKey: string;
  descKey: string;
  urlPlaceholderKey: string;
}

const sourceOptions: SourceOption[] = [
  { key: "group-members", icon: Users, titleKey: "extract.source.groupMembers", descKey: "extract.source.groupMembersDesc", urlPlaceholderKey: "extract.source.groupUrl" },
  { key: "page-followers", icon: Layers, titleKey: "extract.source.pageFollowers", descKey: "extract.source.pageFollowersDesc", urlPlaceholderKey: "extract.source.pageUrl" },
  { key: "post-comments", icon: MessageSquare, titleKey: "extract.source.postComments", descKey: "extract.source.postCommentsDesc", urlPlaceholderKey: "extract.source.postUrl" },
  { key: "post-reactions", icon: ThumbsUp, titleKey: "extract.source.postReactions", descKey: "extract.source.postReactionsDesc", urlPlaceholderKey: "extract.source.postUrl" },
];

function isValidFacebookUrl(url: string): boolean {
  if (!url) return false;
  return /^https?:\/\/(www\.|m\.|web\.)?(facebook\.com|fb\.com|fb\.me)\/.+/i.test(url) || /^\d{5,25}$/.test(url.trim());
}

/** Type-aware URL validation: returns the i18n error key or null when valid. */
function getSourceUrlErrorKey(type: MemberSourceType, url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (!isValidFacebookUrl(trimmed)) return "extract.invalidUrl";
  switch (type) {
    case "group-members":
      return /(?:facebook|fb)\.com\/groups\/[^/?#]+/i.test(trimmed) || /^\d{5,25}$/.test(trimmed)
        ? null
        : "extract.invalidUrlGroup";
    case "page-followers":
      if (/\/groups\//i.test(trimmed)) return "extract.invalidUrlPage";
      return null;
    case "post-comments":
    case "post-reactions":
      return /\/(posts|permalink|share\/[pv]|reel|videos|watch|photo)\b/i.test(trimmed) ||
        /story_fbid=/i.test(trimmed) ||
        /\/groups\/[^/]+\/(posts|permalink)\//i.test(trimmed)
        ? null
        : "extract.invalidUrlPost";
    default:
      return null;
  }
}

type Phase = "setup" | "running" | "completed" | "failed";

export function ExtractMembersPage() {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>("setup");
  const [sourceType, setSourceType] = useState<MemberSourceType>("group-members");
  const [targetUrl, setTargetUrl] = useState("");
  const [isPageAdmin, setIsPageAdmin] = useState(false);
  const [jobName, setJobName] = useState("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [secondarySessionIds, setSecondarySessionIds] = useState<string[]>([]);

  const startExtraction = useStartExtraction();
  const continueExtraction = useContinueExtraction();
  const cancelExtraction = useCancelExtraction();
  const exportResults = useExportResults();
  const { data: jobs } = useExtractionJobs();

  const [activeJob, setActiveJob] = useState<ExtractionJob | null>(null);
  const channelRef = useRef<ReturnType<typeof extractionRepository.subscribeToJob> | null>(null);

  useAudioNotification(phase === "completed");

  const { data: allSessions } = useSessions();
  const connectedCount = (allSessions ?? []).filter((s: any) => s.status === "connected").length;

  useEffect(() => {
    if (!jobs) return;
    const active = jobs.find((j) => j.status === "running" || j.status === "queued");
    if (active && ["group-members", "page-followers", "post-comments", "post-reactions"].includes(active.type)) {
      setActiveJob(active as unknown as ExtractionJob);
      setPhase("running");
    }
  }, [jobs]);

  const urlErrorKey = targetUrl ? getSourceUrlErrorKey(sourceType, targetUrl) : null;
  const canStart = selectedSessionId && targetUrl && !urlErrorKey;
  const selectedSource = sourceOptions.find((s) => s.key === sourceType)!;

  useEffect(() => {
    if (!activeJob?.id) return;
    if (activeJob.status !== "running" && activeJob.status !== "queued" && activeJob.status !== "paused") return;

    const channel = extractionRepository.subscribeToJob(activeJob.id, (updatedJob) => {
      setActiveJob(updatedJob as ExtractionJob);

      if (updatedJob.status === "completed") {
        setPhase("completed");
      } else if (updatedJob.status === "failed") {
        setPhase("failed");
      } else if (updatedJob.status === "paused") {
        const cursor = (updatedJob.config as any)?.cursor;
        if (cursor && updatedJob.result_count > 0) {
          const dbType = updatedJob.type!;
          const sourceUrl = updatedJob.source!;
          continueExtraction.mutate({
            jobId: updatedJob.id,
            cursor,
            maxResults: 100000,
            skipDuplicates,
            sessionId: selectedSessionId,
            dbType,
            sourceUrl,
          });
        } else {
          setPhase("completed");
        }
      } else if (updatedJob.status === "canceled") {
        setPhase("setup");
        setActiveJob(null);
      }
    });
    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        extractionRepository.unsubscribe(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [activeJob?.id, activeJob?.status]);

  useEffect(() => {
    return () => {
      if (channelRef.current) {
        extractionRepository.unsubscribe(channelRef.current);
      }
    };
  }, []);

  function handleStartExtraction() {
    startExtraction.mutate(
      {
        session_id: selectedSessionId,
        session_ids: secondarySessionIds.length > 0 ? secondarySessionIds : undefined,
        type: sourceType,
        source_url: targetUrl,
        job_name: jobName || undefined,
        max_results: 100000,
        skip_duplicates: skipDuplicates,
      },
      {
        onSuccess: (progress) => {
          setPhase("running");
          extractionRepository.getJob(progress.job_id).then((job) => {
            setActiveJob(job);
            if (job.status === "completed") setPhase("completed");
            else if (job.status === "failed") setPhase("failed");
          });
        },
        onError: (err) => {
          toast({ type: "error", title: t("extract.startFailed"), description: err.message });
        },
      },
    );
  }

  function handleCancelExtraction() {
    if (!activeJob?.id) return;
    cancelExtraction.mutate(activeJob.id, {
      onSuccess: () => {
        setPhase("setup");
        setActiveJob(null);
        toast({ type: "success", title: t("extract.cancel.done") });
      },
    });
  }

  function handleExport(format: ExportFormat) {
    if (!activeJob?.id) return;
    exportResults.mutate(
      { jobId: activeJob.id, format },
      {
        onSuccess: (result) => {
          window.open(result.download_url, "_blank");
          toast({ type: "success", title: t("extract.exportStarted") });
        },
        onError: (err) => {
          toast({ type: "error", title: t("extract.exportFailed"), description: err.message });
        },
      },
    );
  }

  // ─── SETUP PHASE ───
  if (phase === "setup") {
    return (
      <div className="space-y-6">
        <PageHeader title={t("extract.title")} description={t("extract.subtitle")} icon={Users} />

        {connectedCount < 2 && (
          <div className="rounded-xl border border-[color-mix(in_oklab,var(--color-primary)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)] p-4">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)] text-white">
                <TrendingUp className="size-5" />
              </div>
              <div className="flex-1 space-y-1">
                <p className="text-sm font-bold text-[var(--color-fg)]">
                  {t("extract.multisessionBannerTitle", { defaultValue: "للحصول على أقصى استخراج (85%+)، أضف جلسات فيسبوك إضافية" })}
                </p>
                <p className="text-xs text-[var(--color-fg-muted)]">
                  {t("extract.multisessionBannerDesc", {
                    defaultValue: "أنت تملك {{count}} جلسة متصلة فقط. أضف 2-3 جلسات إضافية من قائمة الجلسات لرفع نسبة الاستخراج وتفادي حظر فيسبوك.",
                    count: connectedCount,
                  })}
                </p>
                <Button asChild size="sm" variant="primary" className="mt-2 gap-1.5">
                  <Link to="/dashboard/facebook/sessions">
                    <Plug className="size-3.5" />
                    {t("extract.addMoreSessions", { defaultValue: "إدارة الجلسات" })}
                    <ArrowRight className="size-3.5 rtl:rotate-180" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        )}

        {connectedCount >= 2 && (
          <div className="rounded-xl border border-[color-mix(in_oklab,var(--color-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-success)_6%,transparent)] p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-[var(--color-success)] shrink-0" />
              <p className="text-xs text-[var(--color-fg)]">
                {t("extract.multisessionActiveBanner", {
                  defaultValue: "ممتاز! لديك {{count}} جلسات متصلة — نظام Round-robin موزّع الحمل لرفع نسبة الاستخراج.",
                  count: connectedCount,
                })}
              </p>
            </div>
          </div>
        )}

        {/* Step 1: Source type */}
        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Filter className="size-5 text-[var(--color-primary)]" />
            <CardTitle>{t("extract.step1Title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {sourceOptions.map((opt) => {
                const Icon = opt.icon;
                const isActive = sourceType === opt.key;
                return (
                  <button key={opt.key} onClick={() => setSourceType(opt.key)}
                    className={cn("flex items-center gap-4 rounded-xl border-2 p-4 text-start transition-all w-full",
                      isActive ? "border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)]" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
                    )}>
                    <div className={cn("flex size-12 items-center justify-center rounded-xl transition-colors shrink-0",
                      isActive ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]"
                    )}><Icon className="size-6" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-[var(--color-fg)]">{t(opt.titleKey)}</p>
                      <p className="text-xs text-[var(--color-fg-subtle)]">{t(opt.descKey)}</p>
                    </div>
                    <div className={cn("size-5 rounded-full border-2 transition-all shrink-0",
                      isActive ? "border-[var(--color-primary)] bg-[var(--color-primary)]" : "border-[var(--color-border-strong)]"
                    )}>
                      {isActive && <CheckCircle2 className="size-full text-white p-0.5" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Step 2: Session */}
        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Plug className="size-5 text-[var(--color-primary)]" />
            <CardTitle>{t("extract.step2Title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FbMultiSessionSelector
              primarySessionId={selectedSessionId}
              onPrimarySessionChange={setSelectedSessionId}
              secondarySessionIds={secondarySessionIds}
              onSecondarySessionIdsChange={setSecondarySessionIds}
            />
          </CardContent>
        </Card>

        {/* Step 3: URL */}
        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Globe className="size-5 text-[var(--color-primary)]" />
            <CardTitle>{t("extract.step3Title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <InputIcon icon={Globe} placeholder={t(selectedSource.urlPlaceholderKey)} value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)} error={!!urlErrorKey} />
            {sourceType === "page-followers" && (
              <div className="flex items-center gap-2 mt-2">
                <input id="isAdmin" type="checkbox" checked={isPageAdmin} onChange={(e) => setIsPageAdmin(e.target.checked)} />
                <label htmlFor="isAdmin" className="text-sm">{t("extract.ui.isAdmin")}</label>
              </div>
            )}
            {urlErrorKey && (
              <p className="text-xs text-[var(--color-error)]">{t(urlErrorKey)}</p>
            )}
            <div className="flex gap-3">
              <InputIcon icon={Pencil} placeholder={t("extract.jobNamePlaceholder")} value={jobName}
                onChange={(e) => setJobName(e.target.value)} className="flex-1" />
            </div>
            <Checkbox checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} label={t("extract.skipDuplicates")} />
          </CardContent>
        </Card>

        <div className="flex items-center justify-end">
          <Button size="lg" disabled={!canStart || startExtraction.isPending} onClick={handleStartExtraction}>
            {startExtraction.isPending ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
            {t("extract.start")}
            <ArrowRight className="size-4 rtl:rotate-180" />
          </Button>
        </div>
      </div>
    );
  }

  // ─── RUNNING PHASE ───
  if (phase === "running") {
    const jobAny = activeJob as any;
    const p = (jobAny?.progress ?? {}) as Record<string, any>;
    const totalFollowers = jobAny?.config?.total_followers_count || 0;
    const discovered = jobAny?.progress?.discovered ?? activeJob?.result_count ?? 0;
    const progress = totalFollowers > 0
      ? Math.round((discovered / totalFollowers) * 100)
      : 0;
    const showProgress = totalFollowers > 0;
    const isEnriching = jobAny?.progress?.phase === "enriching";
    const statusLabel = isEnriching
      ? t("extract.running.enriching")
      : activeJob?.status === "paused"
        ? t("extract.running.paused")
        : t("extract.running.extracting");

    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title={t("extract.running.title")} description={t(selectedSource.titleKey)} icon={Loader2} />

        <Card className="overflow-hidden">
          <CardContent className="space-y-5 pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative flex size-14 items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-[color-mix(in_oklab,var(--color-primary)_15%,transparent)] animate-[ping_2s_ease-in-out_infinite]" />
                  <Loader2 className={cn("size-7 animate-spin text-[var(--color-primary)]", activeJob?.status === "paused" && "animate-none")} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[var(--color-fg)]">{statusLabel}</h2>
                  <p className="text-sm text-[var(--color-fg-muted)] truncate max-w-[240px]">{targetUrl}</p>
                </div>
              </div>
              <div className="text-end">
                {showProgress ? (
                  <>
                    <p className="text-3xl font-extrabold text-[var(--color-primary)]">{progress}%</p>
                    <p className="text-xs text-[var(--color-fg-subtle)]">{discovered.toLocaleString()} / {totalFollowers.toLocaleString()} {t("extract.running.members")}</p>
                  </>
                ) : (
                  <>
                    <p className="text-3xl font-extrabold text-[var(--color-primary)] animate-pulse">...</p>
                    <p className="text-xs text-[var(--color-fg-subtle)]">{discovered.toLocaleString()} {t("extract.running.members")}</p>
                  </>
                )}
              </div>
            </div>

            <div className="h-3 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              {showProgress ? (
                <div className="h-full rounded-full gradient-brand transition-all duration-500" style={{ width: `${progress}%` }} />
              ) : (
                <div className="h-full w-1/2 rounded-full gradient-brand animate-[pulse_2s_ease-in-out_infinite]" />
              )}
            </div>

            {typeof jobAny?.progress?.posts_done === "number" && (
              <p className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
                <MessageSquare className="size-3.5" />
                {t("extract.running.cascadePosts")}: {jobAny.progress.posts_done} / {jobAny.progress.posts_total ?? "…"}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatBox
                icon={Layers}
                label={t("extract.running.strategySource")}
                value={p.source ? t(`extract.running.source_${p.source}`) : "—"}
              />
              <StatBox
                icon={Users}
                label={t("extract.running.strategySessions")}
                value={`${p.active_sessions ?? 1}`}
              />
              <StatBox
                icon={Gauge}
                label={t("extract.running.strategyRate")}
                value={p.rate_per_min ? `${Math.round(p.rate_per_min)}` : "0"}
              />
              <StatBox
                icon={AlertTriangle}
                label={t("extract.running.strategyErrors")}
                value={`${p.errors_count ?? 0}`}
              />
              <StatBox
                icon={RefreshCw}
                label={t("extract.running.strategyDuplicates")}
                value={`${p.duplicates_skipped ?? 0}`}
              />
              <StatBox
                icon={Navigation}
                label={t("extract.running.strategyNext")}
                value={p.next_strategy && p.next_strategy !== "none" ? t(`extract.running.source_${p.next_strategy}`) : t("extract.running.strategyNone")}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatBox icon={Users} label={t("extract.running.extracted")} value={discovered.toLocaleString()} />
              <StatBox icon={Activity} label={t("extract.status")} value={t(`extract.jobStatus.${activeJob?.status ?? "running"}`)} />
              <StatBox icon={Clock} label={t("extract.startedAt")} value={activeJob?.started_at ? new Date(activeJob.started_at).toLocaleTimeString() : "—"} />
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--color-border)] pt-4">
              {activeJob?.status === "paused" && (
                <Button variant="primary" onClick={() => {
                  const cursor = (activeJob.config as any)?.cursor;
                  if (cursor) continueExtraction.mutate({ jobId: activeJob.id, cursor, maxResults: 100000, skipDuplicates, sessionId: selectedSessionId, dbType: activeJob.type!, sourceUrl: activeJob.source! });
                }} disabled={continueExtraction.isPending}>
                  {continueExtraction.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                  {t("extract.running.resume")}
                </Button>
              )}
              <Button variant="ghost" onClick={handleCancelExtraction} disabled={cancelExtraction.isPending}>
                <Square className="size-4" />{t("extract.running.cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── FAILED PHASE ───
  if (phase === "failed") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title={t("extract.failed.title")} description={activeJob?.error ?? ""} icon={AlertTriangle} />
        <Card className="overflow-hidden">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center pt-6">
            <div className="flex size-20 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-error)_15%,transparent)]">
              <AlertTriangle className="size-10 text-[var(--color-error)]" />
            </div>
            <p className="text-sm text-[var(--color-fg-muted)] max-w-md">{activeJob?.error ?? t("extract.failed.default")}</p>
            <Button variant="outline" onClick={() => { setPhase("setup"); setActiveJob(null); }}>
              <ArrowRight className="size-4 rtl:rotate-180" />{t("extract.failed.back")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── COMPLETED PHASE ───
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("extract.completed.title")} description={t("extract.completed.subtitle")} icon={CheckCircle2} />

      <Card className="overflow-hidden">
        <div className="flex flex-col items-center gap-4 bg-[color-mix(in_oklab,var(--color-success)_8%,transparent)] p-8 text-center animate-[scale-in_0.4s_ease-out]">
          <div className="flex size-20 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-success)_15%,transparent)]">
            <CheckCircle2 className="size-10 text-[var(--color-success)]" />
          </div>
          <h2 className="text-xl font-extrabold text-[var(--color-success)]">{t("extract.completed.success")}</h2>
          <p className="text-sm text-[var(--color-fg-muted)]">{targetUrl}</p>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("extract.completed.total")} value={(activeJob?.result_count ?? 0).toLocaleString()} icon={Users} />
        <StatCard label={t("extract.completed.duration")} value={activeJob?.started_at && activeJob?.completed_at
          ? formatDuration(new Date(activeJob.started_at), new Date(activeJob.completed_at))
          : "—"} icon={Clock} />
        <StatCard label={t("extract.completed.status")} value={t(`extract.jobStatus.${activeJob?.status ?? "completed"}`)} icon={CheckCircle2} />
        <StatCard label={t("extract.completed.skipped")} value={skipDuplicates ? t("extract.completed.enabled") : t("extract.completed.disabled")} icon={Filter} />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center pt-6">
          <Button variant="primary" disabled={exportResults.isPending} onClick={() => handleExport("csv")}>
            {exportResults.isPending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {t("extract.completed.downloadCsv")}
          </Button>
          <Button variant="secondary" disabled={exportResults.isPending} onClick={() => handleExport("json")}>
            <Download className="size-4" />JSON
          </Button>
          <Button variant="secondary" disabled={exportResults.isPending} onClick={() => handleExport("xlsx")}>
            <Download className="size-4" />Excel
          </Button>
          <Button variant="outline" onClick={() => { setPhase("setup"); setActiveJob(null); }}>
            <Zap className="size-4" />{t("extract.completed.newExtraction")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function StatBox({ icon: Icon, label, value }: { icon: typeof Zap; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] p-3">
      <div className="flex items-center gap-1.5 text-xs text-[var(--color-fg-subtle)]"><Icon className="size-3" />{label}</div>
      <p className="mt-1 text-lg font-bold text-[var(--color-fg)]">{value}</p>
    </div>
  );
}

function formatDuration(start: Date, end: Date): string {
  const diffMs = end.getTime() - start.getTime();
  const m = Math.floor(diffMs / 60000);
  const s = Math.floor((diffMs % 60000) / 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
