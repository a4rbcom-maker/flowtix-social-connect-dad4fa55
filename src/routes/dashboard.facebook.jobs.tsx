import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2, Send, Eye, AlertCircle, Users, UserPlus, MessageSquare, FileText } from "lucide-react";
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
  const [groupMaxMembers, setGroupMaxMembers] = useState(1500);
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
    gmHint: "بيسحب الأعضاء الظاهرين فعلياً (حد أقصى 5000). يتطلب أن تكون عضو في الجروب.",
    paPage: "ID الصفحة أو رابطها",
    paPagePh: "pageusername أو 100012345",
    paMax: "الحد الأقصى",
    paSources: "المصادر",
    paFollowersLabel: "المتابعون",
    paLikersLabel: "الإعجابات",
    paEngagersLabel: "المتفاعلون مع البوستات",
    paHint: "بيسحب الجمهور المرئي علنياً فقط (حد أقصى 3000).",
  } : {
    title: "Bot Jobs",
    subtitle: "Create automation jobs",
    accountLabel: "Select account",
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
    gmHint: "Extracts visible members only (max 5000). You must be a group member.",
    paPage: "Page ID or URL",
    paPagePh: "pageusername or 100012345",
    paMax: "Max items",
    paSources: "Sources",
    paFollowersLabel: "Followers",
    paLikersLabel: "Likers",
    paEngagersLabel: "Post engagers",
    paHint: "Only publicly visible audience can be extracted (max 3000).",
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const raw = await listAccountsFn();
        const data: Account[] = Array.isArray((raw as { accounts?: unknown })?.accounts)
          ? ((raw as { accounts: Account[] }).accounts)
          : [];
        setAccounts(data);
        if (data.length > 0) setAccountId(data[0].id);
      } catch (e) {
        try {
          const { data: browserRows, error } = await supabase
            .from("fb_bot_accounts")
            .select(SAFE_ACCOUNT_SELECT)
            .eq("user_id", user.id)
            .order("created_at", { ascending: false });
          if (error) throw error;
          const data = (browserRows ?? []) as Account[];
          setAccounts(data);
          if (data.length > 0) setAccountId(data[0].id);
        } catch (fallbackErr) {
          console.error("[fb-jobs] listBotAccounts failed:", fallbackErr);
          toast.error(String(fallbackErr));
        }
      }
      finally { setLoading(false); }
    })();
  }, [user, authLoading]);

  const submitPost = async () => {
    if (!accountId) return;
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
    setBusy(true);
    try {
      await createExtractPagesJobFn({ data: { accountId } });
      toast.success(t.created);
    } catch (e) { toast.error(String(e)); } finally { setBusy(false); }
  };

  const submitExtractCommenters = async () => {
    if (!accountId || !postUrl) return;
    setBusy(true);
    try {
      await createExtractCommentersJobFn({ data: { accountId, postUrl } });
      toast.success(t.created);
      setPostUrl("");
    } catch (e) { toast.error(String(e)); } finally { setBusy(false); }
  };

  const submitGroupMembers = async () => {
    if (!accountId || !groupMembersId.trim()) return;
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
        </Card>

        <Card className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground me-1">{lang === "ar" ? "وصول سريع:" : "Quick access:"}</span>
            <Button size="sm" variant={activeTab === "groupmembers" ? "default" : "outline"} onClick={() => navigate({ search: { tab: "groupmembers" }, replace: true })} className="gap-2">
              <Users className="h-4 w-4" />{t.tabGroupMembers}
            </Button>
            <Button size="sm" variant={activeTab === "pageaudience" ? "default" : "outline"} onClick={() => navigate({ search: { tab: "pageaudience" }, replace: true })} className="gap-2">
              <UserPlus className="h-4 w-4" />{t.tabPageAudience}
            </Button>
            <Button size="sm" variant={activeTab === "commenters" ? "default" : "outline"} onClick={() => navigate({ search: { tab: "commenters" }, replace: true })} className="gap-2">
              <MessageSquare className="h-4 w-4" />{t.tabExtractCommenters}
            </Button>
            <Button size="sm" variant={activeTab === "post" ? "default" : "outline"} onClick={() => navigate({ search: { tab: "post" }, replace: true })} className="gap-2">
              <FileText className="h-4 w-4" />{t.tabPost}
            </Button>
          </div>
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
            <Card className="space-y-4 p-5">
              <div className="space-y-2">
                <Label>{t.content}</Label>
                <Textarea rows={5} placeholder={t.contentPh} value={content} onChange={(e) => setContent(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t.groupIds}</Label>
                <Textarea rows={4} placeholder={t.groupIdsPh} className="font-mono text-sm" value={groupIds} onChange={(e) => setGroupIds(e.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t.intervalMin}</Label>
                  <Input type="number" min={1} max={1440} value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))} />
                  <p className="text-xs text-muted-foreground">{t.intervalHint}</p>
                </div>
                <div className="space-y-2">
                  <Label>{t.schedule}</Label>
                  <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
                </div>
              </div>
              <Button onClick={submitPost} disabled={busy} className="w-full gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {t.create}
              </Button>
            </Card>
          </TabsContent>

          <TabsContent value="groupmembers">
            <Card className="space-y-4 p-5">
              <p className="text-sm text-muted-foreground">{t.gmHint}</p>
              <div className="space-y-2">
                <Label>{t.gmGroup}</Label>
                <Input placeholder={t.gmGroupPh} value={groupMembersId} onChange={(e) => setGroupMembersId(e.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t.gmMax}</Label>
                  <Input type="number" min={50} max={5000} step={50} value={groupMaxMembers} onChange={(e) => setGroupMaxMembers(Number(e.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label>{t.gmKeywords}</Label>
                  <Input placeholder={t.gmKeywordsPh} value={groupFilterKeywords} onChange={(e) => setGroupFilterKeywords(e.target.value)} />
                </div>
              </div>
              <Button onClick={submitGroupMembers} disabled={busy || !groupMembersId.trim()} className="w-full">
                {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t.create}
              </Button>
            </Card>
          </TabsContent>

          <TabsContent value="pageaudience">
            <Card className="space-y-4 p-5">
              <p className="text-sm text-muted-foreground">{t.paHint}</p>
              <div className="space-y-2">
                <Label>{t.paPage}</Label>
                <Input placeholder={t.paPagePh} value={pageAudienceId} onChange={(e) => setPageAudienceId(e.target.value)} />
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
                <Input type="number" min={50} max={3000} step={50} value={pageMaxItems} onChange={(e) => setPageMaxItems(Number(e.target.value))} />
              </div>
              <Button onClick={submitPageAudience} disabled={busy || !pageAudienceId.trim()} className="w-full">
                {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t.create}
              </Button>
            </Card>
          </TabsContent>

          <TabsContent value="commenters">
            <Card className="space-y-4 p-5">
              <div className="space-y-2">
                <Label>{t.postUrl}</Label>
                <Input placeholder={t.postUrlPh} value={postUrl} onChange={(e) => setPostUrl(e.target.value)} />
              </div>
              <Button onClick={submitExtractCommenters} disabled={busy || !postUrl} className="w-full">
                {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t.create}
              </Button>
            </Card>
          </TabsContent>

          <TabsContent value="pages">
            <Card className="space-y-4 p-5">
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
