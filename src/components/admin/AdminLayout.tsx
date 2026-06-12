import { useState, useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  User as UserIcon,
  KeyRound,
  Bell,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { checkIsAdmin } from "@/lib/admin.functions";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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
  | "/admin/security"
  | "/admin/profile";

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
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const { data: adminCheck, isLoading: checkingAdmin } = useQuery({
    queryKey: ["admin", "check", user?.id],
    queryFn: () => checkIsAdmin(),
    enabled: !!user,
    staleTime: 60_000,
  });

  const { data: profile } = useQuery({
    queryKey: ["admin", "profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
    staleTime: 30_000,
  });

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);



  const handleAdminLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginError("");
    setLoginLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: adminEmail.trim(),
        password: adminPassword,
      });
      if (error) throw error;

      const adminResult = await checkIsAdmin();
      if (!adminResult?.isAdmin) {
        await supabase.auth.signOut();
        throw new Error("not_admin");
      }

      await queryClient.invalidateQueries();
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("not_admin")) {
        setLoginError(lang === "ar" ? "هذا الحساب لا يملك صلاحية السوبر أدمن." : "This account is not a super admin.");
      } else if (message.includes("invalid login credentials")) {
        setLoginError(lang === "ar" ? "بيانات السوبر أدمن غير صحيحة." : "The super admin credentials are incorrect.");
      } else {
        setLoginError(lang === "ar" ? "تعذر تسجيل الدخول الآن. حاول مرة أخرى." : "Unable to sign in right now. Try again.");
      }
    } finally {
      setLoginLoading(false);
    }
  };

  if (loading || (user && checkingAdmin)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5 p-4" dir={dir}>
        <div className="w-full max-w-md rounded-2xl border border-border bg-card/90 p-7 shadow-2xl shadow-primary/10 backdrop-blur-xl">
          <div className="mb-6 text-center">
            <img src={flowtixLogo} alt="Flowtix" className="mx-auto mb-3 h-12 w-12 rounded-xl" />
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-600 dark:text-amber-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              {lang === "ar" ? "دخول السوبر أدمن" : "Super admin sign-in"}
            </div>
            <h1 className="text-2xl font-bold text-foreground">{lang === "ar" ? "لوحة الإدارة" : "Admin Panel"}</h1>
          </div>

          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">{lang === "ar" ? "البريد الإلكتروني" : "Email"}</label>
              <div className="relative">
                <Mail className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  required
                  autoComplete="username"
                  dir="ltr"
                  className="w-full rounded-xl border border-input bg-background px-4 py-3 ps-10 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  placeholder="admin@example.com"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">{lang === "ar" ? "كلمة المرور" : "Password"}</label>
              <div className="relative">
                <Lock className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  dir="ltr"
                  className="w-full rounded-xl border border-input bg-background px-4 py-3 ps-10 pe-11 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? (lang === "ar" ? "إخفاء كلمة المرور" : "Hide password") : (lang === "ar" ? "إظهار كلمة المرور" : "Show password")}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {loginError && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loginLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loginLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {lang === "ar" ? "دخول لوحة الإدارة" : "Enter admin panel"}
            </button>
          </form>
        </div>
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
              navigate({ to: "/admin" });
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
            {(() => {
              const fullName = (profile?.full_name ?? (user.user_metadata as any)?.full_name ?? "").trim();
              const displayName = fullName || (user.email?.split("@")[0] ?? "Admin");
              const firstName = displayName.split(" ")[0];
              const initials = (fullName || user.email || "A")
                .split(/\s+/)
                .map((p: string) => p[0])
                .slice(0, 2)
                .join("")
                .toUpperCase();
              const greeting = lang === "ar" ? `مرحبًا، ${firstName}` : `Hi, ${firstName}`;
              const avatarUrl = (profile?.avatar_url as string | undefined) ?? undefined;
              const menuItems: { to: AdminPath; icon: typeof UserIcon; ar: string; en: string }[] = [
                { to: "/admin/profile", icon: UserIcon, ar: "الملف الشخصي", en: "Profile" },
                { to: "/admin/profile", icon: Settings, ar: "إعدادات الحساب", en: "Account settings" },
                { to: "/admin/profile", icon: KeyRound, ar: "تغيير كلمة المرور", en: "Change password" },
                { to: "/admin/notifications", icon: Bell, ar: "الإشعارات", en: "Notifications" },
              ];
              return (
                <div className="relative" ref={menuRef}>
                  <button
                    onClick={() => setMenuOpen((v) => !v)}
                    className="flex items-center gap-2 ps-1 pe-2 md:pe-3 py-1 rounded-full bg-gradient-to-r from-amber-500/10 to-primary/10 border border-amber-500/20 hover:from-amber-500/20 hover:to-primary/20 transition"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    title={lang === "ar" ? "حسابي" : "My account"}
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={displayName} className="h-8 w-8 rounded-full object-cover ring-2 ring-amber-500/30" />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground text-xs font-bold ring-2 ring-amber-500/30">
                        {initials || "A"}
                      </div>
                    )}
                    <div className="hidden md:flex flex-col items-start leading-tight">
                      <span className="text-xs font-bold text-foreground truncate max-w-[140px]">{greeting}</span>
                      <span className="text-[10px] text-muted-foreground truncate max-w-[140px]" dir="ltr">{user.email}</span>
                    </div>
                    <ChevronDown className={`hidden md:block h-3.5 w-3.5 text-muted-foreground transition ${menuOpen ? "rotate-180" : ""}`} />
                  </button>

                  {menuOpen && (
                    <div
                      role="menu"
                      className={`absolute mt-2 w-64 rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10 backdrop-blur-xl overflow-hidden z-50 ${dir === "rtl" ? "start-0" : "end-0"}`}
                    >
                      <div className="p-4 bg-gradient-to-br from-amber-500/10 to-primary/10 border-b border-border">
                        <div className="flex items-center gap-3">
                          {avatarUrl ? (
                            <img src={avatarUrl} alt={displayName} className="h-11 w-11 rounded-full object-cover ring-2 ring-amber-500/30" />
                          ) : (
                            <div className="h-11 w-11 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground text-sm font-bold ring-2 ring-amber-500/30">
                              {initials || "A"}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-foreground truncate">{displayName}</div>
                            <div className="text-[11px] text-muted-foreground truncate" dir="ltr">{user.email}</div>
                            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                              <ShieldCheck className="h-3 w-3" />
                              {lang === "ar" ? "سوبر أدمن" : "Super admin"}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="p-1.5">
                        {menuItems.map((item) => (
                          <Link
                            key={`${item.to}-${item.en}`}
                            to={item.to}
                            onClick={() => setMenuOpen(false)}
                            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-foreground hover:bg-muted transition"
                            role="menuitem"
                          >
                            <item.icon className="h-4 w-4 text-muted-foreground" />
                            <span>{lang === "ar" ? item.ar : item.en}</span>
                          </Link>
                        ))}
                        <div className="my-1 border-t border-border" />
                        <button
                          onClick={async () => {
                            setMenuOpen(false);
                            await signOut();
                            navigate({ to: "/" });
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition"
                          role="menuitem"
                        >
                          <LogOut className="h-4 w-4" />
                          <span>{lang === "ar" ? "تسجيل الخروج" : "Sign out"}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 max-w-[1600px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
