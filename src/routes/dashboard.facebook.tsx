import { createFileRoute, useNavigate, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState, type MouseEvent } from "react";
import { Facebook, RefreshCw, Trash2, Users, Loader2, ExternalLink, ChevronDown, CheckCircle2, Copy, ShieldCheck, FlaskConical, XCircle, KeyRound, Send, Sparkles, AlertCircle, History, Clock, Cookie } from "lucide-react";
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
  inspectFacebookConnection,
  testFacebookToken,
} from "@/lib/facebook.functions";
import { openExternalUrl, ExternalLinkButton } from "@/components/shared/ExternalLinkButton";

import { useFacebookApi, describeFbError } from "@/features/facebook/api";

export const Route = createFileRoute("/dashboard/facebook")({
  ssr: false,
  // Gate the route on a hydrated Supabase session so the very first server-fn
  // call in the page already carries a valid bearer token. Without this, the
  // initial render fires getFacebookConnection before auth is restored, which
  // shows up as a silent 401 and an apparently "frozen" UI.
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.getSession();
  },
  component: FacebookRouteShell,
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

function FacebookRouteShell() {
  const location = useLocation();
  return location.pathname === "/dashboard/facebook" ? <FacebookPage /> : <Outlet />;
}

function FacebookPage() {
  const { user, loading: authLoading } = useAuth();
  const { lang } = useI18n();
  const navigate = useNavigate();
  const [connection, setConnection] = useState<Connection | null>(null);
  // Token expiry awareness — populated silently on dashboard open via
  // inspectFacebookConnection (no token leaves the server). Used to render
  // a top banner when the token is expired or about to expire.
  const { call: fbCall } = useFacebookApi();
  const [tokenExpiry, setTokenExpiry] = useState<{
    expiresAt: string | null;
    dataAccessExpiresAt: string | null;
    isExpired: boolean;
    valid: boolean;
  } | null>(null);
  const [expiryDismissed, setExpiryDismissed] = useState(false);
  const EXPIRY_WARN_DAYS = 7;
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

  // ── Debug logging ─────────────────────────────────────────────────────
  // When enabled, every link-open and clipboard attempt is captured with a
  // timestamp + outcome, so the user can see EXACTLY why opening failed and
  // whether the URL ended up on the clipboard.
  type DebugLog = {
    id: string;
    ts: string;
    level: "info" | "success" | "warn" | "error";
    step: string;
    detail?: string;
  };
  const [debugMode, setDebugMode] = useState(false);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const debugLog = (level: DebugLog["level"], step: string, detail?: string) => {
    if (!debugMode) return;
    const entry: DebugLog = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString().slice(11, 23),
      level,
      step,
      detail,
    };
    setDebugLogs((prev) => [...prev.slice(-49), entry]);
    // Mirror to browser console for power users / Lovable console-logs tool.
    const tag = `[FB-DBG ${entry.ts}] ${step}`;
    if (level === "error") console.error(tag, detail);
    else if (level === "warn") console.warn(tag, detail);
    else console.log(tag, detail);
  };
  const clearDebug = () => setDebugLogs([]);
  const copyDebug = async () => {
    const text = debugLogs.map((l) => `[${l.ts}] ${l.level.toUpperCase()} ${l.step}${l.detail ? " — " + l.detail : ""}`).join("\n");
    try {
      await navigator.clipboard.writeText(text || "(empty)");
      toast.success(lang === "ar" ? "تم نسخ السجل" : "Log copied");
    } catch {
      toast.error(lang === "ar" ? "فشل النسخ" : "Copy failed");
    }
  };

  const copyScopes = async () => {
    debugLog("info", "copyScopes:start", `scopes=${requiredScopes.join(",")}`);
    try {
      await navigator.clipboard.writeText(requiredScopes.join(","));
      debugLog("success", "copyScopes:clipboard.writeText", "ok");
      toast.success(lang === "ar" ? "تم نسخ الصلاحيات" : "Scopes copied");
    } catch (err) {
      debugLog("error", "copyScopes:clipboard.writeText", err instanceof Error ? err.message : String(err));
      toast.error(lang === "ar" ? "فشل نسخ الصلاحيات" : "Copy failed");
    }
  };

  // Open external links robustly inside the Lovable preview iframe.
  // Strategy: copy URL to clipboard FIRST (so the user always has it),
  // then try multiple opening techniques in order of reliability.
  // Thin wrapper around the shared openExternalUrl helper. All FB/WhatsApp
  // links in this page funnel through it so they ALWAYS copy first, then try
  // every safe opening strategy (anchor → window.open → top.location).
  const openExternal = (e: MouseEvent, url: string) => {
    e.preventDefault();
    e.stopPropagation();
    void openExternalUrl(url, {
      lang: lang === "ar" ? "ar" : "en",
      onDebug: debugMode ? debugLog : undefined,
    });
  };

  // Reconnect flow: copy the (missing) scopes to the clipboard and open
  // Graph API Explorer so the user can paste them into "Add a Permission"
  // and re-generate a token. Meta does not accept scopes via URL on Explorer,
  // so the clipboard + toast guidance is the most reliable handoff.
  const handleReconnect = async (scopes: string[]) => {
    const list = (scopes && scopes.length ? scopes : requiredScopes).join(",");
    debugLog("info", "reconnect:start", `scopes=${list}`);
    let copied = false;
    try {
      await navigator.clipboard.writeText(list);
      copied = true;
      debugLog("success", "reconnect:clipboard", "ok");
    } catch (err) {
      debugLog("error", "reconnect:clipboard", err instanceof Error ? err.message : String(err));
    }
    if (copied) {
      toast.success(
        lang === "ar" ? "تم نسخ الصلاحيات الناقصة" : "Missing scopes copied",
        {
          description:
            lang === "ar"
              ? "افتح Graph API Explorer، اضغط \"Add a Permission\" والصق الصلاحيات، ثم اضغط Generate Access Token."
              : "Open Graph API Explorer, click \"Add a Permission\", paste the scopes, then click Generate Access Token.",
        },
      );
    } else {
      toast.warning(
        lang === "ar" ? "تعذّر نسخ الصلاحيات تلقائياً" : "Could not copy scopes automatically",
        { description: lang === "ar" ? `انسخها يدوياً: ${list}` : `Copy them manually: ${list}` },
      );
    }
    void openExternalUrl("https://developers.facebook.com/tools/explorer/", {
      lang: lang === "ar" ? "ar" : "en",
      onDebug: debugMode ? debugLog : undefined,
    });
  };

  // ── Sync history ──────────────────────────────────────────────────────
  // Persisted per user in localStorage. Records every Load Groups / Load
  // Pages attempt with the outcome (success + count, or failure + reason),
  // so the user can see exactly what was last fetched and when.
  type SyncEvent = {
    id: string;
    at: string; // ISO timestamp
    kind: "groups" | "pages";
    status: "success" | "error";
    count?: number;
    errorType?: string;
    errorMessage?: string;
  };
  const SYNC_LOG_KEY = user ? `flowtix:fb:sync-log:${user.id}` : "flowtix:fb:sync-log:anon";
  const [syncLog, setSyncLog] = useState<SyncEvent[]>([]);
  const [syncLogOpen, setSyncLogOpen] = useState(false);

  // Hydrate from localStorage on mount / user change
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(SYNC_LOG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SyncEvent[];
        if (Array.isArray(parsed)) setSyncLog(parsed);
      }
    } catch {
      /* corrupt entry — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [SYNC_LOG_KEY]);

  const recordSync = (ev: Omit<SyncEvent, "id" | "at">) => {
    const entry: SyncEvent = {
      ...ev,
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
    };
    setSyncLog((prev) => {
      const next = [entry, ...prev].slice(0, 20); // keep last 20
      try {
        window.localStorage.setItem(SYNC_LOG_KEY, JSON.stringify(next));
      } catch {
        /* quota — ignore */
      }
      return next;
    });
  };

  const clearSyncLog = () => {
    setSyncLog([]);
    try {
      window.localStorage.removeItem(SYNC_LOG_KEY);
    } catch {
      /* ignore */
    }
  };

  const formatRelative = (iso: string) => {
    const diffMs = Date.now() - new Date(iso).getTime();
    const sec = Math.round(diffMs / 1000);
    if (sec < 60) return lang === "ar" ? `قبل ${sec} ث` : `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return lang === "ar" ? `قبل ${min} د` : `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return lang === "ar" ? `قبل ${hr} س` : `${hr}h ago`;
    const day = Math.round(hr / 24);
    return lang === "ar" ? `قبل ${day} يوم` : `${day}d ago`;
  };

  const lastGroupsSync = syncLog.find((e) => e.kind === "groups");
  const lastPagesSync = syncLog.find((e) => e.kind === "pages");


  const t = lang === "ar"
    ? {
        title: "ربط فيسبوك",
        subtitle: "اربط حساب فيسبوك لتحميل جروباتك وصفحاتك تلقائياً",
        tokenLabel: "Access Token",
        tokenPlaceholder: "الصق توكن فيسبوك هنا...",
        tokenHelp: "احصل على التوكن من Graph API Explorer",
        getToken: "الحصول على توكن",
        botCookiesTitle: "عايز إعداد البوت بالـ Cookies؟",
        botCookiesDesc: "ده مكان مختلف عن Access Token. افتح صفحة حسابات البوت والصق Cookies JSON مباشرة.",
        openBotCookies: "فتح إعداد Cookies للبوت",
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
        reconnect: "إعادة ربط بالصلاحيات الناقصة",
        reconnectAll: "إعادة الربط بصلاحيات كاملة",
        reconnectToastTitle: "تم نسخ الصلاحيات الناقصة",
        reconnectToastDesc: "افتح Graph API Explorer، اضغط \"Add a Permission\" والصق الصلاحيات، ثم اضغط Generate Access Token.",
        syncHistoryTitle: "سجل آخر مزامنة",
        syncHistorySubtitle: "آخر عمليات تحميل الجروبات والصفحات مع وقت ونتيجة كل عملية",
        showHistory: "عرض السجل",
        hideHistory: "إخفاء السجل",
        clearHistory: "مسح السجل",
        noHistory: "لا توجد عمليات مزامنة بعد. اضغط \"تحميل الجروبات\" أو \"تحميل الصفحات\" للبدء.",
        lastGroupsSync: "آخر تحميل للجروبات",
        lastPagesSync: "آخر تحميل للصفحات",
        neverSynced: "لم يتم التحميل بعد",
        syncSuccess: "نجاح",
        syncFailed: "فشل",
        syncCount: (n: number) => `تم تحميل ${n}`,
        scopesSectionTitle: "Scopes المطلوبة",
        scopesSectionSubtitle: "انسخ القائمة كاملة والصقها داخل حقل \"Add a Permission\" في Graph API Explorer.",
        scopesCopyComma: "نسخ بفواصل (Graph Explorer)",
        scopesCopyLines: "نسخ سطر لكل صلاحية",
        scopesCopied: "تم النسخ — الصق في Graph Explorer",
        scopesCount: (n: number) => `${n} صلاحية`,
      }
    : {
        title: "Facebook Connection",
        subtitle: "Link your Facebook account to load your groups and pages",
        tokenLabel: "Access Token",
        tokenPlaceholder: "Paste your Facebook token here...",
        tokenHelp: "Get a token from Graph API Explorer",
        getToken: "Get Token",
        botCookiesTitle: "Need the Cookies bot setup?",
        botCookiesDesc: "This is separate from Access Token. Open Bot accounts and paste the Cookies JSON directly.",
        openBotCookies: "Open bot Cookies setup",
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
        reconnect: "Reconnect with missing scopes",
        reconnectAll: "Reconnect with full permissions",
        reconnectToastTitle: "Missing scopes copied",
        reconnectToastDesc: "Open Graph API Explorer, click \"Add a Permission\", paste the scopes, then click Generate Access Token.",
        syncHistoryTitle: "Last sync history",
        syncHistorySubtitle: "Most recent Load Groups / Load Pages attempts with timestamp and outcome",
        showHistory: "Show history",
        hideHistory: "Hide history",
        clearHistory: "Clear history",
        noHistory: "No sync runs yet. Click \"Load Groups\" or \"Load Pages\" to start.",
        lastGroupsSync: "Last groups load",
        lastPagesSync: "Last pages load",
        neverSynced: "Never loaded yet",
        syncSuccess: "Success",
        syncFailed: "Failed",
        syncCount: (n: number) => `${n} loaded`,
        scopesSectionTitle: "Required Scopes",
        scopesSectionSubtitle: "Copy the full list and paste it into the \"Add a Permission\" field in Graph API Explorer.",
        scopesCopyComma: "Copy comma-separated (Graph Explorer)",
        scopesCopyLines: "Copy one per line",
        scopesCopied: "Copied — paste in Graph Explorer",
        scopesCount: (n: number) => `${n} scopes`,
      };

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [user, authLoading, navigate]);

  // Load existing connection + token expiry inspection. The expiry check
  // runs silently in the background; if the token is expired or expires
  // within EXPIRY_WARN_DAYS, the UI surfaces a banner + one-time toast.
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await fbCall(getFacebookConnection);
        setConnection(res.connection);

        // Only inspect if there's actually a stored connection.
        if (res.connection) {
          try {
            const insp = await fbCall(inspectFacebookConnection);
            if (insp.connected) {
              setTokenExpiry({
                expiresAt: insp.expiresAt,
                dataAccessExpiresAt: insp.dataAccessExpiresAt,
                isExpired: insp.isExpired,
                valid: insp.valid,
              });

              // One-time toast for expired or near-expiry tokens.
              const dismissedKey = `flowtix:fb:expiry-toast:${user.id}:${insp.expiresAt ?? "none"}`;
              const alreadyToasted = window.sessionStorage.getItem(dismissedKey) === "1";
              if (!alreadyToasted) {
                if (insp.isExpired || insp.valid === false) {
                  toast.error(
                    lang === "ar" ? "انتهت صلاحية توكن فيسبوك" : "Facebook token has expired",
                    {
                      description:
                        lang === "ar"
                          ? "أعد توليد التوكن من Graph API Explorer ثم اربط الحساب من جديد."
                          : "Generate a new token from Graph API Explorer and reconnect.",
                    },
                  );
                  window.sessionStorage.setItem(dismissedKey, "1");
                } else if (insp.expiresAt) {
                  const daysLeft = Math.floor(
                    (new Date(insp.expiresAt).getTime() - Date.now()) / 86_400_000,
                  );
                  if (daysLeft >= 0 && daysLeft <= EXPIRY_WARN_DAYS) {
                    toast.warning(
                      lang === "ar"
                        ? `توكن فيسبوك ينتهي خلال ${daysLeft} يوم`
                        : `Facebook token expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
                      {
                        description:
                          lang === "ar"
                            ? "ننصح بتجديد التوكن قبل الانتهاء لتجنّب توقف تحميل الجروبات والصفحات."
                            : "Renew the token before it expires to avoid disruption.",
                      },
                    );
                    window.sessionStorage.setItem(dismissedKey, "1");
                  }
                }
              }
            }
          } catch (inspErr) {
            // Inspection is best-effort; don't block the page if it fails.
            console.warn("Token inspection failed", inspErr);
          }
        }
      } catch (err) {
        console.error("Load connection failed", err);
        toast.error(describeFbError(err, lang === "ar" ? "ar" : "en"));
      }
    })();
    // lang is intentionally read at effect time; we don't want to re-toast on language switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, fbCall]);

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
      const res = await fbCall(testFacebookToken, { access_token: token.trim() });
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
      const res = await fbCall(connectFacebook, { access_token: token.trim() });
      toast.success(
        lang === "ar"
          ? `تم الربط بنجاح: ${res.profile.name}`
          : `Connected as ${res.profile.name}`,
      );
      setToken("");
      // refresh connection
      const c = await fbCall(getFacebookConnection);
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
      await fbCall(disconnectFacebook);
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
      const res = await fbCall(fetchFacebookGroups);
      if (res.error) {
        setGroups([]);
        setGroupsError(res.error);
        recordSync({
          kind: "groups",
          status: "error",
          errorType: res.error.type,
          errorMessage: friendlyFbError(res.error),
        });
        toast.error(friendlyFbError(res.error));
      } else {
        setGroups(res.groups);
        recordSync({ kind: "groups", status: "success", count: res.groups.length });
        toast.success(lang === "ar" ? `تم تحميل ${res.groups.length} جروب` : `Loaded ${res.groups.length} groups`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load groups";
      setGroupsError({ type: "unknown", message: msg, missingPermission: null });
      recordSync({ kind: "groups", status: "error", errorType: "unknown", errorMessage: msg });
      toast.error(msg);
    } finally {
      setLoadingGroups(false);
    }
  };

  const handleLoadPages = async () => {
    setLoadingPages(true);
    setPagesError(null);
    try {
      const res = await fbCall(fetchFacebookPages);
      if (res.error) {
        setPages([]);
        setPagesError(res.error);
        recordSync({
          kind: "pages",
          status: "error",
          errorType: res.error.type,
          errorMessage: friendlyFbError(res.error),
        });
        toast.error(friendlyFbError(res.error));
      } else {
        setPages(res.pages);
        recordSync({ kind: "pages", status: "success", count: res.pages.length });
        toast.success(lang === "ar" ? `تم تحميل ${res.pages.length} صفحة` : `Loaded ${res.pages.length} pages`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load pages";
      setPagesError({ type: "unknown", message: msg, missingPermission: null });
      recordSync({ kind: "pages", status: "error", errorType: "unknown", errorMessage: msg });
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
        <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Cookie className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">{t.botCookiesTitle}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t.botCookiesDesc}</p>
              </div>
            </div>
            <Link to="/dashboard/facebook/bot">
              <button className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:opacity-90">
                <Cookie className="h-4 w-4" />
                {t.openBotCookies}
              </button>
            </Link>
          </div>
        </div>

        {/* Token expiry banner — only when expired or within EXPIRY_WARN_DAYS.
            Reads silently from inspectFacebookConnection on mount. The user
            can dismiss for the current view; persists per-token in sessionStorage. */}
        {(() => {
          if (!connection || !tokenExpiry || expiryDismissed) return null;
          const expired = tokenExpiry.isExpired || tokenExpiry.valid === false;
          const daysLeft = tokenExpiry.expiresAt
            ? Math.floor((new Date(tokenExpiry.expiresAt).getTime() - Date.now()) / 86_400_000)
            : null;
          const expiringSoon = !expired && daysLeft !== null && daysLeft >= 0 && daysLeft <= EXPIRY_WARN_DAYS;
          if (!expired && !expiringSoon) return null;

          const tone = expired
            ? "border-destructive/40 bg-destructive/10"
            : "border-amber-400/50 bg-amber-50 dark:bg-amber-950/20";
          const iconTone = expired ? "text-destructive" : "text-amber-600 dark:text-amber-400";

          const title = expired
            ? lang === "ar" ? "انتهت صلاحية توكن فيسبوك" : "Facebook token has expired"
            : lang === "ar"
              ? `توكن فيسبوك ينتهي خلال ${daysLeft} يوم`
              : `Facebook token expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;

          const body = expired
            ? lang === "ar"
              ? "لن نتمكّن من تحميل الجروبات أو الصفحات حتى تجدّد التوكن. أعد توليده من Graph API Explorer ثم اربط الحساب من جديد."
              : "We can't load groups or pages until you renew the token. Generate a new one from Graph API Explorer and reconnect."
            : lang === "ar"
              ? "ننصح بتجديد التوكن قبل الانتهاء لتجنّب توقف العمل."
              : "Renew the token before it expires to avoid disruption.";

          const expiresOn = tokenExpiry.expiresAt
            ? new Date(tokenExpiry.expiresAt).toLocaleString(lang === "ar" ? "ar" : "en", {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : null;

          return (
            <div className={`relative rounded-2xl border p-5 shadow-sm ${tone}`}>
              <div className="flex items-start gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card ${iconTone}`}>
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold text-foreground">{title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                  {expiresOn && (
                    <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-card/60 px-2 py-1 text-xs text-foreground/80 ring-1 ring-border">
                      <Clock className="h-3.5 w-3.5" />
                      {lang === "ar" ? "ينتهي في:" : "Expires:"} <span className="font-mono">{expiresOn}</span>
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleReconnect(requiredScopes)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      {lang === "ar" ? "تجديد التوكن الآن" : "Renew token now"}
                      <ExternalLink className="h-3 w-3 opacity-80" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpiryDismissed(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
                    >
                      {lang === "ar" ? "إخفاء مؤقتاً" : "Dismiss"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

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

        {/* Required Scopes — standalone, prominent block. Gives the user
            ready-to-paste lists for Graph API Explorer's "Add a Permission"
            field, plus a one-per-line variant for manual entry. */}
        {!connection && (
          <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">{t.scopesSectionTitle}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t.scopesSectionSubtitle}</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary ring-1 ring-primary/20">
                {t.scopesCount(requiredScopes.length)}
              </span>
            </div>

            {/* Read-only ready-to-paste textarea */}
            <div className="relative">
              <textarea
                readOnly
                value={requiredScopes.join(",")}
                onFocus={(e) => e.currentTarget.select()}
                onClick={(e) => e.currentTarget.select()}
                rows={2}
                className="w-full resize-none rounded-xl border border-border bg-muted/40 p-3 pe-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label={t.scopesSectionTitle}
              />
            </div>

            {/* Action buttons + chip list */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(requiredScopes.join(","));
                    toast.success(t.scopesCopied);
                  } catch {
                    toast.error(lang === "ar" ? "فشل النسخ" : "Copy failed");
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:opacity-90"
              >
                <Copy className="h-3.5 w-3.5" />
                {t.scopesCopyComma}
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(requiredScopes.join("\n"));
                    toast.success(t.scopesCopied);
                  } catch {
                    toast.error(lang === "ar" ? "فشل النسخ" : "Copy failed");
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
              >
                <Copy className="h-3.5 w-3.5" />
                {t.scopesCopyLines}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
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
                {/* Always-visible fallback: show the URL as a selectable text
                    field so the user can copy it manually if both clipboard
                    and popup-based opening fail. */}
                <div className="mt-2">
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    {lang === "ar" ? "أو انسخ الرابط يدوياً" : "Or copy the link manually"}
                  </label>
                  <div className="flex items-stretch gap-1.5">
                    <input
                      type="text"
                      readOnly
                      value="https://developers.facebook.com/tools/explorer/"
                      onFocus={(e) => e.currentTarget.select()}
                      onClick={(e) => e.currentTarget.select()}
                      className="flex-1 rounded-lg border border-border bg-muted/40 px-3 py-1.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                      dir="ltr"
                      aria-label={lang === "ar" ? "رابط Graph API Explorer" : "Graph API Explorer URL"}
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const url = "https://developers.facebook.com/tools/explorer/";
                        try {
                          await navigator.clipboard.writeText(url);
                          toast.success(lang === "ar" ? "تم نسخ الرابط" : "Link copied");
                        } catch {
                          toast.error(lang === "ar" ? "فشل النسخ — حدد النص يدوياً" : "Copy failed — select the text manually");
                        }
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                      aria-label={lang === "ar" ? "نسخ الرابط" : "Copy link"}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {lang === "ar" ? "نسخ" : "Copy"}
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-foreground/80">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <p>
                    {lang === "ar"
                      ? "ملاحظة: عند فتح Graph API Explorer قد يطلب منك فيسبوك تسجيل الدخول إلى حسابك أولاً، ثم الموافقة على صلاحيات التطبيق المطلوبة (User Token + Permissions). إذا لم تمنح الصلاحيات بالكامل، لن يعمل الاستكشاف ولن نتمكن من جلب الجروبات والصفحات."
                      : "Note: When you open the Graph API Explorer, Facebook may ask you to log in first, then approve the requested app permissions (User Token + Permissions). If permissions are not fully granted, the explorer won't work and we can't fetch your groups or pages."}
                  </p>
                </div>
                {/* Debug toggle + log panel */}
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setDebugMode((v) => !v)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      debugMode
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    <FlaskConical className="h-3.5 w-3.5" />
                    {lang === "ar"
                      ? `وضع الاختبار (Debug) ${debugMode ? "مفعّل" : "متوقف"}`
                      : `Debug mode ${debugMode ? "ON" : "OFF"}`}
                  </button>
                  {debugMode && (
                    <div className="mt-2 rounded-xl border border-border bg-muted/30 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-foreground">
                          {lang === "ar" ? "سجل الأحداث" : "Event log"}{" "}
                          <span className="font-mono text-muted-foreground">({debugLogs.length})</span>
                        </p>
                        <div className="flex gap-1">
                          <button
                            onClick={copyDebug}
                            disabled={debugLogs.length === 0}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-50"
                          >
                            <Copy className="h-3 w-3" />
                            {lang === "ar" ? "نسخ" : "Copy"}
                          </button>
                          <button
                            onClick={clearDebug}
                            disabled={debugLogs.length === 0}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-50"
                          >
                            {lang === "ar" ? "مسح" : "Clear"}
                          </button>
                        </div>
                      </div>
                      <div className="max-h-48 overflow-y-auto rounded-lg bg-background p-2 font-mono text-[11px] leading-relaxed">
                        {debugLogs.length === 0 ? (
                          <p className="py-3 text-center text-muted-foreground">
                            {lang === "ar"
                              ? "اضغط على «الحصول على توكن» أو زر النسخ لتسجيل الأحداث."
                              : "Click 'Get Token' or any copy button to record events."}
                          </p>
                        ) : (
                          debugLogs.map((l) => (
                            <div
                              key={l.id}
                              className={`flex gap-2 border-b border-border/50 py-1 last:border-0 ${
                                l.level === "error"
                                  ? "text-destructive"
                                  : l.level === "warn"
                                    ? "text-amber-600"
                                    : l.level === "success"
                                      ? "text-emerald-600"
                                      : "text-foreground/80"
                              }`}
                            >
                              <span className="shrink-0 text-muted-foreground">{l.ts}</span>
                              <span className="shrink-0 uppercase">{l.level}</span>
                              <span className="break-all">
                                <b>{l.step}</b>
                                {l.detail && <span className="text-muted-foreground"> — {l.detail}</span>}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
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
                        <button
                          type="button"
                          onClick={() => handleReconnect(missing)}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          {t.reconnect}
                          <ExternalLink className="h-3 w-3 opacity-80" />
                        </button>
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

            {/* Sync history — last attempts per kind, expandable to full log */}
            <div className="mb-4 rounded-xl border border-border/60 bg-muted/30 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <History className="h-4 w-4 text-primary" />
                    <h4 className="text-sm font-semibold text-foreground">{t.syncHistoryTitle}</h4>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t.syncHistorySubtitle}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSyncLogOpen((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent"
                  >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${syncLogOpen ? "rotate-180" : ""}`} />
                    {syncLogOpen ? t.hideHistory : t.showHistory}
                  </button>
                  {syncLog.length > 0 && (
                    <button
                      type="button"
                      onClick={clearSyncLog}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-destructive"
                      title={t.clearHistory}
                      aria-label={t.clearHistory}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Compact per-kind summary always visible */}
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {[
                  { ev: lastGroupsSync, label: t.lastGroupsSync, Icon: Users },
                  { ev: lastPagesSync, label: t.lastPagesSync, Icon: Facebook },
                ].map(({ ev, label, Icon }) => (
                  <div key={label} className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-card px-3 py-2">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-muted-foreground">{label}</p>
                      {ev ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {ev.status === "success" ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-700 ring-1 ring-green-200 dark:bg-green-950/30 dark:text-green-300 dark:ring-green-900">
                              <CheckCircle2 className="h-3 w-3" /> {t.syncSuccess}
                              {typeof ev.count === "number" && <> · {t.syncCount(ev.count)}</>}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive ring-1 ring-destructive/30">
                              <XCircle className="h-3 w-3" /> {t.syncFailed}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <time dateTime={ev.at} title={new Date(ev.at).toLocaleString()}>
                              {formatRelative(ev.at)}
                            </time>
                          </span>
                        </div>
                      ) : (
                        <p className="mt-1 text-[11px] italic text-muted-foreground">{t.neverSynced}</p>
                      )}
                      {ev && ev.status === "error" && ev.errorMessage && (
                        <p className="mt-1 line-clamp-2 text-[11px] text-destructive/80">{ev.errorMessage}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Full chronological log (collapsible) */}
              {syncLogOpen && (
                syncLog.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-dashed border-border/60 bg-card/40 px-3 py-4 text-center text-xs text-muted-foreground">
                    {t.noHistory}
                  </p>
                ) : (
                  <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-border/50 bg-card p-2">
                    {syncLog.map((ev) => (
                      <li key={ev.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs odd:bg-muted/30">
                        {ev.status === "success" ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                        ) : (
                          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-foreground">
                              {ev.kind === "groups" ? t.loadGroups : t.loadPages}
                            </span>
                            <span className="text-muted-foreground">·</span>
                            <span className={ev.status === "success" ? "text-green-700 dark:text-green-400" : "text-destructive"}>
                              {ev.status === "success"
                                ? typeof ev.count === "number"
                                  ? t.syncCount(ev.count)
                                  : t.syncSuccess
                                : t.syncFailed}
                            </span>
                            <span className="text-muted-foreground">·</span>
                            <time dateTime={ev.at} title={new Date(ev.at).toLocaleString()} className="text-muted-foreground">
                              {formatRelative(ev.at)}
                            </time>
                          </div>
                          {ev.status === "error" && ev.errorMessage && (
                            <p className="mt-0.5 text-[11px] text-destructive/80">{ev.errorMessage}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>

            {tab === "groups" && groupsError && (
              <FbErrorBanner
                err={groupsError}
                onRetry={handleLoadGroups}
                onReconnect={() => handleReconnect(groupsError.missingPermission ? [groupsError.missingPermission] : requiredScopes)}
                lang={lang}
                friendly={friendlyFbError}
                reconnectLabel={t.reconnectAll}
              />
            )}
            {tab === "pages" && pagesError && (
              <FbErrorBanner
                err={pagesError}
                onRetry={handleLoadPages}
                onReconnect={() => handleReconnect(pagesError.missingPermission ? [pagesError.missingPermission] : requiredScopes)}
                lang={lang}
                friendly={friendlyFbError}
                reconnectLabel={t.reconnectAll}
              />
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
  onReconnect,
  lang,
  friendly,
  reconnectLabel,
}: {
  err: FbErr;
  onRetry: () => void;
  onReconnect?: () => void;
  lang: string;
  friendly: (e: FbErr) => string;
  reconnectLabel?: string;
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
              <button
                type="button"
                onClick={() => (onReconnect ? onReconnect() : (window.location.hash = "fb-token-form"))}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                <KeyRound className="h-3.5 w-3.5" />
                {reconnectLabel ?? (lang === "ar" ? "إعادة الربط بصلاحيات كاملة" : "Reconnect with full permissions")}
                <ExternalLink className="h-3 w-3 opacity-80" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
