import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Key, Plus, RefreshCw, Trash2, Zap, Activity, AlertCircle,
  CheckCircle2, XCircle, PauseCircle, Pencil, Sparkles, FlaskConical, Wallet,
} from "lucide-react";
import {
  listAiAccounts, createAiAccount, updateAiAccount, deleteAiAccount,
  resetAiAccountCounters, testAiAccount,
  refreshAiAccountCredit, refreshAllAiAccountCredits,
  listModelTiers, upsertModelTier, deleteModelTier,
  listAiUsageLogs, getAiPoolStats,
} from "@/lib/admin-ai.functions";

export const Route = createFileRoute("/admin/ai")({ ssr: false, component: AiAdminPage });

function AiAdminPage() {
  const { lang } = useI18n();
  return (
    <AdminLayout title={lang === "ar" ? "وكلاء الذكاء الاصطناعي" : "AI Agents"}>
      <Tabs defaultValue="accounts" dir={lang === "ar" ? "rtl" : "ltr"}>
        <div className="mb-6 -mx-2 px-2 overflow-x-auto sm:overflow-visible">
          <TabsList
            className="inline-flex sm:grid sm:w-full sm:max-w-2xl sm:grid-cols-3 h-auto p-1.5 gap-1 rounded-2xl bg-gradient-to-br from-primary/5 via-background to-primary/5 border border-primary/15 shadow-[0_4px_20px_-8px_oklch(0.62_0.27_295_/_0.25)] backdrop-blur"
          >
            <TabsTrigger
              value="accounts"
              className="gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground hover:bg-primary/5 data-[state=active]:bg-gradient-to-br data-[state=active]:from-primary data-[state=active]:to-primary/85 data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_6px_16px_-6px_oklch(0.62_0.27_295_/_0.55)] data-[state=active]:font-semibold"
            >
              <Key className="h-4 w-4" />
              <span className="whitespace-nowrap">{lang === "ar" ? "حسابات kie.ai" : "kie.ai Accounts"}</span>
            </TabsTrigger>
            <TabsTrigger
              value="models"
              className="gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground hover:bg-primary/5 data-[state=active]:bg-gradient-to-br data-[state=active]:from-primary data-[state=active]:to-primary/85 data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_6px_16px_-6px_oklch(0.62_0.27_295_/_0.55)] data-[state=active]:font-semibold"
            >
              <Sparkles className="h-4 w-4" />
              <span className="whitespace-nowrap">{lang === "ar" ? "الموديلات" : "Models"}</span>
            </TabsTrigger>
            <TabsTrigger
              value="logs"
              className="gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:text-foreground hover:bg-primary/5 data-[state=active]:bg-gradient-to-br data-[state=active]:from-primary data-[state=active]:to-primary/85 data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_6px_16px_-6px_oklch(0.62_0.27_295_/_0.55)] data-[state=active]:font-semibold"
            >
              <Activity className="h-4 w-4" />
              <span className="whitespace-nowrap">{lang === "ar" ? "سجل الاستخدام" : "Usage Logs"}</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="accounts"><AccountsTab /></TabsContent>
        <TabsContent value="models"><ModelsTab /></TabsContent>
        <TabsContent value="logs"><LogsTab /></TabsContent>
      </Tabs>
    </AdminLayout>
  );
}

// ============================================================
// Accounts Tab
// ============================================================

function AccountsTab() {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const list = useServerFn(listAiAccounts);
  const create = useServerFn(createAiAccount);
  const update = useServerFn(updateAiAccount);
  const remove = useServerFn(deleteAiAccount);
  const reset = useServerFn(resetAiAccountCounters);
  const test = useServerFn(testAiAccount);
  const refreshCredit = useServerFn(refreshAiAccountCredit);
  const refreshAllCredits = useServerFn(refreshAllAiAccountCredits);
  const stats = useServerFn(getAiPoolStats);

  const { data: rows } = useQuery({ queryKey: ["ai-accounts"], queryFn: () => list() });
  const { data: poolStats } = useQuery({ queryKey: ["ai-pool-stats"], queryFn: () => stats() });

  const [openAdd, setOpenAdd] = useState(false);
  const [editing, setEditing] = useState<null | { id: string; label: string; priority: number }>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ai-accounts"] });
    qc.invalidateQueries({ queryKey: ["ai-pool-stats"] });
  };

  // Credit balances refresh only on manual user action (refresh buttons).
  // No auto-refresh on mount, no polling interval.

  const mCreate = useMutation({
    mutationFn: (data: { label: string; apiKey: string; priority: number }) => create({ data }),
    onSuccess: () => { toast.success(lang === "ar" ? "تم إضافة الحساب" : "Account added"); setOpenAdd(false); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const mUpdate = useMutation({
    mutationFn: (data: Parameters<typeof update>[0]["data"]) => update({ data }),
    onSuccess: () => { toast.success(lang === "ar" ? "تم التحديث" : "Updated"); setEditing(null); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const mDelete = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => { toast.success(lang === "ar" ? "تم الحذف" : "Deleted"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const mReset = useMutation({
    mutationFn: (id: string) => reset({ data: { id } }),
    onSuccess: () => { toast.success(lang === "ar" ? "تم إعادة التعيين" : "Reset"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const mTest = useMutation({
    mutationFn: (id: string) => test({ data: { id } }),
    onSuccess: (r) => {
      if (r.ok) toast.success(lang === "ar" ? "المفتاح يعمل ✓" : "Key works ✓");
      else toast.error(`${lang === "ar" ? "فشل" : "Failed"}: ${r.message}`);
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mRefreshCredit = useMutation({
    mutationFn: (id: string) => refreshCredit({ data: { id } }),
    onSuccess: () => { toast.success(lang === "ar" ? "تم تحديث الرصيد" : "Credit refreshed"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const mRefreshAll = useMutation({
    mutationFn: () => refreshAllCredits(),
    onSuccess: (r) => { toast.success(lang === "ar" ? `تم تحديث ${r.count} حساب` : `Refreshed ${r.count} accounts`); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label={lang === "ar" ? "إجمالي" : "Total"} value={poolStats?.counts.total ?? 0} icon={Key} tone="default" />
        <StatCard label={lang === "ar" ? "نشط" : "Active"} value={poolStats?.counts.active ?? 0} icon={CheckCircle2} tone="success" />
        <StatCard label={lang === "ar" ? "مستنفد" : "Exhausted"} value={poolStats?.counts.exhausted ?? 0} icon={PauseCircle} tone="warning" />
        <StatCard label={lang === "ar" ? "خطأ" : "Error"} value={poolStats?.counts.error ?? 0} icon={XCircle} tone="danger" />
        <StatCard label={lang === "ar" ? "طلبات 24س" : "24h Requests"} value={poolStats?.today.requests ?? 0} icon={Zap} tone="default" />
      </div>

      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{lang === "ar" ? "حسابات kie.ai" : "kie.ai Accounts"}</CardTitle>
            <CardDescription>
              {lang === "ar"
                ? "Pool مركزي للمفاتيح — التدوير يحدث تلقائياً عند فشل المفتاح أو نفاد رصيده"
                : "Central key pool — rotates automatically on failure or quota exhaustion"}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={() => mRefreshAll.mutate()} disabled={mRefreshAll.isPending}>
              <Wallet className="h-4 w-4" />
              {lang === "ar" ? "تحديث الأرصدة" : "Refresh credits"}
            </Button>
            <Dialog open={openAdd} onOpenChange={setOpenAdd}>
              <DialogTrigger asChild>
                <Button className="gap-2"><Plus className="h-4 w-4" />{lang === "ar" ? "إضافة حساب" : "Add account"}</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{lang === "ar" ? "إضافة حساب kie.ai جديد" : "Add new kie.ai account"}</DialogTitle></DialogHeader>
                <AddAccountForm onSubmit={(d) => mCreate.mutate(d)} loading={mCreate.isPending} />
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{lang === "ar" ? "الاسم" : "Label"}</TableHead>
                  <TableHead>{lang === "ar" ? "المفتاح" : "Key"}</TableHead>
                  <TableHead>{lang === "ar" ? "الحالة" : "Status"}</TableHead>
                  <TableHead className="text-center">{lang === "ar" ? "الرصيد المتبقي" : "Credit"}</TableHead>
                  <TableHead className="text-center">{lang === "ar" ? "الأولوية" : "Priority"}</TableHead>
                  <TableHead className="text-center">{lang === "ar" ? "طلبات" : "Requests"}</TableHead>
                  <TableHead className="text-center">{lang === "ar" ? "فشل" : "Failed"}</TableHead>
                  <TableHead>{lang === "ar" ? "آخر استخدام" : "Last used"}</TableHead>
                  <TableHead className="text-right">{lang === "ar" ? "إجراءات" : "Actions"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rows?.rows ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                    {lang === "ar" ? "لا توجد حسابات بعد — أضف أول مفتاح kie.ai" : "No accounts yet — add your first kie.ai key"}
                  </TableCell></TableRow>
                ) : rows!.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.key_hint}</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-center">
                      {r.credit_error ? (
                        <span className="text-xs text-red-500" title={r.credit_error}>—</span>
                      ) : r.credit_balance !== null && r.credit_balance !== undefined ? (
                        <div className="flex flex-col items-center">
                          <span className={`text-sm font-mono ${Number(r.credit_balance) <= 0 ? "text-red-500" : Number(r.credit_balance) < 5 ? "text-yellow-500" : "text-green-600"}`}>
                            {Number(r.credit_balance).toFixed(2)}
                          </span>
                          {r.credit_checked_at && (
                            <span className="text-[10px] text-muted-foreground" title={new Date(r.credit_checked_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}>
                              {new Date(r.credit_checked_at).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">{r.priority}</TableCell>
                    <TableCell className="text-center">{r.requests_count}</TableCell>
                    <TableCell className="text-center">
                      {r.failed_count > 0 ? <span className="text-red-500">{r.failed_count}</span> : r.failed_count}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.last_used_at ? new Date(r.last_used_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US") : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => mTest.mutate(r.id)} disabled={mTest.isPending}
                          title={lang === "ar" ? "اختبار" : "Test"}>
                          <FlaskConical className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => mRefreshCredit.mutate(r.id)} disabled={mRefreshCredit.isPending}
                          title={lang === "ar" ? "تحديث الرصيد" : "Refresh credit"}>
                          <Wallet className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditing({ id: r.id, label: r.label, priority: r.priority })}
                          title={lang === "ar" ? "تعديل" : "Edit"}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => mReset.mutate(r.id)} disabled={mReset.isPending}
                          title={lang === "ar" ? "إعادة تفعيل" : "Reset"}>
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost"
                          onClick={() => mUpdate.mutate({ id: r.id, status: r.status === "disabled" ? "active" : "disabled" })}
                          title={lang === "ar" ? "تفعيل/تعطيل" : "Toggle"}>
                          {r.status === "disabled" ? <CheckCircle2 className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="icon" variant="ghost" className="text-red-500 hover:text-red-600">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{lang === "ar" ? "حذف الحساب؟" : "Delete account?"}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {lang === "ar" ? `سيتم حذف "${r.label}" نهائياً.` : `"${r.label}" will be permanently deleted.`}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{lang === "ar" ? "إلغاء" : "Cancel"}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => mDelete.mutate(r.id)} className="bg-red-500 hover:bg-red-600">
                                {lang === "ar" ? "حذف" : "Delete"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{lang === "ar" ? "تعديل الحساب" : "Edit account"}</DialogTitle></DialogHeader>
          {editing && (
            <EditAccountForm
              initial={editing}
              loading={mUpdate.isPending}
              onSubmit={(d) => mUpdate.mutate({ id: editing.id, ...d })}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddAccountForm({ onSubmit, loading }: { onSubmit: (d: { label: string; apiKey: string; priority: number }) => void; loading: boolean }) {
  const { lang } = useI18n();
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(100);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ label, apiKey, priority }); }} className="space-y-4">
      <div>
        <Label>{lang === "ar" ? "اسم مرجعي" : "Label"}</Label>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="kie-account-1" required maxLength={80} />
      </div>
      <div>
        <Label>{lang === "ar" ? "مفتاح API" : "API key"}</Label>
        <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." required type="password" minLength={8} />
        <p className="text-xs text-muted-foreground mt-1">
          {lang === "ar" ? "احصل عليه من dashboard.kie.ai — يُشفّر فور الحفظ" : "Get it from dashboard.kie.ai — encrypted on save"}
        </p>
      </div>
      <div>
        <Label>{lang === "ar" ? "الأولوية (الأقل أولاً)" : "Priority (lowest first)"}</Label>
        <Input type="number" min={1} max={9999} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={loading || !label || !apiKey}>
          {loading ? (lang === "ar" ? "جارٍ..." : "Saving...") : (lang === "ar" ? "حفظ" : "Save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditAccountForm({ initial, onSubmit, loading }: {
  initial: { label: string; priority: number };
  onSubmit: (d: { label?: string; priority?: number; apiKey?: string }) => void;
  loading: boolean;
}) {
  const { lang } = useI18n();
  const [label, setLabel] = useState(initial.label);
  const [priority, setPriority] = useState(initial.priority);
  const [apiKey, setApiKey] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ label, priority, apiKey: apiKey || undefined }); }} className="space-y-4">
      <div>
        <Label>{lang === "ar" ? "الاسم" : "Label"}</Label>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={80} />
      </div>
      <div>
        <Label>{lang === "ar" ? "الأولوية" : "Priority"}</Label>
        <Input type="number" min={1} max={9999} value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
      </div>
      <div>
        <Label>{lang === "ar" ? "مفتاح API جديد (اختياري)" : "New API key (optional)"}</Label>
        <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={lang === "ar" ? "اتركه فارغاً للإبقاء على الحالي" : "Leave empty to keep current"} type="password" />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={loading}>{loading ? "..." : (lang === "ar" ? "حفظ" : "Save")}</Button>
      </DialogFooter>
    </form>
  );
}

// ============================================================
// Models Tab
// ============================================================

interface ModelTierRow {
  id: string;
  tier: "simple" | "smart" | "negotiation";
  model_name: string;
  display_name_ar: string;
  display_name_en: string;
  description: string | null;
  enabled: boolean;
  max_tokens: number;
  temperature: number;
  sort_order: number;
}

function ModelsTab() {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const list = useServerFn(listModelTiers);
  const upsert = useServerFn(upsertModelTier);
  const remove = useServerFn(deleteModelTier);
  const { data } = useQuery({ queryKey: ["ai-tiers"], queryFn: () => list() });

  const [editing, setEditing] = useState<Partial<ModelTierRow> | null>(null);

  const mUpsert = useMutation({
    mutationFn: (d: Parameters<typeof upsert>[0]["data"]) => upsert({ data: d }),
    onSuccess: () => { toast.success(lang === "ar" ? "تم الحفظ" : "Saved"); setEditing(null); qc.invalidateQueries({ queryKey: ["ai-tiers"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const mDelete = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => { toast.success(lang === "ar" ? "تم الحذف" : "Deleted"); qc.invalidateQueries({ queryKey: ["ai-tiers"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const tiers: Array<{ key: "simple" | "smart" | "negotiation"; ar: string; en: string; desc_ar: string; desc_en: string; color: string }> = [
    { key: "simple", ar: "بسيط", en: "Simple", desc_ar: "ردود سريعة قصيرة (ترحيب، أسئلة شائعة)", desc_en: "Quick short replies (greetings, FAQ)", color: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
    { key: "smart", ar: "ذكي", en: "Smart", desc_ar: "محادثات متوسطة وفهم سياق", desc_en: "Mid-complexity conversations", color: "bg-violet-500/10 text-violet-600 border-violet-500/20" },
    { key: "negotiation", ar: "تفاوض", en: "Negotiation", desc_ar: "تفاوض ذكي على الأسعار والإغلاق", desc_en: "Smart price negotiation & closing", color: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  ];

  return (
    <div className="space-y-6">
      {tiers.map((t) => {
        const rows = ((data?.rows ?? []) as ModelTierRow[]).filter((r) => r.tier === t.key);
        return (
          <Card key={t.key}>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className={t.color}>{lang === "ar" ? t.ar : t.en}</Badge>
                  <CardTitle className="text-lg">{lang === "ar" ? `موديلات طبقة ${t.ar}` : `${t.en} tier models`}</CardTitle>
                </div>
                <CardDescription>{lang === "ar" ? t.desc_ar : t.desc_en}</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => setEditing({ tier: t.key, enabled: true, max_tokens: 1024, temperature: 0.7, sort_order: rows.length + 1 })}>
                <Plus className="h-4 w-4 mr-1" />{lang === "ar" ? "إضافة" : "Add"}
              </Button>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {lang === "ar" ? "لا توجد موديلات في هذه الطبقة بعد" : "No models in this tier yet"}
                </p>
              ) : (
                <div className="space-y-2">
                  {rows.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-4 p-3 rounded-lg border border-border/60 bg-card/40">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-xs font-mono px-2 py-0.5 rounded bg-muted">{r.model_name}</code>
                          <span className="font-medium text-sm">{lang === "ar" ? r.display_name_ar : r.display_name_en}</span>
                          {!r.enabled && <Badge variant="secondary" className="text-xs">{lang === "ar" ? "معطل" : "Disabled"}</Badge>}
                        </div>
                        {r.description && <p className="text-xs text-muted-foreground mt-1">{r.description}</p>}
                        <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                          <span>max_tokens: {r.max_tokens}</span>
                          <span>temp: {r.temperature}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Switch checked={r.enabled} onCheckedChange={(v) => mUpsert.mutate({ ...r, enabled: v, description: r.description ?? undefined })} />
                        <Button size="icon" variant="ghost" onClick={() => setEditing({ ...r, description: r.description ?? undefined })}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="text-red-500" onClick={() => mDelete.mutate(r.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? (lang === "ar" ? "تعديل موديل" : "Edit model") : (lang === "ar" ? "إضافة موديل" : "Add model")}</DialogTitle></DialogHeader>
          {editing && <ModelForm initial={editing} onSubmit={(d) => mUpsert.mutate(d)} loading={mUpsert.isPending} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModelForm({ initial, onSubmit, loading }: { initial: Partial<ModelTierRow>; onSubmit: (d: Parameters<ReturnType<typeof useServerFn<typeof upsertModelTier>>>[0]["data"]) => void; loading: boolean }) {
  const { lang } = useI18n();
  const [form, setForm] = useState({
    id: initial.id,
    tier: initial.tier || "simple",
    model_name: initial.model_name || "",
    display_name_ar: initial.display_name_ar || "",
    display_name_en: initial.display_name_en || "",
    description: initial.description || "",
    enabled: initial.enabled ?? true,
    max_tokens: initial.max_tokens || 1024,
    temperature: initial.temperature ?? 0.7,
    sort_order: initial.sort_order || 0,
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{lang === "ar" ? "الطبقة" : "Tier"}</Label>
          <Select value={form.tier} onValueChange={(v) => setForm({ ...form, tier: v as never })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="simple">{lang === "ar" ? "بسيط" : "Simple"}</SelectItem>
              <SelectItem value="smart">{lang === "ar" ? "ذكي" : "Smart"}</SelectItem>
              <SelectItem value="negotiation">{lang === "ar" ? "تفاوض" : "Negotiation"}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{lang === "ar" ? "اسم الموديل (kie.ai)" : "Model name (kie.ai)"}</Label>
          <Input value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} placeholder="gpt-4o-mini" required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{lang === "ar" ? "اسم العرض (عربي)" : "Display name (Arabic)"}</Label>
          <Input value={form.display_name_ar} onChange={(e) => setForm({ ...form, display_name_ar: e.target.value })} required />
        </div>
        <div>
          <Label>{lang === "ar" ? "اسم العرض (إنجليزي)" : "Display name (English)"}</Label>
          <Input value={form.display_name_en} onChange={(e) => setForm({ ...form, display_name_en: e.target.value })} required />
        </div>
      </div>
      <div>
        <Label>{lang === "ar" ? "وصف مختصر" : "Description"}</Label>
        <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label>Max tokens</Label>
          <Input type="number" min={64} max={8192} value={form.max_tokens} onChange={(e) => setForm({ ...form, max_tokens: Number(e.target.value) })} />
        </div>
        <div>
          <Label>Temperature</Label>
          <Input type="number" min={0} max={2} step={0.1} value={form.temperature} onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })} />
        </div>
        <div>
          <Label>{lang === "ar" ? "الترتيب" : "Sort"}</Label>
          <Input type="number" min={0} max={999} value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
        <Label>{lang === "ar" ? "مفعّل" : "Enabled"}</Label>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={loading}>{loading ? "..." : (lang === "ar" ? "حفظ" : "Save")}</Button>
      </DialogFooter>
    </form>
  );
}

// ============================================================
// Logs Tab
// ============================================================

function LogsTab() {
  const { lang } = useI18n();
  const list = useServerFn(listAiUsageLogs);
  const stats = useServerFn(getAiPoolStats);
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState("");
  const { data } = useQuery({
    queryKey: ["ai-logs", tier, status],
    queryFn: () => list({ data: { limit: 200, tier, status } }),
  });
  const { data: poolStats } = useQuery({ queryKey: ["ai-pool-stats"], queryFn: () => stats() });

  const series = poolStats?.series ?? [];
  const maxV = Math.max(1, ...series.map((d) => d.success + d.failed));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{lang === "ar" ? "آخر 7 أيام" : "Last 7 days"}</CardTitle>
          <CardDescription>{lang === "ar" ? "طلبات يومية مقسّمة بين ناجح وفاشل" : "Daily requests split success vs failed"}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-2 h-40">
            {series.map((d) => {
              const total = d.success + d.failed;
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-xs font-mono">{total || ""}</div>
                  <div className="w-full bg-muted rounded-md overflow-hidden flex flex-col justify-end" style={{ height: 120 }}>
                    {d.failed > 0 && <div className="bg-red-500" style={{ height: `${(d.failed / maxV) * 120}px` }} />}
                    {d.success > 0 && <div className="bg-emerald-500" style={{ height: `${(d.success / maxV) * 120}px` }} />}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{d.day.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle>{lang === "ar" ? "سجل الاستخدام" : "Usage logs"}</CardTitle>
            <div className="flex gap-2">
              <Select value={tier || "all"} onValueChange={(v) => setTier(v === "all" ? "" : v)}>
                <SelectTrigger className="w-32"><SelectValue placeholder={lang === "ar" ? "كل الطبقات" : "All tiers"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{lang === "ar" ? "كل الطبقات" : "All tiers"}</SelectItem>
                  <SelectItem value="simple">{lang === "ar" ? "بسيط" : "Simple"}</SelectItem>
                  <SelectItem value="smart">{lang === "ar" ? "ذكي" : "Smart"}</SelectItem>
                  <SelectItem value="negotiation">{lang === "ar" ? "تفاوض" : "Negotiation"}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
                <SelectTrigger className="w-32"><SelectValue placeholder={lang === "ar" ? "كل الحالات" : "All status"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{lang === "ar" ? "كل الحالات" : "All status"}</SelectItem>
                  <SelectItem value="success">{lang === "ar" ? "ناجح" : "Success"}</SelectItem>
                  <SelectItem value="error">{lang === "ar" ? "خطأ" : "Error"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-border/60 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{lang === "ar" ? "الوقت" : "Time"}</TableHead>
                  <TableHead>{lang === "ar" ? "الطبقة" : "Tier"}</TableHead>
                  <TableHead>{lang === "ar" ? "الموديل" : "Model"}</TableHead>
                  <TableHead className="text-center">Tokens</TableHead>
                  <TableHead className="text-center">{lang === "ar" ? "زمن (ms)" : "Latency"}</TableHead>
                  <TableHead>{lang === "ar" ? "الحالة" : "Status"}</TableHead>
                  <TableHead>{lang === "ar" ? "الخطأ" : "Error"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.rows ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    {lang === "ar" ? "لا توجد سجلات" : "No logs"}
                  </TableCell></TableRow>
                ) : data!.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</TableCell>
                    <TableCell>{r.tier && <Badge variant="outline" className="text-xs">{r.tier}</Badge>}</TableCell>
                    <TableCell className="font-mono text-xs">{r.model}</TableCell>
                    <TableCell className="text-center text-xs">{(r.tokens_in || 0) + (r.tokens_out || 0)}</TableCell>
                    <TableCell className="text-center text-xs">{r.latency_ms ?? "—"}</TableCell>
                    <TableCell>
                      {r.status === "success"
                        ? <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">{lang === "ar" ? "ناجح" : "OK"}</Badge>
                        : <Badge className="bg-red-500/10 text-red-600 border-red-500/20">{lang === "ar" ? "خطأ" : "Error"}</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{r.error_message || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function StatusBadge({ status }: { status: string }) {
  const { lang } = useI18n();
  const map: Record<string, { ar: string; en: string; cls: string; Icon: typeof CheckCircle2 }> = {
    active: { ar: "نشط", en: "Active", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", Icon: CheckCircle2 },
    exhausted: { ar: "مستنفد", en: "Exhausted", cls: "bg-amber-500/10 text-amber-600 border-amber-500/20", Icon: PauseCircle },
    disabled: { ar: "معطل", en: "Disabled", cls: "bg-slate-500/10 text-slate-600 border-slate-500/20", Icon: PauseCircle },
    error: { ar: "خطأ", en: "Error", cls: "bg-red-500/10 text-red-600 border-red-500/20", Icon: AlertCircle },
  };
  const m = map[status] || map.disabled;
  return (
    <Badge variant="outline" className={`${m.cls} gap-1`}>
      <m.Icon className="h-3 w-3" />
      {lang === "ar" ? m.ar : m.en}
    </Badge>
  );
}

function StatCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof Key; tone: "default" | "success" | "warning" | "danger" }) {
  const toneCls = {
    default: "bg-card/70 border-border/60",
    success: "bg-emerald-500/5 border-emerald-500/20",
    warning: "bg-amber-500/5 border-amber-500/20",
    danger: "bg-red-500/5 border-red-500/20",
  }[tone];
  const iconCls = {
    default: "text-primary",
    success: "text-emerald-500",
    warning: "text-amber-500",
    danger: "text-red-500",
  }[tone];
  return (
    <div className={`rounded-xl border p-4 ${toneCls} backdrop-blur-xl`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <Icon className={`h-8 w-8 ${iconCls} opacity-70`} />
      </div>
    </div>
  );
}
