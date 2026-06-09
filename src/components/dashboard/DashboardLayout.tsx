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
  Smartphone,
  Shield,
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
    ? { overview: "نظرة عامة", control: "لوحة التحكم", facebook: "فيسبوك", fbConnect: "الربط والحالة", fbGroups: "الجروبات", whatsapp: "واتساب", waInbox: "الدردشة", waAccounts: "حساباتي", waBot: "البوت (ردود الكلمات)", waAgent: "وكيل الذكاء الاصطناعي", waSettings: "إعدادات واتساب", bulk: "إرسال جماعي", activity: "سجل النشاط", settings: "الملف الشخصي", logout: "تسجيل الخروج", sectionMain: "الرئيسية", sectionChannels: "القنوات", sectionInsights: "التحليلات" }
    : { overview: "Overview", control: "Control Panel", facebook: "Facebook", fbConnect: "Connect & Status", fbGroups: "Groups", whatsapp: "WhatsApp", waInbox: "Chats", waAccounts: "My Accounts", waBot: "Bot (Keyword Replies)", waAgent: "AI Agent", waSettings: "WhatsApp Settings", bulk: "Bulk Send", activity: "Activity", settings: "Profile", logout: "Sign Out", sectionMain: "Main", sectionChannels: "Channels", sectionInsights: "Insights" };

  type LeafItem = { kind: "leaf"; icon: typeof LayoutDashboard; label: string; to: "/dashboard" | "/dashboard/control" | "/dashboard/facebook" | "/dashboard/facebook/groups" | "/dashboard/facebook/insights" | "/dashboard/facebook/messages" | "/dashboard/facebook/bot" | "/dashboard/facebook/jobs" | "/dashboard/facebook/history" | "/dashboard/facebook/campaigns" | "/dashboard/facebook/templates" | "/dashboard/facebook/media" | "/dashboard/whatsapp" | "/dashboard/whatsapp/inbox" | "/dashboard/whatsapp/accounts" | "/dashboard/whatsapp/bot" | "/dashboard/whatsapp/automation" | "/dashboard/whatsapp/settings" | "/dashboard/bulk" | "/dashboard/activity" | "/dashboard/profile" };
  type GroupItem = { kind: "group"; key: string; icon: typeof LayoutDashboard; label: string; children: LeafItem[] };
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
            { kind: "leaf", icon: LinkIcon, label: labels.fbConnect, to: "/dashboard/facebook" },
            { kind: "leaf", icon: Users, label: labels.fbGroups, to: "/dashboard/facebook/groups" },
            { kind: "leaf", icon: Activity, label: lang === "ar" ? "تحليلات الصفحة" : "Page insights", to: "/dashboard/facebook/insights" },
            { kind: "leaf", icon: MessageCircle, label: lang === "ar" ? "رسائل Inbox" : "Messenger Inbox", to: "/dashboard/facebook/messages" },
            { kind: "leaf", icon: Bot, label: lang === "ar" ? "حسابات البوت" : "Bot accounts", to: "/dashboard/facebook/bot" },
            { kind: "leaf", icon: Sparkles, label: lang === "ar" ? "حملات النشر" : "Campaigns", to: "/dashboard/facebook/campaigns" },
            { kind: "leaf", icon: Send, label: lang === "ar" ? "القوالب النصية" : "Templates", to: "/dashboard/facebook/templates" },
            { kind: "leaf", icon: Activity, label: lang === "ar" ? "مكتبة الوسائط" : "Media library", to: "/dashboard/facebook/media" },
            { kind: "leaf", icon: Send, label: lang === "ar" ? "إنشاء مهمة" : "Create job", to: "/dashboard/facebook/jobs" },
            { kind: "leaf", icon: Activity, label: lang === "ar" ? "سجل المهام" : "Jobs history", to: "/dashboard/facebook/history" },
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
            { kind: "leaf", icon: Bot, label: labels.waBot, to: "/dashboard/whatsapp/bot" },
            { kind: "leaf", icon: Settings, label: labels.waSettings, to: "/dashboard/whatsapp/settings" },
            { kind: "leaf", icon: Send, label: labels.bulk, to: "/dashboard/bulk" },
          ],
        },
      ],
    },
    {
      title: labels.sectionInsights,
      items: [
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
      initialOpen[m.key] = m.children.some((c) => c.to === location.pathname);
    }
  });
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initialOpen);
  const toggleGroup = (key: string) =>
    setOpenGroups((p) => ({ ...p, [key]: !p[key] }));

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

                const groupActive = item.children.some((c) => c.to === location.pathname);
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
                            {item.children.map((child, j) => {
                              const ChildIcon = child.icon;
                              const childActive = location.pathname === child.to;
                              return (
                                <Link
                                  key={j}
                                  to={child.to}
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
