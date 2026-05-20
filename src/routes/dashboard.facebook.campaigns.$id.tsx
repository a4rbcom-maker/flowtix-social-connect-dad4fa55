import { createFileRoute, useNavigate, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, XCircle, Clock, Loader2, Play, Pause, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { getCampaign, getCampaignResults, startCampaign, pauseCampaign } from "@/lib/fb-campaigns.functions";
import { safeArray } from "@/lib/safe-data";

function CampaignDetailErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <DashboardLayout title="تفاصيل الحملة">
      <div className="max-w-xl mx-auto mt-12 rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-destructive" />
        <h2 className="text-lg font-semibold text-foreground mb-2">حدث خطأ في تحميل تفاصيل الحملة</h2>
        <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-destructive whitespace-pre-wrap break-words">
          {error?.message ?? "Unknown error"}
        </pre>
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            إعادة المحاولة
          </button>
          <Link to="/dashboard/facebook/campaigns" className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm hover:bg-accent">
            عودة للحملات
          </Link>
        </div>
      </div>
    </DashboardLayout>
  );
}

export const Route = createFileRoute("/dashboard/facebook/campaigns/$id")({
  ssr: false,
  component: CampaignDetailPage,
  errorComponent: CampaignDetailErrorComponent,
  notFoundComponent: () => (
    <DashboardLayout title="تفاصيل الحملة">
      <div className="max-w-xl mx-auto mt-12 rounded-2xl border border-border bg-card p-6 text-center">
        <h2 className="text-lg font-semibold text-foreground mb-2">الحملة غير موجودة</h2>
        <Link to="/dashboard/facebook/campaigns" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
          عودة للحملات
        </Link>
      </div>
    </DashboardLayout>
  ),
});

type Campaign = {
  id: string; name: string; status: string;
  total_targets: number; done_targets: number;
  success_count: number; failed_count: number;
  target_ids: string[]; target_names: Record<string, string> | null;
  last_job_id: string | null; delay_min_seconds: number; delay_max_seconds: number;
};

// The DB stores `target_ids` and `target_names` as `Json | null`. The worker
// payload and UI both expect `string[]` and `Record<string, string>`. Normalize
// at the fetch boundary so the rest of the component is fully typed.
function normalizeCampaign(raw: unknown): Campaign {
  const r = raw as Record<string, unknown>;
  const ids = Array.isArray(r.target_ids)
    ? (r.target_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const names = r.target_names && typeof r.target_names === "object" && !Array.isArray(r.target_names)
    ? Object.fromEntries(
        Object.entries(r.target_names as Record<string, unknown>)
          .filter(([, v]) => typeof v === "string") as [string, string][],
      )
    : null;
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    status: String(r.status ?? "draft"),
    total_targets: Number(r.total_targets ?? 0),
    done_targets: Number(r.done_targets ?? 0),
    success_count: Number(r.success_count ?? 0),
    failed_count: Number(r.failed_count ?? 0),
    target_ids: ids,
    target_names: names,
    last_job_id: (r.last_job_id as string | null) ?? null,
    delay_min_seconds: Number(r.delay_min_seconds ?? 0),
    delay_max_seconds: Number(r.delay_max_seconds ?? 0),
  };
}
type Result = { id: string; target: string | null; status: string; error: string | null; created_at: string };

function CampaignDetailPage() {
  const { id } = Route.useParams();
  const { user, loading } = useAuth();
  const { lang, dir } = useI18n();
  const navigate = useNavigate();
  const [c, setC] = useState<Campaign | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);

  const t = lang === "ar"
    ? { back: "العودة", progress: "التقدم", start: "بدء", pause: "إيقاف", delay: "الفاصل الزمني",
        seconds: "ثانية", target: "الوجهة", status: "الحالة", time: "الوقت", error: "خطأ",
        pending: "قيد الانتظار", success: "ناجح", failed: "فشل", skipped: "تجاوز",
        empty: "لا توجد نتائج بعد. ابدأ الحملة لتظهر النتائج لايف هنا." }
    : { back: "Back", progress: "Progress", start: "Start", pause: "Pause", delay: "Interval",
        seconds: "sec", target: "Target", status: "Status", time: "Time", error: "Error",
        pending: "Pending", success: "Success", failed: "Failed", skipped: "Skipped",
        empty: "No results yet. Start the campaign to see live results here." };

  useEffect(() => { if (!loading && !user) navigate({ to: "/login" }); }, [user, loading, navigate]);

  const callFn = async <T,>(fn: (opts: never) => Promise<T>, body?: unknown): Promise<T> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return fn({ data: body, headers: { Authorization: `Bearer ${session.access_token}` } } as never);
  };

  const load = async () => {
    try {
      const [camp, res] = await Promise.all([
        callFn<unknown>(getCampaign as unknown as (opts: never) => Promise<unknown>, { id }),
        callFn<{ results: Result[]; job: unknown }>(getCampaignResults as unknown as (opts: never) => Promise<{ results: Result[]; job: unknown }>, { id }),
      ]);
      setC(normalizeCampaign(camp));
      setResults(safeArray<Result>(res.results));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user, id]);

  // Realtime: campaign + results
  useEffect(() => {
    if (!user || !c) return;
    const ch = supabase.channel(`campaign-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "fb_campaigns", filter: `id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "fb_job_results", filter: c.last_job_id ? `job_id=eq.${c.last_job_id}` : "id=eq.00000000-0000-0000-0000-000000000000" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [user, id, c?.last_job_id]);

  const handleStart = async () => {
    setBusy(true);
    try { await callFn(startCampaign, { id }); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };
  const handlePause = async () => {
    setBusy(true);
    try { await callFn(pauseCampaign, { id }); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  if (loading || !c) return <DashboardLayout title={t.back}><div className="p-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></DashboardLayout>;

  const pct = c.total_targets > 0 ? Math.round((c.done_targets / c.total_targets) * 100) : 0;
  const active = c.status === "running" || c.status === "queued";

  const statusBadge = (s: string) => {
    const cls = s === "success" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
      : s === "failed" ? "bg-destructive/10 text-destructive border-destructive/30"
      : s === "skipped" ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
      : "bg-muted text-muted-foreground border-border";
    const label = s === "success" ? t.success : s === "failed" ? t.failed : s === "skipped" ? t.skipped : t.pending;
    return <span className={`text-[10px] px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>;
  };

  return (
    <DashboardLayout title={c.name}>
      <div dir={dir} className="space-y-6">
        <div>
          <Link to="/dashboard/facebook/campaigns" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="w-4 h-4" /> {t.back}
          </Link>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-2xl font-bold text-foreground">{c.name}</h2>
              <p className="text-xs text-muted-foreground mt-1">{t.delay}: {c.delay_min_seconds}–{c.delay_max_seconds} {t.seconds}</p>
            </div>
            {active ? (
              <button onClick={handlePause} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />} {t.pause}
              </button>
            ) : (
              <button onClick={handleStart} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} {t.start}
              </button>
            )}
          </div>
        </div>

        {/* Progress card */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
            <span>{t.progress}: <b className="text-foreground">{c.done_targets}</b> / {c.total_targets}</span>
            <div className="flex gap-4 text-xs">
              <span className="inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> {c.success_count}</span>
              <span className="inline-flex items-center gap-1"><XCircle className="w-3.5 h-3.5 text-destructive" /> {c.failed_count}</span>
              <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {Math.max(0, c.total_targets - c.done_targets)}</span>
            </div>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-gradient-to-r from-primary to-violet-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Results */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {results.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">{t.empty}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-start font-medium">{t.target}</th>
                  <th className="px-4 py-2 text-start font-medium">{t.status}</th>
                  <th className="px-4 py-2 text-start font-medium">{t.time}</th>
                  <th className="px-4 py-2 text-start font-medium">{t.error}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {results.map((r) => (
                  <tr key={r.id} className="hover:bg-accent/40">
                    <td className="px-4 py-2 text-foreground">{(r.target && c.target_names?.[r.target]) ?? r.target ?? "—"}</td>
                    <td className="px-4 py-2">{statusBadge(r.status)}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</td>
                    <td className="px-4 py-2 text-xs text-destructive truncate max-w-[280px]">{r.error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
