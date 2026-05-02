import { useState, useEffect, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Facebook,
  MessageCircle,
  Bot,
  Send,
  Settings,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
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
  // Sidebar visibility: on desktop start open; on mobile start closed.
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  // Auto-close sidebar on mobile when route changes (prevents the menu
  // from staying on top of the page after a navigation tap).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 768px)").matches) {
      setSidebarOpen(false);
    }
  }, [location.pathname]);

  const labels = lang === "ar"
    ? { overview: "نظرة عامة", facebook: "فيسبوك", whatsapp: "واتساب بوت", whatsappAI: "واتساب AI", bulkSend: "إرسال جماعي", settings: "الإعدادات", logout: "تسجيل الخروج" }
    : { overview: "Overview", facebook: "Facebook", whatsapp: "WhatsApp Bot", whatsappAI: "WhatsApp AI", bulkSend: "Bulk Send", settings: "Settings", logout: "Sign Out" };

  const menu = [
    { icon: LayoutDashboard, label: labels.overview, to: "/dashboard" as const },
    { icon: Facebook, label: labels.facebook, to: "/dashboard/facebook" as const },
    { icon: MessageCircle, label: labels.whatsapp, to: "/dashboard/whatsapp" as const },
    { icon: Bot, label: labels.whatsappAI, to: "/dashboard/whatsapp" as const },
    { icon: Send, label: labels.bulkSend, to: "/dashboard" as const },
    { icon: Settings, label: labels.settings, to: "/dashboard" as const },
  ];

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
            const active = location.pathname === item.to;
            const Icon = item.icon;
            return (
              <Link
                key={i}
                to={item.to}
                onClick={() => {
                  if (typeof window !== "undefined" && !window.matchMedia("(min-width: 768px)").matches) {
                    setSidebarOpen(false);
                  }
                }}
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
