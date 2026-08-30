import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AtSign, Send, ArrowRight, Users, Loader2, MessageCircle, CheckCircle2, AlertTriangle, Sparkles, Link2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { igActionRepository } from "@/lib/ig-actions/ig-action-repository";
import { IG_MENTION_DEFAULTS, IG_DM_DEFAULTS, type IgActionMode, type IgActionPacing, type IgActionPreview } from "@/lib/ig-actions/types";
import { IgMultiSessionSelector } from "@/components/extraction/IgMultiSessionSelector";
import { useIgActionJob, useIgActionActions } from "@/hooks/useIgActions";

const CHAR_LIMIT = 2000;

export function IgActionPage() {
  const { t } = useTranslation();
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialMode = (params.get("mode") as IgActionMode) || "mention";

  const [mode, setMode] = useState<IgActionMode>(initialMode);
  const [body, setBody] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [primarySessionId, setPrimarySessionId] = useState("");
  const [secondaryIds, setSecondaryIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<IgActionPreview | undefined>(undefined);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pacing, setPacing] = useState<IgActionPacing>(IG_MENTION_DEFAULTS);
  const [starting, setStarting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [sourceInfo, setSourceInfo] = useState<{ name: string; type: string; result_count: number; source?: string | null } | null>(null);
  const timer = useRef<number | null>(null);

  const sessionIds = useMemo(
    () => [primarySessionId, ...secondaryIds].filter(Boolean).slice(0, 2),
    [primarySessionId, secondaryIds],
  );

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      try {
        const { supabase } = await import("@/lib/supabase");
        const { data } = await supabase.from("extraction_jobs").select("name, type, source, result_count").eq("id", jobId).single();
        if (!cancelled && data) setSourceInfo(data);
      } catch { /* card simply stays hidden */ }
    })();
    return () => { cancelled = true; };
  }, [jobId]);

  // reset pacing when toggling mode
  useEffect(() => {
    setPacing(mode === "mention" ? IG_MENTION_DEFAULTS : IG_DM_DEFAULTS);
  }, [mode]);

  // debounced preview (no start yet)
  useEffect(() => {
    if (!jobId || !body.trim()) { setPreview(undefined); return; }
    let cancelled = false;
    setPreviewLoading(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      try {
        const p = await igActionRepository.preview(jobId, mode, body, mode === "mention" ? pacing.mentions_per_comment : undefined);
        if (!cancelled) setPreview(p);
      } catch (err) {
        if (!cancelled) { setPreview(undefined); setError(err instanceof Error ? err.message : String(err)); }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 600);
    return () => { cancelled = true; if (timer.current) window.clearTimeout(timer.current); };
  }, [jobId, body, mode, pacing.mentions_per_comment]);

  const postUrlValid = !postUrl || /^https?:\/\/(www\.)?instagram\.com\/(p|reel)\/[A-Za-z0-9_-]+/.test(postUrl);
  const canStart = !!jobId && !!body.trim() && sessionIds.length > 0 && !!preview && preview.eligible > 0 &&
    (mode === "dm" || postUrlValid);

  const handleStart = async () => {
    if (!jobId || !canStart) return;
    setStarting(true);
    setError("");
    try {
      const result = await igActionRepository.start({
        source_job_id: jobId,
        session_ids: sessionIds,
        mode,
        body: body.trim(),
        post_url: mode === "mention" ? postUrl.trim() || undefined : undefined,
        mentions_per_comment: mode === "mention" ? pacing.mentions_per_comment : undefined,
        comments_per_hour: mode === "mention" ? pacing.comments_per_hour : undefined,
        daily_cap: pacing.daily_cap,
        rate_per_hour: pacing.rate_per_hour,
        delay_min: pacing.delay_min,
        delay_max: pacing.delay_max,
        batch_size: pacing.batch_size,
        batch_pause: pacing.batch_pause,
        respect_quiet_hours: pacing.respect_quiet_hours,
        max_errors: pacing.max_errors,
        retry_max: pacing.retry_max,
      });
      toast({ type: "success", title: t("ig_actions.startedTitle"), description: t("ig_actions.startedDesc", { count: result.recipient_count }) });
      setActiveJobId(result.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  if (activeJobId) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("ig_actions.progressTitle")} icon={mode === "mention" ? AtSign : Send} />
        <IgActionProgressInline jobId={activeJobId} />
        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={() => navigate("/dashboard/tasks")}>
            <ArrowRight className="size-4 rtl:rotate-180" /> {t("ig_actions.backToTasks")}
          </Button>
          <Button variant="ghost" onClick={() => { setActiveJobId(null); setBody(""); setPreview(undefined); }}>{t("ig_actions.newAction")}</Button>
        </div>
      </div>
    );
  }

  if (!jobId) {
    return (
      <div className="text-center py-20">
        <p className="text-[var(--color-fg-muted)]">{t("ig_actions.noSourceJob")}</p>
        <Button variant="ghost" onClick={() => navigate("/dashboard/tasks")} className="mt-3">
          <ArrowRight className="size-4 rtl:rotate-180" /> {t("ig_actions.backToTasks")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("ig_actions.title")} description={t("ig_actions.subtitle")} icon={MessageCircle} />

      {sourceInfo && (
        <Card className="overflow-hidden">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]">
                <Users className="size-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--color-fg)]">{t("ig_actions.source.task")}: {sourceInfo.name}</p>
                <p className="text-xs text-[var(--color-fg-muted)] truncate">
                  {sourceInfo.source ? `${t("ig_actions.source.from")}: ${sourceInfo.source}` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 ms-auto">
              <div className="text-center">
                <p className="text-xl font-bold tabular-nums text-[var(--color-fg)]">{(sourceInfo.result_count ?? 0).toLocaleString()}</p>
                <p className="text-[10px] text-[var(--color-fg-muted)]">{t("ig_actions.source.extracted")}</p>
              </div>
              <div className="h-8 w-px bg-[var(--color-border)]" aria-hidden />
              <div className="text-center">
                <p className="text-xl font-bold tabular-nums text-[var(--color-success)]">
                  {previewLoading ? <Loader2 className="size-5 animate-spin mx-auto" /> : (preview?.eligible ?? "—").toLocaleString?.() ?? preview?.eligible}
                </p>
                <p className="text-[10px] text-[var(--color-fg-muted)]">{t("ig_actions.source.eligible")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mode selector — two cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {([
          { m: "mention" as const, icon: AtSign, title: t("ig_actions.mode.mention"), desc: t("ig_actions.mode.mentionDesc") },
          { m: "dm" as const, icon: Send, title: t("ig_actions.mode.dm"), desc: t("ig_actions.mode.dmDesc") },
        ]).map((opt) => {
          const active = mode === opt.m;
          return (
            <button
              key={opt.m}
              type="button"
              onClick={() => setMode(opt.m)}
              className={cn(
                "text-start rounded-xl border-2 p-4 transition-colors",
                active ? "border-[var(--color-primary)] bg-[color-mix(in_oklab,var(--color-primary)_8%,transparent)]" : "border-[var(--color-border)] hover:bg-[var(--color-surface-2)]",
              )}
            >
              <div className="flex items-center gap-3">
                <span className={cn("flex size-12 items-center justify-center rounded-xl", active ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]")}>
                  <opt.icon className="size-6" aria-hidden />
                </span>
                <div>
                  <p className="font-semibold text-[var(--color-fg)]">{opt.title}</p>
                  <p className="text-xs text-[var(--color-fg-muted)]">{opt.desc}</p>
                </div>
                <span className={cn("ms-auto size-4 rounded-full border-2", active ? "border-[var(--color-primary)] bg-[var(--color-primary)]" : "border-[var(--color-border)]")} aria-hidden />
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        {/* LEFT: composer */}
        <Card className="xl:col-span-3">
          <CardContent className="p-5 space-y-4">
            {mode === "mention" && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-fg-muted)] flex items-center gap-1.5">
                  <Link2 className="size-3.5" /> {t("ig_actions.postUrlPlaceholder")}
                </label>
                <input
                  value={postUrl}
                  onChange={(e) => setPostUrl(e.target.value)}
                  placeholder="https://www.instagram.com/p/CODE/  —  https://www.instagram.com/reel/CODE/"
                  className={cn(
                    "w-full h-10 rounded-lg border bg-[var(--color-bg)] px-3 text-sm focus:outline-none focus:ring-2",
                    !postUrlValid ? "border-[var(--color-error)] focus:border-[var(--color-error)]/60 focus:ring-[var(--color-error)]/10" : "border-[var(--color-border)] focus:border-[var(--color-primary)]/60 focus:ring-[var(--color-primary)]/10",
                  )}
                  dir="ltr"
                />
                {!postUrlValid && <p className="text-xs text-[var(--color-error)]">{t("ig_actions.invalidPostUrl")}</p>}
              </div>
            )}

            <div className="relative">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t("ig_actions.bodyPlaceholder")}
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-sm resize-none min-h-[180px] focus:outline-none focus:border-[var(--color-primary)]/60 focus:ring-2 focus:ring-[var(--color-primary)]/10"
                maxLength={CHAR_LIMIT}
                dir="auto"
              />
              <div className={cn(
                "absolute bottom-3 end-3 text-[11px] font-mono px-2 py-0.5 rounded-md",
                body.length > CHAR_LIMIT * 0.9 ? "bg-[var(--color-error)]/10 text-[var(--color-error)]" : "bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]",
              )}>{body.length}/{CHAR_LIMIT}</div>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-[var(--color-primary)]/15 bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)] p-3 text-xs">
              <Sparkles className="size-4 shrink-0 text-[var(--color-primary)] mt-0.5" aria-hidden />
              <div className="space-y-1">
                <p className="text-[var(--color-fg)]">{t("ig_actions.spintaxHint")}</p>
                <button type="button" className="text-[var(--color-primary)] underline underline-offset-2 hover:opacity-80" onClick={() => setBody((b) => `${b}{مرحبا|أهلا} {{name}}`)}>
                  {t("ig_actions.insertExample")}
                </button>
              </div>
            </div>

            {mode === "mention" && (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/25 bg-[color-mix(in_oklab,var(--color-warning)_8%,transparent)] p-3 text-xs text-[var(--color-warning)]" role="alert">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden />
                <span>{t("ig_actions.warn.mentionOnYourPost")}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* RIGHT: sessions + pacing + preview */}
        <div className="xl:col-span-2 space-y-5">
          <Card>
            <CardContent className="p-5">
              <IgMultiSessionSelector
                primarySessionId={primarySessionId}
                onPrimarySessionChange={setPrimarySessionId}
                secondarySessionIds={secondaryIds}
                onSecondarySessionIdsChange={setSecondaryIds}
                label={t("ig_actions.sessions")}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2">
                {mode === "mention" ? <AtSign className="size-4 text-[var(--color-fg-muted)]" /> : <Send className="size-4 text-[var(--color-fg-muted)]" />}
                {t("ig_actions.settings.title")}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {mode === "mention" ? (
                  <>
                    <label className="space-y-1">
                      <span className="text-[11px] text-[var(--color-fg-muted)]">{t("ig_actions.settings.mentionsPerComment")}</span>
                      <input type="number" min={1} max={5} value={pacing.mentions_per_comment}
                        onChange={(e) => setPacing((p) => ({ ...p, mentions_per_comment: +e.target.value }))}
                        className="w-full h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm focus:outline-none focus:border-[var(--color-primary)]/60" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-[var(--color-fg-muted)]">{t("ig_actions.settings.commentsPerHour")}</span>
                      <input type="number" min={1} max={12} value={pacing.comments_per_hour}
                        onChange={(e) => setPacing((p) => ({ ...p, comments_per_hour: +e.target.value }))}
                        className="w-full h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm focus:outline-none focus:border-[var(--color-primary)]/60" />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="space-y-1">
                      <span className="text-[11px] text-[var(--color-fg-muted)]">{t("ig_actions.settings.dailyCap")}</span>
                      <input type="number" min={1} max={30} value={pacing.daily_cap}
                        onChange={(e) => setPacing((p) => ({ ...p, daily_cap: +e.target.value }))}
                        className="w-full h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm focus:outline-none focus:border-[var(--color-primary)]/60" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-[var(--color-fg-muted)]">{t("ig_actions.settings.perHour")}</span>
                      <input type="number" min={1} max={20} value={pacing.rate_per_hour}
                        onChange={(e) => setPacing((p) => ({ ...p, rate_per_hour: +e.target.value }))}
                        className="w-full h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm focus:outline-none focus:border-[var(--color-primary)]/60" />
                    </label>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {previewLoading ? (
            <Card><CardContent className="p-5 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></CardContent></Card>
          ) : preview ? (
            <Card>
              <CardContent className="p-5 space-y-3">
                <p className="text-sm font-semibold">{t("ig_actions.preview.title")}</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-[var(--color-surface-2)] p-2.5">
                    <p className="text-xl font-bold tabular-nums">{preview.eligible}</p>
                    <p className="text-[10px] text-[var(--color-fg-muted)]">{t("ig_actions.preview.eligible")}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--color-surface-2)] p-2.5">
                    <p className="text-xl font-bold tabular-nums">{mode === "mention" ? preview.comments_needed : preview.eligible}</p>
                    <p className="text-[10px] text-[var(--color-fg-muted)]">{mode === "mention" ? t("ig_actions.preview.comments") : t("ig_actions.preview.messages")}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--color-surface-2)] p-2.5">
                    <p className="text-xl font-bold tabular-nums">{preview.est_hours}</p>
                    <p className="text-[10px] text-[var(--color-fg-muted)]">{t("ig_actions.preview.estHours")}</p>
                  </div>
                </div>
                {mode === "mention" && preview.comments_needed > 0 && (
                  <p className="text-xs text-[var(--color-fg-muted)]">{t("ig_actions.preview.commentNote", { comments: preview.comments_needed })}</p>
                )}
                {preview.sample.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-[var(--color-fg-muted)]">{t("ig_actions.preview.samples")}</p>
                    {preview.sample.map((s: string, i: number) => (
                      <p key={i} className="text-xs rounded-lg bg-[var(--color-surface-2)] px-3 py-2 line-clamp-2" dir="auto">{s}</p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {error && (
            <div className="flex items-center gap-2 justify-center text-sm text-[var(--color-error)] bg-[var(--color-error)]/5 py-3 px-4 rounded-lg border border-[var(--color-error)]/20" role="alert">
              <AlertTriangle className="size-4 shrink-0" /> {error}
            </div>
          )}

          <Button className="w-full h-12 text-base font-semibold gap-2 rounded-xl" onClick={handleStart} disabled={!canStart || starting}>
            {starting ? <Loader2 className="size-5 animate-spin" /> : mode === "mention" ? <AtSign className="size-5" /> : <Send className="size-5" />}
            {starting ? t("ig_actions.starting") : t("ig_actions.startButton")}
          </Button>
          {sessionIds.length > 0 && (
            <p className="text-center text-xs text-[var(--color-fg-subtle)]">
              <Badge variant="primary" className="gap-1"><CheckCircle2 className="size-3" />{sessionIds.length} {t("ig_actions.sessionsSelected")}</Badge>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function IgActionProgressInline({ jobId }: { jobId: string }) {
  const { t } = useTranslation();
  const { data } = useIgActionJob(jobId);
  const { pause, resume, stop } = useIgActionActions(jobId);
  if (!data) return <Skeleton className="h-40 w-full" />;
  const p = data.job?.progress as { sent?: number; failed?: number; skipped?: number } | null;
  const sent = p?.sent ?? 0;
  const failed = p?.failed ?? 0;
  const skipped = p?.skipped ?? 0;
  const processed = sent + failed + skipped;
  const pct = processed > 0 ? Math.round((sent / Math.max(processed, 1)) * 100) : 0;
  const status = data.job?.status ?? "queued";

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="grid grid-cols-4 gap-3 text-center">
          {[
            [processed, t("ig_actions.progress.total"), "text-[var(--color-fg)]"],
            [sent, t("ig_actions.progress.sent"), "text-[var(--color-success)]"],
            [failed, t("ig_actions.progress.failed"), "text-[var(--color-error)]"],
            [skipped, t("ig_actions.progress.skipped"), "text-[var(--color-warning)]"],
          ].map(([v, label, cls]) => (
            <div key={label as string}>
              <p className={cn("text-2xl font-bold tabular-nums", cls as string)}>{v as number}</p>
              <p className="text-xs text-[var(--color-fg-muted)]">{label as string}</p>
            </div>
          ))}
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-3)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-center text-xs text-[var(--color-fg-muted)]" aria-live="polite">{t(`ig_actions.status.${status}`)}</p>
        <div className="flex gap-2 justify-center">
          {status === "running" && <Button variant="outline" size="sm" onClick={() => pause.mutate()} disabled={pause.isPending}>{t("ig_actions.pause")}</Button>}
          {status === "paused" && <Button variant="outline" size="sm" onClick={() => resume.mutate()} disabled={resume.isPending}>{t("ig_actions.resume")}</Button>}
          {(status === "running" || status === "paused") && <Button variant="ghost" size="sm" onClick={() => stop.mutate()} disabled={stop.isPending}>{t("ig_actions.stop")}</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
