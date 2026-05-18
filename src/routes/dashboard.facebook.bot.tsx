import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, ShieldCheck, Cookie, KeyRound, AlertTriangle, Loader2, CheckCircle2, XCircle, Clock, Activity } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useFacebookApi } from "@/features/facebook/api";
import { addBotAccount, listBotAccounts, deleteBotAccount, testBotAccount } from "@/lib/fb-bot.functions";

export const Route = createFileRoute("/dashboard/facebook/bot")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.getSession();
  },
  component: BotAccountsPage,
});

type Account = {
  id: string;
  display_name: string;
  auth_method: "cookies" | "credentials";
  status: BotAccountStatus;
  last_check_at: string | null;
  last_error: string | null;
  created_at: string;
};

type BotAccountStatus = "untested" | "active" | "invalid" | "checkpoint" | "disabled";

const normalizeStatus = (status: string | null | undefined): BotAccountStatus => {
  return status === "active" || status === "invalid" || status === "checkpoint" || status === "disabled"
    ? status
    : "untested";
};

function BotAccountsPage() {
  const { user, signOut } = useAuth();
  const { lang } = useI18n();
  const { call } = useFacebookApi();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"cookies" | "credentials">("cookies");
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    displayName: "",
    cookies: "",
    email: "",
    password: "",
    twoFactorSecret: "",
  });

  const t = lang === "ar" ? {
    title: "حسابات بوت فيسبوك",
    subtitle: "اربط حسابات فيسبوك للنشر التلقائي والاستخراج عبر VPS Worker",
    add: "ربط حساب جديد",
    directTitle: "إضافة حساب بالـ Cookies مباشرة",
    directSubtitle: "الصق JSON من إضافة Cookie Editor هنا واحفظ الحساب بدون فتح نوافذ أو تبويبات إضافية.",
    cookiesLabel: "Cookies JSON",
    saveCookies: "حفظ حساب Cookies",
    cookiesRequired: "الصق Cookies JSON أولاً",
    none: "لا توجد حسابات بعد",
    name: "الاسم",
    method: "الطريقة",
    status: "الحالة",
    lastCheck: "آخر فحص",
    actions: "إجراءات",
    deleteConfirm: "هل تريد حذف هذا الحساب؟",
    deleted: "تم الحذف",
    addTitle: "ربط حساب فيسبوك جديد",
    displayName: "اسم تعريفي",
    displayNamePh: "مثال: حساب التسويق الرئيسي",
    methodCookies: "Cookies (موصى به)",
    methodCreds: "Email/Password",
    cookiesHelp: "ثبّت إضافة 'Cookie Editor' من متجر Chrome، افتح facebook.com وأنت مسجّل دخول، اضغط 'Export → JSON' والصق الناتج هنا.",
    cookiesPh: '[{"name":"c_user","value":"...",...}]',
    credsWarn: "⚠️ تخزين كلمة المرور خطير ويعرّض حسابك للحظر. استخدم Cookies كلما أمكن.",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    twoFa: "مفتاح 2FA (اختياري)",
    save: "حفظ",
    cancel: "إلغاء",
    saved: "تم ربط الحساب بنجاح",
    savedDesc: "تمت إضافة الحساب للقائمة. الحالة الحالية: \"لم يُختبر\" — اضغط تحديث لاحقًا للتحقق من صلاحية الكوكيز.",
    saveFailed: "فشل ربط الحساب",
    statuses: { untested: "لم يُختبر", active: "نشط ✓", invalid: "فشل — كوكيز غير صالحة", checkpoint: "تحقق مطلوب", disabled: "معطّل" } satisfies Record<BotAccountStatus, string>,
    backToFb: "→ الذهاب لمهام البوت",
    sessionTitle: "أنت مسجَّل دخول بالحساب التالي",
    sessionHint: "الحسابات المرتبطة تظهر فقط إذا كانت تخص نفس الـ user_id بالأسفل. لو ربطت من جلسة مختلفة، سجّل خروج وادخل بنفس الإيميل.",
    signOutBtn: "تسجيل خروج وإعادة دخول",
    copyId: "نسخ المُعرّف",
    copied: "تم النسخ",
    testNow: "اختبر الآن",
    testing: "جاري الاختبار…",
    testSuccess: "الكوكيز صالحة ✓",
    testFailed: "الاختبار فشل",
  } : {
    title: "Facebook Bot Accounts",
    subtitle: "Link Facebook accounts for VPS Worker automation",
    add: "Add new account",
    directTitle: "Add a Cookies account directly",
    directSubtitle: "Paste the Cookie Editor JSON here and save without opening extra dialogs or tabs.",
    cookiesLabel: "Cookies JSON",
    saveCookies: "Save Cookies account",
    cookiesRequired: "Paste the Cookies JSON first",
    none: "No accounts yet",
    name: "Name",
    method: "Method",
    status: "Status",
    lastCheck: "Last check",
    actions: "Actions",
    deleteConfirm: "Delete this account?",
    deleted: "Deleted",
    addTitle: "Link a new Facebook account",
    displayName: "Display name",
    displayNamePh: "e.g. Main marketing account",
    methodCookies: "Cookies (recommended)",
    methodCreds: "Email/Password",
    cookiesHelp: "Install 'Cookie Editor' Chrome extension, open facebook.com while logged in, click Export → JSON, and paste here.",
    cookiesPh: '[{"name":"c_user","value":"...",...}]',
    credsWarn: "⚠️ Storing passwords is risky and may get your account banned. Prefer Cookies.",
    email: "Email",
    password: "Password",
    twoFa: "2FA secret (optional)",
    save: "Save",
    cancel: "Cancel",
    saved: "Account linked successfully",
    savedDesc: "The account was added. Current status: \"Untested\" — refresh later to verify the cookies are valid.",
    saveFailed: "Failed to link account",
    statuses: { untested: "Untested", active: "Active ✓", invalid: "Failed — invalid cookies", checkpoint: "Verify needed", disabled: "Disabled" } satisfies Record<BotAccountStatus, string>,
    backToFb: "→ Go to bot jobs",
    sessionTitle: "You are signed in as",
    sessionHint: "Linked accounts only appear if they belong to the same user_id below. If you linked from a different session, sign out and sign back in with the same email.",
    signOutBtn: "Sign out & re-login",
    copyId: "Copy ID",
    copied: "Copied",
    testNow: "Test now",
    testing: "Testing…",
    testSuccess: "Cookies are valid ✓",
    testFailed: "Test failed",
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await call(listBotAccounts);
      setAccounts(data as Account[]);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);

  const handleAdd = async () => {
    if (!form.displayName.trim()) { toast.error(t.displayName); return; }
    setSubmitting(true);
    try {
      const row = tab === "cookies"
        ? await call(addBotAccount, { method: "cookies", displayName: form.displayName, cookies: form.cookies })
        : await call(addBotAccount, {
            method: "credentials",
            displayName: form.displayName,
            email: form.email,
            password: form.password,
            twoFactorSecret: form.twoFactorSecret || null,
          });
      if (row) {
        setAccounts((prev) => [row as Account, ...prev.filter((a) => a.id !== (row as Account).id)]);
        setJustAddedId((row as Account).id);
        setTimeout(() => setJustAddedId(null), 4000);
      }
      toast.success(t.saved, { description: t.savedDesc });
      setOpen(false);
      setForm({ displayName: "", cookies: "", email: "", password: "", twoFactorSecret: "" });
      void load();
    } catch (e) {
      toast.error(t.saveFailed, { description: String(e instanceof Error ? e.message : e) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveCookies = async () => {
    if (!form.displayName.trim()) { toast.error(t.displayName); return; }
    if (!form.cookies.trim()) { toast.error(t.cookiesRequired); return; }
    setSubmitting(true);
    try {
      const row = await call(addBotAccount, { method: "cookies", displayName: form.displayName, cookies: form.cookies });
      if (row) {
        setAccounts((prev) => [row as Account, ...prev.filter((a) => a.id !== (row as Account).id)]);
        setJustAddedId((row as Account).id);
        setTimeout(() => setJustAddedId(null), 4000);
      }
      toast.success(t.saved, { description: t.savedDesc });
      setForm({ displayName: "", cookies: "", email: "", password: "", twoFactorSecret: "" });
      void load();
    } catch (e) {
      toast.error(t.saveFailed, { description: String(e instanceof Error ? e.message : e) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t.deleteConfirm)) return;
    try {
      await call(deleteBotAccount, { id });
      toast.success(t.deleted);
      await load();
    } catch (e) { toast.error(String(e)); }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const updated = await call(testBotAccount, { id });
      if (updated) {
        setAccounts((prev) => prev.map((a) => (a.id === id ? (updated as Account) : a)));
        const u = updated as Account;
        if (u.status === "active") {
          toast.success(t.testSuccess);
        } else {
          toast.error(t.testFailed, { description: u.last_error ?? t.statuses[normalizeStatus(u.status)] });
        }
      }
    } catch (e) {
      toast.error(t.testFailed, { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setTestingId(null);
    }
  };

  const statusBadge = (rawStatus: Account["status"] | string | null | undefined) => {
    const s = normalizeStatus(rawStatus);
    const map: Record<BotAccountStatus, { color: string; icon: typeof CheckCircle2 }> = {
      untested: { color: "bg-muted text-muted-foreground", icon: Clock },
      active: { color: "bg-green-500/15 text-green-700 dark:text-green-400", icon: CheckCircle2 },
      invalid: { color: "bg-red-500/15 text-red-700 dark:text-red-400", icon: XCircle },
      checkpoint: { color: "bg-amber-500/15 text-amber-700 dark:text-amber-400", icon: AlertTriangle },
      disabled: { color: "bg-muted text-muted-foreground", icon: XCircle },
    };
    const { color, icon: Icon } = map[s];
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${color}`}>
        <Icon className="h-3 w-3" />
        {t.statuses[s]}
      </span>
    );
  };

  return (
    <DashboardLayout title={t.title}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">{t.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/dashboard/facebook/jobs">
              <Button variant="outline">{t.backToFb}</Button>
            </Link>
            <Button onClick={() => setOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" /> {t.add}
            </Button>
          </div>
        </div>

        {user && (
          <Card className="border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{t.sessionTitle}</p>
                  <p className="mt-0.5 truncate text-sm text-foreground">{user.email}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground break-all">user_id: {user.id}</p>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{t.sessionHint}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { navigator.clipboard.writeText(user.id); toast.success(t.copied); }}
                >
                  {t.copyId}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => signOut()}>
                  {t.signOutBtn}
                </Button>
              </div>
            </div>
          </Card>
        )}

        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-5 shadow-sm">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Cookie className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground">{t.directTitle}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t.directSubtitle}</p>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(220px,320px)_1fr]">
            <div className="space-y-2">
              <Label>{t.displayName}</Label>
              <Input
                placeholder={t.displayNamePh}
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t.cookiesLabel}</Label>
              <Textarea
                rows={7}
                placeholder={t.cookiesPh}
                className="font-mono text-xs"
                value={form.cookies}
                onChange={(e) => setForm({ ...form, cookies: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <Button onClick={handleSaveCookies} disabled={submitting} className="gap-2">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {t.saveCookies}
            </Button>
          </div>
        </Card>

        <Card className="overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : accounts.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <ShieldCheck className="mx-auto mb-3 h-10 w-10 opacity-40" />
              {t.none}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-start">{t.name}</th>
                    <th className="px-4 py-3 text-start">{t.method}</th>
                    <th className="px-4 py-3 text-start">{t.status}</th>
                    <th className="px-4 py-3 text-start">{t.lastCheck}</th>
                    <th className="px-4 py-3 text-end">{t.actions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {accounts.map((a) => (
                    <tr key={a.id} className={`transition-colors hover:bg-muted/30 ${justAddedId === a.id ? "bg-primary/10 animate-pulse" : ""}`}>
                      <td className="px-4 py-3 font-medium">{a.display_name}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="gap-1">
                          {a.auth_method === "cookies" ? <Cookie className="h-3 w-3" /> : <KeyRound className="h-3 w-3" />}
                          {a.auth_method}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">{statusBadge(a.status)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {a.last_check_at ? new Date(a.last_check_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US") : "—"}
                      </td>
                      <td className="px-4 py-3 text-end">
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(a.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.addTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t.displayName}</Label>
              <Input
                placeholder={t.displayNamePh}
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </div>
            <Tabs value={tab} onValueChange={(v) => setTab(v as "cookies" | "credentials")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="cookies"><Cookie className="me-2 h-4 w-4" />{t.methodCookies}</TabsTrigger>
                <TabsTrigger value="credentials"><KeyRound className="me-2 h-4 w-4" />{t.methodCreds}</TabsTrigger>
              </TabsList>
              <TabsContent value="cookies" className="space-y-3 pt-3">
                <p className="text-xs text-muted-foreground">{t.cookiesHelp}</p>
                <Textarea
                  rows={6}
                  placeholder={t.cookiesPh}
                  className="font-mono text-xs"
                  value={form.cookies}
                  onChange={(e) => setForm({ ...form, cookies: e.target.value })}
                />
              </TabsContent>
              <TabsContent value="credentials" className="space-y-3 pt-3">
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                  {t.credsWarn}
                </div>
                <div className="space-y-2">
                  <Label>{t.email}</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t.password}</Label>
                  <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t.twoFa}</Label>
                  <Input value={form.twoFactorSecret} onChange={(e) => setForm({ ...form, twoFactorSecret: e.target.value })} />
                </div>
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t.cancel}</Button>
            <Button onClick={handleAdd} disabled={submitting}>
              {submitting && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
