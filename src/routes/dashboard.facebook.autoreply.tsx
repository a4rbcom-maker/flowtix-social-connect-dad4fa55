import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Trash2, MessageSquare, MessageCircle, Sparkles, Power, Settings, Activity, X, Loader2 } from "lucide-react";
import {
  listPages, addPage, deletePage,
  listRules, upsertRule, toggleRule, deleteRule,
  listLog,
} from "@/lib/fb-autoreply.functions";

export const Route = createFileRoute("/dashboard/facebook/autoreply")({
  component: AutoReplyPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6">
        <p className="text-destructive">حدث خطأ: {error.message}</p>
        <Button onClick={() => { reset(); router.invalidate(); }}>إعادة المحاولة</Button>
      </div>
    );
  },
  notFoundComponent: () => <div>غير موجود</div>,
});

type RuleRow = Awaited<ReturnType<typeof listRules>>[number];
type PageRow = Awaited<ReturnType<typeof listPages>>[number];

function AutoReplyPage() {
  const { lang } = useI18n();
  const ar = lang === "ar";

  return (
    <DashboardLayout title={ar ? "الرد التلقائي" : "Auto-Reply"}>
      <div className="container mx-auto p-6 space-y-6" dir={ar ? "rtl" : "ltr"}>
        <div className={ar ? "text-right" : "text-left"}>
          <h1 className={`text-3xl font-bold flex items-center gap-3 ${ar ? "justify-end flex-row-reverse" : "justify-start"}`}>
            <Sparkles className="w-8 h-8 text-primary shrink-0" />
            <span>{ar ? "الرد التلقائي على تعليقات الفيسبوك" : "Facebook Auto-Reply"}</span>
          </h1>
          <p className="text-muted-foreground mt-1">
            {ar
              ? "اربط صفحاتك وأنشئ قواعد ذكية ترد على التعليقات بتعليق عام و/أو رسالة خاصة."
              : "Connect your pages and build smart rules to auto-reply with comment and/or DM."}
          </p>
        </div>

        <Tabs defaultValue="rules" className="space-y-4" dir={ar ? "rtl" : "ltr"}>
          <TabsList className={ar ? "flex-row-reverse" : ""}>
            <TabsTrigger value="rules"><Sparkles className="w-4 h-4 me-2"/>{ar ? "القواعد" : "Rules"}</TabsTrigger>
            <TabsTrigger value="pages"><Settings className="w-4 h-4 me-2"/>{ar ? "الصفحات المربوطة" : "Connected pages"}</TabsTrigger>
            <TabsTrigger value="log"><Activity className="w-4 h-4 me-2"/>{ar ? "السجل" : "Log"}</TabsTrigger>
          </TabsList>

          <TabsContent value="rules"><RulesTab ar={ar} /></TabsContent>
          <TabsContent value="pages"><PagesTab ar={ar} /></TabsContent>
          <TabsContent value="log"><LogTab ar={ar} /></TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}


/* ====================== PAGES TAB ====================== */
function PagesTab({ ar }: { ar: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listPages);
  const add = useServerFn(addPage);
  const del = useServerFn(deletePage);
  const { data: pages, isLoading } = useQuery({ queryKey: ["fb_pages"], queryFn: () => list() });
  const [open, setOpen] = useState(false);

  const delMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fb_pages"] }); toast.success(ar ? "تم الحذف" : "Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card dir={ar ? "rtl" : "ltr"}>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className={ar ? "text-right" : "text-left"}>
          <CardTitle>{ar ? "الصفحات المربوطة" : "Connected pages"}</CardTitle>
          <CardDescription>{ar ? "أضف صفحات فيسبوك ترغب في تشغيل الرد التلقائي عليها." : "Add Facebook pages for auto-reply."}</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 me-2"/>{ar ? "إضافة صفحة" : "Add page"}</Button></DialogTrigger>
          <AddPageDialog ar={ar} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["fb_pages"] }); }} addFn={add} />
        </Dialog>
      </CardHeader>
      <CardContent>

        {isLoading ? <Loader2 className="animate-spin"/> : !pages?.length ? (
          <p className="text-muted-foreground text-sm">{ar ? "لا توجد صفحات مربوطة بعد." : "No pages connected yet."}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{ar ? "اسم الصفحة" : "Name"}</TableHead>
                <TableHead>Page ID</TableHead>
                <TableHead>{ar ? "نوع الربط" : "Type"}</TableHead>
                <TableHead>{ar ? "الحالة" : "Status"}</TableHead>
                <TableHead/>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pages.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.page_name}</TableCell>
                  <TableCell className="font-mono text-xs">{p.page_id}</TableCell>
                  <TableCell><Badge variant={p.connection_type === "official" ? "default" : "secondary"}>{p.connection_type}</Badge></TableCell>
                  <TableCell><Badge variant={p.status === "active" ? "default" : "destructive"}>{p.status}</Badge></TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => delMut.mutate(p.id)}><Trash2 className="w-4 h-4 text-destructive"/></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AddPageDialog({ ar, onDone, addFn }: { ar: boolean; onDone: () => void; addFn: (args: { data: any }) => Promise<any> }) {
  const [form, setForm] = useState({
    page_id: "", page_name: "", access_token: "",
    connection_type: "official" as "official" | "bot",
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await addFn({ data: {
        page_id: form.page_id.trim(),
        page_name: form.page_name.trim(),
        avatar_url: null,
        connection_type: form.connection_type,
        access_token: form.connection_type === "official" ? form.access_token.trim() : null,
        bot_account_id: null,
      }});
      toast.success(ar ? "تمت الإضافة" : "Added");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{ar ? "ربط صفحة فيسبوك" : "Connect Facebook page"}</DialogTitle>
        <DialogDescription>
          {ar
            ? "للربط الرسمي تحتاج Page Access Token من Graph API Explorer مع صلاحيات pages_manage_engagement + pages_messaging."
            : "Official connect requires a Page Access Token with pages_manage_engagement + pages_messaging."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>{ar ? "نوع الربط" : "Connection type"}</Label>
          <Select value={form.connection_type} onValueChange={(v) => setForm({ ...form, connection_type: v as "official" | "bot" })}>
            <SelectTrigger><SelectValue/></SelectTrigger>
            <SelectContent>
              <SelectItem value="official">{ar ? "رسمي (Graph API)" : "Official (Graph API)"}</SelectItem>
              <SelectItem value="bot">{ar ? "عبر البوت" : "Via bot"}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Page ID</Label>
          <Input value={form.page_id} onChange={(e) => setForm({ ...form, page_id: e.target.value })} placeholder="123456789012345"/>
        </div>
        <div>
          <Label>{ar ? "اسم الصفحة" : "Page name"}</Label>
          <Input value={form.page_name} onChange={(e) => setForm({ ...form, page_name: e.target.value })}/>
        </div>
        {form.connection_type === "official" && (
          <div>
            <Label>Page Access Token</Label>
            <Textarea value={form.access_token} onChange={(e) => setForm({ ...form, access_token: e.target.value })} rows={3} className="font-mono text-xs"/>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={saving || !form.page_id || !form.page_name}>
          {saving && <Loader2 className="w-4 h-4 me-2 animate-spin"/>}
          {ar ? "حفظ" : "Save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* ====================== RULES TAB ====================== */
function RulesTab({ ar }: { ar: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listRules);
  const listP = useServerFn(listPages);
  const toggle = useServerFn(toggleRule);
  const del = useServerFn(deleteRule);
  const { data: rules } = useQuery({ queryKey: ["fb_rules"], queryFn: () => list() });
  const { data: pages } = useQuery({ queryKey: ["fb_pages"], queryFn: () => listP() });
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [open, setOpen] = useState(false);

  const tMut = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => toggle({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fb_rules"] }),
  });
  const dMut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fb_rules"] }); toast.success(ar ? "تم الحذف" : "Deleted"); },
  });

  const openNew = () => {
    if (!pages?.length) { toast.error(ar ? "أضف صفحة أولاً" : "Add a page first"); return; }
    setEditing(null); setOpen(true);
  };
  const openEdit = (r: RuleRow) => { setEditing(r); setOpen(true); };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>{ar ? "قواعد الرد التلقائي" : "Auto-reply rules"}</CardTitle>
          <CardDescription>{ar ? "كل قاعدة تطابق التعليقات وفقاً للنطاق والكلمات." : "Each rule matches comments by scope and keywords."}</CardDescription>
        </div>
        <Button onClick={openNew}><Plus className="w-4 h-4 me-2"/>{ar ? "قاعدة جديدة" : "New rule"}</Button>
      </CardHeader>
      <CardContent>
        {!rules?.length ? (
          <p className="text-muted-foreground text-sm">{ar ? "لا توجد قواعد بعد." : "No rules yet."}</p>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>{ar ? "الاسم" : "Name"}</TableHead>
              <TableHead>{ar ? "الصفحة" : "Page"}</TableHead>
              <TableHead>{ar ? "النطاق" : "Scope"}</TableHead>
              <TableHead>{ar ? "المحفّز" : "Trigger"}</TableHead>
              <TableHead>{ar ? "الردود" : "Replies"}</TableHead>
              <TableHead>{ar ? "تطابقات" : "Matches"}</TableHead>
              <TableHead/><TableHead/>
            </TableRow></TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-xs">{(r as any).page?.page_name ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{r.scope === "all_posts" ? (ar ? "كل البوستات" : "All posts") : (ar ? "بوست محدد" : "Specific")}</Badge></TableCell>
                  <TableCell className="text-xs">
                    {r.trigger_type === "any_comment" ? (ar ? "أي تعليق" : "Any") : (r.keywords?.slice(0, 3).join(", ") + (r.keywords?.length > 3 ? "…" : ""))}
                  </TableCell>
                  <TableCell className="flex gap-1">
                    {r.reply_comment_enabled && <Badge variant="secondary"><MessageSquare className="w-3 h-3"/></Badge>}
                    {r.reply_dm_enabled && <Badge variant="secondary"><MessageCircle className="w-3 h-3"/></Badge>}
                  </TableCell>
                  <TableCell>{r.match_count}</TableCell>
                  <TableCell>
                    <Switch checked={r.enabled} onCheckedChange={(v) => tMut.mutate({ id: r.id, enabled: v })}/>
                  </TableCell>
                  <TableCell className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Settings className="w-4 h-4"/></Button>
                    <Button variant="ghost" size="icon" onClick={() => dMut.mutate(r.id)}><Trash2 className="w-4 h-4 text-destructive"/></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <RuleDialog ar={ar} pages={pages ?? []} rule={editing} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["fb_rules"] }); }}/>
      </Dialog>
    </Card>
  );
}

function RuleDialog({ ar, pages, rule, onDone }: { ar: boolean; pages: PageRow[]; rule: RuleRow | null; onDone: () => void }) {
  const upsert = useServerFn(upsertRule);
  const [form, setForm] = useState(() => ({
    id: rule?.id,
    page_id: rule?.page_id ?? pages[0]?.id ?? "",
    name: rule?.name ?? "",
    enabled: rule?.enabled ?? true,
    scope: (rule?.scope ?? "all_posts") as "all_posts" | "specific_post",
    post_id: rule?.post_id ?? "",
    trigger_type: (rule?.trigger_type ?? "keywords") as "keywords" | "any_comment",
    keywords: rule?.keywords ?? [],
    match_mode: (rule?.match_mode ?? "any") as "any" | "all" | "exact",
    reply_comment_enabled: rule?.reply_comment_enabled ?? true,
    reply_comment_text: rule?.reply_comment_text ?? "",
    reply_dm_enabled: rule?.reply_dm_enabled ?? false,
    reply_dm_text: rule?.reply_dm_text ?? "",
    ignore_admin_comments: rule?.ignore_admin_comments ?? true,
    dedupe_per_user: rule?.dedupe_per_user ?? true,
    detect_spam: rule?.detect_spam ?? true,
    priority: rule?.priority ?? 0,
    cooldown_seconds: rule?.cooldown_seconds ?? 0,
  }));
  const [kwInput, setKwInput] = useState("");
  const [saving, setSaving] = useState(false);

  const addKw = () => {
    const v = kwInput.trim();
    if (!v) return;
    if (form.keywords.includes(v)) return;
    setForm({ ...form, keywords: [...form.keywords, v] });
    setKwInput("");
  };

  const submit = async () => {
    setSaving(true);
    try {
      await upsert({ data: { ...form, post_id: form.post_id || null, reply_comment_text: form.reply_comment_text || null, reply_dm_text: form.reply_dm_text || null } as any });
      toast.success(ar ? "تم الحفظ" : "Saved");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{rule ? (ar ? "تعديل القاعدة" : "Edit rule") : (ar ? "قاعدة جديدة" : "New rule")}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{ar ? "اسم القاعدة" : "Rule name"}</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/>
          </div>
          <div>
            <Label>{ar ? "الصفحة" : "Page"}</Label>
            <Select value={form.page_id} onValueChange={(v) => setForm({ ...form, page_id: v })}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{pages.map((p) => <SelectItem key={p.id} value={p.id}>{p.page_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{ar ? "النطاق" : "Scope"}</Label>
            <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v as any })}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="all_posts">{ar ? "كل بوستات الصفحة" : "All page posts"}</SelectItem>
                <SelectItem value="specific_post">{ar ? "بوست محدد" : "Specific post"}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.scope === "specific_post" && (
            <div>
              <Label>Post ID</Label>
              <Input value={form.post_id ?? ""} onChange={(e) => setForm({ ...form, post_id: e.target.value })} placeholder="pageid_postid"/>
            </div>
          )}
        </div>

        <div>
          <Label>{ar ? "نوع المحفّز" : "Trigger"}</Label>
          <Select value={form.trigger_type} onValueChange={(v) => setForm({ ...form, trigger_type: v as any })}>
            <SelectTrigger><SelectValue/></SelectTrigger>
            <SelectContent>
              <SelectItem value="keywords">{ar ? "كلمات مفتاحية" : "Keywords"}</SelectItem>
              <SelectItem value="any_comment">{ar ? "أي تعليق" : "Any comment"}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {form.trigger_type === "keywords" && (
          <>
            <div>
              <Label>{ar ? "الكلمات المفتاحية" : "Keywords"}</Label>
              <div className="flex gap-2">
                <Input value={kwInput} onChange={(e) => setKwInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKw(); } }} placeholder={ar ? "اكتب كلمة واضغط Enter" : "Type a word + Enter"}/>
                <Button type="button" variant="secondary" onClick={addKw}>{ar ? "أضف" : "Add"}</Button>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {form.keywords.map((k) => (
                  <Badge key={k} variant="secondary" className="gap-1">
                    {k}<button onClick={() => setForm({ ...form, keywords: form.keywords.filter((x) => x !== k) })}><X className="w-3 h-3"/></button>
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <Label>{ar ? "نمط المطابقة" : "Match mode"}</Label>
              <Select value={form.match_mode} onValueChange={(v) => setForm({ ...form, match_mode: v as any })}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{ar ? "أي كلمة (OR)" : "Any (OR)"}</SelectItem>
                  <SelectItem value="all">{ar ? "كل الكلمات (AND)" : "All (AND)"}</SelectItem>
                  <SelectItem value="exact">{ar ? "مطابقة كاملة" : "Exact"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        <div className="border rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2"><MessageSquare className="w-4 h-4"/>{ar ? "الرد بتعليق عام" : "Reply with public comment"}</Label>
            <Switch checked={form.reply_comment_enabled} onCheckedChange={(v) => setForm({ ...form, reply_comment_enabled: v })}/>
          </div>
          {form.reply_comment_enabled && (
            <Textarea value={form.reply_comment_text ?? ""} onChange={(e) => setForm({ ...form, reply_comment_text: e.target.value })} placeholder={ar ? "مرحباً {{name}}، سيتم التواصل معك..." : "Hi {{name}}, we'll reach out..."} rows={2}/>
          )}
        </div>

        <div className="border rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-2"><MessageCircle className="w-4 h-4"/>{ar ? "إرسال رسالة خاصة (DM)" : "Send private message (DM)"}</Label>
            <Switch checked={form.reply_dm_enabled} onCheckedChange={(v) => setForm({ ...form, reply_dm_enabled: v })}/>
          </div>
          {form.reply_dm_enabled && (
            <>
              <Textarea value={form.reply_dm_text ?? ""} onChange={(e) => setForm({ ...form, reply_dm_text: e.target.value })} placeholder={ar ? "السلام عليكم {{name}}..." : "Hello {{name}}..."} rows={3}/>
              <p className="text-xs text-muted-foreground">{ar ? "ملاحظة: فيسبوك يسمح بإرسال DM للمعلق خلال 7 أيام فقط من التعليق." : "Note: FB allows DM to commenter only within 7 days of the comment."}</p>
            </>
          )}
        </div>

        <details className="border rounded-lg p-3">
          <summary className="cursor-pointer font-medium">{ar ? "خيارات متقدمة" : "Advanced"}</summary>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="flex items-center justify-between col-span-2"><Label>{ar ? "تجاهل تعليقات الإدارة" : "Ignore admin comments"}</Label><Switch checked={form.ignore_admin_comments} onCheckedChange={(v) => setForm({ ...form, ignore_admin_comments: v })}/></div>
            <div className="flex items-center justify-between col-span-2"><Label>{ar ? "عدم تكرار الرد لنفس الشخص" : "Dedupe per user"}</Label><Switch checked={form.dedupe_per_user} onCheckedChange={(v) => setForm({ ...form, dedupe_per_user: v })}/></div>
            <div className="flex items-center justify-between col-span-2"><Label>{ar ? "كشف السبام" : "Detect spam"}</Label><Switch checked={form.detect_spam} onCheckedChange={(v) => setForm({ ...form, detect_spam: v })}/></div>
            <div><Label>{ar ? "الأولوية" : "Priority"}</Label><Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value) || 0 })}/></div>
            <div><Label>Cooldown (s)</Label><Input type="number" value={form.cooldown_seconds} onChange={(e) => setForm({ ...form, cooldown_seconds: parseInt(e.target.value) || 0 })}/></div>
          </div>
        </details>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={saving || !form.name || !form.page_id}>
          {saving && <Loader2 className="w-4 h-4 me-2 animate-spin"/>}
          {ar ? "حفظ" : "Save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/* ====================== LOG TAB ====================== */
function LogTab({ ar }: { ar: boolean }) {
  const list = useServerFn(listLog);
  const { data: rows, isLoading } = useQuery({ queryKey: ["fb_autoreply_log"], queryFn: () => list({ data: { limit: 100 } }) });
  return (
    <Card>
      <CardHeader><CardTitle>{ar ? "سجل التنفيذ" : "Execution log"}</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <Loader2 className="animate-spin"/> : !rows?.length ? (
          <p className="text-muted-foreground text-sm">{ar ? "لا يوجد سجلات." : "No log entries."}</p>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>{ar ? "الوقت" : "Time"}</TableHead>
              <TableHead>{ar ? "الصفحة" : "Page"}</TableHead>
              <TableHead>{ar ? "القاعدة" : "Rule"}</TableHead>
              <TableHead>{ar ? "المعلّق" : "Commenter"}</TableHead>
              <TableHead>{ar ? "التعليق" : "Comment"}</TableHead>
              <TableHead>{ar ? "الإجراء" : "Action"}</TableHead>
              <TableHead>{ar ? "الحالة" : "Status"}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{(r as any).page?.page_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{(r as any).rule?.name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.commenter_name ?? r.commenter_id ?? "—"}</TableCell>
                  <TableCell className="max-w-[280px] truncate text-xs">{r.comment_text}</TableCell>
                  <TableCell><Badge variant="outline">{r.action_taken}</Badge></TableCell>
                  <TableCell><Badge variant={r.status === "success" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>{r.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
