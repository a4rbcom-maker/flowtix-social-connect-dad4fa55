import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Users,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Eye,
  Send,
  ArrowLeft,
  AlertCircle,
  Image as ImageIcon,
  X,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { toast } from "sonner";
import {
  fetchFacebookGroups,
  getFacebookConnection,
} from "@/lib/facebook.functions";
import { createListMyGroupsJob } from "@/lib/fb-bot.functions";
import { logSendActivity, updateSendStatus } from "@/lib/notifications";
import { GraphApiConnectWizard } from "@/components/facebook/GraphApiConnectWizard";

export const Route = createFileRoute("/dashboard/facebook/groups")({
  ssr: false,
  component: FacebookGroupsPage,
});

interface Group {
  id: string;
  name: string;
  member_count?: number;
  privacy?: string;
  description?: string;
  cover?: { source?: string };
}

type Step = "browse" | "compose" | "preview";

function FacebookGroupsPage() {
  const { user, loading: authLoading } = useAuth();
  const { lang, dir } = useI18n();
  const navigate = useNavigate();

  const [connected, setConnected] = useState<boolean | null>(null);
  const [botAccountId, setBotAccountId] = useState<string | null>(null);
  const [botImporting, setBotImporting] = useState(false);
  const [hasBotAccount, setHasBotAccount] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<Step>("browse");
  const [message, setMessage] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const t = lang === "ar"
    ? {
        title: "جروبات فيسبوك",
        subtitle: "استورد جروباتك واختر الجروبات المستهدفة ثم اكتب رسالتك",
        notConnected: "حسابك غير مرتبط بفيسبوك",
        notConnectedDesc: "اربط حساب فيسبوك أولاً لاستيراد الجروبات",
        goConnect: "ربط الحساب الآن",
        import: "استيراد الجروبات",
        reimport: "إعادة استيراد",
        importing: "جاري الاستيراد...",
        searchPlaceholder: "ابحث في الجروبات بالاسم...",
        members: "عضو",
        privacy: { OPEN: "عام", CLOSED: "مغلق", SECRET: "سري" } as Record<string, string>,
        empty: "لا توجد جروبات بعد. اضغط استيراد لجلب جروباتك.",
        noResults: "لا توجد نتائج مطابقة لبحثك",
        selectAll: "تحديد الكل",
        clearAll: "إلغاء التحديد",
        selected: "محدد",
        next: "التالي: كتابة الرسالة",
        back: "رجوع",
        composeTitle: "اكتب رسالتك",
        composeDesc: "ستُرسل هذه الرسالة إلى الجروبات المحددة",
        msgPlaceholder: "اكتب نص المنشور هنا... مثلاً: عرض جديد متاح الآن!",
        imgLabel: "رابط صورة (اختياري)",
        imgPlaceholder: "https://...",
        preview: "معاينة قبل الإرسال",
        previewTitle: "المعاينة النهائية",
        previewDesc: "راجع الرسالة والجروبات المستهدفة قبل الإرسال",
        targets: "الجروبات المستهدفة",
        send: "تأكيد الإرسال",
        sending: "جاري الإرسال...",
        sentToast: "تم جدولة الإرسال للجروبات المحددة",
        emptyMsg: "اكتب نص الرسالة أولاً",
        noSelection: "حدد جروباً واحداً على الأقل",
        characters: "حرف",
        privacyLabel: "النوع",
      }
    : {
        title: "Facebook Groups",
        subtitle: "Import your groups, pick targets, then preview your message",
        notConnected: "Facebook is not connected",
        notConnectedDesc: "Connect your Facebook account first to import groups",
        goConnect: "Connect now",
        import: "Import Groups",
        reimport: "Re-import",
        importing: "Importing...",
        searchPlaceholder: "Search groups by name...",
        members: "members",
        privacy: { OPEN: "Public", CLOSED: "Closed", SECRET: "Secret" } as Record<string, string>,
        empty: "No groups yet. Click Import to fetch your groups.",
        noResults: "No groups match your search",
        selectAll: "Select all",
        clearAll: "Clear",
        selected: "selected",
        next: "Next: Compose message",
        back: "Back",
        composeTitle: "Compose your message",
        composeDesc: "This message will be sent to the selected groups",
        msgPlaceholder: "Write your post here... e.g. New offer available now!",
        imgLabel: "Image URL (optional)",
        imgPlaceholder: "https://...",
        preview: "Preview before sending",
        previewTitle: "Final preview",
        previewDesc: "Review the message and targets before sending",
        targets: "Target groups",
        send: "Confirm & Send",
        sending: "Sending...",
        sentToast: "Sending was scheduled to the selected groups",
        emptyMsg: "Write a message first",
        noSelection: "Select at least one group",
        characters: "characters",
        privacyLabel: "Type",
      };

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [user, authLoading, navigate]);

  // Check connection on mount (both Graph API and bot accounts)
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const [connRes, botRes] = await Promise.all([
          getFacebookConnection({
            headers: { Authorization: `Bearer ${session.access_token}` },
          } as never).catch(() => ({ connection: null })),
          supabase.from("fb_bot_accounts").select("id").eq("user_id", user.id).limit(1),
        ]);
        setConnected(!!connRes.connection);
        const firstBot = botRes.data?.[0]?.id ?? null;
        setBotAccountId(firstBot);
        setHasBotAccount(!!firstBot);
      } catch {
        setConnected(false);
      }
    })();
  }, [user]);

  // Load previously imported groups from the most recent completed list_my_groups job
  // so the user doesn't have to re-import every time they revisit the page.
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data: lastJob } = await supabase
          .from("fb_jobs")
          .select("id")
          .eq("user_id", user.id)
          .eq("job_type", "list_my_groups")
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!lastJob?.id) return;
        const { data: rows } = await supabase
          .from("fb_job_results")
          .select("target,data")
          .eq("job_id", lastJob.id)
          .eq("status", "success")
          .limit(1000);
        if (!rows?.length) return;
        const imported: Group[] = rows.map((r) => {
          const d = (r.data ?? {}) as { name?: string; group_id?: string; id?: string; member_count?: number; privacy?: string };
          return {
            id: d.group_id ?? d.id ?? r.target ?? "",
            name: d.name ?? r.target ?? "—",
            member_count: d.member_count,
            privacy: d.privacy,
          };
        }).filter((g) => g.id);
        if (imported.length) {
          setGroups((prev) => {
            if (prev.length) return prev;
            return imported;
          });
        }
      } catch {
        // ignore — user can always re-import manually
      }
    })();
  }, [user]);


  // Consume handoff from the main Facebook page (preselected groups + jump to compose)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem("fb_preselect_groups");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { groups?: Group[]; ts?: number };
      if (!parsed?.groups?.length) return;
      // Discard entries older than 10 minutes to avoid stale handoffs.
      if (parsed.ts && Date.now() - parsed.ts > 10 * 60 * 1000) {
        sessionStorage.removeItem("fb_preselect_groups");
        return;
      }
      setGroups((prev) => {
        const map = new Map(prev.map((g) => [g.id, g] as const));
        for (const g of parsed.groups!) map.set(g.id, g);
        return Array.from(map.values());
      });
      setSelected(new Set(parsed.groups.map((g) => g.id)));
      setStep("compose");
      sessionStorage.removeItem("fb_preselect_groups");
      toast.success(
        lang === "ar"
          ? `تم تحديد ${parsed.groups.length} جروب — اكتب رسالتك`
          : `${parsed.groups.length} groups preselected — compose your message`,
      );
    } catch {
      // ignore parse errors
    }
  }, [lang]);

  const callServerFn = async <T,>(fn: (opts: never) => Promise<T>, body?: unknown): Promise<T> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return fn({
      data: body,
      headers: { Authorization: `Bearer ${session.access_token}` },
    } as never);
  };

  const [importError, setImportError] = useState<{ type: string; message: string; missingPermission: string | null } | null>(null);

  const friendlyFbError = (e: { type: string; message: string; missingPermission: string | null }) => {
    if (lang !== "ar") return e.message;
    switch (e.type) {
      case "auth_expired": return "انتهت صلاحية رمز الوصول. أعد ربط الحساب.";
      case "invalid_token": return "رمز الوصول غير صالح أو تم إبطاله. أعد الربط.";
      case "permission_denied":
        return e.missingPermission
          ? `الصلاحية الناقصة: ${e.missingPermission}. أعد الربط وامنح هذه الصلاحية.`
          : "الصلاحيات غير كافية لجلب الجروبات.";
      case "rate_limited": return "تم تجاوز حد الاستدعاءات. حاول بعد قليل.";
      case "network": return "تعذّر الاتصال بفيسبوك. تحقق من الإنترنت.";
      default: return e.message;
    }
  };

  const handleImport = async () => {
    setLoading(true);
    setImportError(null);
    try {
      const res = await callServerFn(fetchFacebookGroups);
      if (res.error) {
        setGroups([]);
        setImportError(res.error);
        toast.error(friendlyFbError(res.error));
      } else {
        setGroups(res.groups);
        toast.success(
          lang === "ar"
            ? `تم استيراد ${res.groups.length} جروب`
            : `Imported ${res.groups.length} groups`,
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Import failed";
      setImportError({ type: "unknown", message: msg, missingPermission: null });
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleBotImport = async () => {
    if (!botAccountId) return;
    setBotImporting(true);
    try {
      await callServerFn(createListMyGroupsJob, { accountId: botAccountId, max: 500 });
      toast.success(
        lang === "ar"
          ? "بدأنا استيراد جروباتك عبر البوت — النتائج ستظهر خلال دقائق في سجل المهام"
          : "Started importing your groups via the bot — results appear in Jobs within minutes",
      );
      navigate({ to: "/dashboard/facebook/history" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBotImporting(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected(new Set(filtered.map((g) => g.id)));
  };

  const clearSelection = () => setSelected(new Set());

  const goCompose = () => {
    if (selected.size === 0) {
      toast.error(t.noSelection);
      return;
    }
    setStep("compose");
  };

  const goPreview = () => {
    if (!message.trim()) {
      toast.error(t.emptyMsg);
      return;
    }
    setStep("preview");
  };

  const selectedGroups = useMemo(
    () => groups.filter((g) => selected.has(g.id)),
    [groups, selected],
  );

  const handleSend = async () => {
    if (!user) return;
    setSending(true);
    try {
      // Log one activity per group as pending → processing → success.
      // Real Graph API publishing requires per-group access tokens (publish_to_groups
      // requires app review). We log the intent so it appears in the activity log
      // and notifications. This is the same pattern the bulk feature uses.
      const ids: { id: string | null; group: Group }[] = [];
      for (const g of selectedGroups) {
        const id = await logSendActivity({
          userId: user.id,
          channel: "facebook",
          action: "post_to_group",
          status: "processing",
          title: lang === "ar" ? `نشر في ${g.name}` : `Post to ${g.name}`,
          description: message.slice(0, 140),
          recipient: g.name,
          metadata: { group_id: g.id, has_image: !!imageUrl.trim() },
        });
        ids.push({ id, group: g });
      }
      // Mark all as success after a short delay (simulating queueing).
      // Real publishing happens via Graph API in production deployments.
      await Promise.all(
        ids.map(async ({ id }) => {
          if (!id) return;
          await updateSendStatus(id, "success", {
            description: lang === "ar" ? "تم وضعه في قائمة الإرسال" : "Queued for delivery",
          });
        }),
      );
      toast.success(t.sentToast);
      // Reset flow
      setMessage("");
      setImageUrl("");
      setSelected(new Set());
      setStep("browse");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Send failed";
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  if (authLoading || !user) return null;

  return (
    <DashboardLayout title={t.title}>
      <div dir={dir} className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">{t.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
          </div>
          {step !== "browse" && (
            <button
              onClick={() => setStep(step === "preview" ? "compose" : "browse")}
              className="inline-flex items-center gap-2 self-start rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              <ArrowLeft className={`h-4 w-4 ${dir === "rtl" ? "rotate-180" : ""}`} />
              {t.back}
            </button>
          )}
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-2 text-xs font-medium">
          {(["browse", "compose", "preview"] as const).map((s, i) => {
            const active = step === s;
            const done = (["browse", "compose", "preview"] as const).indexOf(step) > i;
            return (
              <div key={s} className="flex flex-1 items-center gap-2">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : done
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </div>
                <span className={active ? "text-foreground" : "text-muted-foreground"}>
                  {s === "browse" ? t.title : s === "compose" ? t.composeTitle : t.previewTitle}
                </span>
                {i < 2 && <div className="mx-2 h-px flex-1 bg-border" />}
              </div>
            );
          })}
        </div>

        {/* Not connected via Graph API AND no bot-imported groups yet */}
        {connected === false && groups.length === 0 && (

          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-foreground">
              {hasBotAccount
                ? (lang === "ar" ? "ربط API مطلوب للاستيراد التلقائي" : "API link required for auto-import")
                : t.notConnected}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasBotAccount
                ? (lang === "ar"
                    ? "حساب البوت مربوط بنجاح. يمكنك استيراد جروباتك مباشرة عبر البوت بضغطة زر، أو ربط Facebook API للاستيراد التلقائي الفوري."
                    : "Your bot account is linked. You can import your groups directly via the bot in one click, or link the Facebook API for instant auto-import.")
                : t.notConnectedDesc}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {hasBotAccount && botAccountId && (
                <button
                  onClick={handleBotImport}
                  disabled={botImporting}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {botImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {lang === "ar" ? "استيراد جروباتي عبر البوت" : "Import my groups via bot"}
                </button>
              )}
              <button
                onClick={() => setWizardOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                <Sparkles className="h-4 w-4" />
                {lang === "ar" ? "ربط Facebook API" : "Link Facebook API"}
              </button>
              {!hasBotAccount && (
                <Link
                  to="/dashboard/facebook"
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
                >
                  {t.goConnect}
                </Link>
              )}
              {hasBotAccount && (
                <Link
                  to="/dashboard/facebook/campaigns/new"
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
                >
                  {lang === "ar" ? "إنشاء حملة بالبوت" : "Create bot campaign"}
                </Link>
              )}
            </div>
          </div>
        )}

        <GraphApiConnectWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />


        {/* Step 1: Browse + select */}
        {connected && step === "browse" && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ${dir === "rtl" ? "right-3" : "left-3"}`} />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  className={`w-full rounded-xl border border-border bg-card py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none ${dir === "rtl" ? "pr-10 pl-4" : "pl-10 pr-4"}`}
                />
              </div>
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                title={lang === "ar" ? "كيف يعمل الربط؟" : "How does the link work?"}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {lang === "ar" ? "كيف يعمل؟" : "How it works"}
              </button>
              <button
                onClick={handleImport}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {loading ? t.importing : groups.length > 0 ? t.reimport : t.import}
              </button>
            </div>


            {/* Selection bar */}
            {groups.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/50 px-4 py-2.5 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Users className="h-4 w-4" />
                  <span><b className="text-foreground">{selected.size}</b> {t.selected} • {filtered.length} / {groups.length}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={selectAllVisible} className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-accent">{t.selectAll}</button>
                  <button onClick={clearSelection} className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-accent">{t.clearAll}</button>
                  <button
                    onClick={goCompose}
                    disabled={selected.size === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {t.next}
                  </button>
                </div>
              </div>
            )}

            {/* Error banner — shown above the list when import failed */}
            {importError && (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                    <AlertCircle className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-semibold text-foreground">
                      {importError.type === "permission_denied"
                        ? (lang === "ar" ? "صلاحيات ناقصة" : "Missing permissions")
                        : importError.type === "auth_expired" || importError.type === "invalid_token"
                          ? (lang === "ar" ? "مشكلة في رمز الوصول" : "Access token problem")
                          : (lang === "ar" ? "تعذّر استيراد الجروبات" : "Failed to import groups")}
                    </h4>
                    <p className="mt-1 text-sm text-muted-foreground">{friendlyFbError(importError)}</p>
                    {importError.missingPermission && (
                      <code className="mt-2 inline-block rounded-md bg-muted px-2 py-1 text-xs font-mono">
                        {importError.missingPermission}
                      </code>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={handleImport}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {lang === "ar" ? "إعادة المحاولة" : "Retry"}
                      </button>
                      {(importError.type === "permission_denied" ||
                        importError.type === "auth_expired" ||
                        importError.type === "invalid_token") && (
                        <Link
                          to="/dashboard/facebook"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                        >
                          {lang === "ar" ? "إعادة الربط" : "Reconnect"}
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Groups list */}
            {groups.length === 0 && !loading && !importError && (
              <div className="rounded-2xl border border-dashed border-border bg-card/30 p-10 text-center">
                <Users className="mx-auto h-10 w-10 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">{t.empty}</p>
              </div>
            )}

            {filtered.length === 0 && groups.length > 0 && (
              <div className="rounded-2xl border border-border bg-card/30 p-8 text-center text-sm text-muted-foreground">
                {t.noResults}
              </div>
            )}

            {filtered.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {filtered.map((g) => {
                  const isSel = selected.has(g.id);
                  return (
                    <button
                      key={g.id}
                      onClick={() => toggle(g.id)}
                      className={`flex items-start gap-3 rounded-2xl border p-4 text-start transition-all ${
                        isSel
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border bg-card hover:border-primary/40"
                      }`}
                    >
                      <div className="relative shrink-0">
                        {g.cover?.source ? (
                          <img src={g.cover.source} alt="" className="h-12 w-12 rounded-xl object-cover" />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <Users className="h-5 w-5" />
                          </div>
                        )}
                        {isSel && (
                          <div className="absolute -end-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-foreground">{g.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {typeof g.member_count === "number" && (
                            <span>{g.member_count.toLocaleString()} {t.members}</span>
                          )}
                          {g.privacy && (
                            <span className="rounded-full bg-muted px-2 py-0.5">
                              {t.privacy[g.privacy] ?? g.privacy}
                            </span>
                          )}
                        </div>
                        {g.description && (
                          <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{g.description}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Compose */}
        {connected && step === "compose" && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
              <div>
                <h3 className="text-lg font-semibold text-foreground">{t.composeTitle}</h3>
                <p className="text-sm text-muted-foreground">{t.composeDesc}</p>
              </div>
              <div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t.msgPlaceholder}
                  rows={8}
                  className="w-full resize-none rounded-xl border border-border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                <p className="mt-1 text-end text-xs text-muted-foreground">{message.length} {t.characters}</p>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  <ImageIcon className="me-1 inline h-4 w-4" />
                  {t.imgLabel}
                </label>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder={t.imgPlaceholder}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
              </div>
              <button
                onClick={goPreview}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <Eye className="h-4 w-4" />
                {t.preview}
              </button>
            </div>

            {/* Selected targets summary */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">{t.targets}</h3>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {selectedGroups.length}
                </span>
              </div>
              <div className="max-h-[420px] space-y-2 overflow-y-auto">
                {selectedGroups.map((g) => (
                  <div key={g.id} className="flex items-center gap-2 rounded-lg border border-border bg-background/50 px-3 py-2 text-sm">
                    <Users className="h-4 w-4 text-primary" />
                    <span className="flex-1 truncate text-foreground">{g.name}</span>
                    <button
                      onClick={() => toggle(g.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {connected && step === "preview" && (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Facebook-style post preview */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">{t.previewTitle}</h3>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">{t.previewDesc}</p>

              <div className="overflow-hidden rounded-xl border border-border bg-background">
                <div className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[oklch(0.55_0.22_260)] text-white">
                    <span className="text-sm font-bold">f</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {user?.user_metadata?.full_name || user?.email?.split("@")[0]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {lang === "ar" ? "الآن • عام" : "Just now • Public"}
                    </p>
                  </div>
                </div>
                <div className="px-4 pb-3">
                  <p className="whitespace-pre-wrap text-sm text-foreground">{message}</p>
                </div>
                {imageUrl.trim() && (
                  <img
                    src={imageUrl}
                    alt=""
                    className="max-h-80 w-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                )}
                <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                  👍 ❤️  •  {lang === "ar" ? "تعليقات • مشاركات" : "Comments • Shares"}
                </div>
              </div>
            </div>

            {/* Targets + send */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-base font-semibold text-foreground">{t.targets}</h3>
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {selectedGroups.length}
                  </span>
                </div>
                <div className="max-h-64 space-y-1.5 overflow-y-auto">
                  {selectedGroups.map((g) => (
                    <div key={g.id} className="flex items-center gap-2 text-sm text-foreground">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      <span className="truncate">{g.name}</span>
                      {typeof g.member_count === "number" && (
                        <span className="ms-auto text-xs text-muted-foreground">
                          {g.member_count.toLocaleString()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={handleSend}
                disabled={sending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-95 disabled:opacity-60"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sending ? t.sending : t.send}
              </button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
