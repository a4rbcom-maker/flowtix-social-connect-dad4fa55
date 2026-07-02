import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Facebook,
  MessageCircle,
  Bot,
  Send,
  Users,
  FileText,
  Loader2,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Sparkles,
  Key,
  Zap,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard")({
  ssr: false,
  component: DashboardRouteShell,
});

interface ConnectionStatus {
  facebook: { connected: boolean; name?: string | null };
  whatsapp: { connected: boolean; type?: string | null; ai_enabled?: boolean };
}

function DashboardRouteShell() {
  const location = useLocation();
  return location.pathname === "/dashboard" ? <DashboardOverview /> : <Outlet />;
}

function DashboardOverview() {
  const { user, loading: authLoading } = useAuth();
  const { lang } = useI18n();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Tables<"profiles"> | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>({
    facebook: { connected: false },
    whatsapp: { connected: false },
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      try {
        const [{ data: prof }, { data: fb }, { data: wa }] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
          supabase
            .from("facebook_connections")
            .select("fb_user_name")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase
            .from("whatsapp_settings")
            .select("is_connected, connection_type, ai_enabled")
            .eq("user_id", user.id)
            .maybeSingle(),
        ]);
        setProfile(prof);
        setStatus({
          facebook: { connected: !!fb, name: fb?.fb_user_name },
          whatsapp: {
            connected: !!wa?.is_connected,
            type: wa?.connection_type,
            ai_enabled: !!wa?.ai_enabled,
          },
        });
      } catch (error) {
        console.warn("[dashboard] failed to load overview", error);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  const t = lang === "ar"
    ? {
        title: "نظرة عامة",
        welcome: "مرحباً",
        subtitle: "ابدأ بربط حساباتك واستثمر تلقائياً في جروبات فيسبوك وعملاء واتساب",
        plan: "الخطة",
        connections: "حالة الاتصالات",
        connected: "متصل",
        notConnected: "غير متصل",
        facebook: "فيسبوك",
        facebookDesc: "اربط حسابك عبر User Access Token لجلب جروباتك وصفحاتك",
        whatsapp: "واتساب بوت",
        whatsappDesc: "اضبط Meta Cloud API أو QR وفعّل الردّ التلقائي بالذكاء الاصطناعي",
        aiAssistant: "مساعد AI",
        aiOn: "مفعّل",
        aiOff: "متوقف",
        connectNow: "اربط الآن",
        manage: "إدارة",
        configure: "إعداد",
        quickActions: "إجراءات سريعة",
        connectFb: "ربط فيسبوك بالتوكن",
        connectFbDesc: "الصق User Access Token من Graph Explorer",
        setupWa: "إعداد واتساب بوت",
        setupWaDesc: "Meta API أو QR Code مع AI",
        bulkSend: "إرسال جماعي",
        bulkSendDesc: "أرسل رسائل لقوائم جهات اتصالك",
        bulkSendSoon: "قريباً",
        groups: "الجروبات",
        pages: "الصفحات",
        contacts: "جهات الاتصال",
        messages: "الرسائل",
        gettingStarted: "ابدأ خلال 3 خطوات",
        step1: "أنشئ حسابك",
        step1Desc: "سجّل دخولك (تم ✓)",
        step2: "اربط فيسبوك",
        step2Desc: "الصق User Access Token من Graph API Explorer",
        step3: "فعّل واتساب AI",
        step3Desc: "اربط رقمك واترك الـ AI يردّ على عملائك",
        done: "تم",
        todo: "قيد التنفيذ",
      }
    : {
        title: "Overview",
        welcome: "Welcome",
        subtitle: "Connect your accounts and start automating Facebook groups and WhatsApp customers",
        plan: "Plan",
        connections: "Connection Status",
        connected: "Connected",
        notConnected: "Not Connected",
        facebook: "Facebook",
        facebookDesc: "Link your account via User Access Token to load groups and pages",
        whatsapp: "WhatsApp Bot",
        whatsappDesc: "Configure Meta Cloud API or QR and enable AI auto-reply",
        aiAssistant: "AI Assistant",
        aiOn: "Enabled",
        aiOff: "Disabled",
        connectNow: "Connect Now",
        manage: "Manage",
        configure: "Configure",
        quickActions: "Quick Actions",
        connectFb: "Connect Facebook with Token",
        connectFbDesc: "Paste a User Access Token from Graph Explorer",
        setupWa: "Set Up WhatsApp Bot",
        setupWaDesc: "Meta API or QR Code with AI",
        bulkSend: "Bulk Send",
        bulkSendDesc: "Send messages to your contact lists",
        bulkSendSoon: "Coming soon",
        groups: "Groups",
        pages: "Pages",
        contacts: "Contacts",
        messages: "Messages",
        gettingStarted: "Get started in 3 steps",
        step1: "Create your account",
        step1Desc: "Sign in (done ✓)",
        step2: "Connect Facebook",
        step2Desc: "Paste a User Access Token from Graph API Explorer",
        step3: "Enable WhatsApp AI",
        step3Desc: "Link your number and let AI reply to customers",
        done: "Done",
        todo: "Pending",
      };

  if (authLoading || loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const displayName =
    profile?.full_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "";
  const plan = profile?.plan || "free";

  const stats = [
    { label: t.groups, value: "0", icon: Users, color: "from-primary to-[oklch(0.66_0.26_320)]" },
    { label: t.pages, value: "0", icon: FileText, color: "from-blue-500 to-cyan-500" },
    { label: t.contacts, value: "0", icon: MessageCircle, color: "from-green-500 to-emerald-500" },
    { label: t.messages, value: "0", icon: Send, color: "from-orange-500 to-amber-500" },
  ];

  const steps = [
    { num: 1, title: t.step1, desc: t.step1Desc, done: true, link: null },
    { num: 2, title: t.step2, desc: t.step2Desc, done: status.facebook.connected, link: "/dashboard/facebook" as const },
    { num: 3, title: t.step3, desc: t.step3Desc, done: status.whatsapp.connected && status.whatsapp.ai_enabled, link: "/dashboard/whatsapp" as const },
  ];

  return (
    <DashboardLayout title={t.title}>
      <div className="space-y-6">
        {/* Welcome banner */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/10 via-card to-[oklch(0.66_0.26_320)]/10 p-6">
          <div className="absolute -end-10 -top-10 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-foreground">
                {t.welcome}، {displayName} 👋
              </h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t.subtitle}</p>
            </div>
            <div className="rounded-xl border border-primary/30 bg-card/60 px-4 py-2 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{t.plan}</p>
              <p className="text-base font-bold capitalize text-primary">{plan}</p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={i}
                className="rounded-2xl border border-border/50 bg-card p-5 transition-all hover:border-primary/30 hover:shadow-lg"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">{s.label}</p>
                  <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br ${s.color} text-white shadow-md`}>
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-3 text-3xl font-bold text-foreground">{s.value}</p>
              </div>
            );
          })}
        </div>

        {/* Connections status */}
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t.connections}
          </h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Facebook */}
            <div className="rounded-2xl border border-border/50 bg-card p-6 transition-all hover:shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-white shadow-md">
                    <Facebook className="h-6 w-6" strokeWidth={2.5} />
                  </div>
                  <div>
                    <h4 className="font-bold text-foreground">{t.facebook}</h4>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t.facebookDesc}</p>
                  </div>
                </div>
                <StatusBadge connected={status.facebook.connected} t={t} />
              </div>
              {status.facebook.connected && status.facebook.name && (
                <p className="mt-3 truncate rounded-lg bg-muted/50 px-3 py-2 text-xs text-foreground">
                  {status.facebook.name}
                </p>
              )}
              <Link
                to="/dashboard/facebook"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:gap-2"
              >
                {status.facebook.connected ? t.manage : t.connectNow} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Link>
            </div>

            {/* WhatsApp */}
            <div className="rounded-2xl border border-border/50 bg-card p-6 transition-all hover:shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-md">
                    <MessageCircle className="h-6 w-6" strokeWidth={2.5} />
                  </div>
                  <div>
                    <h4 className="font-bold text-foreground">{t.whatsapp}</h4>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t.whatsappDesc}</p>
                  </div>
                </div>
                <StatusBadge connected={status.whatsapp.connected} t={t} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {status.whatsapp.type && (
                  <span className="rounded-md bg-muted/50 px-2 py-1 text-xs font-medium text-foreground">
                    {status.whatsapp.type === "meta_api" ? "Meta API" : "QR Code"}
                  </span>
                )}
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
                    status.whatsapp.ai_enabled
                      ? "bg-primary/10 text-primary"
                      : "bg-muted/50 text-muted-foreground"
                  }`}
                >
                  <Bot className="h-3 w-3" /> {t.aiAssistant}: {status.whatsapp.ai_enabled ? t.aiOn : t.aiOff}
                </span>
              </div>
              <Link
                to="/dashboard/whatsapp"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:gap-2"
              >
                {status.whatsapp.connected ? t.manage : t.configure} <ArrowRight className="h-4 w-4 rtl:rotate-180" />
              </Link>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t.quickActions}
          </h3>
          <div className="grid gap-4 md:grid-cols-3">
            <QuickAction
              icon={Key}
              title={t.connectFb}
              desc={t.connectFbDesc}
              to="/dashboard/facebook"
              gradient="from-primary to-[oklch(0.66_0.26_320)]"
            />
            <QuickAction
              icon={Zap}
              title={t.setupWa}
              desc={t.setupWaDesc}
              to="/dashboard/whatsapp"
              gradient="from-green-500 to-emerald-600"
            />
            <QuickAction
              icon={Send}
              title={t.bulkSend}
              desc={t.bulkSendDesc}
              to="/dashboard"
              gradient="from-orange-500 to-amber-500"
              badge={t.bulkSendSoon}
            />
          </div>
        </div>

        {/* Getting started */}
        <div className="rounded-2xl border border-border/50 bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-bold text-foreground">{t.gettingStarted}</h3>
          </div>
          <ol className="space-y-3">
            {steps.map((step) => {
              const inner = (
                <div
                  className={`flex items-start gap-4 rounded-xl border p-4 transition-all ${
                    step.done
                      ? "border-green-500/30 bg-green-500/5"
                      : "border-border/50 bg-background hover:border-primary/30 hover:bg-primary/5"
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      step.done
                        ? "bg-green-500 text-white"
                        : "bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-white shadow-md"
                    }`}
                  >
                    {step.done ? <CheckCircle2 className="h-5 w-5" /> : step.num}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">{step.title}</h4>
                    <p className="mt-0.5 text-sm text-muted-foreground">{step.desc}</p>
                  </div>
                  {step.link && !step.done && (
                    <ArrowRight className="mt-2 h-5 w-5 shrink-0 text-primary rtl:rotate-180" />
                  )}
                </div>
              );
              return (
                <li key={step.num}>
                  {step.link ? (
                    <Link to={step.link} className="block">
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {/* Activity placeholder */}
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
          <TrendingUp className="mx-auto h-10 w-10 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            {lang === "ar"
              ? "لا يوجد نشاط بعد — سيظهر هنا بعد ربط حساباتك وإرسال أول رسالة."
              : "No activity yet — it will appear here once you connect accounts and send your first message."}
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}

function StatusBadge({ connected, t }: { connected: boolean; t: { connected: string; notConnected: string } }) {
  return connected ? (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-600 dark:text-green-400">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
      {t.connected}
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
      <XCircle className="h-3 w-3" />
      {t.notConnected}
    </span>
  );
}

function QuickAction({
  icon: Icon,
  title,
  desc,
  to,
  gradient,
  badge,
}: {
  icon: typeof Key;
  title: string;
  desc: string;
  to: "/dashboard" | "/dashboard/facebook" | "/dashboard/whatsapp";
  gradient: string;
  badge?: string;
}) {
  return (
    <Link
      to={to}
      className="group relative overflow-hidden rounded-2xl border border-border/50 bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
    >
      {badge && (
        <span className="absolute end-3 top-3 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
          {badge}
        </span>
      )}
      <div className={`mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-md`}>
        <Icon className="h-5 w-5" strokeWidth={2.5} />
      </div>
      <h4 className="font-semibold text-foreground">{title}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
      <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
        <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
      </div>
    </Link>
  );
}
