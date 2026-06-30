import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Trash2, RefreshCw, Download, Sparkles, Send } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { useFacebookApi } from "@/features/facebook/api";
import { listJobs, getJob, cancelJob, createDeepProfileScrapeJob, createSendMessengerDmJob } from "@/lib/fb-bot.functions";
import { loadEgyptData, extractEgyptPhone, detectLocation } from "@/lib/egypt-enrich";

export const Route = createFileRoute("/dashboard/facebook/history")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.getSession();
  },
  component: JobsHistoryPage,
});

type JobRow = {
  id: string;
  job_type: "post_to_groups" | "extract_pages" | "extract_commenters" | "extract_group_members" | "extract_page_audience" | "deep_profile_scrape" | "send_messenger_dm";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  total_items: number;
  processed_items: number;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  account_id: string | null;
};

type JobResult = { id: string; target: string | null; status: "success" | "failed" | "skipped"; data: unknown; error: string | null; created_at: string };

function JobsHistoryPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const { call } = useFacebookApi();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<JobRow | null>(null);
  const [results, setResults] = useState<JobResult[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<JobRow | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // Messaging wizard state
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgChannels, setMsgChannels] = useState<{ whatsapp: boolean; messenger: boolean }>({ whatsapp: true, messenger: true });
  const [msgText, setMsgText] = useState("");
  const [msgTitle, setMsgTitle] = useState("");
  const [msgPerHour, setMsgPerHour] = useState(20);
  const [msgSubmitting, setMsgSubmitting] = useState(false);

  const t = lang === "ar" ? {
    title: "سجل المهام",
    subtitle: "كل المهام مع تتبع حي للتقدم",
    none: "لا توجد مهام بعد",
    create: "إنشاء مهمة",
    type: "النوع",
    status: "الحالة",
    progress: "التقدم",
    created: "أُنشئت",
    actions: "إجراءات",
    cancel: "إلغاء",
    confirmCancelTitle: "تأكيد إلغاء المهمة",
    confirmCancelDesc: "سيتم إيقاف المعالجة في الخلفية فوراً وحفظ ما تم استخراجه حتى الآن. هل تريد المتابعة؟",
    confirmCancelYes: "نعم، ألغِ المهمة",
    confirmCancelNo: "تراجع",
    cancelDone: "تم إلغاء المهمة وإيقاف المعالجة",
    results: "النتائج",
    download: "تنزيل CSV",
    types: { post_to_groups: "نشر", extract_pages: "صفحات", extract_commenters: "معلقين", extract_group_members: "أعضاء جروب", extract_page_audience: "جمهور صفحة", deep_profile_scrape: "فحص عميق للبروفايل", send_messenger_dm: "رسائل ماسنجر" },
    statuses: { pending: "معلّقة", running: "جارية", completed: "مكتملة", failed: "فشلت", cancelled: "ملغاة" },
  } : {
    title: "Jobs History",
    subtitle: "All jobs with live progress",
    none: "No jobs yet",
    create: "Create a job",
    type: "Type",
    status: "Status",
    progress: "Progress",
    created: "Created",
    actions: "Actions",
    cancel: "Cancel",
    confirmCancelTitle: "Cancel job?",
    confirmCancelDesc: "Background processing will stop immediately. Already-extracted data will be kept. Continue?",
    confirmCancelYes: "Yes, cancel job",
    confirmCancelNo: "Keep running",
    cancelDone: "Job cancelled and worker stopped",
    results: "Results",
    download: "Download CSV",
    types: { post_to_groups: "Post", extract_pages: "Pages", extract_commenters: "Commenters", extract_group_members: "Group Members", extract_page_audience: "Page Audience", deep_profile_scrape: "Deep Profile Scrape", send_messenger_dm: "Messenger DMs" },
    statuses: { pending: "Pending", running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled" },
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await call(listJobs);
      setJobs(data as JobRow[]);
    } catch (e) { toast.error(String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (user) load(); }, [user]);

  // Realtime: merge changes into local state to avoid full reloads (which feel like a page refresh)
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`fb-jobs-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "fb_jobs", filter: `user_id=eq.${user.id}` }, (payload) => {
        setJobs((prev) => [payload.new as JobRow, ...prev.filter((j) => j.id !== (payload.new as JobRow).id)]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "fb_jobs", filter: `user_id=eq.${user.id}` }, (payload) => {
        setJobs((prev) => prev.map((j) => (j.id === (payload.new as JobRow).id ? { ...j, ...(payload.new as JobRow) } : j)));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "fb_jobs", filter: `user_id=eq.${user.id}` }, (payload) => {
        setJobs((prev) => prev.filter((j) => j.id !== (payload.old as JobRow).id));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const openDetails = async (j: JobRow) => {
    setSelected(j);
    setResultsLoading(true);
    try {
      const peopleTypes = ["extract_commenters", "extract_group_members", "extract_page_audience", "deep_profile_scrape"];
      if (peopleTypes.includes(j.job_type)) await loadEgyptData();
      const { results } = await call(getJob, { id: j.id });
      setResults(results as JobResult[]);
    } catch (e) { toast.error(String(e)); }
    finally { setResultsLoading(false); }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await call(cancelJob, { id: cancelTarget.id });
      setJobs((prev) => prev.map((j) => (j.id === cancelTarget.id ? { ...j, status: "cancelled", completed_at: new Date().toISOString() } : j)));
      toast.success(t.cancelDone);
      setCancelTarget(null);
    } catch (e) { toast.error(String(e)); }
    finally { setCancelling(false); }
  };

  const isPeople = selected?.job_type === "extract_commenters"
    || selected?.job_type === "extract_group_members"
    || selected?.job_type === "extract_page_audience"
    || selected?.job_type === "deep_profile_scrape";
  const enrichedRows = isPeople
    ? results.map((r) => {
        const d = (r.data ?? {}) as { name?: string; id?: string; fb_user_id?: string; profile?: string; profile_url?: string; bio?: string; bio_snippet?: string; city?: string; hometown?: string; work?: string; phone?: string; source?: string };
        const blob = `${d.name ?? ""} ${d.bio ?? ""} ${d.bio_snippet ?? ""} ${d.city ?? ""} ${d.hometown ?? ""} ${r.target ?? ""}`;
        const loc = detectLocation(blob);
        return {
          row: r,
          name: d.name ?? r.target ?? "—",
          profile: d.profile_url ?? d.profile ?? "",
          phone: d.phone ?? extractEgyptPhone(blob) ?? null,
          city: d.city ?? loc?.city ?? null,
          gov: loc?.gov ?? null,
          declared: d.city ?? d.hometown ?? null,
          work: d.work ?? null,
          source: d.source ?? "",
        };
      })
    : [];

  const downloadCsv = () => {
    if (results.length === 0) return;
    let rows: (string | number)[][];
    if (isPeople) {
      rows = [
        ["name", "facebook_id", "profile", "phone", "city", "governorate", "source"],
        ...enrichedRows.map((e) => [e.name, e.row.target ?? "", e.profile, e.phone ?? "", e.city ?? "", e.gov ?? "", e.source]),
      ];
    } else {
      rows = [
        ["target", "status", "data", "error", "created_at"],
        ...results.map((r) => [r.target ?? "", r.status, JSON.stringify(r.data ?? ""), r.error ?? "", r.created_at]),
      ];
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `job-${selected?.id}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const statusColor = (s: JobRow["status"]) => ({
    pending: "bg-muted text-muted-foreground",
    running: "bg-primary/15 text-primary",
    completed: "bg-green-500/15 text-green-700 dark:text-green-400",
    failed: "bg-red-500/15 text-red-700 dark:text-red-400",
    cancelled: "bg-muted text-muted-foreground",
  }[s]);

  // Counts for the messaging wizard preview
  const phoneCount = enrichedRows.filter((e) => !!e.phone).length;
  const profileCount = enrichedRows.filter((e) => !!(e.profile || e.row.target)).length;

  const openMessenger = () => {
    if (!selected) return;
    const groupLabel = selected ? t.types[selected.job_type] : "";
    setMsgTitle(lang === "ar" ? `حملة - ${groupLabel}` : `Campaign - ${groupLabel}`);
    setMsgText("");
    setMsgPerHour(20);
    setMsgChannels({ whatsapp: phoneCount > 0, messenger: profileCount > 0 });
    setMsgOpen(true);
  };

  const launchMessaging = async () => {
    if (!user || !selected) return;
    const message = msgText.trim();
    if (message.length < 2) { toast.error(lang === "ar" ? "اكتب نص الرسالة" : "Enter message text"); return; }
    if (!msgChannels.whatsapp && !msgChannels.messenger) { toast.error(lang === "ar" ? "اختر قناة واحدة على الأقل" : "Pick at least one channel"); return; }

    const intervalSec = Math.max(36, Math.round(3600 / Math.max(1, msgPerHour)));
    setMsgSubmitting(true);
    try {
      let waCount = 0;
      let fbCount = 0;

      // ---- WhatsApp: create a bulk_jobs row + recipients (only those with phone)
      if (msgChannels.whatsapp) {
        const waRecipients = enrichedRows
          .filter((e) => !!e.phone)
          .map((e) => ({ name: e.name || "", phone: String(e.phone) }));
        if (waRecipients.length > 0) {
          const { data: job, error } = await supabase
            .from("bulk_jobs")
            .insert({
              user_id: user.id,
              channel: "bulk",
              title: msgTitle.trim() || (lang === "ar" ? "حملة واتساب" : "WhatsApp campaign"),
              message,
              interval_seconds: intervalSec,
              batch_size: 1,
              scheduled_at: new Date().toISOString(),
              status: "scheduled",
              total_recipients: waRecipients.length,
            })
            .select("id")
            .single();
          if (error || !job) throw new Error(error?.message || "WhatsApp campaign insert failed");
          const rows = waRecipients.map((r) => ({ job_id: job.id, user_id: user.id, name: r.name, phone: r.phone }));
          const { error: rErr } = await supabase.from("bulk_job_recipients").insert(rows);
          if (rErr) throw new Error(rErr.message);
          waCount = waRecipients.length;
        }
      }

      // ---- Messenger: create fb_jobs send_messenger_dm
      if (msgChannels.messenger) {
        const fbRecipients = enrichedRows
          .map((e) => ({ profile: e.profile || e.row.target || "", name: e.name || "" }))
          .filter((r) => !!r.profile);
        if (fbRecipients.length > 0 && selected.account_id) {
          await call(createSendMessengerDmJob, {
            accountId: selected.account_id,
            recipients: fbRecipients.slice(0, 500),
            message,
            intervalSeconds: intervalSec,
            label: msgTitle.trim() || undefined,
          });
          fbCount = fbRecipients.length;
        } else if (msgChannels.messenger && !selected.account_id) {
          toast.error(lang === "ar" ? "لا يوجد حساب فيسبوك مرتبط بهذه المهمة" : "No FB account linked to this job");
        }
      }

      toast.success(
        lang === "ar"
          ? `تم: واتساب ${waCount} · ماسنجر ${fbCount}`
          : `Queued: WhatsApp ${waCount} · Messenger ${fbCount}`,
      );
      setMsgOpen(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setMsgSubmitting(false);
    }
  };


  return (
    <DashboardLayout title={t.title}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">{t.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load}><RefreshCw className="me-2 h-4 w-4" />Refresh</Button>
            <Link to="/dashboard/facebook/jobs"><Button>{t.create}</Button></Link>
          </div>
        </div>

        <Card className="overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : jobs.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">{t.none}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-start">{t.type}</th>
                    <th className="px-4 py-3 text-start">{t.status}</th>
                    <th className="px-4 py-3 text-start">{t.progress}</th>
                    <th className="px-4 py-3 text-start">{t.created}</th>
                    <th className="px-4 py-3 text-end">{t.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {jobs.map((j) => (
                    <tr key={j.id} className="cursor-pointer hover:bg-muted/30" onClick={() => openDetails(j)}>
                      <td className="px-4 py-3"><Badge variant="outline">{t.types[j.job_type]}</Badge></td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusColor(j.status)}`}>{t.statuses[j.status]}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex w-48 items-center gap-2">
                          <Progress value={j.progress} className="h-1.5" />
                          <span className="text-xs text-muted-foreground">{j.processed_items}/{j.total_items || "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(j.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</td>
                      <td className="px-4 py-3 text-end">
                        {(j.status === "pending" || j.status === "running") && (
                          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setCancelTarget(j); }}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center justify-between gap-2">
              <span>{selected && t.types[selected.job_type]}</span>
              {results.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {isPeople && selected?.job_type !== "deep_profile_scrape" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        if (!selected?.id) return;
                        const accountId = selected.account_id;
                        const profiles = enrichedRows
                          .map((e) => e.profile || e.row.target)
                          .filter((v): v is string => !!v);
                        if (!accountId) { toast.error(lang === "ar" ? "تعذّر تحديد الحساب" : "Account missing"); return; }
                        if (profiles.length === 0) { toast.error(lang === "ar" ? "لا توجد بروفايلات" : "No profiles"); return; }
                        try {
                          await call(createDeepProfileScrapeJob, { accountId, profiles });
                          toast.success(lang === "ar" ? "تم إنشاء مهمة فحص عميق" : "Deep scrape job queued");
                          setSelected(null);
                          load();
                        } catch (e) { toast.error(String(e)); }
                      }}
                      className="gap-2"
                    >
                      {lang === "ar" ? "فحص عميق للبروفايلات" : "Deep profile scrape"}
                    </Button>
                  )}
                  {isPeople && (
                    <Button
                      size="sm"
                      onClick={() => {
                        const lines = enrichedRows
                          .map((e) => [e.name, e.phone, e.city, e.gov, e.row.target].filter(Boolean).join(" "))
                          .filter(Boolean);
                        try {
                          sessionStorage.setItem("flowtix:enrich:prefill", lines.join("\n"));
                        } catch (_) { /* ignore quota */ }
                        navigate({ to: "/dashboard/enrich" });
                      }}
                      className="gap-2"
                    >
                      <Sparkles className="h-4 w-4" />
                      {lang === "ar" ? "إثراء بداتا مصر" : "Enrich with Egypt data"}
                    </Button>
                  )}
                  {isPeople && (
                    <Button size="sm" variant="default" onClick={openMessenger} className="gap-2">
                      <Send className="h-4 w-4" />
                      {lang === "ar" ? "إرسال رسائل" : "Send messages"}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={downloadCsv}>
                    <Download className="me-2 h-4 w-4" />{t.download}
                  </Button>
                </div>
              )}
            </DialogTitle>
          </DialogHeader>
          {resultsLoading ? (
            <div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t.none}</p>
          ) : isPeople ? (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start">{lang === "ar" ? "الاسم" : "Name"}</th>
                    <th className="px-3 py-2 text-start">{lang === "ar" ? "موبايل" : "Phone"}</th>
                    <th className="px-3 py-2 text-start">{lang === "ar" ? "المدينة" : "City"}</th>
                    <th className="px-3 py-2 text-start">{lang === "ar" ? "المحافظة" : "Governorate"}</th>
                    <th className="px-3 py-2 text-start">{lang === "ar" ? "البروفايل" : "Profile"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {enrichedRows.map((e) => (
                    <tr key={e.row.id} className={e.gov ? "bg-primary/[0.04]" : ""}>
                      <td className="px-3 py-2 font-medium">{e.name}</td>
                      <td className="px-3 py-2 font-mono">{e.phone ?? "—"}</td>
                      <td className="px-3 py-2">{e.city ?? "—"}</td>
                      <td className="px-3 py-2">
                        {e.gov ? <Badge variant="outline" className="border-primary/30 text-primary">{e.gov}</Badge> : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {e.profile ? <a href={e.profile} target="_blank" rel="noreferrer" className="text-primary hover:underline">↗</a> : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr><th className="px-3 py-2 text-start">target</th><th className="px-3 py-2 text-start">status</th><th className="px-3 py-2 text-start">details</th></tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {results.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-mono">{r.target ?? "—"}</td>
                      <td className="px-3 py-2">{r.status}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.error ?? JSON.stringify(r.data ?? "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => !o && !cancelling && setCancelTarget(null)}>
        <AlertDialogContent dir={lang === "ar" ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.confirmCancelTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.confirmCancelDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>{t.confirmCancelNo}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmCancel} disabled={cancelling} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {cancelling && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t.confirmCancelYes}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>

  );
}
