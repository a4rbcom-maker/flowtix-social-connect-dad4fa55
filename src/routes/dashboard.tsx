import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import flowtixLogo from "@/assets/flowtix-logo.png";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { user, loading, signOut } = useAuth();
  const { t, lang, setLang, dir } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Tables<"profiles"> | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user) {
      supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single()
        .then(({ data }) => setProfile(data));
    }
  }, [user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  const labels = lang === "ar"
    ? {
        dashboard: "لوحة التحكم",
        welcome: "مرحباً",
        facebook: "فيسبوك",
        whatsapp: "واتساب",
        whatsappAI: "واتساب AI",
        bulkSend: "إرسال جماعي",
        settings: "الإعدادات",
        logout: "تسجيل الخروج",
        overview: "نظرة عامة",
        totalMessages: "إجمالي الرسائل",
        activeGroups: "الجروبات النشطة",
        contacts: "جهات الاتصال",
        pending: "في الانتظار",
        comingSoon: "قريباً — هذه الميزة قيد التطوير",
      }
    : {
        dashboard: "Dashboard",
        welcome: "Welcome",
        facebook: "Facebook",
        whatsapp: "WhatsApp",
        whatsappAI: "WhatsApp AI",
        bulkSend: "Bulk Send",
        settings: "Settings",
        logout: "Sign Out",
        overview: "Overview",
        totalMessages: "Total Messages",
        activeGroups: "Active Groups",
        contacts: "Contacts",
        pending: "Pending",
        comingSoon: "Coming Soon — This feature is under development",
      };

  const menuItems = [
    { icon: "📊", label: labels.overview, active: true },
    { icon: "📘", label: labels.facebook },
    { icon: "💬", label: labels.whatsapp },
    { icon: "🤖", label: labels.whatsappAI },
    { icon: "📨", label: labels.bulkSend },
    { icon: "⚙️", label: labels.settings },
  ];

  const stats = [
    { label: labels.totalMessages, value: "0", color: "from-primary to-blue-500" },
    { label: labels.activeGroups, value: "0", color: "from-green-500 to-emerald-500" },
    { label: labels.contacts, value: "0", color: "from-orange-500 to-amber-500" },
    { label: labels.pending, value: "0", color: "from-pink-500 to-rose-500" },
  ];

  const displayName = profile?.full_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "";

  return (
    <div dir={dir} className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={`fixed top-0 z-40 flex h-full flex-col border-border/50 bg-card transition-all ${
          dir === "rtl" ? "right-0 border-l" : "left-0 border-r"
        } ${sidebarOpen ? "w-64" : "w-16"}`}
      >
        <div className="flex items-center gap-2 border-b border-border/50 p-4">
          <img src={flowtixLogo} alt="Logo" width={32} height={32} className="h-8 w-8 shrink-0" />
          {sidebarOpen && (
            <span className="bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-lg font-bold text-transparent">
              Flowtix
            </span>
          )}
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {menuItems.map((item, i) => (
            <button
              key={i}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                item.active
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="border-t border-border/50 p-3">
          <button
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10"
          >
            <span className="text-lg">🚪</span>
            {sidebarOpen && <span>{labels.logout}</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className={`flex-1 transition-all ${sidebarOpen ? (dir === "rtl" ? "mr-64" : "ml-64") : (dir === "rtl" ? "mr-16" : "ml-16")}`}>
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-border/50 bg-card/50 px-6 py-3 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-muted-foreground hover:text-foreground">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <h1 className="text-lg font-semibold text-foreground">{labels.dashboard}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">
              {lang === "ar" ? "EN" : "عربي"}
            </button>
            <button onClick={toggleTheme} className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent">
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm font-medium text-foreground">{displayName}</span>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="p-6">
          <h2 className="mb-6 text-xl font-bold text-foreground">
            {labels.welcome}، {displayName}! 👋
          </h2>

          {/* Stats */}
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat, i) => (
              <div key={i} className="rounded-2xl border border-border/50 bg-card p-5">
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className={`mt-2 bg-gradient-to-r ${stat.color} bg-clip-text text-3xl font-bold text-transparent`}>
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          {/* Coming Soon */}
          <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-12 text-center">
            <div className="text-4xl">🚀</div>
            <p className="mt-4 text-lg font-medium text-foreground">{labels.comingSoon}</p>
          </div>
        </div>
      </main>
    </div>
  );
}
