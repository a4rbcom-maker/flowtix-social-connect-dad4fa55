import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Send, ArrowRight, Users, Loader2, MessageCircle, CheckCircle2,
  Paperclip, X, Settings2, AlertTriangle, Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { messageRepository } from "@/lib/messaging/message-repository";
import { MESSAGE_PACING_DEFAULTS, type MessagePreview } from "@/lib/messaging/types";
import { useActiveSessionsForSelect } from "@/hooks/useFbSessions";

const CHAR_LIMIT = 2000;

export function MessageComposerPage() {
  const { t } = useTranslation();
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { data: sessionOptions, isLoading: sessionsLoading } = useActiveSessionsForSelect();

  const [body, setBody] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [media, setMedia] = useState<File[]>([]);
  const [preview, setPreview] = useState<MessagePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pacing, setPacing] = useState(MESSAGE_PACING_DEFAULTS);
  const [ackCold, setAckCold] = useState(false);
  const [starting, setStarting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Load the source job name via preview endpoint (also validates eligibility)
  useEffect(() => {
    if (!jobId || !body.trim()) { setPreview(null); return; }
    let cancelled = false;
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const p = await messageRepository.preview(jobId, body);
        if (!cancelled) setPreview(p);
      } catch (err) {
        if (!cancelled) { setPreview(null); setError(err instanceof Error ? err.message : String(err)); }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [jobId, body]);

  const toggleSession = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const hasVariation = preview?.has_variation ?? false;
  const isCold = preview?.cold_outreach ?? false;
  const canStart = !!jobId && !!body.trim() && selected.size > 0 && !!preview && preview.eligible > 0 && (!isCold || ackCold);

  const handleStart = async () => {
    if (!jobId || !canStart) return;
    setStarting(true);
    setError("");
    try {
      const mediaKeys: string[] = [];
      for (const file of media) {
        const up = await messageRepository.uploadMedia(file);
        mediaKeys.push(up.key);
      }
      const result = await messageRepository.start({
        source_job_id: jobId,
        session_ids: Array.from(selected),
        body: body.trim(),
        media_keys: mediaKeys,
        ...pacing,
      });
      toast({ type: "success", title: t("messaging.startedTitle"), description: t("messaging.startedDesc", { count: result.recipient_count }) });
      setActiveJobId(result.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const selectedNames = useMemo(
    () => (sessionOptions ?? []).filter((s) => selected.has(s.value)).map((s) => s.label),
    [sessionOptions, selected],
  );

  if (activeJobId) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("messaging.progressTitle")} icon={Send} />
        <MessageProgressInline jobId={activeJobId} />
        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={() => navigate("/dashboard/tasks")}>
            <ArrowRight className="size-4 rtl:rotate-180" /> {t("messaging.backToTasks")}
          </Button>
          <Button variant="ghost" onClick={() => { setActiveJobId(null); setBody(""); setPreview(null); }}>
            {t("messaging.newMessage")}
          </Button>
        </div>
      </div>
    );
  }

  if (!jobId) {
    return (
      <div className="text-center py-20">
        <p className="text-[var(--color-fg-muted)]">{t("messaging.noSourceJob")}</p>
        <Button variant="ghost" onClick={() => navigate("/dashboard/tasks")} className="mt-3">
          <ArrowRight className="size-4 rtl:rotate-180" /> {t("messaging.backToTasks")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("messaging.title")} description={t("messaging.subtitle")} icon={MessageCircle} />

      <div className="grid gap-6 xl:grid-cols-5">
        {/* LEFT: composer */}
        <Card className="xl:col-span-3">
          <CardContent className="p-5 space-y-4">
            <div className="relative">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t("messaging.bodyPlaceholder")}
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3 text-sm resize-none min-h-[180px] focus:outline-none focus:border-[var(--color-primary)]/60 focus:ring-2 focus:ring-[var(--color-primary)]/10"
                maxLength={CHAR_LIMIT}
                dir="auto"
              />
              <div className={cn(
                "absolute bottom-3 end-3 text-[11px] font-mono px-2 py-0.5 rounded-md",
                body.length > CHAR_LIMIT * 0.9 ? "bg-[var(--color-error)]/10 text-[var(--color-error)]" : "bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]",
              )}>{body.length}/{CHAR_LIMIT}</div>
            </div>

            {/* Spintax hint */}
            <div className="flex items-start gap-2.5 rounded-lg border border-[var(--color-primary)]/15 bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)] p-3 text-xs">
              <Sparkles className="size-4 shrink-0 text-[var(--color-primary)] mt-0.5" aria-hidden />
              <div className="space-y-1">
                <p className="text-[var(--color-fg)]">{t("messaging.spintaxHint")}</p>
                <button
                  type="button"
                  className="text-[var(--color-primary)] underline underline-offset-2 hover:opacity-80"
                  onClick={() => setBody((b) => `${b}{${t("messaging.spintaxExample")}}`)}
                >
                  {t("messaging.insertExample")}
                </button>
              </div>
            </div>

            {!hasVariation && body.trim().length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/25 bg-[color-mix(in_oklab,var(--color-warning)_8%,transparent)] p-3 text-xs text-[var(--color-warning)]" role="alert">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden />
                <span>{t("messaging.warn.noVariation")}</span>
              </div>
            )}

            {/* Attachments */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--color-fg-muted)]">{t("messaging.attachments")}:</span>
              <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden"
                onChange={(e) => { if (e.target.files) setMedia((prev) => [...prev, ...Array.from(e.target.files!)].slice(0, 4)); }} />
              <button type="button"
                className="flex items-center gap-2 text-sm h-9 px-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] hover:bg-[var(--color-surface-2)] transition-colors"
                onClick={() => fileRef.current?.click()}>
                <Paperclip className="size-4" />
                {media.length > 0 ? t("messaging.attachedCount", { count: media.length }) : t("messaging.attachMedia")}
              </button>
              {media.length > 0 && (
                <button type="button" className="flex items-center gap-1 h-9 px-2 text-sm text-[var(--color-error)] hover:bg-[var(--color-error)]/10 rounded-lg transition-colors" onClick={() => setMedia([])}>
                  <X className="size-3" /> {t("common.remove")}
                </button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* RIGHT: sessions + pacing + preview */}
        <div className="xl:col-span-2 space-y-5">
          {/* Sessions */}
          <Card>
            <CardContent className="p-5 space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Users className="size-4 text-[var(--color-fg-muted)]" /> {t("messaging.sessions")}
              </p>
              {sessionsLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (sessionOptions ?? []).length === 0 ? (
                <p className="text-xs text-[var(--color-fg-muted)] py-2">{t("messaging.noSessions")}</p>
              ) : (
                <div className="space-y-2">
                  {(sessionOptions ?? []).map((s) => (
                    <label key={s.value} className="flex items-center gap-2.5 text-sm cursor-pointer">
                      <Checkbox checked={selected.has(s.value)} onChange={() => toggleSession(s.value)} />
                      <span className="truncate">{s.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pacing */}
          <Card>
            <CardContent className="p-5 space-y-3">
              <p className="text-sm font-semibold flex items-center gap-2">
                <Settings2 className="size-4 text-[var(--color-fg-muted)]" /> {t("messaging.pacing.title")}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-[11px] text-[var(--color-fg-muted)]">{t("messaging.pacing.dailyCap")}</span>
                  <input type="number" min={1} max={80} value={pacing.daily_cap}
                    onChange={(e) => setPacing((p) => ({ ...p, daily_cap: +e.target.value }))}
                    className="w-full h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm focus:outline-none focus:border-[var(--color-primary)]/60" />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-[var(--color-fg-muted)]">{t("messaging.pacing.perHour")}</span>
                  <input type="number" min={1} max={20} value={pacing.rate_per_hour}
                    onChange={(e) => setPacing((p) => ({ ...p, rate_per_hour: +e.target.value }))}
                    className="w-full h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm focus:outline-none focus:border-[var(--color-primary)]/60" />
                </label>
              </div>
              <label className="flex items-center gap-2.5 text-sm cursor-pointer">
                <Checkbox checked={pacing.respect_quiet_hours} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPacing((p) => ({ ...p, respect_quiet_hours: e.target.checked }))} />
                <span className="text-[var(--color-fg-muted)]">{t("messaging.pacing.quietHours")}</span>
              </label>
            </CardContent>
          </Card>

          {/* Preview */}
          {previewLoading ? (
            <Card><CardContent className="p-5 space-y-2">
              <Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" />
            </CardContent></Card>
          ) : preview ? (
            <Card>
              <CardContent className="p-5 space-y-3">
                <p className="text-sm font-semibold">{t("messaging.preview.title")}</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-[var(--color-surface-2)] p-2.5">
                    <p className="text-xl font-bold tabular-nums">{preview.eligible}</p>
                    <p className="text-[10px] text-[var(--color-fg-muted)]">{t("messaging.preview.eligible")}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--color-surface-2)] p-2.5">
                    <p className="text-xl font-bold tabular-nums">{preview.est_days}</p>
                    <p className="text-[10px] text-[var(--color-fg-muted)]">{t("messaging.preview.estDays")}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--color-surface-2)] p-2.5">
                    <p className="text-xl font-bold tabular-nums">{preview.skipped_unsupported}</p>
                    <p className="text-[10px] text-[var(--color-fg-muted)]">{t("messaging.preview.skipped")}</p>
                  </div>
                </div>
                {preview.sample.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-[var(--color-fg-muted)]">{t("messaging.preview.samples")}</p>
                    {preview.sample.map((s, i) => (
                      <p key={i} className="text-xs rounded-lg bg-[var(--color-surface-2)] px-3 py-2 line-clamp-2" dir="auto">{s}</p>
                    ))}
                  </div>
                )}
                {isCold && (
                  <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/25 bg-[color-mix(in_oklab,var(--color-warning)_8%,transparent)] p-3 text-xs text-[var(--color-warning)]" role="alert">
                    <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden />
                    <span>{t("messaging.warn.coldOutreach")}</span>
                  </div>
                )}
                {isCold && (
                  <label className="flex items-center gap-2.5 text-xs cursor-pointer">
                    <Checkbox checked={ackCold} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAckCold(e.target.checked)} />
                    <span className="text-[var(--color-fg-muted)]">{t("messaging.warn.coldAck")}</span>
                  </label>
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
            {starting ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
            {starting ? t("messaging.starting") : t("messaging.startButton")}
          </Button>
          {selectedNames.length > 0 && (
            <p className="text-center text-xs text-[var(--color-fg-subtle)]">
              <Badge variant="primary" className="gap-1"><CheckCircle2 className="size-3" />{selectedNames.join(" · ")}</Badge>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Inline progress after starting — real-time polling from /messages/:jobId */
function MessageProgressInline({ jobId }: { jobId: string }) {
  const { t } = useTranslation();
  const { data } = useMessageJobQuery(jobId);
  if (!data) return <Skeleton className="h-40 w-full" />;
  const p = data.job?.progress as { sent?: number; failed?: number; skipped?: number } | null;
  const sent = p?.sent ?? 0;
  const failed = p?.failed ?? 0;
  const skipped = p?.skipped ?? 0;
  const total = Math.max(sent + failed + skipped, 1);
  const pct = Math.round(((sent + failed + skipped) / Math.max(total, sent + failed + skipped || 1)) * 100);

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="grid grid-cols-4 gap-3 text-center">
          {[
            [sent + failed + skipped, t("messaging.progress.total"), "text-[var(--color-fg)]"],
            [sent, t("messaging.progress.sent"), "text-[var(--color-success)]"],
            [failed, t("messaging.progress.failed"), "text-[var(--color-error)]"],
            [skipped, t("messaging.progress.skipped"), "text-[var(--color-warning)]"],
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
        <p className="text-center text-xs text-[var(--color-fg-muted)]" aria-live="polite">
          {t(`messaging.status.${data.job?.status ?? "queued"}`)}
        </p>
      </CardContent>
    </Card>
  );
}

import { useMessageJob as useMessageJobQuery } from "@/hooks/useMessageJobs";
