import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Users, UserPlus, UserCheck, Clock, Zap, AlertTriangle, Download, Globe, AtSign, Send,
  Activity, CheckCircle2, Loader2, ArrowRight, Square, Camera, Pencil,
} from "lucide-react";
import { PageHeader, StatCard } from "@/components/ui/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InputIcon } from "@/components/ui/input-icon";
import { Checkbox } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useAudioNotification } from "@/hooks/useAudioNotification";
import { IgMultiSessionSelector } from "@/components/extraction/IgMultiSessionSelector";
import { useIgExtraction, useIgJob, useIgCoverage } from "@/hooks/useIgExtraction";
import { extractionRepository } from "@/lib/extraction/extraction-repository";
import type { ExportFormat } from "@/lib/extraction/types";

type IgSourceType =
  | "ig-followers"
  | "ig-following"
  | "ig-post-commenters"
  | "ig-post-engagers"
  | "ig-hashtag-posts"
  | "ig-profile-info"
  | "ig-user-search";

interface SourceOption {
  key: IgSourceType;
  icon: typeof Users;
  titleKey: string;
  descKey: string;
  usernamePlaceholderKey?: string;
}

const sourceOptions: SourceOption[] = [
  { key: "ig-followers", icon: UserPlus, titleKey: "ig_extract.source.followers", descKey: "ig_extract.source.followersDesc", usernamePlaceholderKey: "ig_extract.source.followersPlaceholder" },
  { key: "ig-following", icon: UserCheck, titleKey: "ig_extract.source.following", descKey: "ig_extract.source.followingDesc", usernamePlaceholderKey: "ig_extract.source.followingPlaceholder" },
  { key: "ig-post-commenters", icon: Users, titleKey: "ig_extract.source.postCommenters", descKey: "ig_extract.source.postCommentersDesc" },
  { key: "ig-post-engagers", icon: Zap, titleKey: "ig_extract.source.postEngagers", descKey: "ig_extract.source.postEngagersDesc" },
  { key: "ig-hashtag-posts", icon: Activity, titleKey: "ig_extract.source.hashtagPosts", descKey: "ig_extract.source.hashtagPostsDesc" },
  { key: "ig-profile-info", icon: CheckCircle2, titleKey: "ig_extract.source.profileInfo", descKey: "ig_extract.source.profileInfoDesc" },
  { key: "ig-user-search", icon: Globe, titleKey: "ig_extract.source.userSearch", descKey: "ig_extract.source.userSearchDesc" },
];

/** Input kind per source type. */
function inputKindFor(key: IgSourceType): "username" | "post" | "hashtag" | "query" {
  if (key === "ig-post-commenters" || key === "ig-post-engagers") return "post";
  if (key === "ig-hashtag-posts") return "hashtag";
  if (key === "ig-user-search") return "query";
  return "username";
}

const DB_TYPE_BY_KEY: Record<IgSourceType, string> = {
  "ig-followers": "ig_followers",
  "ig-following": "ig_following",
  "ig-post-commenters": "ig_post_commenters",
  "ig-post-engagers": "ig_post_engagers",
  "ig-hashtag-posts": "ig_hashtag_posts",
  "ig-profile-info": "ig_profile_info",
  "ig-user-search": "ig_user_search",
};

/** Validate + normalize the input for the active source type.
 *  Returns the API source_url or null when invalid. */
function buildSourceUrl(key: IgSourceType, raw: string): string | null {
  const v = raw.trim().replace(/^@/, "").replace(/\/+$/, "");
  if (!v) return null;
  switch (inputKindFor(key)) {
    case "username": {
      if (/^https?:\/\/www\.instagram\.com\/[a-zA-Z0-9._]{1,30}\/?$/i.test(v)) return v;
      if (/^[a-zA-Z0-9._]{1,30}$/.test(v)) return `https://www.instagram.com/${v}/`;
      return null;
    }
    case "post":
      return /^https?:\/\/(www\.)?instagram\.com\/(p|reel)\/[A-Za-z0-9_-]+\/?$/i.test(v)
        ? `https://www.instagram.com/${v.match(/instagram\.com\/(p|reel)\/([A-Za-z0-9_-]+)/i)![1]}/${v.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/i)![1]}/`
        : (/^[A-Za-z0-9_-]{5,20}$/.test(v) ? `https://www.instagram.com/p/${v}/` : null);
    case "hashtag": {
      if (/^https?:\/\/www\.instagram\.com\/explore\/tags\//i.test(v)) return v;
      if (/^[\p{L}\p{N}_]+$/u.test(v)) return `https://www.instagram.com/explore/tags/${encodeURIComponent(v)}/`;
      return null;
    }
    case "query":
      return /^[\p{L}\p{N}\s_.'-]+$/u.test(v) ? `?q=${encodeURIComponent(v)}` : null;
  }
}



type Phase = "setup" | "running" | "completed" | "failed";

export function ExtractIgPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("setup");
  const [sourceType, setSourceType] = useState<IgSourceType>("ig-followers");
  const [username, setUsername] = useState("");
  const [jobName, setJobName] = useState("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [ceiling, setCeiling] = useState(100000);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [secondarySessionIds, setSecondarySessionIds] = useState<string[]>([]);

  const { start, cancel } = useIgExtraction();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const { data: activeJob } = useIgJob(activeJobId ?? undefined);
  const coverage = useIgCoverage(activeJob);
  const channelRef = useRef<ReturnType<typeof extractionRepository.subscribeToJob> | null>(null);

  useAudioNotification(phase === "completed");

  const inputKind = inputKindFor(sourceType);
  const canStart = selectedSessionId && !!buildSourceUrl(sourceType, username);

  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status === "completed") setPhase("completed");
    else if (activeJob.status === "failed") {
      setPhase("failed");
      if (activeJob.error) toast({ type: "error", title: t("ig_extract.failed.title"), description: activeJob.error });
    } else if (activeJob.status === "canceled") {
      setPhase("setup");
      setActiveJobId(null);
    }
  }, [activeJob, t]);

  useEffect(() => {
    if (!activeJobId) return;
    const channel = extractionRepository.subscribeToJob(activeJobId, (updatedJob) => {
      if (updatedJob.status === "completed") setPhase("completed");
      else if (updatedJob.status === "failed") {
        setPhase("failed");
        if (updatedJob.error) toast({ type: "error", title: t("ig_extract.failed.title"), description: updatedJob.error });
      } else if (updatedJob.status === "canceled") {
        setPhase("setup");
        setActiveJobId(null);
      }
    });
    channelRef.current = channel;
    return () => {
      if (channelRef.current) {
        extractionRepository.unsubscribe(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [activeJobId, t]);

  useEffect(() => {
    return () => {
      if (channelRef.current) extractionRepository.unsubscribe(channelRef.current);
    };
  }, []);

  function handleStart() {
    const sourceUrl = buildSourceUrl(sourceType, username);
    if (!sourceUrl) {
      toast({ type: "error", title: t("ig_extract.startFailed"), description: t("ig_extract.invalidInput") });
      return;
    }
    start.mutate(
      {
        session_id: selectedSessionId,
        session_ids: secondarySessionIds.length > 0 ? secondarySessionIds : undefined,
        type: DB_TYPE_BY_KEY[sourceType] as never,
        source_url: sourceUrl,
        job_name: jobName || undefined,
        max_results: ceiling,
        skip_duplicates: skipDuplicates,
      },
      {
        onSuccess: (progress) => {
          setPhase("running");
          setActiveJobId(progress.job_id);
        },
        onError: (err) => {
          toast({ type: "error", title: t("ig_extract.startFailed"), description: err.message });
        },
      },
    );
  }

  function handleCancel() {
    if (!activeJobId) return;
    cancel.mutate(activeJobId, {
      onSuccess: () => {
        setPhase("setup");
        setActiveJobId(null);
        toast({ type: "success", title: t("ig_extract.cancelDone") });
      },
    });
  }

  function handleExport(format: ExportFormat) {
    if (!activeJobId) return;
    void extractRepositoryExport(activeJobId, format, t);
  }

  const selectedSource = sourceOptions.find((s) => s.key === sourceType)!;

  if (phase === "setup") {
    return (
      <div className="space-y-6">
        <PageHeader title={t("ig_extract.title")} description={t("ig_extract.subtitle")} icon={Camera} />

        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Users className="size-5 text-[var(--color-primary)]" />
            <CardTitle>{t("ig_extract.step1Title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {sourceOptions.map((opt) => {
                const Icon = opt.icon;
                const isActive = sourceType === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setSourceType(opt.key)}
                    className={cn(
                      "flex items-center gap-4 rounded-xl border-2 p-4 text-start transition-all w-full",
                      isActive
                        ? "border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)]"
                        : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
                    )}
                  >
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

        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Globe className="size-5 text-[var(--color-primary)]" />
            <CardTitle>{t("ig_extract.step2Title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <IgMultiSessionSelector
              primarySessionId={selectedSessionId}
              onPrimarySessionChange={setSelectedSessionId}
              secondarySessionIds={secondarySessionIds}
              onSecondarySessionIdsChange={setSecondarySessionIds}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <Globe className="size-5 text-[var(--color-primary)]" />
            <CardTitle>{t("ig_extract.step3Title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <InputIcon
              icon={UserPlus}
              placeholder={
                inputKind === "post" ? t("ig_extract.source.postPlaceholder")
                : inputKind === "hashtag" ? t("ig_extract.source.hashtagPlaceholder")
                : inputKind === "query" ? t("ig_extract.source.queryPlaceholder")
                : t(selectedSource.usernamePlaceholderKey ?? "ig_extract.source.followersPlaceholder")
              }
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              error={!!username && !buildSourceUrl(sourceType, username)}
            />
            {username && !buildSourceUrl(sourceType, username) && (
              <p className="text-xs text-[var(--color-error)]">{t("ig_extract.invalidInput")}</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <InputIcon icon={Zap} placeholder={t("ig_extract.ceilingPlaceholder")} type="number" value={String(ceiling)}
                onChange={(e) => setCeiling(Number(e.target.value) || 0)} />
              <InputIcon icon={Pencil} placeholder={t("ig_extract.jobNamePlaceholder")} value={jobName}
                onChange={(e) => setJobName(e.target.value)} />
            </div>
            <Checkbox checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} label={t("ig_extract.skipDuplicates")} />
          </CardContent>
        </Card>

        <div className="flex items-center justify-end">
          <Button size="lg" disabled={!canStart || start.isPending} onClick={handleStart}>
            {start.isPending ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
            {t("ig_extract.start")}
            <ArrowRight className="size-4 rtl:rotate-180" />
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "running") {
    const total = coverage.total;
    const extracted = coverage.extracted;
    const pct = total && total > 0 ? Math.round((extracted / total) * 100) : null;
    const rawProgress = ((activeJob as { progress?: Record<string, unknown> } | undefined)?.progress ?? {}) as Record<string, unknown>;
    const isEnriching = rawProgress.phase === "enriching";
    const ratePerMin = typeof rawProgress.rate_per_min === "number" ? (rawProgress.rate_per_min as number) : null;
    const activeSessions = typeof rawProgress.active_sessions === "number" ? (rawProgress.active_sessions as number) : null;
    const workingState = typeof rawProgress.working_state === "string" ? (rawProgress.working_state as string) : null;

    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title={t("ig_extract.running.title")} description={t(selectedSource.titleKey)} icon={Loader2} />

        <Card className="overflow-hidden">
          <CardContent className="space-y-5 pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative flex size-14 items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-[color-mix(in_oklab,var(--color-primary)_15%,transparent)] animate-[ping_2s_ease-in-out_infinite]" />
                  <Loader2 className={cn("size-7 animate-spin text-[var(--color-primary)]", activeJob?.status === "paused" && "animate-none")} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[var(--color-fg)]">
                    {isEnriching ? t("ig_extract.running.enriching") : activeJob?.status === "paused" ? t("ig_extract.running.paused") : t("ig_extract.running.extracting")}
                  </h2>
                  <p className="text-sm text-[var(--color-fg-muted)] truncate max-w-[240px]">{username}</p>
                </div>
              </div>
              <div className="text-end">
                {pct !== null ? (
                  <>
                    <p className="text-3xl font-extrabold text-[var(--color-primary)]">{pct}%</p>
                    <p className="text-xs text-[var(--color-fg-subtle)]">{extracted.toLocaleString()} / {(total ?? 0).toLocaleString()} {t("ig_extract.running.members")}</p>
                  </>
                ) : (
                  <>
                    <p className="text-3xl font-extrabold text-[var(--color-primary)] animate-pulse">...</p>
                    <p className="text-xs text-[var(--color-fg-subtle)]">{extracted.toLocaleString()} {t("ig_extract.running.members")}</p>
                  </>
                )}
              </div>
            </div>

            <div className="h-3 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
              {pct !== null ? (
                <div className="h-full rounded-full gradient-brand transition-all duration-500" style={{ width: `${pct}%` }} />
              ) : (
                <div className="h-full w-1/2 rounded-full gradient-brand animate-[pulse_2s_ease-in-out_infinite]" />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatBox icon={Users} label={t("ig_extract.running.extracted")} value={extracted.toLocaleString()} />
              <StatBox icon={Activity} label={t("ig_extract.statusLabel")} value={t(`ig_extract.status.${activeJob?.status ?? "running"}`)} />
              <StatBox icon={Clock} label={t("ig_extract.startedAt")} value={activeJob?.started_at ? new Date(activeJob.started_at).toLocaleTimeString() : "—"} />
              <StatBox icon={Zap} label={t("ig_extract.running.strategyRate")} value={ratePerMin !== null ? `${ratePerMin.toLocaleString()} / ${t("ig_extract.running.minute")}` : t("ig_extract.running.strategyNone")} />
              <StatBox icon={Globe} label={t("ig_extract.running.strategySessions")} value={activeSessions !== null ? String(activeSessions) : t("ig_extract.running.strategyNone")} />
              <StatBox icon={Loader2} label={t("ig_extract.running.activity")} value={
                workingState === "producing" ? t("ig_extract.running.producing")
                : workingState === "stalled" ? t("ig_extract.running.stalled")
                : isEnriching ? t("ig_extract.running.enriching")
                : t("ig_extract.running.waiting")
              } />
            </div>

            <div className="flex items-center gap-2 border-t border-[var(--color-border)] pt-4">
              <Button variant="ghost" onClick={handleCancel} disabled={cancel.isPending}>
                <Square className="size-4" />{t("ig_extract.running.cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <PageHeader title={t("ig_extract.failed.title")} description={activeJob?.error ?? ""} icon={AlertTriangle} />
        <Card className="overflow-hidden">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center pt-6">
            <div className="flex size-20 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-error)_15%,transparent)]">
              <AlertTriangle className="size-10 text-[var(--color-error)]" />
            </div>
            <p className="text-sm text-[var(--color-fg-muted)] max-w-md">{activeJob?.error ?? t("ig_extract.failed.default")}</p>
            <Button variant="outline" onClick={() => { setPhase("setup"); setActiveJobId(null); }}>
              <ArrowRight className="size-4 rtl:rotate-180" />{t("ig_extract.failed.back")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={t("ig_extract.completed.title")} description={t("ig_extract.completed.subtitle")} icon={CheckCircle2} />

      <Card className="overflow-hidden">
        <div className="flex flex-col items-center gap-4 bg-[color-mix(in_oklab,var(--color-success)_8%,transparent)] p-8 text-center animate-[scale-in_0.4s_ease-out]">
          <div className="flex size-20 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-success)_15%,transparent)]">
            <CheckCircle2 className="size-10 text-[var(--color-success)]" />
          </div>
          <h2 className="text-xl font-extrabold text-[var(--color-success)]">{t("ig_extract.completed.success")}</h2>
          <p className="text-sm text-[var(--color-fg-muted)]">@{username.replace(/^@/, "").replace(/\/+$/, "")}</p>
          {coverage.coverage !== null && (
            <p className="text-sm font-bold text-[var(--color-fg)]">
              {t("ig_extract.completed.coverage", { value: coverage.coverage })}
            </p>
          )}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("ig_extract.completed.total")} value={(activeJob?.result_count ?? 0).toLocaleString()} icon={Users} />
        <StatCard label={t("ig_extract.completed.duration")} value={activeJob?.started_at && activeJob?.completed_at
          ? formatDuration(new Date(activeJob.started_at), new Date(activeJob.completed_at))
          : "—"} icon={Clock} />
        <StatCard label={t("ig_extract.completed.status")} value={t(`ig_extract.status.${activeJob?.status ?? "completed"}`)} icon={CheckCircle2} />
        <StatCard label={t("ig_extract.completed.skipped")} value={skipDuplicates ? t("ig_extract.completed.enabled") : t("ig_extract.completed.disabled")} icon={Download} />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center pt-6">
          <Button variant="primary" onClick={() => handleExport("csv")}>
            <Download className="size-4" />
            {t("ig_extract.completed.downloadCsv")}
          </Button>
          <Button variant="secondary" onClick={() => handleExport("json")}>
            <Download className="size-4" />JSON
          </Button>
          <Button variant="secondary" onClick={() => handleExport("xlsx")}>
            <Download className="size-4" />Excel
          </Button>
          <Button variant="outline" onClick={() => { setPhase("setup"); setActiveJobId(null); }}>
            <Zap className="size-4" />{t("ig_extract.completed.newExtraction")}
          </Button>
          {(activeJob?.result_count ?? 0) > 0 && (
            <>
              <Button variant="primary" onClick={() => navigate(`/dashboard/instagram/action/${activeJob?.id}?mode=mention`)}>
                <AtSign className="size-4" />{t("ig_actions.mentionButton")}
              </Button>
              <Button variant="secondary" onClick={() => navigate(`/dashboard/instagram/action/${activeJob?.id}?mode=dm`)}>
                <Send className="size-4" />{t("ig_actions.dmButton")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function extractRepositoryExport(jobId: string, format: ExportFormat, t: (key: string) => string) {
  try {
    const res = await extractionRepository.exportResults(jobId, format);
    window.open(res.download_url, "_blank");
    toast({ type: "success", title: t("ig_extract.exportStarted") });
  } catch (err) {
    toast({ type: "error", title: t("ig_extract.exportFailed"), description: err instanceof Error ? err.message : String(err) });
  }
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