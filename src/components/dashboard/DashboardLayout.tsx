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
    ? { overview: "نظرة عامة", control: "لوحة التحكم", facebook: "فيسبوك", fbConnect: "الربط والحالة", fbGroups: "الجروبات", whatsapp: "واتساب", waBot: "البوت", bulk: "إرسال جماعي", activity: "سجل النشاط", settings: "الإعدادات", logout: "تسجيل الخروج", sectionMain: "الرئيسية", sectionChannels: "القنوات", sectionInsights: "التحليلات" }
    : { overview: "Overview", control: "Control Panel", facebook: "Facebook", fbConnect: "Connect & Status", fbGroups: "Groups", whatsapp: "WhatsApp", waBot: "Bot", bulk: "Bulk Send", activity: "Activity", settings: "Settings", logout: "Sign Out", sectionMain: "Main", sectionChannels: "Channels", sectionInsights: "Insights" };

  type LeafItem = { kind: "leaf"; icon: typeof LayoutDashboard; label: string; to: "/dashboard" | "/dashboard/control" | "/dashboard/facebook" | "/dashboard/facebook/groups" | "/dashboard/whatsapp" | "/dashboard/bulk" | "/dashboard/activity" };
  type GroupItem = { kind: "group"; key: string; icon: typeof LayoutDashboard; label: string; children: LeafItem[] };
  type MenuItem = LeafItem | GroupItem;

  const menu: MenuItem[] = [
    { kind: "leaf", icon: LayoutDashboard, label: labels.overview, to: "/dashboard" },
    { kind: "leaf", icon: Activity, label: labels.control, to: "/dashboard/control" },
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
    { kind: "leaf", icon: Activity, label: labels.activity, to: "/dashboard/activity" },
    { kind: "leaf", icon: Settings, label: labels.settings, to: "/dashboard" },
  ];

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
        className={`fixed top-0 z-40 flex h-full flex-col border-border/50 bg-card transition-transform duration-200 md:transition-all ${
          dir === "rtl" ? "right-0 border-l" : "left-0 border-r"
        } ${sidebarOpen ? "w-64" : "w-64 md:w-16"} ${
          sidebarOpen
            ? "translate-x-0"
            : dir === "rtl"
              ? "translate-x-full md:translate-x-0"
              : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/50 p-4">
          <div className="flex items-center gap-2">
            <img src={flowtixLogo} alt="Logo" width={32} height={32} className="h-8 w-8 shrink-0" />
            {sidebarOpen && (
              <span className="bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] bg-clip-text text-lg font-bold text-transparent">
                Flowtix
              </span>
            )}
          </div>
          {/* Close button visible on mobile */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {menu.map((item, i) => {
            const Icon = item.icon;
            if (item.kind === "leaf") {
              const active = location.pathname === item.to;
              return (
                <Link
                  key={i}
                  to={item.to}
                  onClick={closeOnMobile}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {sidebarOpen && <span>{item.label}</span>}
                </Link>
              );
            }

            // Group with collapsible children
            const groupActive = item.children.some((c) => c.to === location.pathname);
            const isOpen = sidebarOpen ? (openGroups[item.key] ?? groupActive) : false;
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
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                    groupActive
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {sidebarOpen && (
                    <>
                      <span className="flex-1 text-start">{item.label}</span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                      />
                    </>
                  )}
                </button>
                {sidebarOpen && isOpen && (
                  <div className={`space-y-1 ${dir === "rtl" ? "pr-4 border-r" : "pl-4 border-l"} ms-4 border-border/50`}>
                    {item.children.map((child, j) => {
                      const ChildIcon = child.icon;
                      const childActive = location.pathname === child.to;
                      return (
                        <Link
                          key={j}
                          to={child.to}
                          onClick={closeOnMobile}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                            childActive
                              ? "bg-primary/10 font-medium text-primary"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground"
                          }`}
                        >
                          <ChildIcon className="h-4 w-4 shrink-0" />
                          <span>{child.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-border/50 p-3">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {sidebarOpen && <span>{labels.logout}</span>}
          </button>
        </div>
      </aside>

      {/* Main content — sidebar margin only applies on md+ (mobile uses overlay) */}
      <main
        className={`flex-1 transition-all ${
          sidebarOpen
            ? dir === "rtl" ? "md:mr-64" : "md:ml-64"
            : dir === "rtl" ? "md:mr-16" : "md:ml-16"
        }`}
      >
        <header className="flex items-center justify-between border-b border-border/50 bg-card/50 px-4 py-3 backdrop-blur-sm md:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-muted-foreground hover:text-foreground"
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
