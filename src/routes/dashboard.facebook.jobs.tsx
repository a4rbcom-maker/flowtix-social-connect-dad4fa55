import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Send, Eye, AlertCircle } from "lucide-react";
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
import { useFacebookApi } from "@/features/facebook/api";
import { listBotAccounts, createPostJob, createExtractPagesJob, createExtractCommentersJob } from "@/lib/fb-bot.functions";

export const Route = createFileRoute("/dashboard/facebook/jobs")({
  beforeLoad: async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.getSession();
  },
  component: JobsHubPage,
});

type Account = { id: string; display_name: string; status: string };

function JobsHubPage() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const { call } = useFacebookApi();
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

  const t = lang === "ar" ? {
    title: "مهام البوت",
    subtitle: "أنشئ مهام نشر تلقائي أو استخراج بيانات",
    accountLabel: "اختر الحساب",
    noAccounts: "لا توجد حسابات. اربط حساب أولاً.",
    addAccount: "ربط حساب",
    tabPost: "نشر على جروبات",
    tabExtractPages: "استخراج صفحاتي",
    tabExtractCommenters: "استخراج معلقي بوست",
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
  } : {
    title: "Bot Jobs",
    subtitle: "Create automation jobs",
    accountLabel: "Select account",
    noAccounts: "No accounts yet. Link one first.",
    addAccount: "Link account",
    tabPost: "Post to groups",
    tabExtractPages: "Extract my pages",
    tabExtractCommenters: "Extract post commenters",
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
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const data = await call(listBotAccounts);
        setAccounts(data as Account[]);
        if ((data as Account[]).length > 0) setAccountId((data as Account[])[0].id);
      } catch (e) { toast.error(String(e)); }
      finally { setLoading(false); }
    })();
  }, [user]);

  const submitPost = async () => {
    if (!accountId) return;
    const ids = groupIds.split("\n").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) { toast.error(t.groupIds); return; }
    setBusy(true);
    try {
      await call(createPostJob, {
        accountId,
        content,
        groupIds: ids,
        intervalMinutes,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      });
      toast.success(t.created);
      setContent(""); setGroupIds(""); setScheduledAt("");
    } catch (e) { toast.error(String(e)); } finally { setBusy(false); }
  };

  const submitExtractPages = async () => {
    if (!accountId) return;
    setBusy(true);
    try {
      await call(createExtractPagesJob, { accountId });
      toast.success(t.created);
    } catch (e) { toast.error(String(e)); } finally { setBusy(false); }
  };

  const submitExtractCommenters = async () => {
    if (!accountId || !postUrl) return;
    setBusy(true);
    try {
      await call(createExtractCommentersJob, { accountId, postUrl });
      toast.success(t.created);
      setPostUrl("");
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

        <Tabs defaultValue="post">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="post">{t.tabPost}</TabsTrigger>
            <TabsTrigger value="pages">{t.tabExtractPages}</TabsTrigger>
            <TabsTrigger value="commenters">{t.tabExtractCommenters}</TabsTrigger>
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

          <TabsContent value="pages">
            <Card className="space-y-4 p-5">
              <p className="text-sm text-muted-foreground">{t.extractPagesDesc}</p>
              <Button onClick={submitExtractPages} disabled={busy} className="w-full">
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
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
