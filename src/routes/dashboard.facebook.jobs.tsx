import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2, Send, Eye, AlertCircle, Users, UserPlus, MessageSquare, FileText, Info, ShieldAlert, EyeOff, Lock, BarChart3 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { listBotAccounts, createPostJob, createExtractPagesJob, createExtractCommentersJob, createExtractGroupMembersJob, createExtractPageAudienceJob } from "@/lib/fb-bot.functions";
import { z } from "zod";

export const Route = createFileRoute("/dashboard/facebook/jobs")({
  ssr: false,
  validateSearch: z.object({ tab: z.enum(["post", "pages", "commenters", "groupmembers", "pageaudience"]).optional() }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.getSession();
  },
  component: JobsHubPage,
});

type Account = { id: string; display_name: string; status: string };
const SAFE_ACCOUNT_SELECT = "id, display_name, status";

function JobsHubPage() {
  const { user, loading: authLoading } = useAuth();
  const { lang } = useI18n();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/dashboard/facebook/jobs" });
  const activeTab = search.tab ?? "post";
  const listAccountsFn = useServerFn(listBotAccounts);
  const createPostJobFn = useServerFn(createPostJob);
  const createExtractPagesJobFn = useServerFn(createExtractPagesJob);
  const createExtractCommentersJobFn = useServerFn(createExtractCommentersJob);
  const createExtractGroupMembersJobFn = useServerFn(createExtractGroupMembersJob);
  const createExtractPageAudienceJobFn = useServerFn(createExtractPageAudienceJob);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Post job
  const [content, setContent] = useState("");
  const [groupIds, setGroupIds] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [scheduledAt, setScheduledAt] = useState("");
  // Extract commenters
  const [postUrl, setPostUrl] = useState("");
  // Extract group members
  const [groupMembersId, setGroupMembersId] = useState("");
  const [groupMaxMembers, setGroupMaxMembers] = useState(200);
  const [groupFilterKeywords, setGroupFilterKeywords] = useState("");
  // Extract page audience
  const [pageAudienceId, setPageAudienceId] = useState("");
  const [pageMaxItems, setPageMaxItems] = useState(1000);
  const [paFollowers, setPaFollowers] = useState(true);
  const [paLikers, setPaLikers] = useState(true);
  const [paEngagers, setPaEngagers] = useState(false);

  const t = lang === "ar" ? {
    title: "مهام البوت",
    subtitle: "أنشئ مهام نشر تلقائي أو استخراج بيانات",
    accountLabel: "اختر الحساب",
    invalidAccount: "هذا الحساب غير صالح حالياً. حدّث كوكيز فيسبوك من صفحة ربط الحسابات أولاً.",
    activeAccountRequired: "لا يمكن إنشاء المهمة لأن الحساب المختار غير صالح. حدّث الكوكيز أو اختر حساب Active.",
    noAccounts: "لا توجد حسابات. اربط حساب أولاً.",
    addAccount: "ربط حساب",
    tabPost: "نشر على جروبات",
    tabExtractPages: "صفحاتي",
    tabExtractCommenters: "معلقي بوست",
    tabGroupMembers: "أعضاء جروب",
    tabPageAudience: "جمهور صفحة",
    content: "محتوى المنشور",
    contentPh: "اكتب نص المنشور… يدعم {{spin:نص1|نص2}} للمحتوى المتغير",
    groupIds: "Group IDs (واحد في كل سطر)",
    groupIdsPh: "1234567890\n9876543210",
    intervalMin: "فاصل زمني بين البوستات (دقايق)",
    schedule: "جدولة (اختياري)",
    create: "إنشاء المهمة",
    extractPagesDesc: "يفتح صفحة Pages المربوطة بحسابك ويستخرج كل الصفحات اللي بتديرها.",
    postUrl: "رابط البوست",
    postUrlPh: "https://www.facebook.com/...",
    created: "تم إنشاء المهمة",
    viewJobs: "→ عرض كل المهام",
    intervalHint: "نوصي بحد أدنى 5 دقايق لتفادي الحظر",
    gmGroup: "ID الجروب أو رابطه",
    gmGroupPh: "1234567890 أو https://facebook.com/groups/...",
    gmMax: "الحد الأقصى للأعضاء",
    gmKeywords: "كلمات فلترة (اختياري، مفصولة بفاصلة)",
    gmKeywordsPh: "مصر, قاهرة, ملابس",
    gmHint: "بيسحب الأعضاء الظاهرين فعلياً (حد أقصى 200 لحماية حسابك من الحظر). يتطلب أن تكون عضو في الجروب.",
    paPage: "ID الصفحة أو رابطها",
    paPagePh: "pageusername أو 100012345",
    paMax: "الحد الأقصى",
    paSources: "المصادر",
    paFollowersLabel: "المتابعون",
    paLikersLabel: "الإعجابات",
    paEngagersLabel: "المتفاعلون مع البوستات",
    paHint: "بيسحب الجمهور المرئي علنياً فقط (حد أقصى 3000).",
    paLimitsTitle: "قيود استخراج جمهور الصفحات",
    paLimitsIntro: "أي صفحة عامة تقدر تستخرج منها، بشرط إن المحتوى ظاهر فعلاً للحساب اللي شغّال بيه البوت. خد بالك من الحالات دي:",
    paLimit1Title: "صفحات أخفت جمهورها",
    paLimit1Body: "بعض الصفحات بتعطّل ظهور قائمة المعجبين والمتابعين من إعدادات الصفحة، وفي الحالة دي مفيش طريقة لاستخراجهم.",
    paLimit2Title: "محتوى غير عام",
    paLimit2Body: "لو البوست أو الصفحة محدودة لأصدقاء صاحبها أو لجروب خاص، الحساب المربوط لازم يكون عنده صلاحية رؤية المحتوى.",
    paLimit3Title: "حدود فيسبوك للصفحات الكبيرة",
    paLimit3Body: "في الصفحات اللي عندها +100 ألف متابع، فيسبوك بيعرض عينة فقط مش كل الجمهور، فالرقم الظاهر مش بالضرورة كامل الجمهور الحقيقي.",
    paLimit4Title: "حماية الحساب",
    paLimit4Body: "ابدأ بأرقام صغيرة (500-1000) لأول مرة، ولو كل حاجة تمام زوّد تدريجياً، عشان نتجنّب أي Checkpoint أو حظر مؤقت من فيسبوك.",
  } : {
    title: "Bot Jobs",
    subtitle: "Create automation jobs",
    accountLabel: "Select account",
    invalidAccount: "This account is not valid right now. Refresh its Facebook cookies from the bot accounts page first.",
    activeAccountRequired: "Can't create the job because the selected account is not valid. Refresh cookies or choose an Active account.",
    noAccounts: "No accounts yet. Link one first.",
    addAccount: "Link account",
    tabPost: "Post",
    tabExtractPages: "My Pages",
    tabExtractCommenters: "Commenters",
    tabGroupMembers: "Group Members",
    tabPageAudience: "Page Audience",
    content: "Post content",
    contentPh: "Write the post… supports {{spin:option1|option2}} for variations",
    groupIds: "Group IDs (one per line)",
    groupIdsPh: "1234567890\n9876543210",
    intervalMin: "Interval between posts (minutes)",
    schedule: "Schedule (optional)",
    create: "Create job",
    extractPagesDesc: "Opens your Pages section and extracts all pages you manage.",
    postUrl: "Post URL",
    postUrlPh: "https://www.facebook.com/...",
    created: "Job created",
    viewJobs: "→ View all jobs",
    intervalHint: "Minimum 5 min recommended to avoid bans",
    gmGroup: "Group ID or URL",
    gmGroupPh: "1234567890 or https://facebook.com/groups/...",
    gmMax: "Max members",
    gmKeywords: "Filter keywords (optional, comma-separated)",
    gmKeywordsPh: "egypt, cairo, fashion",
    gmHint: "Extracts visible members only (max 200 to protect your account from blocks). You must be a group member.",
    paPage: "Page ID or URL",
    paPagePh: "pageusername or 100012345",
    paMax: "Max items",
    paSources: "Sources",
    paFollowersLabel: "Followers",
    paLikersLabel: "Likers",
    paEngagersLabel: "Post engagers",
    paHint: "Only publicly visible audience can be extracted (max 3000).",
    paLimitsTitle: "Page audience extraction limits",
    paLimitsIntro: "You can extract from any public page, as long as the content is actually visible to the linked account. Keep these limits in mind:",
    paLimit1Title: "Pages that hide their audience",
    paLimit1Body: "Some pages disable the public list of likers and followers from page settings — in that case there is no way to extract them.",
    paLimit2Title: "Non-public content",
    paLimit2Body: "If the post or page is restricted to friends or a private group, the connected account must have permission to see it.",
    paLimit3Title: "Facebook limits on large pages",
    paLimit3Body: "For pages with 100k+ followers, Facebook only returns a sample of the audience, not the full list.",
    paLimit4Title: "Account safety",
    paLimit4Body: "Start with small batches (500-1000) the first time, then scale up gradually to avoid triggering a Facebook checkpoint or a temporary block.",
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    (async () => {
      // Robust loader: try server fn; if it returns ok:false OR throws OR returns
      // empty, fall back to a direct RLS-scoped browser query so this page
      // never disagrees with /dashboard/facebook/bot.
      const browserFallback = async (): Promise<Account[]> => {
        const { data: rows, error } = await supabase
          .from("fb_bot_accounts")
          .select(SAFE_ACCOUNT_SELECT)
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
        if (error) throw error;
        return (rows ?? []) as Account[];
      };

      let data: Account[] | null = null;
      try {
        const raw = (await listAccountsFn()) as { ok?: boolean; accounts?: Account[] };
        if (raw && raw.ok !== false && Array.isArray(raw.accounts)) {
          data = raw.accounts;
        } else {
          console.warn("[fb-jobs] server fn returned non-ok, falling back", raw);
        }
      } catch (e) {
        console.warn("[fb-jobs] listBotAccounts threw, falling back:", e);
      }

      if (data === null || data.length === 0) {
        try {
          const fb = await browserFallback();
          if (fb.length > 0 || data === null) data = fb;
        } catch (fallbackErr) {
          console.error("[fb-jobs] browser fallback failed:", fallbackErr);
          toast.error(String(fallbackErr));
          data = data ?? [];
        }
      }

      setAccounts(data);
      if (data.length > 0) {
        const active = data.find((a) => a.status === "active");
        setAccountId((active ?? data[0]).id);
      }
      setLoading(false);
    })();
  }, [user, authLoading]);

  const submitPost = async () => {
    if (!accountId) return;
    const selectedAccount = accounts.find((a) => a.id === accountId);
    if (selectedAccount?.status !== "active") { toast.error(t.activeAccountRequired); return; }
    const ids = groupIds.split("\n").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) { toast.error(t.groupIds); return; }
    setBusy(true);
    try {
      await createPostJobFn({ data: {
        accountId,
        content,
        groupIds: ids,
        intervalMinutes,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      } });
      toast.success(t.created);
      setContent(""); setGroupIds(""); setScheduledAt("");
    } catch (e) { toast.error(String(e)); } finally { setBusy(false); }
  };

  const submitExtractPages = async () => {
    if (!accountId) return;
    const selectedAccount = accounts.find((a) => a.id === accountId);
    if (selectedAccount?.status !== "active") { toast.error(t.activeAccountRequired); return; }
    setBusy(true);
    try {
      await createExtractPagesJobFn({ data: { accountId } });
      toast.success(t.created);
    } catch (e) { toast.error(String(e)); } finally { setBusy(false); }
  };

  const submitExtractCommenters = async () => {
    if (!accountId) { toast.error("لا يوجد حساب فيسبوك مرتبط — اربط حسابك أولاً من صفحة البوت"); return; }
    const selectedAccount = accounts.find((a) => a.id === accountId);
    if (selectedAccount?.status !== "active") { toast.error(t.activeAccountRequired); return; }
    if (!postUrl.trim()) { toast.error("الرجاء إدخال رابط البوست"); return; }
    setBusy(true);
    try {
      const res = await createExtractCommentersJobFn({ data: { accountId, postUrl: postUrl.trim() } });
      console.log("[extract-commenters] job created:", res);
      toast.success(`${t.created}`, {
        description: "ستُنفَّذ تلقائيًا فور تشغيل برنامج الـ Worker على جهازك. شغّله من مجلد /worker (راجع worker/README.md).",
        duration: 8000,
      });

      setPostUrl("");
    } catch (e) {
      console.error("[extract-commenters] failed:", e);
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`فشل إنشاء المهمة: ${msg}`);
    } finally { setBusy(false); }
  };

  const submitGroupMembers = async () => {
    if (!accountId || !groupMembersId.trim()) return;
    const selectedAccount = accounts.find((a) => a.id === accountId);
    if (selectedAccount?.status !== "active") { toast.error(t.activeAccountRequired); return; }
    setBusy(true);
    try {
      const filterKeywords = groupFilterKeywords.split(",").map((s) => s.trim()).filter(Boolean);
      await createExtractGroupMembersJobFn({ data: {
        accountId,
        groupId: groupMembersId.trim(),
        maxMembers: groupMaxMembers,
        filterKeywords,
      } });
      toast.success(t.created);
      setGroupMembersId(""); setGroupFilterKeywords("");
    } catch (e) { toast.error(String(e)); } finally { setBusy(false); }
  };

  const submitPageAudience = async () => {
    if (!accountId || !pageAudienceId.trim()) return;
    const selectedAccount = accounts.find((a) => a.id === accountId);
    if (selectedAccount?.status !== "active") { toast.error(t.activeAccountRequired); return; }
    const sources: ("followers" | "likers" | "engagers")[] = [];
    if (paFollowers) sources.push("followers");
    if (paLikers) sources.push("likers");
    if (paEngagers) sources.push("engagers");
    if (sources.length === 0) { toast.error(t.paSources); return; }
    setBusy(true);
    try {
      await createExtractPageAudienceJobFn({ data: {
        accountId,
        pageId: pageAudienceId.trim(),
        sources,
        maxItems: pageMaxItems,
      } });
      toast.success(t.created);
      setPageAudienceId("");
    } catch (e) { toast.error(String(e)); } finally { setBusy(false); }
  };

  if (loading) return (
    <DashboardLayout title={t.title}>
      <div className="flex items-center justify-center p-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
    </DashboardLayout>
  );

  if (accounts.length === 0) return (
    <DashboardLayout title={t.title}>
      <Card className="p-10 text-center">
        <AlertCircle className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
        <p className="mb-4 text-muted-foreground">{t.noAccounts}</p>
        <Link to="/dashboard/facebook/bot"><Button>{t.addAccount}</Button></Link>
      </Card>
    </DashboardLayout>
  );

  return (
    <DashboardLayout title={t.title}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold">{t.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
          </div>
          <Link to="/dashboard/facebook/history"><Button variant="outline"><Eye className="me-2 h-4 w-4" />{t.viewJobs}</Button></Link>
        </div>

        <Card className="p-4">
          <Label className="mb-2 block">{t.accountLabel}</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>{a.display_name} ({a.status})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {accounts.find((a) => a.id === accountId)?.status !== "active" && (
            <p className="mt-2 text-sm text-destructive">{t.invalidAccount}</p>
          )}
        </Card>


        <Tabs value={activeTab} onValueChange={(v) => navigate({ search: { tab: v as typeof activeTab }, replace: true })}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="post">{t.tabPost}</TabsTrigger>
            <TabsTrigger value="groupmembers">{t.tabGroupMembers}</TabsTrigger>
            <TabsTrigger value="pageaudience">{t.tabPageAudience}</TabsTrigger>
            <TabsTrigger value="commenters">{t.tabExtractCommenters}</TabsTrigger>
            <TabsTrigger value="pages">{t.tabExtractPages}</TabsTrigger>
          </TabsList>

          <TabsContent value="post">
            <Card dir={lang === "ar" ? "rtl" : "ltr"} className="space-y-4 p-5 text-start">
              <div className="space-y-2">
                <Label>{t.content}</Label>
                <Textarea dir={lang === "ar" ? "rtl" : "ltr"} className="text-start" rows={5} placeholder={t.contentPh} value={content} onChange={(e) => setContent(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t.groupIds}</Label>
                <Textarea dir={lang === "ar" ? "rtl" : "ltr"} rows={4} placeholder={t.groupIdsPh} className="font-mono text-sm text-start" value={groupIds} onChange={(e) => setGroupIds(e.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t.intervalMin}</Label>
                  <Input dir={lang === "ar" ? "rtl" : "ltr"} className="text-start" type="number" min={1} max={1440} value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))} />
                  <p className="text-xs text-muted-foreground">{t.intervalHint}</p>
                </div>
                <div className="space-y-2">
                  <Label>{t.schedule}</Label>
                  <Input dir={lang === "ar" ? "rtl" : "ltr"} className="text-start" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
                </div>
              </div>
              <Button onClick={submitPost} disabled={busy} className="w-full gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {t.create}
              </Button>
            </Card>
          </TabsContent>

          <TabsContent value="groupmembers">
            <Card dir={lang === "ar" ? "rtl" : "ltr"} className={`space-y-4 p-5 ${lang === "ar" ? "text-right" : "text-left"}`}>
              <p className={`text-sm text-muted-foreground ${lang === "ar" ? "text-right" : "text-left"}`}>{t.gmHint}</p>
              <div className="space-y-2">
                <Label className={`block ${lang === "ar" ? "text-right" : "text-left"}`}>{t.gmGroup}</Label>
                <Input dir={lang === "ar" ? "rtl" : "ltr"} className={lang === "ar" ? "text-right" : "text-left"} placeholder={t.gmGroupPh} value={groupMembersId} onChange={(e) => setGroupMembersId(e.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className={`block ${lang === "ar" ? "text-right" : "text-left"}`}>{t.gmMax}</Label>
                  <Input dir={lang === "ar" ? "rtl" : "ltr"} className={lang === "ar" ? "text-right" : "text-left"} type="number" min={50} max={200} step={50} value={groupMaxMembers} onChange={(e) => setGroupMaxMembers(Number(e.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label className={`block ${lang === "ar" ? "text-right" : "text-left"}`}>{t.gmKeywords}</Label>
                  <Input dir={lang === "ar" ? "rtl" : "ltr"} className={lang === "ar" ? "text-right" : "text-left"} placeholder={t.gmKeywordsPh} value={groupFilterKeywords} onChange={(e) => setGroupFilterKeywords(e.target.value)} />
                </div>
              </div>
              <Button onClick={submitGroupMembers} disabled={busy || !groupMembersId.trim()} className="w-full">
                {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t.create}
              </Button>
            </Card>
          </TabsContent>

          <TabsContent value="pageaudience">
            <div className="space-y-4">
              <div dir={lang === "ar" ? "rtl" : "ltr"} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-start">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-semibold text-foreground">{t.paLimitsTitle}</h4>
                      <p className="mt-1 text-sm text-muted-foreground">{t.paLimitsIntro}</p>
                    </div>
                    <ul className="space-y-2.5 text-sm">
                      <li className="flex items-start gap-2">
                        <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <span><span className="font-medium text-foreground">{t.paLimit1Title}:</span> <span className="text-muted-foreground">{t.paLimit1Body}</span></span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <span><span className="font-medium text-foreground">{t.paLimit2Title}:</span> <span className="text-muted-foreground">{t.paLimit2Body}</span></span>
                      </li>
                      <li className="flex items-start gap-2">
                        <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <span><span className="font-medium text-foreground">{t.paLimit3Title}:</span> <span className="text-muted-foreground">{t.paLimit3Body}</span></span>
                      </li>
                      <li className="flex items-start gap-2">
                        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <span><span className="font-medium text-foreground">{t.paLimit4Title}:</span> <span className="text-muted-foreground">{t.paLimit4Body}</span></span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
              <Card dir={lang === "ar" ? "rtl" : "ltr"} className="space-y-4 p-5 text-start">
                <p className="text-sm text-muted-foreground">{t.paHint}</p>
                <div className="space-y-2">
                  <Label>{t.paPage}</Label>
                  <Input dir={lang === "ar" ? "rtl" : "ltr"} className="text-start" placeholder={t.paPagePh} value={pageAudienceId} onChange={(e) => setPageAudienceId(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{t.paSources}</Label>
                  <div className="flex flex-wrap gap-4 pt-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={paFollowers} onChange={(e) => setPaFollowers(e.target.checked)} />
                      {t.paFollowersLabel}
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={paLikers} onChange={(e) => setPaLikers(e.target.checked)} />
                      {t.paLikersLabel}
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={paEngagers} onChange={(e) => setPaEngagers(e.target.checked)} />
                      {t.paEngagersLabel}
                    </label>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t.paMax}</Label>
                  <Input dir={lang === "ar" ? "rtl" : "ltr"} className="text-start" type="number" min={50} max={3000} step={50} value={pageMaxItems} onChange={(e) => setPageMaxItems(Number(e.target.value))} />
                </div>
                <Button onClick={submitPageAudience} disabled={busy || !pageAudienceId.trim()} className="w-full">
                  {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t.create}
                </Button>
              </Card>
            </div>
          </TabsContent>



          <TabsContent value="commenters">
            <Card dir={lang === "ar" ? "rtl" : "ltr"} className="space-y-4 p-5 text-start">
              <div className="space-y-2">
                <Label>{t.postUrl}</Label>
                <Input dir={lang === "ar" ? "rtl" : "ltr"} className="text-start" placeholder={t.postUrlPh} value={postUrl} onChange={(e) => setPostUrl(e.target.value)} />
              </div>
              <Button onClick={submitExtractCommenters} disabled={busy || !postUrl} className="w-full">
                {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t.create}
              </Button>
            </Card>
          </TabsContent>

          <TabsContent value="pages">
            <Card dir={lang === "ar" ? "rtl" : "ltr"} className="space-y-4 p-5 text-start">
              <p className="text-sm text-muted-foreground">{t.extractPagesDesc}</p>
              <Button onClick={submitExtractPages} disabled={busy} className="w-full">
                {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t.create}
              </Button>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
