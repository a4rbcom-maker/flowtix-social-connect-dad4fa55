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
  LinkIcon,
  Bot,
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isDesktop, setIsDesktop] = useState(true);
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

  type LeafItem = { kind: "leaf"; icon: typeof LayoutDashboard; label: string; to: "/dashboard" | "/dashboard/control" | "/dashboard/facebook" | "/dashboard/facebook/groups" | "/dashboard/whatsapp" | "/dashboard/bulk" | "/dashboard/activity" | "/dashboard/profile" };
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
        className={`fixed top-0 z-40 flex h-full flex-col bg-gradient-to-b from-card via-card to-card/95 shadow-[0_8px_30px_-12px_rgba(124,58,237,0.18)] backdrop-blur-xl transition-[transform,width] duration-300 ease-out ${
          dir === "rtl"
            ? "right-0 border-l border-border/40"
            : "left-0 border-r border-border/40"
        } ${sidebarOpen ? "w-64" : "w-64 md:w-[72px]"} ${
          sidebarOpen
            ? "translate-x-0"
            : dir === "rtl"
              ? "translate-x-full md:translate-x-0"
              : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Decorative gradient halo */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary/8 to-transparent" />

        <div className="relative flex items-center justify-between gap-2 border-b border-border/40 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary/30 to-[oklch(0.66_0.26_320)]/30 blur-md" />
              <img
                src={flowtixLogo}
                alt="Logo"
                width={36}
                height={36}
                className="relative h-9 w-9 shrink-0 rounded-xl"
              />
            </div>
            {sidebarOpen && (
              <div className="flex flex-col leading-none">
                <span className="bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] bg-clip-text text-lg font-extrabold tracking-tight text-transparent">
                  Flowtix
                </span>
                <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
                  Tools
                </span>
              </div>
            )}
          </div>
          {/* Close button visible on mobile */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="relative flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {sections.map((section, sIdx) => (
            <div key={sIdx} className="space-y-1">
              {sidebarOpen && (
                <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
                  {section.title}
                </div>
              )}
              {!sidebarOpen && sIdx > 0 && (
                <div className="mx-3 mb-2 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
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
                      className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                        active
                          ? "bg-gradient-to-r from-primary/15 via-primary/10 to-transparent text-primary shadow-sm"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                      } ${!sidebarOpen ? "justify-center" : ""}`}
                    >
                      {active && (
                        <span
                          className={`absolute inset-y-1.5 w-[3px] rounded-full bg-gradient-to-b from-primary to-[oklch(0.66_0.26_320)] ${
                            dir === "rtl" ? "right-0" : "left-0"
                          }`}
                        />
                      )}
                      <Icon
                        className={`h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110 ${
                          active ? "text-primary" : ""
                        }`}
                      />
                      {sidebarOpen && <span className="truncate">{item.label}</span>}
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
                      className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                        groupActive
                          ? "bg-gradient-to-r from-primary/15 via-primary/10 to-transparent text-primary shadow-sm"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                      } ${!sidebarOpen ? "justify-center" : ""}`}
                    >
                      {groupActive && (
                        <span
                          className={`absolute inset-y-1.5 w-[3px] rounded-full bg-gradient-to-b from-primary to-[oklch(0.66_0.26_320)] ${
                            dir === "rtl" ? "right-0" : "left-0"
                          }`}
                        />
                      )}
                      <span className="relative inline-flex shrink-0">
                        <Icon
                          className={`h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110 ${
                            groupActive ? "text-primary" : ""
                          }`}
                        />
                        {channelState && !sidebarOpen && (
                          <ChannelStatusDot state={channelState} compact lang={lang} />
                        )}
                      </span>
                      {sidebarOpen && (
                        <>
                          <span className="flex-1 truncate text-start">{item.label}</span>
                          {channelState && (
                            <ChannelStatusDot state={channelState} lang={lang} />
                          )}
                          <ChevronDown
                            className={`h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform duration-300 ${isOpen ? "rotate-180 text-primary" : ""}`}
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
                            className={`mt-1 space-y-0.5 ${
                              dir === "rtl"
                                ? "mr-5 border-r border-border/50 pr-3"
                                : "ml-5 border-l border-border/50 pl-3"
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
                                  className={`group/sub relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-all duration-200 ${
                                    childActive
                                      ? "bg-primary/10 font-semibold text-primary"
                                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                  }`}
                                >
                                  <span
                                    className={`h-1.5 w-1.5 shrink-0 rounded-full transition-all ${
                                      childActive
                                        ? "bg-primary shadow-[0_0_8px_oklch(0.62_0.27_295)]"
                                        : "bg-border group-hover/sub:bg-muted-foreground"
                                    }`}
                                  />
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
          ))}
        </nav>

        <div className="border-t border-border/40 p-3">
          <button
            onClick={handleLogout}
            title={!sidebarOpen ? labels.logout : undefined}
            className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-destructive transition-all duration-200 hover:bg-destructive/10 ${
              !sidebarOpen ? "justify-center" : ""
            }`}
          >
            <LogOut className="h-[18px] w-[18px] shrink-0 transition-transform group-hover:-translate-x-0.5 rtl:group-hover:translate-x-0.5" />
            {sidebarOpen && <span>{labels.logout}</span>}
          </button>
        </div>
      </aside>

      {/* Main content — sidebar margin only applies on md+ (mobile uses overlay) */}
      <main
        className={`flex-1 transition-all duration-300 ${
          sidebarOpen
            ? dir === "rtl" ? "md:mr-64" : "md:ml-64"
            : dir === "rtl" ? "md:mr-[72px]" : "md:ml-[72px]"
        }`}
      >
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border/40 bg-card/70 px-4 py-3 backdrop-blur-xl md:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Toggle menu"
            >
              <Menu className="h-5 w-5" />
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
