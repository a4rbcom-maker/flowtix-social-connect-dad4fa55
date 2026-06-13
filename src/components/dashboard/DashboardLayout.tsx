import { useState, useEffect, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Facebook,
  MessageCircle,
  Activity,
  Settings,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
  Users,
  Send,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  LinkIcon,
  Bot,
  Sparkles,
  Inbox,
  Search,
  Smartphone,
  Shield,
  UserPlus,
  MapPin,
  PlugZap,
  Users2,
  UsersRound,
  Megaphone,
  PlusCircle,
  FileText,
  Image as ImageIcon,
  MessageSquareQuote,
  Target,
  Reply,
  BarChart3,
  History,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/integrations/supabase/client";
import { NotificationsBell } from "@/components/dashboard/NotificationsBell";
import { ChannelStatusDot } from "@/components/dashboard/ChannelStatusDot";
import { ChannelQuickActions } from "@/components/dashboard/ChannelQuickActions";
import { useChannelStatus } from "@/hooks/useChannelStatus";
import { useIsAdmin } from "@/hooks/useIsAdmin";
const flowtixLogo = "/flowtix-logo.webp";


interface DashboardLayoutProps {
  children: ReactNode;
  title: string;
}

export function DashboardLayout({ children, title }: DashboardLayoutProps) {
  const { signOut, user } = useAuth();
  const { lang, setLang, dir } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  // Default: sidebar always open (both desktop and mobile overlay).
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isDesktop, setIsDesktop] = useState(true);
  const channelStatus = useChannelStatus(lang);
  const { isAdmin, isLoading: isAdminLoading } = useIsAdmin();

  // Admins must use the admin panel only — never the client dashboard.
  useEffect(() => {
    if (!isAdminLoading && isAdmin) {
      navigate({ to: "/admin", replace: true });
    }
  }, [isAdmin, isAdminLoading, navigate]);

  // Track viewport size only — do not auto-collapse the sidebar.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(min-width: 768px)");
    const apply = () => setIsDesktop(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);

  // Also auto-close on mobile when the route actually changes.
  useEffect(() => {
    if (!isDesktop) setSidebarOpen(false);
  }, [location.pathname, isDesktop]);

  const closeOnMobile = () => {
    if (!isDesktop) setSidebarOpen(false);
  };

  const labels = lang === "ar"
    ? { overview: "نظرة عامة", control: "لوحة التحكم", facebook: "فيسبوك", fbConnect: "ربط حساب فيسبوك", fbGroups: "جروباتي المرتبطة", whatsapp: "واتساب", waInbox: "الدردشة", waAccounts: "حساباتي", waBot: "البوت (ردود الكلمات)", waAgent: "وكيل الذكاء الاصطناعي", waSettings: "إعدادات واتساب", bulk: "إرسال جماعي", activity: "سجل النشاط", settings: "الملف الشخصي", logout: "تسجيل الخروج", sectionMain: "الرئيسية", sectionChannels: "القنوات", sectionInsights: "التحليلات" }
    : { overview: "Overview", control: "Control Panel", facebook: "Facebook", fbConnect: "Connect Facebook Account", fbGroups: "My Linked Groups", whatsapp: "WhatsApp", waInbox: "Chats", waAccounts: "My Accounts", waBot: "Bot (Keyword Replies)", waAgent: "AI Agent", waSettings: "WhatsApp Settings", bulk: "Bulk Send", activity: "Activity", settings: "Profile", logout: "Sign Out", sectionMain: "Main", sectionChannels: "Channels", sectionInsights: "Insights" };

  type LeafItem = { kind: "leaf"; icon: typeof LayoutDashboard; label: string; to: "/dashboard" | "/dashboard/control" | "/dashboard/facebook" | "/dashboard/facebook/groups" | "/dashboard/facebook/insights" | "/dashboard/facebook/messages" | "/dashboard/facebook/bot" | "/dashboard/facebook/jobs" | "/dashboard/facebook/history" | "/dashboard/facebook/campaigns" | "/dashboard/facebook/templates" | "/dashboard/facebook/media" | "/dashboard/facebook/autoreply" | "/dashboard/whatsapp" | "/dashboard/whatsapp/inbox" | "/dashboard/whatsapp/accounts" | "/dashboard/whatsapp/bot" | "/dashboard/whatsapp/automation" | "/dashboard/whatsapp/settings" | "/dashboard/whatsapp/contacts" | "/dashboard/bulk" | "/dashboard/enrich" | "/dashboard/activity" | "/dashboard/profile"; search?: Record<string, string> };
  type SubheaderItem = { kind: "subheader"; label: string };
  type GroupChild = LeafItem | SubheaderItem;
  type GroupItem = { kind: "group"; key: string; icon: typeof LayoutDashboard; label: string; children: GroupChild[] };
  type MenuItem = LeafItem | GroupItem;
  type Section = { title: string; items: MenuItem[] };

  const sections: Section[] = [
    {
      title: labels.sectionMain,
      items: [
        { kind: "leaf", icon: LayoutDashboard, label: labels.overview, to: "/dashboard" },
        { kind: "leaf", icon: Activity, label: labels.control, to: "/dashboard/control" },
      ],
    },
    {
      title: labels.sectionChannels,
      items: [
        {
          kind: "group",
          key: "facebook",
          icon: Facebook,
          label: labels.facebook,
          children: [
            { kind: "subheader", label: lang === "ar" ? "الحسابات والإعداد" : "Accounts & Setup" },
            { kind: "leaf", icon: PlugZap, label: labels.fbConnect, to: "/dashboard/facebook" },
            { kind: "leaf", icon: Bot, label: lang === "ar" ? "حسابات النشر التلقائي" : "Auto-posting accounts", to: "/dashboard/facebook/bot" },
            { kind: "leaf", icon: Users2, label: labels.fbGroups, to: "/dashboard/facebook/groups" },

            { kind: "subheader", label: lang === "ar" ? "النشر في الجروبات والصفحات" : "Post to Groups & Pages" },
            { kind: "leaf", icon: Megaphone, label: lang === "ar" ? "حملات النشر المجدولة" : "Scheduled campaigns", to: "/dashboard/facebook/campaigns" },
            { kind: "leaf", icon: PlusCircle, label: lang === "ar" ? "نشر سريع الآن" : "Quick post", to: "/dashboard/facebook/jobs" },
            { kind: "leaf", icon: FileText, label: lang === "ar" ? "قوالب الرسائل" : "Message templates", to: "/dashboard/facebook/templates" },
            { kind: "leaf", icon: ImageIcon, label: lang === "ar" ? "الصور والفيديوهات" : "Photos & videos", to: "/dashboard/facebook/media" },

            { kind: "subheader", label: lang === "ar" ? "استخراج جهات الاتصال" : "Extract Contacts" },
            { kind: "leaf", icon: MessageSquareQuote, label: lang === "ar" ? "استخراج المعلقين على منشور" : "Extract post commenters", to: "/dashboard/facebook/jobs", search: { tab: "commenters" } },
            { kind: "leaf", icon: UsersRound, label: lang === "ar" ? "استخراج أعضاء جروب" : "Extract group members", to: "/dashboard/facebook/jobs", search: { tab: "groupmembers" } },
            { kind: "leaf", icon: Target, label: lang === "ar" ? "استخراج متابعي صفحة" : "Extract page followers", to: "/dashboard/facebook/jobs", search: { tab: "pageaudience" } },

            { kind: "subheader", label: lang === "ar" ? "الرسائل والإحصائيات" : "Messages & Stats" },
            { kind: "leaf", icon: Inbox, label: lang === "ar" ? "صندوق رسائل ماسنجر" : "Messenger inbox", to: "/dashboard/facebook/messages" },
            { kind: "leaf", icon: Reply, label: lang === "ar" ? "الرد التلقائي على التعليقات" : "Auto-reply to comments", to: "/dashboard/facebook/autoreply" },
            { kind: "leaf", icon: BarChart3, label: lang === "ar" ? "إحصائيات الصفحة" : "Page stats", to: "/dashboard/facebook/insights" },
            { kind: "leaf", icon: History, label: lang === "ar" ? "سجل العمليات السابقة" : "Activity history", to: "/dashboard/facebook/history" },
          ],
        },
        {
          kind: "group",
          key: "whatsapp",
          icon: MessageCircle,
          label: labels.whatsapp,
          children: [
            { kind: "leaf", icon: Inbox, label: labels.waInbox, to: "/dashboard/whatsapp/inbox" },
            { kind: "leaf", icon: Smartphone, label: labels.waAccounts, to: "/dashboard/whatsapp/accounts" },
            { kind: "leaf", icon: UsersRound, label: lang === "ar" ? "استخراج الأرقام" : "Extract numbers", to: "/dashboard/whatsapp/contacts" },
            { kind: "leaf", icon: MessageCircle, label: labels.waBot, to: "/dashboard/whatsapp/automation" },
            { kind: "leaf", icon: Sparkles, label: labels.waAgent, to: "/dashboard/whatsapp/bot" },
            { kind: "leaf", icon: Settings, label: labels.waSettings, to: "/dashboard/whatsapp/settings" },
            { kind: "leaf", icon: Send, label: labels.bulk, to: "/dashboard/bulk" },
          ],
        },
      ],
    },
    {
      title: labels.sectionInsights,
      items: [
        { kind: "leaf", icon: MapPin, label: lang === "ar" ? "إثراء العملاء" : "Lead enrichment", to: "/dashboard/enrich" },
        { kind: "leaf", icon: Activity, label: labels.activity, to: "/dashboard/activity" },
        { kind: "leaf", icon: Settings, label: labels.settings, to: "/dashboard/profile" },
      ],
    },
  ];

  const menu: MenuItem[] = sections.flatMap((s) => s.items);

  // Auto-open the group containing the active route; persist user toggles.
  const initialOpen: Record<string, boolean> = {};
  menu.forEach((m) => {
    if (m.kind === "group") {
      initialOpen[m.key] = m.children.some((c) => c.kind === "leaf" && c.to === location.pathname);
    }
  });
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initialOpen);
  const toggleGroup = (key: string) =>
    setOpenGroups((p) => ({ ...p, [key]: !p[key] }));
  const [groupQuery, setGroupQuery] = useState<Record<string, string>>({});

  const [profilePlan, setProfilePlan] = useState<string | null>(null);
  useEffect(() => {
    if (!user) { setProfilePlan(null); return; }
    let cancelled = false;
    supabase.from("profiles").select("plan").eq("id", user.id).maybeSingle().then(({ data }) => {
      if (!cancelled) setProfilePlan(data?.plan ?? "free");
    });
    return () => { cancelled = true; };
  }, [user]);

  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "";
  const userPlan = profilePlan || (user?.user_metadata?.plan as string | undefined) || "free";
  const isFree = userPlan.toLowerCase() === "free";
  const planLabel = lang === "ar"
    ? (isFree ? "الباقة المجانية" : `باقة ${userPlan}`)
    : `${userPlan.charAt(0).toUpperCase() + userPlan.slice(1)} plan`;
  const upgradeLabel = lang === "ar" ? "ترقية" : "Upgrade";

  const handleLogout = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  return (
    <div dir={dir} className="flex min-h-screen bg-background">
      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
        />
      )}

      <aside
        className={`fixed top-0 z-40 flex h-full flex-col overflow-hidden bg-card transition-[transform,width] duration-200 ease-out ${
          dir === "rtl"
            ? "right-0 border-l border-border"
            : "left-0 border-r border-border"
        } ${sidebarOpen ? "w-[252px]" : "w-[252px] md:w-[68px]"} ${
          sidebarOpen
            ? "translate-x-0"
            : dir === "rtl"
              ? "translate-x-full md:translate-x-0"
              : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Brand header */}
        <div className="flex h-16 items-center justify-between gap-2 border-b border-border px-4 shrink-0">
          <Link
            to="/dashboard"
            onClick={closeOnMobile}
            className="flex items-center gap-2.5 outline-none"
            aria-label="Flowtix Tools"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] shadow-sm">
              <img src={flowtixLogo} alt="" width={22} height={22} className="h-[22px] w-[22px]" />
            </div>
            {sidebarOpen && (
              <div className="flex flex-col leading-tight">
                <span className="text-[15px] font-bold tracking-tight text-foreground">Flowtix</span>
                <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Tools</span>
              </div>
            )}
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 [scrollbar-width:thin]">
          {sections.map((section, sIdx) => (
            <div key={sIdx} className={sIdx > 0 ? "mt-5" : ""}>
              {sidebarOpen ? (
                <div className="mb-1.5 px-3">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                    {section.title}
                  </span>
                </div>
              ) : (
                sIdx > 0 && <div className="mx-3 mb-2 h-px bg-border" />
              )}
              <div className="space-y-0.5">
              {section.items.map((item, i) => {
                const Icon = item.icon;
                if (item.kind === "leaf") {
                  const active = location.pathname === item.to;
                  return (
                    <Link
                      key={i}
                      to={item.to}
                      search={item.search as never}
                      onClick={closeOnMobile}
                      title={!sidebarOpen ? item.label : undefined}
                      className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      } ${!sidebarOpen ? "justify-center" : ""}`}
                    >
                      {active && (
                        <span
                          className={`absolute inset-y-1.5 w-[3px] rounded-full bg-primary ${
                            dir === "rtl" ? "right-0" : "left-0"
                          }`}
                        />
                      )}
                      <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-primary" : ""}`} />
                      {sidebarOpen && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                }

                const groupActive = item.children.some((c) => c.kind === "leaf" && c.to === location.pathname);
                const isOpen = sidebarOpen ? (openGroups[item.key] ?? groupActive) : false;
                const channelState =
                  item.key === "facebook" ? channelStatus.facebook
                  : item.key === "whatsapp" ? channelStatus.whatsapp
                  : null;
                return (
                  <div key={i}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!sidebarOpen) {
                          setSidebarOpen(true);
                          setOpenGroups((p) => ({ ...p, [item.key]: true }));
                        } else {
                          toggleGroup(item.key);
                        }
                      }}
                      aria-expanded={isOpen}
                      title={!sidebarOpen ? `${item.label}${channelState ? ` · ${channelState.label}` : ""}` : undefined}
                      className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                        groupActive
                          ? "text-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      } ${!sidebarOpen ? "justify-center" : ""}`}
                    >
                      <span className="relative inline-flex shrink-0">
                        <Icon className={`h-[18px] w-[18px] shrink-0 ${groupActive ? "text-primary" : ""}`} />
                        {channelState && !sidebarOpen && (
                          <ChannelStatusDot state={channelState} compact lang={lang} />
                        )}
                      </span>
                      {sidebarOpen && (
                        <>
                          <span className="flex-1 truncate text-start">{item.label}</span>
                          {channelState && <ChannelStatusDot state={channelState} lang={lang} />}
                          <ChevronDown
                            className={`h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                          />
                        </>
                      )}
                    </button>
                    {sidebarOpen && (
                      <div
                        className={`grid transition-all duration-200 ease-out ${
                          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                        }`}
                      >
                        <div className="overflow-hidden">
                          <div
                            className={`mt-0.5 space-y-0.5 ${
                              dir === "rtl"
                                ? "mr-[22px] border-r border-border/60 pr-2"
                                : "ml-[22px] border-l border-border/60 pl-2"
                            }`}
                          >
                            {(() => {
                              const leafCount = item.children.filter((c) => c.kind === "leaf").length;
                              const showSearch = leafCount >= 6;
                              const rawQ = groupQuery[item.key] ?? "";
                              const q = rawQ.trim().toLowerCase();
                              // Group children into (subheader, leaves[]) buckets
                              type Bucket = { header: SubheaderItem | null; leaves: LeafItem[] };
                              const buckets: Bucket[] = [];
                              let current: Bucket = { header: null, leaves: [] };
                              buckets.push(current);
                              for (const c of item.children) {
                                if (c.kind === "subheader") {
                                  current = { header: c, leaves: [] };
                                  buckets.push(current);
                                } else {
                                  current.leaves.push(c);
                                }
                              }
                              const filtered = buckets
                                .map((b) => ({
                                  header: b.header,
                                  leaves: q
                                    ? b.leaves.filter((l) => l.label.toLowerCase().includes(q))
                                    : b.leaves,
                                }))
                                .filter((b) => b.leaves.length > 0);

                              return (
                                <>
                                  {showSearch && (
                                    <div className="relative mb-1.5 px-0.5">
                                      <Search className={`pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60 ${dir === "rtl" ? "right-2" : "left-2"}`} />
                                      <input
                                        value={rawQ}
                                        onChange={(e) => setGroupQuery((p) => ({ ...p, [item.key]: e.target.value }))}
                                        placeholder={lang === "ar" ? "بحث داخل القائمة..." : "Search menu..."}
                                        className={`h-7 w-full rounded-md border border-border/60 bg-background/60 text-[11.5px] text-foreground placeholder:text-muted-foreground/50 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20 ${dir === "rtl" ? "pr-6 pl-2 text-right" : "pl-6 pr-2"}`}
                                      />
                                    </div>
                                  )}
                                  {filtered.length === 0 && (
                                    <div className="px-2.5 py-2 text-[11.5px] text-muted-foreground/60">
                                      {lang === "ar" ? "لا توجد نتائج" : "No results"}
                                    </div>
                                  )}
                                  {filtered.map((b, bi) => (
                                    <div key={bi}>
                                      {b.header && (
                                        <div className={`mt-2 mb-0.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 ${bi === 0 ? "mt-0" : ""}`}>
                                          {b.header.label}
                                        </div>
                                      )}
                                      {b.leaves.map((child, j) => {
                                        const ChildIcon = child.icon;
                                        const childActive =
                                          location.pathname === child.to &&
                                          (!child.search || Object.entries(child.search).every(([k, v]) => (location.search as Record<string, unknown>)?.[k] === v));
                                        return (
                                          <Link
                                            key={j}
                                            to={child.to}
                                            search={child.search as never}
                                            onClick={closeOnMobile}
                                            className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px] transition-colors ${
                                              childActive
                                                ? "bg-primary/10 font-medium text-primary"
                                                : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                            }`}
                                          >
                                            <ChildIcon className="h-[14px] w-[14px] shrink-0 opacity-80" />
                                            <span className="truncate">{child.label}</span>
                                          </Link>
                                        );
                                      })}
                                    </div>
                                  ))}
                                </>
                              );
                            })()}
                            {channelState && (
                              <ChannelQuickActions
                                channel={item.key as "facebook" | "whatsapp"}
                                state={channelState}
                                lang={lang}
                                onChanged={channelStatus.refresh}
                                onNavigate={closeOnMobile}
                              />
                            )}
                          </div>
                        </div>

                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            </div>
          ))}

        </nav>


        {/* Footer */}
        <div className="border-t border-border p-3 shrink-0">
          {sidebarOpen ? (
            <div className="space-y-2">
              {isFree ? (
                <Link
                  to="/dashboard/profile"
                  onClick={closeOnMobile}
                  className="group flex items-center gap-2.5 rounded-lg border border-primary/20 bg-primary/5 p-2.5 transition-colors hover:border-primary/40 hover:bg-primary/10"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-primary-foreground">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-foreground">{planLabel}</div>
                    <div className="truncate text-[10.5px] text-primary">{upgradeLabel} →</div>
                  </div>
                </Link>
              ) : (
                <div className="flex items-center gap-2.5 rounded-lg border border-primary/30 bg-gradient-to-br from-primary/10 to-[oklch(0.66_0.26_320)]/10 p-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-primary-foreground">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-foreground">{planLabel}</div>
                    <div className="truncate text-[10.5px] text-muted-foreground">{lang === "ar" ? "اشتراك نشط" : "Active subscription"}</div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] text-[12px] font-semibold text-primary-foreground">
                  {(displayName || "?").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-foreground">{displayName || "—"}</div>
                  <div className="truncate text-[10.5px] text-muted-foreground">{user?.email}</div>
                </div>
                <button
                  onClick={handleLogout}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  title={labels.logout}
                  aria-label={labels.logout}
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>

              <div className="text-center">
                <span className="text-[10px] text-muted-foreground/50">
                  {lang === "ar" ? "الإصدار 2.1.0" : "v2.1.0"}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] text-[12px] font-semibold text-primary-foreground">
                {(displayName || "?").charAt(0).toUpperCase()}
              </div>
              <button
                onClick={handleLogout}
                title={labels.logout}
                aria-label={labels.logout}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut className="h-[18px] w-[18px]" />
              </button>
              <span className="text-[9px] text-muted-foreground/40">v2.1.0</span>
            </div>
          )}
        </div>

      </aside>

      {/* Main content — sidebar margin only applies on md+ (mobile uses overlay) */}
      <main
        className={`flex-1 transition-all duration-300 ${
          sidebarOpen
            ? dir === "rtl" ? "md:mr-[252px]" : "md:ml-[252px]"
            : dir === "rtl" ? "md:mr-[68px]" : "md:ml-[68px]"
        }`}
      >
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border/40 bg-card/70 px-4 py-3 backdrop-blur-xl md:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="group relative flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-background/50 text-muted-foreground transition-all duration-200 hover:border-primary/40 hover:text-primary hover:shadow-[0_4px_12px_-4px_rgba(124,58,237,0.4)]"
              aria-label="Toggle menu"
            >
              {/* Show different icons depending on state, hidden on mobile vs desktop */}
              <Menu className="h-[18px] w-[18px] md:hidden" />
              {sidebarOpen ? (
                <ChevronsLeft className="hidden h-[18px] w-[18px] md:block rtl:hidden" />
              ) : (
                <ChevronsRight className="hidden h-[18px] w-[18px] md:block rtl:hidden" />
              )}
              {sidebarOpen ? (
                <ChevronsRight className="hidden h-[18px] w-[18px] rtl:md:block" />
              ) : (
                <ChevronsLeft className="hidden h-[18px] w-[18px] rtl:md:block" />
              )}
            </button>
            <h1 className="text-base font-semibold text-foreground md:text-lg">{title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <NotificationsBell />
            <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent">
              {lang === "ar" ? "EN" : "عربي"}
            </button>
            <button onClick={toggleTheme} className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-accent">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <div className="hidden items-center gap-2 rounded-lg border border-border px-3 py-1.5 sm:flex">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <span className="hidden text-sm font-medium text-foreground sm:inline">{displayName}</span>
            </div>
          </div>
        </header>

        <div className="p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
