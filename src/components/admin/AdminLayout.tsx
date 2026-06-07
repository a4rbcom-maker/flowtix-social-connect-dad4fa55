import { useState, useEffect, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  Facebook,
  MessageCircle,
  Sparkles,
  ListChecks,
  ScrollText,
  Megaphone,
  Settings,
  ShieldCheck,
  ChevronsLeft,
  ChevronsRight,
  Menu,
  X,
  ArrowLeft,
  LogOut,
  Sun,
  Moon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { checkIsAdmin } from "@/lib/admin.functions";
import { Loader2 } from "lucide-react";

const flowtixLogo = "/flowtix-logo.webp";

type AdminPath =
  | "/admin"
  | "/admin/users"
  | "/admin/facebook"
  | "/admin/whatsapp"
  | "/admin/ai"
  | "/admin/jobs"
  | "/admin/logs"
  | "/admin/notifications"
  | "/admin/settings"
  | "/admin/security";

interface NavItem {
  to: AdminPath;
  icon: typeof LayoutDashboard;
  ar: string;
  en: string;
}

const NAV: NavItem[] = [
  { to: "/admin", icon: LayoutDashboard, ar: "نظرة عامة", en: "Overview" },
  { to: "/admin/users", icon: Users, ar: "المستخدمون", en: "Users" },
  { to: "/admin/facebook", icon: Facebook, ar: "فيسبوك", en: "Facebook" },
  { to: "/admin/whatsapp", icon: MessageCircle, ar: "واتساب", en: "WhatsApp" },
  { to: "/admin/ai", icon: Sparkles, ar: "استهلاك الذكاء", en: "AI Usage" },
  { to: "/admin/jobs", icon: ListChecks, ar: "المهام", en: "Jobs" },
  { to: "/admin/logs", icon: ScrollText, ar: "السجلات", en: "Logs" },
  { to: "/admin/notifications", icon: Megaphone, ar: "الإشعارات", en: "Announcements" },
  { to: "/admin/settings", icon: Settings, ar: "الإعدادات", en: "Settings" },
  { to: "/admin/security", icon: ShieldCheck, ar: "الأمان", en: "Security" },
];

export function AdminLayout({ children, title }: { children: ReactNode; title: string }) {
  const { signOut, user, loading } = useAuth();
  const { lang, dir } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: adminCheck, isLoading: checkingAdmin } = useQuery({
    queryKey: ["admin", "check", user?.id],
    queryFn: () => checkIsAdmin(),
    enabled: !!user,
    staleTime: 60_000,
  });

  if (loading || (user && checkingAdmin)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", search: { redirect: location.pathname } });
    }
  }, [loading, user, navigate, location.pathname]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }


  if (!adminCheck?.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6" dir={dir}>
        <div className="max-w-md text-center space-y-4 rounded-2xl border border-border bg-card p-8 shadow-xl">
          <ShieldCheck className="h-12 w-12 text-destructive mx-auto" />
          <h1 className="text-2xl font-bold">{lang === "ar" ? "وصول مرفوض" : "Access Denied"}</h1>
          <p className="text-muted-foreground">
            {lang === "ar" ? "هذه الصفحة مخصصة للسوبر أدمن فقط." : "This area is reserved for super admins only."}
          </p>
          <Link to="/dashboard" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground font-medium hover:opacity-90">
            <ArrowLeft className="h-4 w-4" />
            {lang === "ar" ? "العودة للوحة التحكم" : "Back to dashboard"}
          </Link>
        </div>
      </div>
    );
  }

  const isActive = (to: string) => {
    if (to === "/admin") return location.pathname === "/admin";
    return location.pathname === to || location.pathname.startsWith(to + "/");
  };

  const sidebarWidth = collapsed ? "w-16" : "w-64";

  return (
    <div className="min-h-screen flex w-full bg-gradient-to-br from-background via-background to-primary/5" dir={dir}>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed md:sticky top-0 ${dir === "rtl" ? "right-0" : "left-0"} h-screen z-50 ${sidebarWidth} transition-all duration-300 bg-card/95 backdrop-blur-xl border-${dir === "rtl" ? "l" : "r"} border-border shadow-2xl flex flex-col ${mobileOpen ? "translate-x-0" : dir === "rtl" ? "translate-x-full md:translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        {/* Brand */}
        <div className="h-16 flex items-center justify-between px-3 border-b border-border">
          <Link to="/admin" className="flex items-center gap-2 overflow-hidden">
            <div className="relative shrink-0">
              <img src={flowtixLogo} alt="Flowtix" className="h-8 w-8 rounded-lg" />
              <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-400 ring-2 ring-card animate-pulse" />
            </div>
            {!collapsed && (
              <div className="flex flex-col leading-tight">
                <span className="font-bold text-sm">Flowtix</span>
                <span className="text-[10px] font-semibold tracking-widest text-amber-500 uppercase">Admin</span>
              </div>
            )}
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden p-1 rounded hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? "bg-gradient-to-r from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                }`}
                title={collapsed ? (lang === "ar" ? item.ar : item.en) : undefined}
              >
                <Icon className={`h-5 w-5 shrink-0 ${active ? "" : "group-hover:scale-110 transition-transform"}`} />
                {!collapsed && <span className="truncate">{lang === "ar" ? item.ar : item.en}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-2 border-t border-border space-y-1">

          <button
            onClick={async () => {
              await signOut();
              navigate({ to: "/login" });
            }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            title={collapsed ? (lang === "ar" ? "خروج" : "Sign out") : undefined}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{lang === "ar" ? "تسجيل الخروج" : "Sign Out"}</span>}
          </button>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="hidden md:flex w-full items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
            {!collapsed && <span>{lang === "ar" ? "طي" : "Collapse"}</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border flex items-center justify-between px-4 md:px-6 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setMobileOpen(true)} className="md:hidden p-2 rounded-lg hover:bg-muted">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="text-[10px] font-bold tracking-widest text-amber-500 uppercase">
                {lang === "ar" ? "وضع السوبر أدمن" : "Super Admin Mode"}
              </div>
              <h1 className="text-base md:text-lg font-bold truncate">{title}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
              title={theme === "dark" ? "Light" : "Dark"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-amber-500/10 to-primary/10 border border-amber-500/20">
              <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground text-xs font-bold">
                {user.email?.[0]?.toUpperCase() ?? "A"}
              </div>
              <span className="text-xs font-medium truncate max-w-[120px]">{user.email}</span>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 max-w-[1600px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
