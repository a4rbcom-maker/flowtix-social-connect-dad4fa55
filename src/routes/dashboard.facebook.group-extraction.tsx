import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Trash2, RefreshCw, Download, UsersRound, Activity, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useFacebookApi } from "@/features/facebook/api";
import { listJobs, getJob, cancelJob } from "@/lib/fb-bot.functions";
import { loadEgyptData, extractEgyptPhone, detectLocation } from "@/lib/egypt-enrich";

export const Route = createFileRoute("/dashboard/facebook/group-extraction")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.getSession();
  },
  component: GroupExtractionStatusPage,
});

type JobRow = {
  id: string;
  job_type: string;
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

function GroupExtractionStatusPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const { call } = useFacebookApi();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<JobRow | null>(null);
  const [results, setResults] = useState<JobResult[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<JobRow | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const t = lang === "ar" ? {
    title: "حالة استخراج أعضاء الجروبات",
    subtitle: "تتبّع المهام الجارية مع شريط تقدّم حي وسجل كامل للمهام السابقة",
    activeNow: "مهام جارية الآن",
    noActive: "لا توجد مهام جارية حالياً",
    historyTitle: "سجل المهام",
    none: "لا توجد مهام استخراج أعضاء بعد",
    create: "بدء مهمة استخراج",
    refresh: "تحديث",
    status: "الحالة",
    progress: "التقدم",
    created: "وقت البدء",
    duration: "المدة",
    actions: "إجراءات",
    cancel: "إلغاء",
    download: "تنزيل CSV",
    members: "عضو",
    of: "من",
    kpiRunning: "جارية",
    kpiCompleted: "مكتملة",
    kpiFailed: "فشلت",
    kpiTotalMembers: "إجمالي الأعضاء المُستخرجين",
    results: "الأعضاء المستخرجون",
    statuses: { pending: "معلّقة", running: "جارية", completed: "مكتملة", failed: "فشلت", cancelled: "ملغاة" },
    eta: "متبقي تقريباً",
    seconds: "ث", minutes: "د", hours: "س",
  } : {
    title: "Group Members Extraction Status",
    subtitle: "Track running jobs with a live progress bar and full history",
    activeNow: "Running now",
    noActive: "No jobs are currently running",
    historyTitle: "Jobs log",
    none: "No extraction jobs yet",
    create: "Start an extraction",
    refresh: "Refresh",
    status: "Status",
    progress: "Progress",
    created: "Started",
    duration: "Duration",
    actions: "Actions",
    cancel: "Cancel",
    download: "Download CSV",
    members: "members",
    of: "of",
    kpiRunning: "Running",
    kpiCompleted: "Completed",
    kpiFailed: "Failed",
    kpiTotalMembers: "Total extracted members",
    results: "Extracted members",
    statuses: { pending: "Pending", running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled" },
    eta: "ETA",
    seconds: "s", minutes: "m", hours: "h",
  };

  const load = async () => {
    setLoading(true);
    try {
      const all = await call(listJobs) as JobRow[];
      setJobs(all.filter((j) => j.job_type === "extract_group_members"));
    } catch (e) { toast.error(String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (user) load(); }, [user]);

  // Realtime: merge into local state (no full reloads)
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`fb-jobs-group-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "fb_jobs", filter: `user_id=eq.${user.id}` }, (payload) => {
        const row = payload.new as JobRow;
        if (row.job_type !== "extract_group_members") return;
        setJobs((prev) => [row, ...prev.filter((j) => j.id !== row.id)]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "fb_jobs", filter: `user_id=eq.${user.id}` }, (payload) => {
        const row = payload.new as JobRow;
        if (row.job_type !== "extract_group_members") return;
        setJobs((prev) => {
          const exists = prev.some((j) => j.id === row.id);
          return exists ? prev.map((j) => (j.id === row.id ? { ...j, ...row } : j)) : [row, ...prev];
        });
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
      await loadEgyptData();
      const { results } = await call(getJob, { id: j.id });
      setResults(results as JobResult[]);
    } catch (e) { toast.error(String(e)); }
    finally { setResultsLoading(false); }
  };

  const handleCancel = async (id: string) => {
    try { await call(cancelJob, { id }); toast.success(t.cancel); }
    catch (e) { toast.error(String(e)); }
  };

  const active = useMemo(() => jobs.filter((j) => j.status === "running" || j.status === "pending"), [jobs]);
  const history = useMemo(() => jobs.filter((j) => j.status !== "running" && j.status !== "pending"), [jobs]);

  const kpis = useMemo(() => {
    const completed = jobs.filter((j) => j.status === "completed");
    const failed = jobs.filter((j) => j.status === "failed");
    const totalMembers = completed.reduce((sum, j) => sum + (j.processed_items || 0), 0);
    return { running: active.length, completed: completed.length, failed: failed.length, totalMembers };
  }, [jobs, active]);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `0${t.seconds}`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}${t.seconds}`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}${t.minutes} ${s % 60}${t.seconds}`;
    const h = Math.floor(m / 60);
    return `${h}${t.hours} ${m % 60}${t.minutes}`;
  };

  const computeEta = (j: JobRow) => {
    if (j.status !== "running" || !j.total_items || j.total_items <= 0 || j.processed_items <= 0) return null;
    const elapsed = Date.now() - new Date(j.created_at).getTime();
    const rate = j.processed_items / elapsed; // items per ms
    const remaining = j.total_items - j.processed_items;
    if (remaining <= 0 || rate <= 0) return null;
    return formatDuration(remaining / rate);
  };

  const enriched = useMemo(() => results.map((r) => {
    const d = (r.data ?? {}) as { name?: string; profile?: string; profile_url?: string; bio?: string; bio_snippet?: string; city?: string; hometown?: string; phone?: string; source?: string };
    const blob = `${d.name ?? ""} ${d.bio ?? ""} ${d.bio_snippet ?? ""} ${d.city ?? ""} ${d.hometown ?? ""} ${r.target ?? ""}`;
    const loc = detectLocation(blob);
    return {
      row: r,
      name: d.name ?? r.target ?? "—",
      profile: d.profile_url ?? d.profile ?? "",
      phone: d.phone ?? extractEgyptPhone(blob) ?? null,
      city: d.city ?? loc?.city ?? null,
      gov: loc?.gov ?? null,
    };
  }), [results]);

  const downloadCsv = () => {
    if (enriched.length === 0) return;
    const rows = [
      ["name", "facebook_id", "profile", "phone", "city", "governorate"],
      ...enriched.map((e) => [e.name, e.row.target ?? "", e.profile, e.phone ?? "", e.city ?? "", e.gov ?? ""]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `group-members-${selected?.id}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const statusColor = (s: JobRow["status"]) => ({
    pending: "bg-muted text-muted-foreground",
    running: "bg-primary/15 text-primary",
    completed: "bg-green-500/15 text-green-700 dark:text-green-400",
    failed: "bg-red-500/15 text-red-700 dark:text-red-400",
    cancelled: "bg-muted text-muted-foreground",
  }[s]);

  return (
    <DashboardLayout title={t.title}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2"><UsersRound className="h-6 w-6 text-primary" /> {t.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={load}><RefreshCw className="me-2 h-4 w-4" />{t.refresh}</Button>
            <Link to="/dashboard/facebook/jobs" search={{ tab: "groupmembers" }}><Button>{t.create}</Button></Link>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Activity className="h-4 w-4" /> {t.kpiRunning}</div>
            <div className="mt-1 text-2xl font-bold text-primary">{kpis.running}</div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-4 w-4" /> {t.kpiCompleted}</div>
            <div className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400">{kpis.completed}</div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><XCircle className="h-4 w-4" /> {t.kpiFailed}</div>
            <div className="mt-1 text-2xl font-bold text-red-600 dark:text-red-400">{kpis.failed}</div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><UsersRound className="h-4 w-4" /> {t.kpiTotalMembers}</div>
            <div className="mt-1 text-2xl font-bold">{kpis.totalMembers.toLocaleString()}</div>
          </Card>
        </div>

        {/* Active jobs */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{t.activeNow}</h3>
          {loading ? (
            <Card className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></Card>
          ) : active.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">{t.noActive}</Card>
          ) : (
            <div className="space-y-3">
              {active.map((j) => {
                const pct = j.total_items > 0 ? Math.min(100, Math.round((j.processed_items / j.total_items) * 100)) : (j.progress ?? 0);
                const eta = computeEta(j);
                return (
                  <Card key={j.id} className="p-5 cursor-pointer hover:bg-muted/30" onClick={() => openDetails(j)}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusColor(j.status)}`}>
                          {j.status === "running" ? <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> {t.statuses[j.status]}</span> : t.statuses[j.status]}
                        </span>
                        <span className="text-sm text-muted-foreground"><Clock className="me-1 inline h-3.5 w-3.5" />{new Date(j.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</span>
                      </div>
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleCancel(j.id); }}>
                        <Trash2 className="me-1 h-4 w-4 text-destructive" /> {t.cancel}
                      </Button>
                    </div>
                    <div className="mt-4 space-y-2">
                      <div className="flex items-end justify-between text-sm">
                        <span className="font-semibold">{j.processed_items.toLocaleString()} <span className="text-muted-foreground font-normal">{t.of} {j.total_items > 0 ? j.total_items.toLocaleString() : "—"} {t.members}</span></span>
                        <span className="text-primary font-bold tabular-nums">{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-2.5" />
                      {eta && <div className="text-xs text-muted-foreground">{t.eta}: {eta}</div>}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* History */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{t.historyTitle}</h3>
          <Card className="overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : history.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">{t.none}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-start">{t.status}</th>
                      <th className="px-4 py-3 text-start">{t.progress}</th>
                      <th className="px-4 py-3 text-start">{t.created}</th>
                      <th className="px-4 py-3 text-start">{t.duration}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {history.map((j) => {
                      const dur = j.completed_at ? new Date(j.completed_at).getTime() - new Date(j.created_at).getTime() : 0;
                      return (
                        <tr key={j.id} className="cursor-pointer hover:bg-muted/30" onClick={() => openDetails(j)}>
                          <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusColor(j.status)}`}>{t.statuses[j.status]}</span></td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{j.processed_items.toLocaleString()}</span>
                              <span className="text-xs text-muted-foreground">{t.members}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{new Date(j.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</td>
                          <td className="px-4 py-3 text-muted-foreground">{dur > 0 ? formatDuration(dur) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center justify-between gap-2">
              <span>{t.results} {selected ? `(${enriched.length})` : ""}</span>
              {enriched.length > 0 && (
                <Button size="sm" onClick={downloadCsv}><Download className="me-1 h-4 w-4" /> {t.download}</Button>
              )}
            </DialogTitle>
          </DialogHeader>
          {selected?.status === "running" && selected.total_items > 0 && (
            <div className="space-y-2">
              <div className="flex items-end justify-between text-sm">
                <span className="font-medium">{selected.processed_items.toLocaleString()} / {selected.total_items.toLocaleString()}</span>
                <span className="text-primary font-bold">{Math.round((selected.processed_items / selected.total_items) * 100)}%</span>
              </div>
              <Progress value={(selected.processed_items / selected.total_items) * 100} className="h-2" />
            </div>
          )}
          {selected?.error_message && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{selected.error_message}</div>
          )}
          {resultsLoading ? (
            <div className="flex items-center justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : enriched.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">{t.none}</div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start">Name</th>
                    <th className="px-3 py-2 text-start">Profile</th>
                    <th className="px-3 py-2 text-start">City</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {enriched.slice(0, 500).map((e) => (
                    <tr key={e.row.id}>
                      <td className="px-3 py-2 font-medium">{e.name}</td>
                      <td className="px-3 py-2"><a href={e.profile} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{e.profile ? "↗" : "—"}</a></td>
                      <td className="px-3 py-2 text-muted-foreground">{e.city ?? e.gov ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
