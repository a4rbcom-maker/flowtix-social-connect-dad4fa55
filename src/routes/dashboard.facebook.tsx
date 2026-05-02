import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, type MouseEvent } from "react";
import { Facebook, RefreshCw, Trash2, Users, Loader2, ExternalLink, ChevronDown, CheckCircle2, Copy, ShieldCheck, FlaskConical, XCircle, KeyRound, Send, Sparkles, AlertCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { toast } from "sonner";
import {
  connectFacebook,
  disconnectFacebook,
  fetchFacebookGroups,
  fetchFacebookPages,
  getFacebookConnection,
  testFacebookToken,
} from "@/server/facebook.functions";

export const Route = createFileRoute("/dashboard/facebook")({
  component: FacebookPage,
});

interface Connection {
  fb_user_id: string | null;
  fb_user_name: string | null;
  fb_user_email: string | null;
  last_synced_at: string | null;
  created_at: string;
}

interface Group {
  id: string;
  name: string;
  member_count?: number;
  privacy?: string;
  description?: string;
  cover?: { source?: string };
}

interface Page {
  id: string;
  name: string;
  category?: string;
  fan_count?: number;
  link?: string;
  picture?: { data?: { url?: string } };
}

function FacebookPage() {
  const { user, loading: authLoading } = useAuth();
  const { lang } = useI18n();
  const navigate = useNavigate();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingPages, setLoadingPages] = useState(false);
  const [groupsError, setGroupsError] = useState<{ type: string; message: string; missingPermission: string | null } | null>(null);
  const [pagesError, setPagesError] = useState<{ type: string; message: string; missingPermission: string | null } | null>(null);
  const [tab, setTab] = useState<"groups" | "pages">("groups");
  const [guideOpen, setGuideOpen] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    profile: { id: string; name: string; email: string | null };
    granted: string[];
    declined: string[];
  } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const requiredScopes = [
    "public_profile",
    "email",
    "user_groups",
    "groups_access_member_info",
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_metadata",
  ];

  const copyScopes = () => {
    navigator.clipboard.writeText(requiredScopes.join(","));
    toast.success(lang === "ar" ? "تم نسخ الصلاحيات" : "Scopes copied");
  };

  // Open external links robustly inside the Lovable preview iframe.
  // Strategy: copy URL to clipboard FIRST (so the user always has it),
  // then try multiple opening techniques in order of reliability.
  const openExternal = async (e: MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();

    // 1) Always copy first — guarantees the user has the link no matter what.
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch { /* clipboard blocked */ }

    // 2) Try a synthetic anchor with target="_blank" — works inside sandboxed
    //    iframes when allow-popups is set, and is more reliable than window.open
    //    because it's treated as a direct user gesture.
    try {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener,noreferrer";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(
        lang === "ar"
          ? `تم فتح الرابط في تبويب جديد${copied ? " (ونسخه احتياطياً)" : ""}. إذا لم يظهر، الصقه يدوياً.`
          : `Opened in a new tab${copied ? " (and copied as backup)" : ""}. If it didn't appear, paste it manually.`,
        { duration: 5000 },
      );
      return;
    } catch { /* fallthrough */ }

    // 3) Try window.open as secondary fallback.
    try {
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (w) {
        toast.success(lang === "ar" ? "تم فتح الرابط" : "Opened");
        return;
      }
    } catch { /* blocked */ }

    // 4) Try top-frame navigation (often blocked by cross-origin, but try).
    try {
      if (window.top && window.top !== window.self) {
        window.top.location.href = url;
        return;
      }
    } catch { /* cross-origin */ }

    // 5) Last resort — clipboard message only.
    if (copied) {
      toast.info(
        lang === "ar"
          ? "تعذّر فتح الرابط داخل المعاينة، لكن تم نسخه إلى الحافظة. الصقه في تبويب جديد."
          : "Couldn't open inside preview, but the link was copied. Paste it in a new tab.",
        { duration: 7000 },
      );
    } else {
      toast.error(
        lang === "ar"
          ? `تعذّر فتح الرابط ونسخه. افتحه يدوياً: ${url}`
          : `Couldn't open or copy. Open manually: ${url}`,
        { duration: 10000 },
      );
    }
  };

  const t = lang === "ar"
    ? {
        title: "ربط فيسبوك",
        subtitle: "اربط حساب فيسبوك لتحميل جروباتك وصفحاتك تلقائياً",
        tokenLabel: "Access Token",
        tokenPlaceholder: "الصق توكن فيسبوك هنا...",
        tokenHelp: "احصل على التوكن من Graph API Explorer",
        getToken: "الحصول على توكن",
        connect: "ربط الحساب",
        connecting: "جاري الربط...",
        disconnect: "إلغاء الربط",
        connected: "مرتبط",
        connectedAs: "مرتبط باسم",
        loadGroups: "تحميل الجروبات",
        loadPages: "تحميل الصفحات",
        groups: "الجروبات",
        pages: "الصفحات",
        members: "عضو",
        fans: "متابع",
        noGroups: "لا توجد جروبات. اضغط \"تحميل الجروبات\".",
        noPages: "لا توجد صفحات. اضغط \"تحميل الصفحات\".",
        show: "عرض",
        hide: "إخفاء",
        warning: "⚠️ ملاحظة: /me/groups يُرجع فقط الجروبات التي يكون التطبيق مثبّتاً فيها (سياسة Meta).",
        lastSync: "آخر مزامنة",
        notSynced: "لم تتم المزامنة بعد",
        guideTitle: "دليل الحصول على User Access Token",
        guideSubtitle: "اتبع الخطوات التالية للحصول على توكن صالح من Graph API Explorer",
        steps: [
          {
            title: "افتح Graph API Explorer",
            desc: "انتقل إلى أداة Meta الرسمية لاختبار الـ API",
            action: "فتح Graph Explorer",
            link: "https://developers.facebook.com/tools/explorer/",
          },
          {
            title: "اختر تطبيقك من القائمة العلوية",
            desc: "في الزاوية العلوية اليمنى اختر Meta App الخاص بك (أو أنشئ تطبيقاً جديداً من developers.facebook.com)",
          },
          {
            title: "اختر User Token وأضف الصلاحيات (Permissions)",
            desc: "اضغط على \"Add a Permission\" وأضف الصلاحيات التالية:",
          },
          {
            title: "اضغط Generate Access Token",
            desc: "ستظهر نافذة فيسبوك لتأكيد الصلاحيات. وافق عليها كلها.",
          },
          {
            title: "انسخ التوكن والصقه هنا",
            desc: "انسخ التوكن من حقل Access Token في Graph Explorer والصقه في الحقل أدناه ثم اضغط \"ربط الحساب\".",
          },
        ],
        scopesLabel: "الصلاحيات المطلوبة",
        copyScopes: "نسخ الصلاحيات",
        securityNote: "نخزّن التوكن مشفّراً في قاعدة بياناتك فقط — لن يصل إليه أي طرف خارجي.",
        showGuide: "عرض الدليل",
        hideGuide: "إخفاء الدليل",
        test: "اختبار التوكن",
        testing: "جاري الاختبار...",
        testSuccess: "التوكن صالح",
        testFailed: "التوكن غير صالح",
        grantedScopes: "الصلاحيات الممنوحة",
        missingScopes: "صلاحيات ناقصة",
        noMissing: "كل الصلاحيات المطلوبة موجودة ✓",
        confirmConnect: "تأكيد الربط وحفظ التوكن",
        testFirst: "اختبر التوكن أولاً قبل الربط",
        savingSecure: "سيتم حفظ التوكن بشكل آمن في قاعدة بياناتك المحمية بـ RLS — لا يمكن لأي مستخدم آخر الوصول إليه.",
        quickStart: "بدء سريع في 3 خطوات",
        quick1Title: "احصل على التوكن",
        quick1Desc: "من Graph API Explorer مع الصلاحيات المطلوبة",
        quick2Title: "اختبر التوكن",
        quick2Desc: "نتأكد من صلاحيته وصلاحياته قبل الحفظ",
        quick3Title: "ثبّت الربط",
        quick3Desc: "نخزّن التوكن مشفّراً ونبدأ التحميل",
        errInvalidToken: "التوكن غير صالح أو منتهي الصلاحية. أنشئ توكن جديد من Graph Explorer.",
        errExpired: "انتهت صلاحية التوكن. أعد توليده من Graph Explorer.",
        errPermission: "صلاحيات ناقصة. تأكد من إضافة كل الصلاحيات المطلوبة.",
        errNetwork: "تعذّر الاتصال بفيسبوك. تحقق من اتصالك بالإنترنت.",
      }
    : {
        title: "Facebook Connection",
        subtitle: "Link your Facebook account to load your groups and pages",
        tokenLabel: "Access Token",
        tokenPlaceholder: "Paste your Facebook token here...",
        tokenHelp: "Get a token from Graph API Explorer",
        getToken: "Get Token",
        connect: "Connect Account",
        connecting: "Connecting...",
        disconnect: "Disconnect",
        connected: "Connected",
        connectedAs: "Connected as",
        loadGroups: "Load Groups",
        loadPages: "Load Pages",
        groups: "Groups",
        pages: "Pages",
        members: "members",
        fans: "fans",
        noGroups: "No groups loaded yet. Click \"Load Groups\".",
        noPages: "No pages loaded yet. Click \"Load Pages\".",
        show: "Show",
        hide: "Hide",
        warning: "⚠️ Note: /me/groups only returns groups where your app is installed (Meta policy).",
        lastSync: "Last synced",
        notSynced: "Not synced yet",
        guideTitle: "How to Get a User Access Token",
        guideSubtitle: "Follow these steps to generate a valid token from Graph API Explorer",
        steps: [
          {
            title: "Open Graph API Explorer",
            desc: "Go to Meta's official tool for testing the Graph API",
            action: "Open Graph Explorer",
            link: "https://developers.facebook.com/tools/explorer/",
          },
          {
            title: "Select your App from the top dropdown",
            desc: "In the top-right corner, pick your Meta App (or create one at developers.facebook.com)",
          },
          {
            title: "Choose User Token and add Permissions",
            desc: "Click \"Add a Permission\" and add the following scopes:",
          },
          {
            title: "Click Generate Access Token",
            desc: "A Facebook dialog will ask you to confirm the permissions. Approve all of them.",
          },
          {
            title: "Copy the token and paste it below",
            desc: "Copy the value from the Access Token field in Graph Explorer, paste it below, and click \"Connect Account\".",
          },
        ],
        scopesLabel: "Required Scopes",
        copyScopes: "Copy scopes",
        securityNote: "We store the token encrypted in your own database — no third party can access it.",
        showGuide: "Show guide",
        hideGuide: "Hide guide",
        test: "Test token",
        testing: "Testing...",
        testSuccess: "Token is valid",
        testFailed: "Token is invalid",
        grantedScopes: "Granted permissions",
        missingScopes: "Missing permissions",
        noMissing: "All required permissions granted ✓",
        confirmConnect: "Confirm & save token securely",
        testFirst: "Test the token before connecting",
        savingSecure: "Token will be stored securely in your RLS-protected database — no other user can access it.",
        quickStart: "Quick start in 3 steps",
        quick1Title: "Get a token",
        quick1Desc: "From Graph API Explorer with the required scopes",
        quick2Title: "Test the token",
        quick2Desc: "We verify it's valid and has the right permissions",
        quick3Title: "Confirm linking",
        quick3Desc: "Token is stored encrypted and loading begins",
        errInvalidToken: "Token is invalid or malformed. Generate a new one from Graph Explorer.",
        errExpired: "Token has expired. Re-generate it from Graph Explorer.",
        errPermission: "Missing permissions. Make sure all required scopes are granted.",
        errNetwork: "Could not reach Facebook. Check your internet connection.",
      };

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [user, authLoading, navigate]);

  // Load existing connection
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await getFacebookConnection({
          headers: { Authorization: `Bearer ${session.access_token}` },
        } as never);
        setConnection(res.connection);
      } catch (err) {
        console.error("Load connection failed", err);
      }
    })();
  }, [user]);

  const callServerFn = async <T,>(fn: (opts: never) => Promise<T>, body?: unknown): Promise<T> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return fn({
      data: body,
      headers: { Authorization: `Bearer ${session.access_token}` },
    } as never);
  };

  const friendlyError = (raw: string): string => {
    const m = raw.toLowerCase();
    if (m.includes("expired")) return t.errExpired;
    if (m.includes("invalid") && m.includes("token")) return t.errInvalidToken;
    if (m.includes("oauth") || m.includes("190")) return t.errInvalidToken;
    if (m.includes("permission") || m.includes("scope")) return t.errPermission;
    if (m.includes("fetch") || m.includes("network") || m.includes("failed to fetch")) return t.errNetwork;
    return raw;
  };

  const handleTest = async () => {
    if (!token.trim() || token.trim().length < 20) {
      toast.error(lang === "ar" ? "التوكن قصير جداً" : "Token is too short");
      return;
    }
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const res = await callServerFn(testFacebookToken, { access_token: token.trim() });
      setTestResult({ profile: res.profile, granted: res.granted, declined: res.declined });
      const missing = requiredScopes.filter((s) => !res.granted.includes(s));
      if (missing.length === 0) {
        toast.success(`${t.testSuccess}: ${res.profile.name}`);
      } else {
        toast.warning(`${t.testSuccess} — ${t.missingScopes}: ${missing.length}`);
      }
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : t.testFailed;
      const msg = friendlyError(raw);
      setTestResult(null);
      setTestError(msg);
      toast.error(`${t.testFailed} — ${msg}`);
    } finally {
      setTesting(false);
    }
  };

  const handleConnect = async () => {
    if (!token.trim() || token.trim().length < 20) {
      toast.error(lang === "ar" ? "التوكن قصير جداً" : "Token is too short");
      return;
    }
    if (!testResult) {
      toast.error(t.testFirst);
      return;
    }
    setConnecting(true);
    try {
      const res = await callServerFn(connectFacebook, { access_token: token.trim() });
      toast.success(
        lang === "ar"
          ? `تم الربط بنجاح: ${res.profile.name}`
          : `Connected as ${res.profile.name}`,
      );
      setToken("");
      // refresh connection
      const c = await callServerFn(getFacebookConnection);
      setConnection(c.connection);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      toast.error(msg);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await callServerFn(disconnectFacebook);
      setConnection(null);
      setGroups([]);
      setPages([]);
      toast.success(lang === "ar" ? "تم إلغاء الربط" : "Disconnected");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Disconnect failed";
      toast.error(msg);
    }
  };

  const friendlyFbError = (e: { type: string; message: string; missingPermission: string | null }) => {
    if (lang !== "ar") return e.message;
    switch (e.type) {
      case "auth_expired": return "انتهت صلاحية رمز الوصول. أعد ربط الحساب.";
      case "invalid_token": return "رمز الوصول غير صالح أو تم إبطاله. أعد الربط.";
      case "permission_denied":
        return e.missingPermission
          ? `الصلاحية الناقصة: ${e.missingPermission}. أعد الربط وامنح هذه الصلاحية.`
          : "الصلاحيات غير كافية. أعد الربط وامنح كل الصلاحيات المطلوبة.";
      case "rate_limited": return "تم تجاوز حد الاستدعاءات. حاول بعد قليل.";
      case "network": return "تعذّر الاتصال بفيسبوك. تحقق من الإنترنت وحاول مرة أخرى.";
      default: return e.message;
    }
  };

  const handleLoadGroups = async () => {
    setLoadingGroups(true);
    setGroupsError(null);
    try {
      const res = await callServerFn(fetchFacebookGroups);
      if (res.error) {
        setGroups([]);
        setGroupsError(res.error);
        toast.error(friendlyFbError(res.error));
      } else {
        setGroups(res.groups);
        toast.success(lang === "ar" ? `تم تحميل ${res.groups.length} جروب` : `Loaded ${res.groups.length} groups`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load groups";
      setGroupsError({ type: "unknown", message: msg, missingPermission: null });
      toast.error(msg);
    } finally {
      setLoadingGroups(false);
    }
  };

  const handleLoadPages = async () => {
    setLoadingPages(true);
    setPagesError(null);
    try {
      const res = await callServerFn(fetchFacebookPages);
      if (res.error) {
        setPages([]);
        setPagesError(res.error);
        toast.error(friendlyFbError(res.error));
      } else {
        setPages(res.pages);
        toast.success(lang === "ar" ? `تم تحميل ${res.pages.length} صفحة` : `Loaded ${res.pages.length} pages`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load pages";
      setPagesError({ type: "unknown", message: msg, missingPermission: null });
      toast.error(msg);
    } finally {
      setLoadingPages(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <DashboardLayout title={t.title}>
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Quick-start strip — concise 3 steps */}
        {!connection && (
          <div className="rounded-2xl border border-border/50 bg-gradient-to-br from-primary/5 via-card to-[oklch(0.66_0.26_320)]/5 p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{t.quickStart}</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { icon: KeyRound, title: t.quick1Title, desc: t.quick1Desc, n: 1 },
                { icon: FlaskConical, title: t.quick2Title, desc: t.quick2Desc, n: 2 },
                { icon: Send, title: t.quick3Title, desc: t.quick3Desc, n: 3 },
              ].map((s) => (
                <div key={s.n} className="relative rounded-xl border border-border/50 bg-card/60 p-4 backdrop-blur-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-xs font-bold text-white shadow">
                      {s.n}
                    </div>
                    <s.icon className="h-4 w-4 text-primary" />
                  </div>
                  <h4 className="text-sm font-semibold text-foreground">{s.title}</h4>
                  <p className="mt-1 text-xs text-muted-foreground">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step-by-step guide — shown only when not connected */}
        {!connection && (
          <div className="overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
            <button
              onClick={() => setGuideOpen(!guideOpen)}
              className="flex w-full items-center justify-between gap-3 p-6 text-start transition-colors hover:bg-accent/30"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-[oklch(0.66_0.26_320)]/20 text-primary">
                  <ShieldCheck className="h-6 w-6" strokeWidth={2.5} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">{t.guideTitle}</h2>
                  <p className="text-sm text-muted-foreground">{t.guideSubtitle}</p>
                </div>
              </div>
              <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${guideOpen ? "rotate-180" : ""}`} />
            </button>

            {guideOpen && (
              <div className="border-t border-border/50 p-6 pt-4">
                <ol className="space-y-5">
                  {t.steps.map((step, idx) => (
                    <li key={idx} className="flex gap-4">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-sm font-bold text-white shadow-md">
                        {idx + 1}
                      </div>
                      <div className="flex-1 pt-0.5">
                        <h3 className="font-semibold text-foreground">{step.title}</h3>
                        <p className="mt-1 text-sm text-muted-foreground">{step.desc}</p>

                        {step.link && (
                          <div className="mt-2 space-y-2">
                            <div className="flex flex-wrap gap-2">
                              <a
                                href={step.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => openExternal(e, step.link!)}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20"
                              >
                                {step.action} <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                              <a
                                href="https://www.facebook.com/login"
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => openExternal(e, "https://www.facebook.com/login")}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
                              >
                                {lang === "ar" ? "تسجيل الدخول إلى فيسبوك أولاً" : "Log in to Facebook first"} <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {lang === "ar"
                                ? "ملاحظة: إذا لم تُفتح صفحة Graph Explorer، فالسبب غالباً أنك غير مسجّل الدخول إلى فيسبوك أو أن المتصفح حظر النوافذ المنبثقة."
                                : "Note: if Graph Explorer doesn't open, you're likely not logged into Facebook, or your browser blocked the popup."}
                            </p>
                          </div>
                        )}

                        {idx === 2 && (
                          <div className="mt-3 rounded-xl border border-border/50 bg-muted/30 p-3">
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                {t.scopesLabel}
                              </span>
                              <button
                                onClick={copyScopes}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                              >
                                <Copy className="h-3 w-3" /> {t.copyScopes}
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {requiredScopes.map((scope) => (
                                <span
                                  key={scope}
                                  className="inline-flex items-center gap-1 rounded-md bg-card px-2 py-1 font-mono text-xs text-foreground ring-1 ring-border"
                                >
                                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                                  {scope}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="mt-5 flex items-start gap-2 rounded-xl bg-primary/5 p-3 text-xs text-foreground/80">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{t.securityNote}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Connection card */}
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-white shadow-lg">
              <Facebook className="h-6 w-6" strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">{t.title}</h2>
              <p className="text-sm text-muted-foreground">{t.subtitle}</p>
            </div>
          </div>

          {connection ? (
            <div className="rounded-xl bg-gradient-to-br from-primary/5 to-[oklch(0.66_0.26_320)]/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="mb-1 inline-flex items-center gap-2 rounded-full bg-green-500/10 px-3 py-1 text-xs font-medium text-green-600 dark:text-green-400">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                    {t.connected}
                  </div>
                  <p className="text-base font-semibold text-foreground">
                    {t.connectedAs}: {connection.fb_user_name}
                  </p>
                  {connection.fb_user_email && (
                    <p className="text-sm text-muted-foreground">{connection.fb_user_email}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.lastSync}: {connection.last_synced_at
                      ? new Date(connection.last_synced_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")
                      : t.notSynced}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/dashboard/facebook/status"
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/20 hover:opacity-95"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {lang === "ar" ? "عرض حالة الاتصال" : "View status"}
                  </Link>
                  <button
                    onClick={handleDisconnect}
                    className="inline-flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t.disconnect}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                {t.warning}
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">{t.tokenLabel}</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showToken ? "text" : "password"}
                      value={token}
                      onChange={(e) => { setToken(e.target.value); setTestResult(null); setTestError(null); }}
                      placeholder={t.tokenPlaceholder}
                      className="w-full rounded-xl border border-border bg-background px-4 py-2.5 pr-20 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute inset-y-0 right-2 my-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent"
                    >
                      {showToken ? t.hide : t.show}
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t.tokenHelp}</span>
                  <a
                    href="https://developers.facebook.com/tools/explorer/"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => openExternal(e, "https://developers.facebook.com/tools/explorer/")}
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    {t.getToken} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-foreground/80">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <p>
                    {lang === "ar"
                      ? "ملاحظة: عند فتح Graph API Explorer قد يطلب منك فيسبوك تسجيل الدخول إلى حسابك أولاً، ثم الموافقة على صلاحيات التطبيق المطلوبة (User Token + Permissions). إذا لم تمنح الصلاحيات بالكامل، لن يعمل الاستكشاف ولن نتمكن من جلب الجروبات والصفحات."
                      : "Note: When you open the Graph API Explorer, Facebook may ask you to log in first, then approve the requested app permissions (User Token + Permissions). If permissions are not fully granted, the explorer won't work and we can't fetch your groups or pages."}
                  </p>
                </div>
              </div>
              {testError && !testResult && (
                <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-destructive">{t.testFailed}</p>
                    <p className="mt-1 text-sm text-foreground/80">{testError}</p>
                  </div>
                </div>
              )}
              {testResult && (
                <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-green-700 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    {t.testSuccess}: {testResult.profile.name}
                    {testResult.profile.email && (
                      <span className="font-normal text-muted-foreground">({testResult.profile.email})</span>
                    )}
                  </div>
                  <div className="mb-2">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t.grantedScopes} ({testResult.granted.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {testResult.granted.map((s) => (
                        <span key={s} className="inline-flex items-center gap-1 rounded-md bg-card px-2 py-1 font-mono text-xs ring-1 ring-border">
                          <CheckCircle2 className="h-3 w-3 text-green-500" /> {s}
                        </span>
                      ))}
                    </div>
                  </div>
                  {(() => {
                    const missing = requiredScopes.filter((s) => !testResult.granted.includes(s));
                    return missing.length === 0 ? (
                      <p className="mt-2 text-xs text-green-700 dark:text-green-400">{t.noMissing}</p>
                    ) : (
                      <div className="mt-2">
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600">
                          {t.missingScopes} ({missing.length})
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {missing.map((s) => (
                            <span key={s} className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 font-mono text-xs text-amber-900 ring-1 ring-amber-300 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-800">
                              <XCircle className="h-3 w-3" /> {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleTest}
                  disabled={testing || connecting || !token.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-5 py-2.5 text-sm font-semibold text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {testing ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> {t.testing}</>
                  ) : (
                    <><FlaskConical className="h-4 w-4" /> {t.test}</>
                  )}
                </button>
                <button
                  onClick={handleConnect}
                  disabled={connecting || testing || !token.trim() || !testResult}
                  title={!testResult ? t.testFirst : undefined}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/30 transition-all hover:shadow-xl hover:shadow-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {connecting ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> {t.connecting}</>
                  ) : testResult ? (
                    <><ShieldCheck className="h-4 w-4" /> {t.confirmConnect}</>
                  ) : (
                    <><Facebook className="h-4 w-4" /> {t.connect}</>
                  )}
                </button>
              </div>
              {!testResult && token.trim().length >= 20 && (
                <p className="text-xs text-muted-foreground">{t.testFirst}</p>
              )}
              {testResult && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  {t.savingSecure}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Groups & Pages — only shown when connected */}
        {connection && (
          <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1 rounded-xl bg-muted p-1">
                <button
                  onClick={() => setTab("groups")}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                    tab === "groups" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {t.groups} {groups.length > 0 && `(${groups.length})`}
                </button>
                <button
                  onClick={() => setTab("pages")}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                    tab === "pages" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {t.pages} {pages.length > 0 && `(${pages.length})`}
                </button>
              </div>
              <button
                onClick={tab === "groups" ? handleLoadGroups : handleLoadPages}
                disabled={loadingGroups || loadingPages}
                className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
              >
                {(tab === "groups" ? loadingGroups : loadingPages) ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {tab === "groups" ? t.loadGroups : t.loadPages}
              </button>
            </div>

            {tab === "groups" && groupsError && (
              <FbErrorBanner err={groupsError} onRetry={handleLoadGroups} lang={lang} friendly={friendlyFbError} />
            )}
            {tab === "pages" && pagesError && (
              <FbErrorBanner err={pagesError} onRetry={handleLoadPages} lang={lang} friendly={friendlyFbError} />
            )}

            {tab === "groups" && !groupsError && (
              groups.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">{t.noGroups}</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {groups.map((g) => (
                    <div key={g.id} className="overflow-hidden rounded-xl border border-border/50 bg-background transition-all hover:border-primary/30 hover:shadow-md">
                      {g.cover?.source && (
                        <img src={g.cover.source} alt={g.name} className="h-24 w-full object-cover" />
                      )}
                      <div className="p-4">
                        <h3 className="line-clamp-1 font-semibold text-foreground">{g.name}</h3>
                        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                          {typeof g.member_count === "number" && (
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {g.member_count.toLocaleString()} {t.members}
                            </span>
                          )}
                          {g.privacy && (
                            <span className="rounded-full bg-muted px-2 py-0.5">{g.privacy}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {tab === "pages" && !pagesError && (
              pages.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">{t.noPages}</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {pages.map((p) => (
                    <div key={p.id} className="rounded-xl border border-border/50 bg-background p-4 transition-all hover:border-primary/30 hover:shadow-md">
                      <div className="flex gap-3">
                        {p.picture?.data?.url && (
                          <img src={p.picture.data.url} alt={p.name} className="h-12 w-12 shrink-0 rounded-full object-cover" />
                        )}
                        <div className="min-w-0 flex-1">
                          <h3 className="line-clamp-1 font-semibold text-foreground">{p.name}</h3>
                          {p.category && (
                            <p className="line-clamp-1 text-xs text-muted-foreground">{p.category}</p>
                          )}
                          {typeof p.fan_count === "number" && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {p.fan_count.toLocaleString()} {t.fans}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

interface FbErr { type: string; message: string; missingPermission: string | null }
function FbErrorBanner({
  err,
  onRetry,
  lang,
  friendly,
}: {
  err: FbErr;
  onRetry: () => void;
  lang: string;
  friendly: (e: FbErr) => string;
}) {
  const isAuth = err.type === "auth_expired" || err.type === "invalid_token";
  const isPerm = err.type === "permission_denied";
  return (
    <div className="my-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <AlertCircle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold text-foreground">
            {lang === "ar"
              ? isPerm
                ? "صلاحيات ناقصة"
                : isAuth
                  ? "مشكلة في رمز الوصول"
                  : "تعذّر جلب البيانات من فيسبوك"
              : isPerm
                ? "Missing permissions"
                : isAuth
                  ? "Access token problem"
                  : "Failed to load from Facebook"}
          </h4>
          <p className="mt-1 text-sm text-muted-foreground">{friendly(err)}</p>
          {isPerm && err.missingPermission && (
            <code className="mt-2 inline-block rounded-md bg-muted px-2 py-1 text-xs font-mono text-foreground">
              {err.missingPermission}
            </code>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {lang === "ar" ? "إعادة المحاولة" : "Retry"}
            </button>
            {(isAuth || isPerm) && (
              <a
                href="#fb-token-form"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                {lang === "ar" ? "إعادة الربط بصلاحيات كاملة" : "Reconnect with full permissions"}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
