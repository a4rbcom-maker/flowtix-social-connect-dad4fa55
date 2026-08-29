import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Users, MessageCircle, Loader2, Play, ArrowLeft, ArrowRight,
  AlertTriangle, Download, CheckCircle2, XCircle, Square,
  Check, ChevronLeft, ListChecks, Sparkles, Clock,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useAudioNotification } from "@/hooks/useAudioNotification";
import { FbSessionSelector } from "@/components/extraction/FbSessionSelector";
import { useStartExtraction, useContinueExtraction, useCancelExtraction, useExportResults, useExtractionJobs } from "@/hooks/useExtractionJobs";
import { extractionRepository } from "@/lib/extraction/extraction-repository";
import type { ExtractionJob, ExportFormat, MemberSourceType } from "@/lib/extraction/types";

interface ManagedPage {
  id: string;
  name: string;
  username: string;
  followers: string;
  picture_url: string;
  category: string;
}

type Phase = "idle" | "loading" | "select" | "settings" | "running" | "completed" | "failed" | "noPages" | "error";

const CONTACTS_TYPE: MemberSourceType = "messenger-contacts";

export function ExtractContactsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("idle");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [pages, setPages] = useState<ManagedPage[]>([]);
  const [selectedPage, setSelectedPage] = useState<ManagedPage | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [activeJob, setActiveJob] = useState<ExtractionJob | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const { data: jobs } = useExtractionJobs();

  useEffect(() => {
    if (!jobs) return;
    const active = jobs.find((j) => j.status === "running" || j.status === "queued");
    if (active && active.type === "messenger_contacts") {
      setActiveJob(active as unknown as ExtractionJob);
      setPhase("running");
      return;
    }
    // Polling fallback: realtime channel can drop silently — reconcile from
    // the 3s-polled jobs list so the UI never stays stuck on "running".
    if (!activeJob) return;
    const fresh = jobs.find((j) => j.id === activeJob.id);
    if (!fresh || fresh.updated_at === (activeJob as ExtractionJob).updated_at) return;
    const updated = fresh as unknown as ExtractionJob;
    setActiveJob(updated);
    if (updated.status === "completed") setPhase("completed");
    else if (updated.status === "failed") { setPhase("failed"); setErrorMsg(updated.error || ""); }
    else if (updated.status === "canceled") setPhase("idle");
  }, [jobs, activeJob]);

  useAudioNotification(phase === "completed");

  const startExtraction = useStartExtraction();
  const continueExtraction = useContinueExtraction();
  const cancelExtraction = useCancelExtraction();
  const exportResults = useExportResults();

  const fetchPages = useCallback(async () => {
    if (!selectedSessionId) return;
    setPhase("loading");
    setErrorMsg("");
    try {
      const apiUrl = import.meta.env.VITE_EXTRACTION_API_URL || "http://localhost:3100";
      const apiKey = import.meta.env.VITE_EXTRACTION_API_KEY || "";
      const res = await fetch(`${apiUrl}/list-pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ session_id: selectedSessionId }),
      });
      if (!res.ok) throw new Error("Failed to fetch pages");
      const data = await res.json();
      if (!data.pages || data.pages.length === 0) {
        setPhase("noPages");
        return;
      }
      setPages(data.pages);
      setPhase("select");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setPhase("error");
    }
  }, [selectedSessionId]);

  useEffect(() => {
    if (!activeJob) return;
    const sub = extractionRepository.subscribeToJob(activeJob.id, (job) => {
      setActiveJob(job);
      if (job.status === "completed") setPhase("completed");
      else if (job.status === "failed") {
        setPhase("failed");
        setErrorMsg(job.error || "");
      }
      else if (job.status === "paused" && (job.config as any)?.cursor) {
        continueExtraction.mutate({
          jobId: job.id,
          cursor: (job.config as any).cursor,
          maxResults: 100000,
          skipDuplicates,
          sessionId: selectedSessionId || "",
          dbType: "messenger_contacts",
          sourceUrl: selectedPage?.id?.startsWith("id_") ? selectedPage.id.replace("id_", "") : (selectedPage?.id || ""),
        });
      }
    });
    return () => { if (sub) extractionRepository.unsubscribe(sub); };
  }, [activeJob?.id]);

  const handleChoosePage = (page: ManagedPage) => {
    setSelectedPage(page);
    setPhase("settings");
    setErrorMsg("");
  };

  const handleStart = async () => {
    if (!selectedSessionId || !selectedPage) return;
    setPhase("running");
    setErrorMsg("");
    const pageId = selectedPage.id.startsWith("id_") ? selectedPage.id.replace("id_", "") : selectedPage.id;
    try {
      const result = await startExtraction.mutateAsync({
        session_id: selectedSessionId,
        type: CONTACTS_TYPE,
        source_url: pageId,
        job_name: `جهات اتصال - ${selectedPage.name}`,
        max_results: 100000,
        skip_duplicates: skipDuplicates,
      });
      if (result?.job_id) {
        const job = await extractionRepository.getJob(result.job_id);
        if (job) {
          setActiveJob(job as unknown as ExtractionJob);
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to start extraction");
      setPhase("failed");
    }
  };

  const handleStop = async () => {
    if (!activeJob) return;
    await cancelExtraction.mutateAsync(activeJob.id);
    setPhase("select");
    setActiveJob(null);
    toast({ type: "info", title: t("pages.tasks.stopDone") });
  };

  const handleExport = async (format: ExportFormat) => {
    if (!activeJob) return;
    try {
      await exportResults.mutateAsync({ jobId: activeJob.id, format } as any);
      toast({ type: "success", title: t("extract.exportStarted"), description: `flowtix-export-${activeJob.id}.${format}` });
    } catch (err) {
      toast({ type: "error", title: t("extract.exportFailed"), description: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleComposeMessage = () => {
    if (!activeJob) return;
    navigate(`/dashboard/messenger/compose/${activeJob.id}`);
  };

  const handleBackToSelection = () => {
    setPhase("select");
    setSelectedPage(null);
    setErrorMsg("");
  };

  const handleStartNew = () => {
    setPhase("idle");
    setSelectedPage(null);
    setActiveJob(null);
    setErrorMsg("");
  };

  const handleBackToTasks = () => {
    navigate("/dashboard/tasks");
  };

  const jobProgress = (activeJob as any)?.progress;
  const progress = jobProgress?.estimate && jobProgress.estimate !== "ongoing"
    ? jobProgress.estimate
    : activeJob?.result_count
      ? Math.min(activeJob.result_count, 99)
      : 0;
  const progressDiscovered = jobProgress?.discovered || activeJob?.result_count || 0;
  const progressPhase = jobProgress?.phase || "";
  const isProgressIndeterminate = progress === "ongoing" || !jobProgress?.estimate;

  const stats = useMemo(() => {
    const count = activeJob?.result_count || 0;
    return {
      count: count.toLocaleString(),
      hasPartial: activeJob?.status === "failed" && count > 0,
      hasMessage: activeJob && count > 0,
    };
  }, [activeJob]);

  return (
    <div className="space-y-6 animate-[fade-up_0.4s_ease-out]">
      <PageHeader
        title={t("pages.messengerContacts.title")}
        description={t("pages.messengerContacts.selectPageDesc")}
        icon={MessageCircle}
        action={
          phase === "completed" || phase === "failed" ? (
            <Button variant="outline" onClick={handleBackToTasks}>
              <ListChecks className="size-4" />
              قائمة المهام
            </Button>
          ) : undefined
        }
      />

      {/* ─── Idle: Hero with gradient + session selection ─── */}
      {phase === "idle" && (
        <Card className="overflow-hidden border-0 bg-gradient-to-br from-[var(--color-primary)]/8 via-[var(--color-secondary)]/5 to-transparent">
          <CardContent className="p-0">
            <div className="grid gap-0 md:grid-cols-[1fr_360px]">
              <div className="p-8 md:p-10 space-y-6">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] px-3 py-1 text-xs font-semibold text-[var(--color-primary-soft)]">
                  <Sparkles className="size-3" />
                  استخراج متقدم لجهات الاتصال
                </div>
                <div className="space-y-2">
                  <h1 className="text-2xl md:text-3xl font-bold leading-tight text-[var(--color-fg)]">
                    استخرج كل من تواصل مع صفحتك
                  </h1>
                  <p className="text-sm md:text-base text-[var(--color-fg-muted)] max-w-md">
                    يقوم النظام بسحب جهات الاتصال تلقائياً من Business Suite Inbox
                    مع حذف الصفحات والمتاجر والإعلانات — أشخاص حقيقيون فقط.
                  </p>
                </div>
                <ul className="space-y-2.5 text-sm">
                  {[
                    "بدون حد أقصى للنتائج",
                    "تصفية تلقائية للصفحات والمؤسسات",
                    "إزالة التكرار قبل الحفظ",
                    "تصدير CSV / JSON بضغطة واحدة",
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-2 text-[var(--color-fg-muted)]">
                      <span className="flex size-5 items-center justify-center rounded-full bg-[var(--color-success)]/15 text-[var(--color-success)]">
                        <Check className="size-3" />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-[var(--color-surface)]/60 backdrop-blur p-6 md:p-8 space-y-4 border-t md:border-t-0 md:border-s border-[var(--color-border)]">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-[var(--color-fg)]">اختر جلسة فيسبوك</label>
                  <p className="text-xs text-[var(--color-fg-muted)]">يجب أن تكون الجلسة متصلة ونشطة</p>
                </div>
                <FbSessionSelector value={selectedSessionId} onChange={setSelectedSessionId} />
                <Button
                  size="lg"
                  className="w-full gap-2"
                  onClick={fetchPages}
                  disabled={!selectedSessionId}
                >
                  <MessageCircle className="size-4" />
                  جلب الصفحات المدارة
                  <ArrowLeft className="size-4 rtl:rotate-180" />
                </Button>
                <p className="text-[0.65rem] text-[var(--color-fg-subtle)] text-center">
                  يتم جلب قائمة الصفحات من فيسبوك مباشرة
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Loading: Skeleton grid ─── */}
      {phase === "loading" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i}>
              <CardContent className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-14 rounded-2xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ─── Error: Friendly retry ─── */}
      {phase === "error" && (
        <Card className="max-w-md mx-auto border-[var(--color-error)]/20">
          <CardContent className="flex flex-col items-center gap-5 py-12 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-error)_12%,transparent)]">
              <AlertTriangle className="size-8 text-[var(--color-error)]" />
            </div>
            <div className="space-y-1.5">
              <p className="text-lg font-semibold">{t("pages.messengerContacts.fetchPagesError")}</p>
              {errorMsg && <p className="text-sm text-[var(--color-fg-muted)]">{errorMsg}</p>}
            </div>
            <Button onClick={fetchPages} className="gap-2">
              <Loader2 className="size-4" />
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── No Pages: Empty state ─── */}
      {phase === "noPages" && (
        <Card className="max-w-md mx-auto">
          <CardContent className="flex flex-col items-center gap-5 py-12 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-[var(--color-surface-2)]">
              <Users className="size-8 text-[var(--color-fg-muted)]" />
            </div>
            <div className="space-y-1.5">
              <p className="text-lg font-semibold">{t("pages.messengerContacts.noPages")}</p>
              <p className="text-sm text-[var(--color-fg-muted)]">{t("pages.messengerContacts.noPagesDesc")}</p>
            </div>
            <Button onClick={fetchPages} variant="outline" className="gap-2">
              <Loader2 className="size-4" />
              تحديث
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── Page Selection ─── */}
      {phase === "select" && pages.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[var(--color-fg)]">اختر صفحة لاستخراج جهات الاتصال</h2>
              <p className="text-sm text-[var(--color-fg-muted)] mt-0.5">
                {pages.length} {pages.length === 1 ? "صفحة متاحة" : "صفحات متاحة"}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={handleStartNew} className="gap-1.5">
              <ArrowRight className="size-3.5 rtl:rotate-180" />
              تغيير الجلسة
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pages.map((page) => (
              <Card
                key={page.id}
                className="group relative overflow-hidden cursor-pointer transition-all duration-200 hover:border-[var(--color-primary)]/50 hover:shadow-[var(--shadow-md)]"
                onClick={() => handleChoosePage(page)}
              >
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] opacity-0 group-hover:opacity-100 transition-opacity" />
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    {page.picture_url ? (
                      <img
                        src={page.picture_url}
                        alt={page.name}
                        className="size-14 rounded-2xl object-cover border-2 border-[var(--color-border)]"
                      />
                    ) : (
                      <div className="size-14 rounded-2xl bg-[var(--color-surface-2)] flex items-center justify-center">
                        <Users className="size-7 text-[var(--color-fg-muted)]" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate text-[var(--color-fg)]">{page.name}</p>
                      {page.category && (
                        <p className="text-xs text-[var(--color-fg-muted)] truncate mt-0.5">{page.category}</p>
                      )}
                      {page.followers && (
                        <Badge variant="outline" className="mt-1.5 text-[0.65rem]">
                          {page.followers} {t("pages.messengerContacts.followers")}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button className="w-full gap-2" size="sm">
                    <MessageCircle className="size-3.5" />
                    {t("pages.messengerContacts.extract")}
                    <ArrowLeft className="size-3.5 rtl:rotate-180" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ─── Settings ─── */}
      {phase === "settings" && selectedPage && (
        <div className="max-w-xl mx-auto">
          <Button variant="ghost" size="sm" onClick={handleBackToSelection} className="mb-3 -ms-2 gap-1.5">
            <ChevronLeft className="size-3.5 rtl:rotate-180" />
            {t("pages.messengerContacts.back")}
          </Button>
          <Card>
            <CardContent className="p-6 space-y-6">
              <div className="flex items-center gap-3 pb-2 border-b border-[var(--color-border)]">
                {selectedPage.picture_url ? (
                  <img src={selectedPage.picture_url} alt={selectedPage.name} className="size-12 rounded-xl object-cover" />
                ) : (
                  <div className="size-12 rounded-xl bg-[var(--color-surface-2)] flex items-center justify-center">
                    <Users className="size-6 text-[var(--color-fg-muted)]" />
                  </div>
                )}
                <div>
                  <p className="font-semibold">{selectedPage.name}</p>
                  <p className="text-xs text-[var(--color-fg-muted)]">{t("pages.messengerContacts.extractionSettings")}</p>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-[var(--color-border)] p-3.5">
                <div className="space-y-0.5">
                  <label htmlFor="skipDup" className="text-sm font-medium cursor-pointer">
                    {t("pages.messengerContacts.skipDuplicates")}
                  </label>
                  <p className="text-xs text-[var(--color-fg-muted)]">تجاهل جهات الاتصال المحفوظة سابقاً</p>
                </div>
                <Checkbox id="skipDup" checked={skipDuplicates} onChange={(e: any) => setSkipDuplicates(e.target.checked)} />
              </div>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={handleBackToSelection} className="gap-2">
                  <ArrowRight className="size-4 rtl:rotate-180" />
                  رجوع
                </Button>
                <Button
                  className="flex-1 gap-2"
                  size="lg"
                  onClick={handleStart}
                  disabled={startExtraction.isPending}
                >
                  {startExtraction.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  {t("pages.messengerContacts.startExtraction")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Running: Live progress ─── */}
      {phase === "running" && activeJob && (
        <div className="max-w-2xl mx-auto space-y-4">
          <Card>
            <CardContent className="p-8 space-y-6">
              <div className="flex flex-col items-center gap-5 text-center">
                <div className="relative">
                  <div className="absolute inset-0 animate-ping rounded-full bg-[var(--color-primary)]/20" />
                  <div className="relative flex size-16 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)]">
                    <Loader2 className="size-8 animate-spin text-[var(--color-primary)]" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-xl font-bold">{t("pages.messengerContacts.extracting")}</h2>
                  <p className="text-sm text-[var(--color-fg-muted)]">
                    {progressDiscovered > 0
                      ? `${t("pages.messengerContacts.progressDiscovered")}: ${progressDiscovered.toLocaleString()}`
                      : t("pages.messengerContacts.contactsCount", { count: activeJob.result_count || 0 })}
                  </p>
                  {progressPhase && (
                    <p className="text-xs text-[var(--color-fg-subtle)]">
                      {t(`pages.messengerContacts.phase_${progressPhase}` as any)}
                    </p>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-2">
                <div className="relative h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      isProgressIndeterminate
                        ? "bg-gradient-to-r from-[var(--color-primary)] via-[var(--color-secondary)] to-[var(--color-primary)] animate-[shimmer_2s_linear_infinite] bg-[length:200%_100%]"
                        : "bg-[var(--color-primary)]"
                    )}
                    style={{ width: isProgressIndeterminate ? "100%" : `${progress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-[var(--color-fg-muted)]">
                  <span>{isProgressIndeterminate ? "جاري الاستخراج..." : `${progress}%`}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {Math.round((Date.now() - new Date(activeJob.started_at || Date.now()).getTime()) / 1000)}s
                  </span>
                </div>
              </div>

              <div className="flex justify-center">
                <Badge variant={activeJob.status === "queued" ? "outline" : "primary"} className="gap-1.5">
                  <span className={cn(
                    "size-1.5 rounded-full",
                    activeJob.status === "running" ? "bg-[var(--color-primary)] animate-pulse" : "bg-[var(--color-warning)]"
                  )} />
                  {activeJob.status === "queued" ? t("pages.messengerContacts.statusQueued")
                    : activeJob.status === "paused" ? t("pages.messengerContacts.statusPaused")
                    : t("pages.messengerContacts.statusRunning")}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Button variant="outline" className="w-full gap-2" onClick={handleStop}>
            <Square className="size-4" />
            {t("pages.tasks.stop")}
          </Button>
        </div>
      )}

      {/* ─── Completed: Success screen with export & broadcast ─── */}
      {phase === "completed" && activeJob && (
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Success card */}
          <Card className="overflow-hidden border-0 bg-gradient-to-br from-[var(--color-success)]/8 via-[var(--color-success)]/3 to-transparent">
            <CardContent className="p-8 space-y-6 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="relative">
                  <div className="absolute inset-0 animate-pulse rounded-full bg-[var(--color-success)]/20" />
                  <div className="relative flex size-20 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--color-success)_15%,transparent)]">
                    <CheckCircle2 className="size-12 text-[var(--color-success)]" />
                  </div>
                </div>
                <div className="space-y-1">
                  <h2 className="text-2xl font-bold">{t("pages.messengerContacts.extractionComplete")}</h2>
                  <p className="text-sm text-[var(--color-fg-muted)]">
                    {t("pages.messengerContacts.contactsExtracted", { count: activeJob.result_count })}
                  </p>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-3 gap-2.5 pt-2">
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/60 p-3 text-center">
                  <p className="text-2xl font-bold text-[var(--color-success)]">
                    {stats.count}
                  </p>
                  <p className="text-[0.65rem] text-[var(--color-fg-muted)] mt-0.5">جهة اتصال</p>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/60 p-3 text-center">
                  <p className="text-2xl font-bold text-[var(--color-fg)]">
                    {(activeJob as any).progress?.phase === "paginating" ? "تصفح" : "مكتمل"}
                  </p>
                  <p className="text-[0.65rem] text-[var(--color-fg-muted)] mt-0.5">المصدر</p>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/60 p-3 text-center">
                  <p className="text-2xl font-bold text-[var(--color-fg)]">
                    {(jobProgress?.duplicates_skipped || 0).toString()}
                  </p>
                  <p className="text-[0.65rem] text-[var(--color-fg-muted)] mt-0.5">مكرر</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Export & Action buttons */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Download className="size-4 text-[var(--color-primary)]" />
                  تصدير النتائج
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handleExport("csv" as ExportFormat)}
                    disabled={exportResults.isPending}
                    className="gap-2"
                  >
                    {exportResults.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                    CSV
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleExport("json" as ExportFormat)}
                    disabled={exportResults.isPending}
                    className="gap-2"
                  >
                    <Download className="size-3.5" />
                    JSON
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleExport("xlsx" as ExportFormat)}
                    disabled={exportResults.isPending}
                    className="gap-2"
                  >
                    <Download className="size-3.5" />
                    Excel
                  </Button>
                </div>
              </div>

              <div className="h-px bg-[var(--color-border)]" />

              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <MessageCircle className="size-4 text-[var(--color-primary)]" />
                  إجراءات إضافية
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Button
                    variant="primary"
                    onClick={handleComposeMessage}
                    disabled={!stats.hasMessage}
                    className="gap-2"
                  >
                    <MessageCircle className="size-4" />
                    إرسال رسالة جماعية
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleStartNew}
                    className="gap-2"
                  >
                    <Sparkles className="size-4" />
                    استخراج جديد
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Back to tasks */}
          <div className="flex justify-center">
            <Button variant="ghost" onClick={handleBackToTasks} className="gap-2 text-[var(--color-fg-muted)]">
              <ListChecks className="size-3.5" />
              العودة لقائمة المهام
            </Button>
          </div>
        </div>
      )}

      {/* ─── Failed: Friendly error with partial export option ─── */}
      {phase === "failed" && (
        <div className="max-w-xl mx-auto space-y-4">
          <Card className="border-[var(--color-error)]/20">
            <CardContent className="p-8 space-y-5 text-center">
              <div className="flex flex-col items-center gap-3">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-error)_12%,transparent)]">
                  <XCircle className="size-8 text-[var(--color-error)]" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-bold">فشل الاستخراج</h2>
                  {errorMsg && <p className="text-sm text-[var(--color-fg-muted)]">{errorMsg}</p>}
                </div>
              </div>

              {stats.hasPartial && (
                <div className="rounded-xl border border-[var(--color-success)]/20 bg-[color-mix(in_oklab,var(--color-success)_5%,transparent)] p-3.5 space-y-2.5">
                  <p className="text-sm font-medium text-[var(--color-success)] flex items-center justify-center gap-2">
                    <CheckCircle2 className="size-4" />
                    {stats.count} نتيجة جزئية متاحة
                  </p>
                  <div className="flex gap-2 justify-center">
                    <Button size="sm" onClick={() => handleExport("csv" as ExportFormat)} className="gap-1.5">
                      <Download className="size-3.5" /> CSV
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleExport("json" as ExportFormat)} className="gap-1.5">
                      <Download className="size-3.5" /> JSON
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex gap-2 justify-center pt-1">
                <Button variant="outline" onClick={handleStartNew} className="gap-2">
                  <Sparkles className="size-4" />
                  بدء جديد
                </Button>
                <Button onClick={() => selectedPage ? handleStart() : handleBackToSelection()} className="gap-2">
                  <Loader2 className="size-4" />
                  إعادة المحاولة
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-center">
            <Button variant="ghost" onClick={handleBackToTasks} className="gap-2 text-[var(--color-fg-muted)]">
              <ListChecks className="size-3.5" />
              العودة لقائمة المهام
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
