import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Facebook, RefreshCw, Trash2, Users, Loader2, ExternalLink, ChevronDown, CheckCircle2, Copy, ShieldCheck } from "lucide-react";
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
