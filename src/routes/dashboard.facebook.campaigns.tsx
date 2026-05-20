import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Play, Pause, Trash2, Megaphone, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import {
  listCampaigns,
  deleteCampaign,
  startCampaign,
  pauseCampaign,
} from "@/lib/fb-campaigns.functions";

export const Route = createFileRoute("/dashboard/facebook/campaigns")({
  ssr: false,
  component: CampaignsPage,
});

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  total_targets: number;
  done_targets: number;
  success_count: number;
  failed_count: number;
  target_kind: string;
  created_at: string;
  last_run_at: string | null;
  fb_bot_accounts?: { display_name: string } | null;
};

function CampaignsPage() {
  const { user, loading } = useAuth();
  const { lang, dir } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState<CampaignRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const t = lang === "ar"
    ? {
        title: "حملات النشر",
        subtitle: "أنشئ حملة لنشر منشور واحد على عدة جروبات/صفحات بفاصل زمني آمن",
        create: "حملة جديدة",
        empty: "لا توجد حملات بعد",
        emptyHint: "ابدأ بإنشاء أول حملة لنشر منشور على عدة وجهات بضغطة واحدة",
        start: "بدء",
        pause: "إيقاف مؤقت",
        delete: "حذف",
        confirmDelete: "حذف هذه الحملة نهائياً؟",
        deleted: "تم الحذف",
        started: "تم بدء الحملة",
        paused: "تم إيقاف الحملة",
        progress: "التقدم",
        targets: "وجهة",
        account: "الحساب",
        groups: "جروبات",
        pages: "صفحات",
        status: {
          draft: "مسودة", queued: "في الانتظار", running: "قيد التنفيذ",
          paused: "متوقفة", completed: "مكتملة", failed: "فشلت",
        } as Record<string, string>,
      }
    : {
        title: "Posting Campaigns",
        subtitle: "Create a campaign to post one message to multiple groups/pages with a safe interval",
        create: "New campaign",
        empty: "No campaigns yet",
        emptyHint: "Create your first campaign to post to many destinations at once",
        start: "Start",
        pause: "Pause",
        delete: "Delete",
        confirmDelete: "Delete this campaign permanently?",
        deleted: "Deleted",
        started: "Campaign started",
        paused: "Campaign paused",
        progress: "Progress",
        targets: "targets",
        account: "Account",
        groups: "groups", pages: "pages",
        status: {
          draft: "Draft", queued: "Queued", running: "Running",
          paused: "Paused", completed: "Completed", failed: "Failed",
        } as Record<string, string>,
      };

  useEffect(() => { if (!loading && !user) navigate({ to: "/login" }); }, [user, loading, navigate]);

  const callFn = async <T,>(fn: (opts: never) => Promise<T>, body?: unknown): Promise<T> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return fn({ data: body, headers: { Authorization: `Bearer ${session.access_token}` } } as never);
  };

  const load = async () => {
    try { setItems(await callFn(listCampaigns) as CampaignRow[]); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

  // Realtime: refresh list on campaign changes
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel("campaigns-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "fb_campaigns", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [user]);

  const handleStart = async (id: string) => {
    setBusy(id);
    try { await callFn(startCampaign, { id }); toast.success(t.started); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  };
  const handlePause = async (id: string) => {
    setBusy(id);
    try { await callFn(pauseCampaign, { id }); toast.success(t.paused); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  };
  const handleDelete = async (id: string) => {
    if (!confirm(t.confirmDelete)) return;
    try { await callFn(deleteCampaign, { id }); toast.success(t.deleted); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const statusStyle = (s: string) => {
    switch (s) {
      case "running": return "bg-blue-500/10 text-blue-600 border-blue-500/30";
      case "completed": return "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
      case "failed": return "bg-destructive/10 text-destructive border-destructive/30";
      case "paused": return "bg-amber-500/10 text-amber-600 border-amber-500/30";
      case "queued": return "bg-violet-500/10 text-violet-600 border-violet-500/30";
      default: return "bg-muted text-muted-foreground border-border";
    }
  };

  if (loading) return null;

  return (
    <DashboardLayout title={t.title}>
      <div dir={dir} className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold text-foreground">{t.title}</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{t.subtitle}</p>
          </div>
          <Link
            to="/dashboard/facebook/campaigns/new"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            {t.create}
          </Link>
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <Megaphone className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-40" />
            <h3 className="text-lg font-semibold text-foreground mb-1">{t.empty}</h3>
            <p className="text-sm text-muted-foreground mb-5">{t.emptyHint}</p>
            <Link
              to="/dashboard/facebook/campaigns/new"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="w-4 h-4" /> {t.create}
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {items.map((c) => {
              const pct = c.total_targets > 0 ? Math.round((c.done_targets / c.total_targets) * 100) : 0;
              const active = c.status === "running" || c.status === "queued";
              return (
                <div key={c.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Link to="/dashboard/facebook/campaigns/$id" params={{ id: c.id }} className="text-lg font-semibold text-foreground hover:text-primary truncate">
                          {c.name}
                        </Link>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${statusStyle(c.status)}`}>
                          {t.status[c.status] ?? c.status}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {c.fb_bot_accounts?.display_name ?? "—"} • {c.total_targets} {c.target_kind === "groups" ? t.groups : t.pages}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {active ? (
                        <button onClick={() => handlePause(c.id)} disabled={busy === c.id} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50">
                          {busy === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5" />}
                          {t.pause}
                        </button>
                      ) : (
                        <button onClick={() => handleStart(c.id)} disabled={busy === c.id} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                          {busy === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                          {t.start}
                        </button>
                      )}
                      <button onClick={() => handleDelete(c.id)} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-destructive/10 hover:border-destructive/40 text-destructive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{t.progress}: {c.done_targets} / {c.total_targets}</span>
                      <div className="flex gap-3">
                        <span className="inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> {c.success_count}</span>
                        <span className="inline-flex items-center gap-1"><XCircle className="w-3 h-3 text-destructive" /> {c.failed_count}</span>
                        <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> {Math.max(0, c.total_targets - c.done_targets)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-primary to-violet-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
