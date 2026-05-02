import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Facebook, RefreshCw, Trash2, Users, Loader2, ExternalLink, ChevronDown, CheckCircle2, Copy, ShieldCheck, FlaskConical, XCircle } from "lucide-react";
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
  const [tab, setTab] = useState<"groups" | "pages">("groups");
  const [guideOpen, setGuideOpen] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    profile: { id: string; name: string; email: string | null };
    granted: string[];
    declined: string[];
  } | null>(null);

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

  const handleConnect = async () => {
    if (!token.trim() || token.trim().length < 20) {
      toast.error(lang === "ar" ? "التوكن قصير جداً" : "Token is too short");
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

  const handleLoadGroups = async () => {
    setLoadingGroups(true);
    try {
      const res = await callServerFn(fetchFacebookGroups);
      setGroups(res.groups);
      toast.success(lang === "ar" ? `تم تحميل ${res.groups.length} جروب` : `Loaded ${res.groups.length} groups`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load groups";
      toast.error(msg);
    } finally {
      setLoadingGroups(false);
    }
  };

  const handleLoadPages = async () => {
    setLoadingPages(true);
    try {
      const res = await callServerFn(fetchFacebookPages);
      setPages(res.pages);
      toast.success(lang === "ar" ? `تم تحميل ${res.pages.length} صفحة` : `Loaded ${res.pages.length} pages`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load pages";
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
                          <a
                            href={step.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20"
                          >
                            {step.action} <ExternalLink className="h-3.5 w-3.5" />
                          </a>
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
                <button
                  onClick={handleDisconnect}
                  className="inline-flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                  {t.disconnect}
                </button>
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
                      onChange={(e) => setToken(e.target.value)}
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
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    {t.getToken} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
              <button
                onClick={handleConnect}
                disabled={connecting || !token.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/30 transition-all hover:shadow-xl hover:shadow-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {connecting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> {t.connecting}</>
                ) : (
                  <><Facebook className="h-4 w-4" /> {t.connect}</>
                )}
              </button>
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

            {tab === "groups" && (
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

            {tab === "pages" && (
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
