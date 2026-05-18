import { createFileRoute, Link, useRouter, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  Cookie,
  KeyRound,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  RotateCw,
  ExternalLink,
  LogIn,
  CalendarClock,
  Lock,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useFacebookApi, describeFbError, FbCallError } from "@/features/facebook/api";
import {
  addBotAccount,
  listBotAccounts,
  deleteBotAccount,
  testBotAccount,
  precheckBotAccount,
} from "@/lib/fb-bot.functions";

// Per-route fallback: surfaces a friendly Arabic card instead of letting any
// runtime error bubble to the root and crash the SSR boundary (502 on origin).
function BotErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  console.error("[/dashboard/facebook/bot]", error);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4" dir="rtl">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-foreground">تعذّر تحميل صفحة البوت</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          حصل خطأ مؤقت أثناء تحميل حسابات البوت. جرّب إعادة المحاولة، أو ارجع للوحة التحكم.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            إعادة المحاولة
          </button>
          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            لوحة التحكم
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/dashboard/facebook/bot")({
  // Dashboard pages are user-scoped, not SEO-relevant; rendering them on the
  // server is what triggered the origin 502 on www.flowtixtools.com. Render
  // entirely on the client so any per-user code path runs after hydration.
  ssr: false,
  component: BotAccountsPage,
  errorComponent: BotErrorComponent,
});

type Account = {
  id: string;
  display_name: string;
  auth_method: "cookies" | "credentials";
  status: BotAccountStatus;
  last_check_at: string | null;
  last_error: string | null;
  created_at: string;
  cookie_expires_at: string | null;
};

type BotAccountStatus = "untested" | "active" | "invalid" | "checkpoint" | "disabled";

const BOT_ACCOUNT_SELECT =
  "id, display_name, auth_method, status, last_check_at, last_error, created_at, cookie_expires_at";
const LEGACY_ERROR = /صفحة \/me|login page|\/me أعادت/i;

// One row in the per-account test timeline. `key` matches a step in TEST_STEPS
// so labels can be localized; `state` drives the icon (spinner/check/x).
type TestEvent = {
  key: "init" | "decrypt" | "fetch" | "groups" | "done" | "retry" | "error";
  state: "running" | "ok" | "fail" | "info";
  at: number; // ms epoch
  detail?: string;
};

const MAX_AUTO_RETRIES = 3;
const RETRY_BACKOFF_MS = [1500, 3000, 6000]; // attempt 1/2/3

// Classify cookie session lifetime for badges/alerts. Returns null when the
// account has no expiry info (credentials accounts or session-only cookies).
function classifyExpiry(
  iso: string | null,
): { state: "expired" | "soon" | "ok"; days: number } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.floor(ms / 86_400_000);
  if (ms <= 0) return { state: "expired", days };
  if (days <= 7) return { state: "soon", days };
  return { state: "ok", days };
}

const normalizeStatus = (status: string | null | undefined): BotAccountStatus => {
  return status === "active" ||
    status === "invalid" ||
    status === "checkpoint" ||
    status === "disabled"
    ? status
    : "untested";
};

const unwrapServerPayload = (raw: unknown): unknown => {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as { data?: unknown; result?: unknown; account?: unknown };
  return obj.data ?? obj.result ?? obj.account ?? raw;
};

const normalizeAccountsPayload = (raw: unknown): Account[] => {
  const payload = unwrapServerPayload(raw);
  return Array.isArray(payload) ? (payload as Account[]) : [];
};

const normalizeAccountPayload = (raw: unknown): Account | null => {
  const payload = unwrapServerPayload(raw);
  return payload && typeof payload === "object" && typeof (payload as Account).id === "string"
    ? (payload as Account)
    : null;
};

const sanitizeAccounts = (list: Account[]): Account[] =>
  list.map((a) =>
    a.last_error && LEGACY_ERROR.test(a.last_error)
      ? { ...a, status: "untested" as BotAccountStatus, last_error: null, last_check_at: null }
      : a,
  );

function StatusReason({
  status,
  lastError,
  t,
}: {
  status: BotAccountStatus;
  lastError: string | null;
  t: {
    untestedHint: string;
    checkpointHint: string;
    invalidHint: string;
    disabledHint: string;
    reasonLabel: string;
  };
}) {
  if (status === "active") return null;
  const hint =
    status === "untested"
      ? t.untestedHint
      : status === "checkpoint"
        ? t.checkpointHint
        : status === "invalid"
          ? t.invalidHint
          : status === "disabled"
            ? t.disabledHint
            : null;
  const cls =
    status === "invalid"
      ? "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300"
      : status === "checkpoint"
        ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300"
        : "border-border bg-muted/40 text-muted-foreground";
  return (
    <div className={`max-w-xs rounded-md border px-2 py-1.5 text-[11px] leading-relaxed ${cls}`}>
      {hint && <p>{hint}</p>}
      {lastError && (
        <p className="mt-1 break-words font-mono text-[10px] opacity-90">
          <span className="font-semibold">{t.reasonLabel}:</span> {lastError}
        </p>
      )}
    </div>
  );
}

function BotAccountsPage() {
  const { user, signOut } = useAuth();
  const { lang } = useI18n();
  const { call } = useFacebookApi();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"cookies" | "credentials">("cookies");
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testProgress, setTestProgress] = useState<{ value: number; label: string } | null>(null);
  const [testLogs, setTestLogs] = useState<Record<string, TestEvent[]>>({});
  const [autoRetry, setAutoRetry] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("fbBotAutoRetry") !== "0";
  });
  const [retryCounts, setRetryCounts] = useState<Record<string, number>>({});
  const [groupsResult, setGroupsResult] = useState<{
    accountName: string;
    groups: { id: string; name: string }[];
  } | null>(null);
  const [reloginFor, setReloginFor] = useState<{ id: string; name: string } | null>(null);
  const [checkpointFor, setCheckpointFor] = useState<{
    id: string;
    name: string;
    reason: string | null;
  } | null>(null);
  const [precheck, setPrecheck] = useState<{
    id: string;
    name: string;
    loading: boolean;
    result: {
      ok: boolean;
      method: "cookies" | "credentials";
      present: string[];
      missing: string[];
      invalid: { name: string; reason: string }[];
      totalCookies: number;
      message: string;
    } | null;
    error: string | null;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    displayName: "",
    cookies: "",
    email: "",
    password: "",
    twoFactorSecret: "",
  });

  const t =
    lang === "ar"
      ? {
          title: "حسابات بوت فيسبوك",
          subtitle: "اربط حسابات فيسبوك للنشر التلقائي والاستخراج عبر VPS Worker",
          add: "ربط حساب جديد",
          directTitle: "إضافة حساب بالـ Cookies مباشرة",
          directSubtitle:
            "الصق JSON من إضافة Cookie Editor هنا واحفظ الحساب بدون فتح نوافذ أو تبويبات إضافية.",
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
          cookiesHelp:
            "ثبّت إضافة 'Cookie Editor' من متجر Chrome، افتح facebook.com وأنت مسجّل دخول، اضغط 'Export → JSON' والصق الناتج هنا.",
          cookiesPh: '[{"name":"c_user","value":"...",...}]',
          credsWarn: "⚠️ تخزين كلمة المرور خطير ويعرّض حسابك للحظر. استخدم Cookies كلما أمكن.",
          email: "البريد الإلكتروني",
          password: "كلمة المرور",
          twoFa: "مفتاح 2FA (اختياري)",
          save: "حفظ",
          cancel: "إلغاء",
          saved: "تم ربط الحساب بنجاح",
          savedDesc:
            'تمت إضافة الحساب للقائمة. الحالة الحالية: "لم يُختبر" — اضغط تحديث لاحقًا للتحقق من صلاحية الكوكيز.',
          saveFailed: "فشل ربط الحساب",
          statuses: {
            untested: "لم يُختبر",
            active: "نشط ✓",
            invalid: "فشل — كوكيز غير صالحة",
            checkpoint: "تحقق مطلوب",
            disabled: "معطّل",
          } satisfies Record<BotAccountStatus, string>,
          backToFb: "→ الذهاب لمهام البوت",
          sessionTitle: "أنت مسجَّل دخول بالحساب التالي",
          sessionHint:
            "الحسابات المرتبطة تظهر فقط إذا كانت تخص نفس الـ user_id بالأسفل. لو ربطت من جلسة مختلفة، سجّل خروج وادخل بنفس الإيميل.",
          signOutBtn: "تسجيل خروج وإعادة دخول",
          copyId: "نسخ المُعرّف",
          copied: "تم النسخ",
          testNow: "اختبر الآن",
          testing: "جاري الاختبار…",
          testSuccess: "الكوكيز صالحة ✓",
          testFailed: "الاختبار فشل",
          groupsFound: (n: number) => `تم العثور على ${n} جروب`,
          groupsTitle: "الجروبات المتاحة",
          groupsEmpty: "لم نتمكن من قراءة قائمة الجروبات تلقائيًا (قد تحتاج VPS Worker).",
          close: "إغلاق",
          reasonLabel: "السبب",
          untestedHint: 'اضغط "اختبر الآن" للتحقق من صلاحية الكوكيز.',
          checkpointHint:
            "فيسبوك يطلب تحقق إضافي. سجّل دخول يدويًا وأكمل التحقق ثم أعد تصدير الكوكيز.",
          invalidHint: "الكوكيز غير صالحة أو منتهية. أعد تصديرها من المتصفح وحدّث الحساب.",
          disabledHint: "هذا الحساب معطّل ولن يُستخدم في المهام.",
          neverTested: "لم يُجرَ اختبار بعد",
          retry: "إعادة المحاولة",
          attemptLabel: (n: number) => `محاولة #${n}`,
          progressInit: "بدء الاختبار…",
          progressDecrypt: "قراءة الكوكيز…",
          progressFetch: "الاتصال بفيسبوك…",
          progressGroups: "جلب الجروبات…",
          progressDone: "اكتمل ✓",
        }
      : {
          title: "Facebook Bot Accounts",
          subtitle: "Link Facebook accounts for VPS Worker automation",
          add: "Add new account",
          directTitle: "Add a Cookies account directly",
          directSubtitle:
            "Paste the Cookie Editor JSON here and save without opening extra dialogs or tabs.",
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
          cookiesHelp:
            "Install 'Cookie Editor' Chrome extension, open facebook.com while logged in, click Export → JSON, and paste here.",
          cookiesPh: '[{"name":"c_user","value":"...",...}]',
          credsWarn:
            "⚠️ Storing passwords is risky and may get your account banned. Prefer Cookies.",
          email: "Email",
          password: "Password",
          twoFa: "2FA secret (optional)",
          save: "Save",
          cancel: "Cancel",
          saved: "Account linked successfully",
          savedDesc:
            'The account was added. Current status: "Untested" — refresh later to verify the cookies are valid.',
          saveFailed: "Failed to link account",
          statuses: {
            untested: "Untested",
            active: "Active ✓",
            invalid: "Failed — invalid cookies",
            checkpoint: "Verify needed",
            disabled: "Disabled",
          } satisfies Record<BotAccountStatus, string>,
          backToFb: "→ Go to bot jobs",
          sessionTitle: "You are signed in as",
          sessionHint:
            "Linked accounts only appear if they belong to the same user_id below. If you linked from a different session, sign out and sign back in with the same email.",
          signOutBtn: "Sign out & re-login",
          copyId: "Copy ID",
          copied: "Copied",
          testNow: "Test now",
          testing: "Testing…",
          testSuccess: "Cookies are valid ✓",
          testFailed: "Test failed",
          groupsFound: (n: number) => `Found ${n} groups`,
          groupsTitle: "Available groups",
          groupsEmpty: "Could not auto-read the groups list (may require VPS Worker).",
          close: "Close",
          reasonLabel: "Reason",
          untestedHint: 'Click "Test now" to verify the cookies are valid.',
          checkpointHint:
            "Facebook is asking for an extra verification. Log in manually, complete it, then re-export cookies.",
          invalidHint:
            "Cookies are invalid or expired. Re-export them from the browser and update the account.",
          disabledHint: "This account is disabled and won't be used in jobs.",
          neverTested: "Not tested yet",
          retry: "Retry",
          attemptLabel: (n: number) => `Attempt #${n}`,
          progressInit: "Starting test…",
          progressDecrypt: "Reading cookies…",
          progressFetch: "Contacting Facebook…",
          progressGroups: "Fetching groups…",
          progressDone: "Done ✓",
        };

  const handleAuthExpired = () => {
    toast.error(lang === "ar" ? "انتهت جلسة الدخول" : "Your session has expired", {
      description:
        lang === "ar" ? "سجّل الدخول مرة أخرى للمتابعة." : "Please sign in again to continue.",
    });
    // Local session is already cleared inside useFacebookApi on auth failure;
    // signOut() flips AuthProvider state and we navigate to login.
    void signOut().finally(() => navigate({ to: "/login" }));
  };

  const isAuthErr = (e: unknown) => e instanceof FbCallError && e.kind === "auth";

  const load = async () => {
    setLoading(true);
    try {
      const raw = await call(listBotAccounts);
      // Defensive: tolerate direct arrays and wrapped server-function payloads.
      const list = normalizeAccountsPayload(raw);
      if (list.length > 0) {
        setAccounts(sanitizeAccounts(list));
        return;
      }

      // Fallback read with the browser session. This keeps the UI honest when
      // a server-function response is unexpectedly wrapped/empty while RLS still
      // allows the signed-in user to read their own rows.
      const { data, error } = await supabase
        .from("fb_bot_accounts")
        .select(BOT_ACCOUNT_SELECT)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setAccounts(sanitizeAccounts((data ?? []) as Account[]));
    } catch (e) {
      if (isAuthErr(e)) {
        handleAuthExpired();
        return;
      }
      console.error("[fb-bot] listBotAccounts failed:", e);
      toast.error(describeFbError(e, lang === "ar" ? "ar" : "en"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      void load();
    } else {
      setLoading(false);
    }
  }, [user]);

  const handleAdd = async () => {
    if (!form.displayName.trim()) {
      toast.error(t.displayName);
      return;
    }
    setSubmitting(true);
    try {
      const row =
        tab === "cookies"
          ? await call(addBotAccount, {
              method: "cookies",
              displayName: form.displayName,
              cookies: form.cookies,
            })
          : await call(addBotAccount, {
              method: "credentials",
              displayName: form.displayName,
              email: form.email,
              password: form.password,
              twoFactorSecret: form.twoFactorSecret || null,
            });
      const account = normalizeAccountPayload(row);
      if (account) {
        setAccounts((prev) => [account, ...prev.filter((a) => a.id !== account.id)]);
        setJustAddedId(account.id);
        setTimeout(() => setJustAddedId(null), 4000);
      } else {
        throw new Error(
          lang === "ar"
            ? "تم الحفظ لكن لم يرجع الحساب من الخادم. حدّث الصفحة وتأكد من الجلسة."
            : "Saved, but the server did not return the account row. Refresh and check your session.",
        );
      }
      toast.success(t.saved, { description: t.savedDesc });
      setOpen(false);
      setForm({ displayName: "", cookies: "", email: "", password: "", twoFactorSecret: "" });
      // NOTE: do NOT call load() here. The optimistic insert above already
      // shows the row; a refetch would flip `loading` to true (hiding the
      // table) and, if the read returns an empty/stale list for any reason
      // (race, transient RLS, timeout), it would WIPE the just-added row
      // and the user sees "saved" toast with an empty list right after.
    } catch (e) {
      if (isAuthErr(e)) {
        handleAuthExpired();
        return;
      }
      toast.error(t.saveFailed, { description: describeFbError(e, lang === "ar" ? "ar" : "en") });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveCookies = async () => {
    if (!form.displayName.trim()) {
      toast.error(t.displayName);
      return;
    }
    if (!form.cookies.trim()) {
      toast.error(t.cookiesRequired);
      return;
    }
    setSubmitting(true);
    try {
      const row = await call(addBotAccount, {
        method: "cookies",
        displayName: form.displayName,
        cookies: form.cookies,
      });
      const account = normalizeAccountPayload(row);
      if (account) {
        setAccounts((prev) => [account, ...prev.filter((a) => a.id !== account.id)]);
        setJustAddedId(account.id);
        setTimeout(() => setJustAddedId(null), 4000);
      } else {
        throw new Error(
          lang === "ar"
            ? "تم الحفظ لكن لم يرجع الحساب من الخادم. حدّث الصفحة وتأكد من الجلسة."
            : "Saved, but the server did not return the account row. Refresh and check your session.",
        );
      }
      toast.success(t.saved, { description: t.savedDesc });
      setForm({ displayName: "", cookies: "", email: "", password: "", twoFactorSecret: "" });
      // Optimistic insert above is the source of truth; skip the refetch so
      // a stale/timed-out list response can't blank the row.
    } catch (e) {
      if (isAuthErr(e)) {
        handleAuthExpired();
        return;
      }
      toast.error(t.saveFailed, { description: describeFbError(e, lang === "ar" ? "ar" : "en") });
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
    } catch (e) {
      if (isAuthErr(e)) {
        handleAuthExpired();
        return;
      }
      toast.error(describeFbError(e, lang === "ar" ? "ar" : "en"));
    }
  };

  const openPrecheck = async (id: string, name: string) => {
    setPrecheck({ id, name, loading: true, result: null, error: null });
    try {
      const result = await call(precheckBotAccount, { id });
      setPrecheck({ id, name, loading: false, result: result as any, error: null });
    } catch (e) {
      setPrecheck({
        id,
        name,
        loading: false,
        result: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  // Append an event to the per-account timeline (capped at last 30 events).
  const pushEvent = (id: string, ev: Omit<TestEvent, "at">) => {
    setTestLogs((prev) => {
      const next = [...(prev[id] ?? []), { ...ev, at: Date.now() }];
      return { ...prev, [id]: next.slice(-30) };
    });
  };

  const updateLastEvent = (id: string, patch: Partial<TestEvent>) => {
    setTestLogs((prev) => {
      const list = prev[id] ?? [];
      if (list.length === 0) return prev;
      const copy = [...list];
      copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch };
      return { ...prev, [id]: copy };
    });
  };

  const handleTest = async (id: string, isRetry = false) => {
    setTestingId(id);
    const attempt = (retryCounts[id] ?? 0) + (isRetry ? 1 : 0);
    if (isRetry) setRetryCounts((p) => ({ ...p, [id]: attempt }));
    if (!isRetry) setTestLogs((p) => ({ ...p, [id]: [] }));

    if (isRetry) {
      pushEvent(id, { key: "retry", state: "info", detail: t.attemptLabel(attempt + 1) });
    }
    pushEvent(id, { key: "init", state: "running" });
    setTestProgress({ value: 10, label: t.progressInit });
    const toastId = toast.loading(t.testing, { description: t.progressInit });

    // Animated progress + event timeline while the request is in-flight.
    const steps: Array<{ value: number; label: string; delay: number; key: TestEvent["key"] }> = [
      { value: 30, label: t.progressDecrypt, delay: 250, key: "decrypt" },
      { value: 60, label: t.progressFetch, delay: 700, key: "fetch" },
      { value: 85, label: t.progressGroups, delay: 1600, key: "groups" },
    ];
    const timers = steps.map((s) =>
      setTimeout(() => {
        // Mark previous step ok, start the next one.
        updateLastEvent(id, { state: "ok" });
        pushEvent(id, { key: s.key, state: "running" });
        setTestProgress({ value: s.value, label: s.label });
        toast.loading(t.testing, { id: toastId, description: s.label });
      }, s.delay),
    );

    const scheduleAutoRetry = (reason: string) => {
      if (!autoRetry) return false;
      if (attempt + 1 >= MAX_AUTO_RETRIES) return false;
      const wait = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)];
      pushEvent(id, {
        key: "retry",
        state: "info",
        detail:
          lang === "ar"
            ? `إعادة محاولة تلقائية خلال ${Math.round(wait / 1000)} ث — ${reason}`
            : `Auto-retry in ${Math.round(wait / 1000)}s — ${reason}`,
      });
      setTimeout(() => void handleTest(id, true), wait);
      return true;
    };

    try {
      const updated = (await call(testBotAccount, { id })) as
        | (Account & { groups?: { id: string; name: string }[] })
        | null;
      timers.forEach(clearTimeout);
      updateLastEvent(id, { state: "ok" });
      setTestProgress({ value: 100, label: t.progressDone });
      if (updated) {
        const { groups = [], ...accountRow } = updated;
        const detectedCheckpoint = looksLikeCheckpoint(accountRow.status, accountRow.last_error);
        const finalAccount = (
          detectedCheckpoint && accountRow.status !== "active"
            ? { ...accountRow, status: "checkpoint" }
            : accountRow
        ) as Account;
        setAccounts((prev) => prev.map((a) => (a.id === id ? finalAccount : a)));
        if (finalAccount.status === "active") {
          setRetryCounts((p) => ({ ...p, [id]: 0 }));
          pushEvent(id, { key: "done", state: "ok", detail: t.groupsFound(groups.length) });
          toast.success(t.testSuccess, { id: toastId, description: t.groupsFound(groups.length) });
          setGroupsResult({ accountName: finalAccount.display_name, groups });
        } else if (detectedCheckpoint) {
          pushEvent(id, {
            key: "error",
            state: "fail",
            detail: finalAccount.last_error ?? "checkpoint",
          });
          toast.warning(
            lang === "ar"
              ? "حساب يحتاج تحقق (Checkpoint)"
              : "Account needs verification (Checkpoint)",
            {
              id: toastId,
              description:
                lang === "ar"
                  ? 'اضغط "إكمال التحقق" لمتابعة الخطوات'
                  : 'Click "Complete verification" to continue',
              action: {
                label: lang === "ar" ? "إكمال التحقق" : "Verify",
                onClick: () =>
                  setCheckpointFor({
                    id,
                    name: finalAccount.display_name,
                    reason: finalAccount.last_error,
                  }),
              },
            },
          );
          // Don't auto-retry checkpoints — user action is required.
        } else {
          const reason =
            finalAccount.last_error ?? t.statuses[normalizeStatus(finalAccount.status)];
          pushEvent(id, { key: "error", state: "fail", detail: reason });
          const willRetry = scheduleAutoRetry(reason);
          toast.error(t.testFailed, {
            id: toastId,
            description: willRetry
              ? lang === "ar"
                ? `${reason} — جاري إعادة المحاولة…`
                : `${reason} — retrying…`
              : reason,
            action: willRetry
              ? undefined
              : { label: t.retry, onClick: () => void handleTest(id, true) },
          });
        }
      }
    } catch (e) {
      timers.forEach(clearTimeout);
      if (isAuthErr(e)) {
        toast.dismiss(toastId);
        handleAuthExpired();
        return;
      }
      const reason = describeFbError(e, lang === "ar" ? "ar" : "en");
      pushEvent(id, { key: "error", state: "fail", detail: reason });
      const willRetry = scheduleAutoRetry(reason);
      toast.error(t.testFailed, {
        id: toastId,
        description: willRetry
          ? lang === "ar"
            ? `${reason} — جاري إعادة المحاولة…`
            : `${reason} — retrying…`
          : reason,
        action: willRetry
          ? undefined
          : { label: t.retry, onClick: () => void handleTest(id, true) },
      });
    } finally {
      setTestingId(null);
      setTimeout(() => setTestProgress(null), 600);
    }
  };

  // Detect Facebook checkpoint / two-step / identity-confirmation hints inside
  // arbitrary error strings (Arabic + English keywords + FB URL fragments).
  const CHECKPOINT_KEYWORDS =
    /checkpoint|two_step|two-step|identity|confirm.{0,15}identity|account.{0,15}restricted|temporarily.{0,15}locked|تأكيد.{0,15}الهوية|التحقق|تم.{0,15}قفل|تأكيد.{0,15}هويتك/i;
  const looksLikeCheckpoint = (
    status: string | null | undefined,
    lastError: string | null | undefined,
  ): boolean => {
    if (status === "checkpoint") return true;
    if (lastError && CHECKPOINT_KEYWORDS.test(lastError)) return true;
    return false;
  };

  const statusBadge = (rawStatus: Account["status"] | string | null | undefined) => {
    const s = normalizeStatus(rawStatus);
    const map: Record<BotAccountStatus, { color: string; icon: typeof CheckCircle2 }> = {
      untested: { color: "bg-muted text-muted-foreground", icon: Clock },
      active: { color: "bg-green-500/15 text-green-700 dark:text-green-400", icon: CheckCircle2 },
      invalid: { color: "bg-red-500/15 text-red-700 dark:text-red-400", icon: XCircle },
      checkpoint: {
        color: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        icon: AlertTriangle,
      },
      disabled: { color: "bg-muted text-muted-foreground", icon: XCircle },
    };
    const { color, icon: Icon } = map[s];
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${color}`}
      >
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
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground break-all">
                    user_id: {user.id}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                    {t.sessionHint}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(user.id);
                    toast.success(t.copied);
                  }}
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

        <Card className="border-amber-500/40 bg-amber-50/70 dark:bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div className="text-sm leading-relaxed">
              <p className="font-semibold text-amber-900 dark:text-amber-200">
                {lang === "ar"
                  ? "تنبيه: الاختبار من السيرفر يتحقق من بنية الكوكيز فقط"
                  : "Notice: Server-side test validates cookie structure only"}
              </p>
              <p className="mt-1 text-amber-900/80 dark:text-amber-100/80">
                {lang === "ar"
                  ? "فيسبوك يرفض طلبات السيرفر القادمة من Cloudflare/Datacenters حتى لو الكوكيز سليمة، ويُرجع صفحة تسجيل دخول. لذلك زر «اختبر الآن» يتحقق حاليًا فقط من اكتمال الكوكيز (c_user, xs, datr, fr) وصحة صيغتها. التحقق الفعلي ضد فيسبوك سيتم تلقائيًا عبر VPS Worker (المرحلة 4) بمتصفح حقيقي على IP منزلي."
                  : "Facebook blocks server requests from Cloudflare/datacenter IPs and returns a login page even with valid cookies. The 'Test now' button currently only validates that cookies are well-formed (c_user, xs, datr, fr). Real Facebook verification will run via the VPS Worker (Phase 4) using a real browser on a residential IP."}
              </p>
            </div>
          </div>
        </Card>

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
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              {t.saveCookies}
            </Button>
          </div>
        </Card>

        {(() => {
          const expiring = accounts
            .map((a) => ({ a, e: classifyExpiry(a.cookie_expires_at) }))
            .filter((x) => x.e && x.e.state !== "ok") as {
            a: Account;
            e: { state: "expired" | "soon"; days: number };
          }[];
          if (expiring.length === 0) return null;
          const expiredCount = expiring.filter((x) => x.e.state === "expired").length;
          const soonCount = expiring.length - expiredCount;
          const tone =
            expiredCount > 0
              ? "border-red-500/40 bg-red-50/70 dark:bg-red-500/5 text-red-900 dark:text-red-200"
              : "border-amber-500/40 bg-amber-50/70 dark:bg-amber-500/5 text-amber-900 dark:text-amber-200";
          return (
            <Card className={`${tone} p-4`}>
              <div className="flex items-start gap-3">
                <CalendarClock className="h-5 w-5 shrink-0 mt-0.5" />
                <div className="text-sm leading-relaxed flex-1">
                  <p className="font-semibold">
                    {lang === "ar"
                      ? expiredCount > 0
                        ? `${expiredCount} حساب انتهت صلاحية جلسته${soonCount > 0 ? ` و${soonCount} على وشك الانتهاء` : ""}`
                        : `${soonCount} حساب جلسته على وشك الانتهاء`
                      : expiredCount > 0
                        ? `${expiredCount} account${expiredCount > 1 ? "s" : ""} expired${soonCount > 0 ? `, ${soonCount} expiring soon` : ""}`
                        : `${soonCount} account${soonCount > 1 ? "s" : ""} expiring soon`}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs opacity-90">
                    {expiring.map(({ a, e }) => (
                      <li key={a.id} className="flex items-center justify-between gap-3">
                        <span className="font-medium">{a.display_name}</span>
                        <span className="font-mono">
                          {e.state === "expired"
                            ? lang === "ar"
                              ? `منتهية منذ ${Math.abs(e.days)} يوم`
                              : `expired ${Math.abs(e.days)}d ago`
                            : lang === "ar"
                              ? `تبقّى ${e.days} يوم`
                              : `${e.days}d left`}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs opacity-80">
                    {lang === "ar"
                      ? "أعد تصدير الكوكيز من إضافة Cookie-Editor واضغط «إعادة تسجيل الدخول» للحساب المتأثر."
                      : "Re-export cookies from Cookie-Editor and click 'Re-login' on the affected account."}
                  </p>
                </div>
              </div>
            </Card>
          );
        })()}

        <div className="flex items-center justify-end gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
          <RotateCw className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">
            {lang === "ar"
              ? `إعادة محاولة تلقائية بعد الفشل (حتى ${MAX_AUTO_RETRIES} محاولات)`
              : `Auto-retry on failure (up to ${MAX_AUTO_RETRIES} attempts)`}
          </span>
          <Switch
            checked={autoRetry}
            onCheckedChange={(v: boolean) => {
              setAutoRetry(v);
              try {
                localStorage.setItem("fbBotAutoRetry", v ? "1" : "0");
              } catch {}
            }}
          />
        </div>

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
                    <tr
                      key={a.id}
                      className={`transition-colors hover:bg-muted/30 ${justAddedId === a.id ? "bg-primary/10 animate-pulse" : ""}`}
                    >
                      <td className="px-4 py-3 font-medium">{a.display_name}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="gap-1">
                          {a.auth_method === "cookies" ? (
                            <Cookie className="h-3 w-3" />
                          ) : (
                            <KeyRound className="h-3 w-3" />
                          )}
                          {a.auth_method}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="space-y-1.5">
                          {statusBadge(a.status)}
                          <StatusReason
                            status={normalizeStatus(a.status)}
                            lastError={a.last_error}
                            t={t}
                          />
                          {(() => {
                            const e = classifyExpiry(a.cookie_expires_at);
                            if (!e) {
                              return a.auth_method === "cookies" ? (
                                <p className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                                  <Lock className="h-3 w-3" />
                                  {lang === "ar"
                                    ? "مشفّر · بدون تاريخ انتهاء معروف"
                                    : "Encrypted · no known expiry"}
                                </p>
                              ) : null;
                            }
                            const cls =
                              e.state === "expired"
                                ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                                : e.state === "soon"
                                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                  : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300";
                            const text =
                              e.state === "expired"
                                ? lang === "ar"
                                  ? `انتهت الجلسة منذ ${Math.abs(e.days)} يوم`
                                  : `Session expired ${Math.abs(e.days)}d ago`
                                : e.state === "soon"
                                  ? lang === "ar"
                                    ? `تنتهي خلال ${e.days} يوم`
                                    : `Expires in ${e.days}d`
                                  : lang === "ar"
                                    ? `صالحة ${e.days} يوم`
                                    : `Valid ${e.days}d`;
                            return (
                              <span
                                className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
                              >
                                <CalendarClock className="h-3 w-3" />
                                {text}
                              </span>
                            );
                          })()}
                          {testingId === a.id && testProgress && (
                            <div className="max-w-xs space-y-1 pt-1">
                              <Progress value={testProgress.value} className="h-1.5" />
                              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                {testProgress.label}
                              </p>
                            </div>
                          )}
                          {Boolean(retryCounts[a.id]) && (
                            <p className="text-[10px] text-muted-foreground">
                              {t.attemptLabel((retryCounts[a.id] ?? 0) + 1)}
                              {" · "}
                              {lang === "ar"
                                ? `الحد الأقصى ${MAX_AUTO_RETRIES}`
                                : `max ${MAX_AUTO_RETRIES}`}
                            </p>
                          )}
                          {(testLogs[a.id]?.length ?? 0) > 0 && (
                            <details
                              className="max-w-xs rounded-md border border-border bg-muted/30 px-2 py-1.5 text-[11px]"
                              open={testingId === a.id}
                            >
                              <summary className="cursor-pointer select-none font-medium text-foreground">
                                {lang === "ar" ? "سجل الأحداث" : "Event log"}
                                <span className="ms-1 text-muted-foreground">
                                  ({testLogs[a.id]!.length})
                                </span>
                              </summary>
                              <ul className="mt-1.5 space-y-1">
                                {testLogs[a.id]!.map((ev, i) => {
                                  const label =
                                    ev.key === "init"
                                      ? t.progressInit
                                      : ev.key === "decrypt"
                                        ? t.progressDecrypt
                                        : ev.key === "fetch"
                                          ? t.progressFetch
                                          : ev.key === "groups"
                                            ? t.progressGroups
                                            : ev.key === "done"
                                              ? t.progressDone
                                              : ev.key === "retry"
                                                ? lang === "ar"
                                                  ? "إعادة محاولة"
                                                  : "Retry"
                                                : lang === "ar"
                                                  ? "خطأ"
                                                  : "Error";
                                  const Icon =
                                    ev.state === "ok"
                                      ? CheckCircle2
                                      : ev.state === "fail"
                                        ? XCircle
                                        : ev.state === "running"
                                          ? Loader2
                                          : Clock;
                                  const cls =
                                    ev.state === "ok"
                                      ? "text-emerald-600"
                                      : ev.state === "fail"
                                        ? "text-red-600"
                                        : ev.state === "running"
                                          ? "text-primary"
                                          : "text-muted-foreground";
                                  return (
                                    <li key={i} className="flex items-start gap-1.5 leading-tight">
                                      <Icon
                                        className={`mt-0.5 h-3 w-3 shrink-0 ${cls} ${ev.state === "running" ? "animate-spin" : ""}`}
                                      />
                                      <span className="flex-1">
                                        <span className="font-medium text-foreground">{label}</span>
                                        {ev.detail && (
                                          <span className="ms-1 text-muted-foreground">
                                            — {ev.detail}
                                          </span>
                                        )}
                                      </span>
                                      <span className="font-mono text-[10px] text-muted-foreground/70">
                                        {new Date(ev.at).toLocaleTimeString(
                                          lang === "ar" ? "ar-EG" : "en-US",
                                          { hour12: false },
                                        )}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </details>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-muted-foreground">
                        {a.last_check_at ? (
                          new Date(a.last_check_at).toLocaleString(
                            lang === "ar" ? "ar-EG" : "en-US",
                          )
                        ) : (
                          <span className="italic">{t.neverTested}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-end">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={testingId === a.id}
                            onClick={() => openPrecheck(a.id, a.display_name)}
                          >
                            {testingId === a.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Activity className="h-3.5 w-3.5" />
                            )}
                            {testingId === a.id ? t.testing : t.testNow}
                          </Button>
                          {(a.status === "invalid" || a.status === "checkpoint") &&
                            testingId !== a.id && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="gap-1.5"
                                onClick={() => handleTest(a.id, true)}
                              >
                                <RotateCw className="h-3.5 w-3.5" />
                                {t.retry}
                              </Button>
                            )}
                          {looksLikeCheckpoint(a.status, a.last_error) &&
                            a.auth_method === "cookies" &&
                            testingId !== a.id && (
                              <Button
                                size="sm"
                                variant="default"
                                className="gap-1.5 bg-amber-500 hover:bg-amber-600 text-white"
                                onClick={() =>
                                  setCheckpointFor({
                                    id: a.id,
                                    name: a.display_name,
                                    reason: a.last_error,
                                  })
                                }
                              >
                                <ShieldAlert className="h-3.5 w-3.5" />
                                {lang === "ar" ? "إكمال التحقق" : "Complete verification"}
                              </Button>
                            )}
                          {a.status === "invalid" &&
                            !looksLikeCheckpoint(a.status, a.last_error) &&
                            a.auth_method === "cookies" &&
                            testingId !== a.id && (
                              <Button
                                size="sm"
                                variant="default"
                                className="gap-1.5"
                                onClick={() => setReloginFor({ id: a.id, name: a.display_name })}
                              >
                                <LogIn className="h-3.5 w-3.5" />
                                {lang === "ar" ? "إعادة تسجيل الدخول" : "Re-login"}
                              </Button>
                            )}
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(a.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
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
                <TabsTrigger value="cookies">
                  <Cookie className="me-2 h-4 w-4" />
                  {t.methodCookies}
                </TabsTrigger>
                <TabsTrigger value="credentials">
                  <KeyRound className="me-2 h-4 w-4" />
                  {t.methodCreds}
                </TabsTrigger>
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
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t.password}</Label>
                  <Input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t.twoFa}</Label>
                  <Input
                    value={form.twoFactorSecret}
                    onChange={(e) => setForm({ ...form, twoFactorSecret: e.target.value })}
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t.cancel}
            </Button>
            <Button onClick={handleAdd} disabled={submitting}>
              {submitting && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!groupsResult} onOpenChange={(o) => !o && setGroupsResult(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-green-600" />
              {t.groupsTitle} — {groupsResult?.accountName}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[420px] overflow-y-auto">
            {!groupsResult || groupsResult.groups.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t.groupsEmpty}</p>
            ) : (
              <ul className="divide-y divide-border/50">
                {groupsResult.groups.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-3 py-2.5">
                    <a
                      href={`https://facebook.com/groups/${g.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {g.name}
                    </a>
                    <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {g.id}
                    </code>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupsResult(null)}>
              {t.close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!precheck} onOpenChange={(o) => !o && setPrecheck(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              {lang === "ar" ? "فحص الكوكيز قبل الاختبار" : "Cookie pre-check"}
            </DialogTitle>
          </DialogHeader>

          {precheck && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {lang === "ar" ? "الحساب:" : "Account:"}{" "}
                <span className="font-semibold text-foreground">{precheck.name}</span>
              </p>

              {precheck.loading && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-3 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  {lang === "ar" ? "جارٍ فحص الكوكيز…" : "Checking cookies…"}
                </div>
              )}

              {precheck.error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-3 text-sm text-red-700 dark:text-red-300">
                  <p className="font-semibold">
                    {lang === "ar" ? "تعذّر إجراء الفحص" : "Pre-check failed"}
                  </p>
                  <p className="mt-1 font-mono text-xs opacity-90">{precheck.error}</p>
                </div>
              )}

              {precheck.result && (
                <>
                  <div
                    className={`rounded-md border px-3 py-3 text-sm ${
                      precheck.result.ok
                        ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                        : "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300"
                    }`}
                  >
                    <p className="flex items-center gap-2 font-semibold">
                      {precheck.result.ok ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <XCircle className="h-4 w-4" />
                      )}
                      {precheck.result.message}
                    </p>
                  </div>

                  {precheck.result.method === "cookies" && (
                    <div className="rounded-md border border-border bg-muted/30 p-3">
                      <p className="mb-2 text-xs font-semibold text-muted-foreground">
                        {lang === "ar" ? "الكوكيز المطلوبة" : "Required cookies"} (
                        {precheck.result.present.length}/5)
                        {" · "}
                        <span className="font-normal">
                          {lang === "ar" ? "إجمالي محفوظ:" : "stored total:"}{" "}
                          {precheck.result.totalCookies}
                        </span>
                      </p>
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {(["c_user", "xs", "fr", "datr", "sb"] as const).map((name) => {
                          const isMissing = precheck.result!.missing.includes(name);
                          const invalid = precheck.result!.invalid.find((i) => i.name === name);
                          const ok = !isMissing && !invalid;
                          return (
                            <div
                              key={name}
                              className={`flex items-center gap-1.5 rounded border px-2 py-1.5 font-mono text-xs ${
                                ok
                                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                                  : "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300"
                              }`}
                            >
                              {ok ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5" />
                              )}
                              {name}
                            </div>
                          );
                        })}
                      </div>
                      {precheck.result.invalid.length > 0 && (
                        <ul className="mt-3 space-y-1 text-xs text-red-700 dark:text-red-300">
                          {precheck.result.invalid.map((i) => (
                            <li key={i.name}>
                              <span className="font-mono font-semibold">{i.name}</span>: {i.reason}
                            </li>
                          ))}
                        </ul>
                      )}
                      {precheck.result.missing.length > 0 && (
                        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                          {lang === "ar"
                            ? "افتح فيسبوك في المتصفح، سجّل دخول من جديد، ثم صدِّر الكوكيز كـ JSON عبر إضافة Cookie-Editor واحفظها بديلًا عن الحالية."
                            : "Open Facebook, sign in fresh, then export cookies as JSON via the Cookie-Editor extension and replace the current ones."}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPrecheck(null)}>
              {lang === "ar" ? "إغلاق" : "Close"}
            </Button>
            <Button
              disabled={!precheck?.result?.ok}
              onClick={() => {
                if (precheck) {
                  const id = precheck.id;
                  setPrecheck(null);
                  void handleTest(id);
                }
              }}
              className="gap-1.5"
            >
              <Activity className="h-4 w-4" />
              {lang === "ar" ? "متابعة الاختبار" : "Run test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reloginFor} onOpenChange={(o) => !o && setReloginFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogIn className="h-5 w-5 text-primary" />
              {lang === "ar" ? "إعادة تسجيل الدخول لفيسبوك" : "Re-login to Facebook"}
            </DialogTitle>
          </DialogHeader>

          {reloginFor && (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-900 dark:text-amber-200">
                <p className="font-semibold">
                  {lang === "ar" ? "الحساب:" : "Account:"}{" "}
                  <span className="font-bold">{reloginFor.name}</span>
                </p>
                <p className="mt-1 text-xs leading-relaxed">
                  {lang === "ar"
                    ? "الكوكيز الحالية غير صالحة أو منتهية. اتبع الخطوات أدناه لتصدير كوكيز جديدة من جلسة نشطة."
                    : "Current cookies are invalid or expired. Follow the steps below to export fresh cookies from an active session."}
                </p>
              </div>

              <ol className="space-y-3 text-sm leading-relaxed">
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                    1
                  </span>
                  <span>
                    {lang === "ar"
                      ? "افتح فيسبوك في تبويب جديد وسجّل خروج ثم سجّل دخول من جديد بنفس الحساب."
                      : "Open Facebook in a new tab, sign out and sign back in with the same account."}
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                    2
                  </span>
                  <span>
                    {lang === "ar" ? (
                      <>
                        ثبّت إضافة <span className="font-mono font-semibold">Cookie-Editor</span> من
                        Chrome Web Store إذا لم تكن مثبتة.
                      </>
                    ) : (
                      <>
                        Install the <span className="font-mono font-semibold">Cookie-Editor</span>{" "}
                        extension from the Chrome Web Store if you don't have it.
                      </>
                    )}
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                    3
                  </span>
                  <span>
                    {lang === "ar"
                      ? 'وأنت على صفحة facebook.com، افتح Cookie-Editor واضغط Export ثم "Export as JSON" (سيتم النسخ تلقائيًا).'
                      : 'While on facebook.com, open Cookie-Editor → Export → "Export as JSON" (it copies to clipboard automatically).'}
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                    4
                  </span>
                  <span>
                    {lang === "ar"
                      ? 'احذف الحساب الحالي من هنا ثم اضغط "ربط حساب جديد" والصق الكوكيز الجديدة.'
                      : 'Delete the current account here, then click "Add new account" and paste the new cookies.'}
                  </span>
                </li>
              </ol>

              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground leading-relaxed">
                <p className="font-semibold text-foreground mb-1">
                  {lang === "ar"
                    ? "تأكد من وجود الكوكيز التالية:"
                    : "Ensure these cookies are present:"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {["c_user", "xs", "fr", "datr", "sb"].map((c) => (
                    <span
                      key={c}
                      className="rounded border border-border bg-background px-1.5 py-0.5 font-mono"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReloginFor(null)}>
              {lang === "ar" ? "إغلاق" : "Close"}
            </Button>
            <Button asChild className="gap-1.5">
              <a href="https://www.facebook.com/login" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                {lang === "ar" ? "افتح فيسبوك" : "Open Facebook"}
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!checkpointFor} onOpenChange={(o) => !o && setCheckpointFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
              {lang === "ar" ? "إكمال التحقق على فيسبوك" : "Complete Facebook verification"}
            </DialogTitle>
          </DialogHeader>

          {checkpointFor && (
            <div className="space-y-4">
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-900 dark:text-amber-200">
                <p className="font-semibold">
                  {lang === "ar" ? "الحساب:" : "Account:"}{" "}
                  <span className="font-bold">{checkpointFor.name}</span>
                </p>
                <p className="mt-1 text-xs leading-relaxed">
                  {lang === "ar"
                    ? 'فيسبوك طلب تأكيد هوية أو خطوة أمان إضافية (Checkpoint). أكمل الخطوات يدويًا ثم اضغط على "تم — أعد الاختبار".'
                    : 'Facebook is requesting identity confirmation or an extra security step (Checkpoint). Complete it manually, then click "Done — re-test".'}
                </p>
                {checkpointFor.reason && (
                  <p className="mt-2 font-mono text-[10px] opacity-80 break-words">
                    <span className="font-semibold">
                      {lang === "ar" ? "السبب من فيسبوك:" : "FB reason:"}
                    </span>{" "}
                    {checkpointFor.reason}
                  </p>
                )}
              </div>

              <ol className="space-y-3 text-sm leading-relaxed">
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-700 dark:text-amber-300">
                    1
                  </span>
                  <span>
                    {lang === "ar"
                      ? "افتح فيسبوك في تبويب جديد ومن نفس المتصفح اللي صدّرت منه الكوكيز."
                      : "Open Facebook in a new tab using the same browser you exported cookies from."}
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-700 dark:text-amber-300">
                    2
                  </span>
                  <span>
                    {lang === "ar"
                      ? "اتبع التعليمات اللي بتظهر: تأكيد الهاتف، الإيميل، صورة، أو رفع هوية."
                      : "Follow the on-screen instructions: phone, email, photo, or ID verification."}
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-700 dark:text-amber-300">
                    3
                  </span>
                  <span>
                    {lang === "ar"
                      ? "بعد ما تخلص وترجع للفيد بشكل طبيعي، رجع هنا واضغط على الزر بالأسفل."
                      : "After you return to the normal feed, come back here and click the button below."}
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-700 dark:text-amber-300">
                    4
                  </span>
                  <span>
                    {lang === "ar"
                      ? "هنعيد فحص الحساب تلقائيًا. لو فضلت المشكلة، صدِّر كوكيز جديدة من Cookie-Editor."
                      : "We'll auto re-test the account. If it still fails, export fresh cookies via Cookie-Editor."}
                  </span>
                </li>
              </ol>
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button asChild variant="outline" className="gap-1.5">
              <a href="https://www.facebook.com/" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                {lang === "ar" ? "افتح فيسبوك" : "Open Facebook"}
              </a>
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setCheckpointFor(null)}>
                {lang === "ar" ? "لاحقًا" : "Later"}
              </Button>
              <Button
                className="gap-1.5 bg-amber-500 hover:bg-amber-600 text-white"
                onClick={() => {
                  if (checkpointFor) {
                    const id = checkpointFor.id;
                    setCheckpointFor(null);
                    void handleTest(id, true);
                  }
                }}
              >
                <RotateCw className="h-4 w-4" />
                {lang === "ar" ? "تم — أعد الاختبار" : "Done — re-test"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
