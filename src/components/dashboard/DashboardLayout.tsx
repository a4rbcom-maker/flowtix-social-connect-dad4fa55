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
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { NotificationsBell } from "@/components/dashboard/NotificationsBell";
import { ChannelStatusDot } from "@/components/dashboard/ChannelStatusDot";
import { ChannelQuickActions } from "@/components/dashboard/ChannelQuickActions";
import { useChannelStatus } from "@/hooks/useChannelStatus";
import flowtixLogo from "@/assets/flowtix-logo.png";

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
  // SSR-safe: assume desktop-open. After mount we reconcile based on screen size.
  // Start closed/mobile to match SSR (which has no window). The effect below
  // promotes to desktop+open after hydration on md+ viewports.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const channelStatus = useChannelStatus(lang);

  // Track viewport size and reconcile sidebar visibility.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(min-width: 768px)");
    const apply = () => {
      setIsDesktop(mql.matches);
      setSidebarOpen(mql.matches); // open on desktop, closed on mobile
    };
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
    ? { overview: "نظرة عامة", control: "لوحة التحكم", facebook: "فيسبوك", fbConnect: "الربط والحالة", fbGroups: "الجروبات", whatsapp: "واتساب", waBot: "البوت", bulk: "إرسال جماعي", activity: "سجل النشاط", settings: "الملف الشخصي", logout: "تسجيل الخروج", sectionMain: "الرئيسية", sectionChannels: "القنوات", sectionInsights: "التحليلات" }
    : { overview: "Overview", control: "Control Panel", facebook: "Facebook", fbConnect: "Connect & Status", fbGroups: "Groups", whatsapp: "WhatsApp", waBot: "Bot", bulk: "Bulk Send", activity: "Activity", settings: "Profile", logout: "Sign Out", sectionMain: "Main", sectionChannels: "Channels", sectionInsights: "Insights" };

  type LeafItem = { kind: "leaf"; icon: typeof LayoutDashboard; label: string; to: "/dashboard" | "/dashboard/control" | "/dashboard/facebook" | "/dashboard/facebook/groups" | "/dashboard/facebook/bot" | "/dashboard/facebook/jobs" | "/dashboard/facebook/history" | "/dashboard/whatsapp" | "/dashboard/bulk" | "/dashboard/activity" | "/dashboard/profile" };
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
            { kind: "leaf", icon: Bot, label: lang === "ar" ? "حسابات البوت" : "Bot accounts", to: "/dashboard/facebook/bot" },
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
            { kind: "leaf", icon: Bot, label: labels.waBot, to: "/dashboard/whatsapp" },
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

  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "";
  const userPlan = (user?.user_metadata?.plan as string | undefined) || "Free";
  const planLabel = lang === "ar"
    ? (userPlan.toLowerCase() === "free" ? "الباقة المجانية" : `باقة ${userPlan}`)
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
        className={`fixed top-0 z-40 flex h-full flex-col overflow-hidden bg-card/85 shadow-[0_20px_60px_-20px_rgba(124,58,237,0.28)] backdrop-blur-2xl transition-[transform,width] duration-300 ease-out ${
          dir === "rtl"
            ? "right-0 border-l border-border/40"
            : "left-0 border-r border-border/40"
        } ${sidebarOpen ? "w-[260px]" : "w-[260px] md:w-[76px]"} ${
          sidebarOpen
            ? "translate-x-0"
            : dir === "rtl"
              ? "translate-x-full md:translate-x-0"
              : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Premium ambient halos */}
        <div className="pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute top-1/3 -left-20 h-48 w-48 rounded-full bg-[oklch(0.66_0.26_320)]/12 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 inset-x-0 h-40 bg-gradient-to-t from-primary/[0.04] to-transparent" />
        {/* Subtle inner highlight on the leading edge */}
        <div className={`pointer-events-none absolute inset-y-0 w-px bg-gradient-to-b from-transparent via-primary/20 to-transparent ${dir === "rtl" ? "left-0" : "right-0"}`} />

        {/* Brand header */}
        <div className="relative flex items-center justify-between gap-2 px-4 pt-5 pb-4">
          <Link
            to="/dashboard"
            onClick={closeOnMobile}
            className="group flex items-center gap-2.5 outline-none"
            aria-label="Flowtix Tools"
          >
            <div className="relative">
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-primary/40 via-[oklch(0.66_0.26_320)]/30 to-transparent opacity-70 blur-md transition-opacity duration-300 group-hover:opacity-100" />
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] p-[1.5px] shadow-[0_4px_16px_-4px_rgba(124,58,237,0.5)]">
                <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-card">
                  <img src={flowtixLogo} alt="Logo" width={28} height={28} className="h-7 w-7 rounded-lg" />
                </div>
              </div>
            </div>
            {sidebarOpen && (
              <div className="flex flex-col leading-none">
                <span className="bg-gradient-to-r from-primary via-[oklch(0.62_0.27_295)] to-[oklch(0.66_0.26_320)] bg-clip-text text-[18px] font-black tracking-tight text-transparent">
                  Flowtix
                </span>
                <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.32em] text-muted-foreground/60">
                  Tools
                </span>
              </div>
            )}
          </Link>
          {/* Close button visible on mobile */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Hairline divider with gradient fade */}
        <div className="relative mx-4 h-px bg-gradient-to-r from-transparent via-border/80 to-transparent" />

        <nav className="relative flex-1 space-y-6 overflow-y-auto overflow-x-hidden px-3 py-5 [scrollbar-width:thin] [scrollbar-color:oklch(0.62_0.27_295/0.2)_transparent]">
          {sections.map((section, sIdx) => (
            <div key={sIdx} className="space-y-1">
              {sidebarOpen ? (
                <div className="mb-2.5 flex items-center gap-2 px-3">
                  <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground/55">
                    {section.title}
                  </span>
                  <span className="h-px flex-1 bg-gradient-to-r from-border/60 to-transparent rtl:bg-gradient-to-l" />
                </div>
              ) : (
                sIdx > 0 && (
                  <div className="mx-4 mb-2 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
                )
              )}
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
                      className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-all duration-300 ${
                        active
                          ? "text-primary shadow-[0_4px_16px_-6px_rgba(124,58,237,0.4)]"
                          : "text-muted-foreground hover:translate-x-0.5 hover:text-foreground rtl:hover:-translate-x-0.5"
                      } ${!sidebarOpen ? "justify-center" : ""}`}
                    >
                      {/* Active background — gradient with subtle inner ring */}
                      {active && (
                        <>
                          <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary/18 via-primary/10 to-transparent rtl:bg-gradient-to-l" />
                          <span className="absolute inset-0 rounded-xl ring-1 ring-inset ring-primary/20" />
                          <span
                            className={`absolute inset-y-2 w-[3px] rounded-full bg-gradient-to-b from-primary via-[oklch(0.66_0.26_320)] to-primary shadow-[0_0_10px_oklch(0.62_0.27_295/0.7)] ${
                              dir === "rtl" ? "right-0" : "left-0"
                            }`}
                          />
                        </>
                      )}
                      {/* Hover background */}
                      {!active && (
                        <span className="absolute inset-0 rounded-xl bg-accent/0 transition-colors duration-300 group-hover:bg-accent/50" />
                      )}
                      <Icon
                        className={`relative h-[18px] w-[18px] shrink-0 transition-all duration-300 group-hover:scale-110 ${
                          active ? "text-primary drop-shadow-[0_0_6px_oklch(0.62_0.27_295/0.5)]" : ""
                        }`}
                      />
                      {sidebarOpen && <span className="relative truncate">{item.label}</span>}
                    </Link>
                  );
                }

                // Group with collapsible children
                const groupActive = item.children.some((c) => c.to === location.pathname);
                const isOpen = sidebarOpen ? (openGroups[item.key] ?? groupActive) : false;
                const channelState =
                  item.key === "facebook" ? channelStatus.facebook
                  : item.key === "whatsapp" ? channelStatus.whatsapp
                  : null;
                return (
                  <div key={i} className="space-y-1">
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
                      className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-all duration-300 ${
                        groupActive
                          ? "text-primary shadow-[0_4px_16px_-6px_rgba(124,58,237,0.4)]"
                          : "text-muted-foreground hover:translate-x-0.5 hover:text-foreground rtl:hover:-translate-x-0.5"
                      } ${!sidebarOpen ? "justify-center" : ""}`}
                    >
                      {groupActive && (
                        <>
                          <span className="absolute inset-0 rounded-xl bg-gradient-to-r from-primary/18 via-primary/10 to-transparent rtl:bg-gradient-to-l" />
                          <span className="absolute inset-0 rounded-xl ring-1 ring-inset ring-primary/20" />
                          <span
                            className={`absolute inset-y-2 w-[3px] rounded-full bg-gradient-to-b from-primary via-[oklch(0.66_0.26_320)] to-primary shadow-[0_0_10px_oklch(0.62_0.27_295/0.7)] ${
                              dir === "rtl" ? "right-0" : "left-0"
                            }`}
                          />
                        </>
                      )}
                      {!groupActive && (
                        <span className="absolute inset-0 rounded-xl bg-accent/0 transition-colors duration-300 group-hover:bg-accent/50" />
                      )}
                      <span className="relative inline-flex shrink-0">
                        <Icon
                          className={`h-[18px] w-[18px] shrink-0 transition-all duration-300 group-hover:scale-110 ${
                            groupActive ? "text-primary drop-shadow-[0_0_6px_oklch(0.62_0.27_295/0.5)]" : ""
                          }`}
                        />
                        {channelState && !sidebarOpen && (
                          <ChannelStatusDot state={channelState} compact lang={lang} />
                        )}
                      </span>
                      {sidebarOpen && (
                        <>
                          <span className="relative flex-1 truncate text-start">{item.label}</span>
                          {channelState && (
                            <span className="relative">
                              <ChannelStatusDot state={channelState} lang={lang} />
                            </span>
                          )}
                          <ChevronDown
                            className={`relative h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform duration-300 ${isOpen ? "rotate-180 text-primary" : ""}`}
                          />
                        </>
                      )}
                    </button>
                    {sidebarOpen && (
                      <div
                        className={`grid transition-all duration-300 ease-out ${
                          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                        }`}
                      >
                        <div className="overflow-hidden">
                          <div
                            className={`mt-1.5 space-y-0.5 ${
                              dir === "rtl"
                                ? "mr-[18px] border-r border-dashed border-border/60 pr-3"
                                : "ml-[18px] border-l border-dashed border-border/60 pl-3"
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
                                  className={`group/sub relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] transition-all duration-300 ${
                                    childActive
                                      ? "bg-primary/10 font-semibold text-primary shadow-[0_2px_8px_-3px_rgba(124,58,237,0.4)]"
                                      : "text-muted-foreground hover:translate-x-0.5 hover:bg-accent/50 hover:text-foreground rtl:hover:-translate-x-0.5"
                                  }`}
                                >
                                  <span
                                    className={`h-1.5 w-1.5 shrink-0 rounded-full transition-all duration-300 ${
                                      childActive
                                        ? "bg-primary shadow-[0_0_10px_oklch(0.62_0.27_295)] scale-125"
                                        : "bg-border group-hover/sub:bg-primary/60 group-hover/sub:scale-110"
                                    }`}
                                  />
                                  <ChildIcon className={`h-[14px] w-[14px] shrink-0 transition-opacity ${childActive ? "opacity-100" : "opacity-70 group-hover/sub:opacity-100"}`} />
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
          ))}
        </nav>

        {/* Premium footer: plan card + user + logout */}
        <div className="relative mt-auto p-3">
          {/* Top hairline */}
          <div className="absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-border/80 to-transparent" />

          {sidebarOpen ? (
            <div className="space-y-2.5 pt-3">
              {/* Plan / upgrade card — only when on free plan */}
              {userPlan.toLowerCase() === "free" && (
                <Link
                  to="/dashboard/profile"
                  onClick={closeOnMobile}
                  className="group relative block overflow-hidden rounded-xl border border-primary/25 bg-gradient-to-br from-primary/12 via-card to-[oklch(0.66_0.26_320)]/8 p-3 shadow-[0_4px_18px_-6px_rgba(124,58,237,0.35)] transition-all duration-300 hover:border-primary/40 hover:shadow-[0_8px_24px_-6px_rgba(124,58,237,0.45)]"
                >
                  <div className="pointer-events-none absolute -top-6 -right-6 h-20 w-20 rounded-full bg-primary/20 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
                  <div className="relative flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-primary-foreground shadow-md">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-bold text-foreground">{planLabel}</div>
                      <div className="truncate text-[10.5px] font-medium text-primary">{upgradeLabel} →</div>
                    </div>
                  </div>
                </Link>
              )}

              {/* User row */}
              <div className="flex items-center gap-2.5 rounded-xl border border-border/50 bg-background/50 px-2.5 py-2 backdrop-blur">
                <div className="relative shrink-0">
                  <div className="absolute -inset-0.5 rounded-full bg-gradient-to-br from-primary/40 to-[oklch(0.66_0.26_320)]/40 blur-sm" />
                  <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] text-[12px] font-bold text-primary-foreground ring-2 ring-card">
                    {(displayName || "?").charAt(0).toUpperCase()}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-foreground">{displayName || "—"}</div>
                  <div className="truncate text-[10.5px] text-muted-foreground">{user?.email}</div>
                </div>
                <button
                  onClick={handleLogout}
                  className="group/lo flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 hover:bg-destructive/10 hover:text-destructive"
                  title={labels.logout}
                  aria-label={labels.logout}
                >
                  <LogOut className="h-4 w-4 transition-transform group-hover/lo:-translate-x-0.5 rtl:group-hover/lo:translate-x-0.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 pt-3">
              <div className="relative">
                <div className="absolute -inset-0.5 rounded-full bg-gradient-to-br from-primary/40 to-[oklch(0.66_0.26_320)]/40 blur-sm" />
                <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] text-[12px] font-bold text-primary-foreground ring-2 ring-card">
                  {(displayName || "?").charAt(0).toUpperCase()}
                </div>
              </div>
              <button
                onClick={handleLogout}
                title={labels.logout}
                aria-label={labels.logout}
                className="group flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-all duration-200 hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut className="h-[18px] w-[18px] transition-transform group-hover:-translate-x-0.5 rtl:group-hover:translate-x-0.5" />
              </button>
            </div>
          )}
        </div>

      </aside>

      {/* Main content — sidebar margin only applies on md+ (mobile uses overlay) */}
      <main
        className={`flex-1 transition-all duration-300 ${
          sidebarOpen
            ? dir === "rtl" ? "md:mr-[260px]" : "md:ml-[260px]"
            : dir === "rtl" ? "md:mr-[76px]" : "md:ml-[76px]"
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
