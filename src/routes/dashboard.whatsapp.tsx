import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MessageCircle, Bot, QrCode, Loader2, Save, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/whatsapp")({
  component: WhatsAppPage,
});

type WaSettings = Tables<"whatsapp_settings">;

function WhatsAppPage() {
  const { user, loading: authLoading } = useAuth();
  const { lang } = useI18n();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"meta" | "qr" | "ai">("meta");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Partial<WaSettings>>({
    connection_type: "meta_api",
    ai_enabled: false,
    ai_model: "google/gemini-2.5-flash",
  });

  const t = lang === "ar"
    ? {
        title: "إعدادات واتساب بوت",
        subtitle: "اختر طريقة الربط وفعّل الرد التلقائي بالذكاء الاصطناعي",
        metaApi: "Meta API (رسمي)",
        qrCode: "QR Code (سكان)",
        ai: "ذكاء اصطناعي",
        phoneId: "Phone Number ID",
        accessToken: "Access Token",
        businessId: "Business Account ID",
        verifyToken: "Verify Token (Webhook)",
        save: "حفظ الإعدادات",
        saving: "جاري الحفظ...",
        saved: "تم الحفظ ✓",
        qrSoon: "ميزة QR Code قيد التطوير — تحتاج خادم دائم التشغيل لجلسات WhatsApp Web. سنوفّرها قريباً.",
        aiEnabled: "تفعيل الرد التلقائي",
        aiEnabledDesc: "اسمح للذكاء الاصطناعي بالرد على عملائك تلقائياً",
        model: "النموذج",
        systemPrompt: "تعليمات النظام (System Prompt)",
        systemPromptPh: "أنت مساعد ذكي لمتجر... رد على العملاء بطريقة ودودة باللهجة المصرية...",
        welcome: "رسالة الترحيب",
        welcomePh: "أهلاً بيك! 👋 أنا المساعد الذكي للمتجر، إزاي أقدر أساعدك؟",
        bizHours: "الرد في ساعات العمل فقط",
        metaHelp: "احصل على هذه البيانات من Meta Business Manager → WhatsApp → API Setup",
      }
    : {
        title: "WhatsApp Bot Settings",
        subtitle: "Choose your connection method and enable AI auto-reply",
        metaApi: "Meta API (Official)",
        qrCode: "QR Code (Scan)",
        ai: "AI Assistant",
        phoneId: "Phone Number ID",
        accessToken: "Access Token",
        businessId: "Business Account ID",
        verifyToken: "Verify Token (Webhook)",
        save: "Save Settings",
        saving: "Saving...",
        saved: "Saved ✓",
        qrSoon: "QR Code feature is under development — requires a persistent server for WhatsApp Web sessions. Coming soon.",
        aiEnabled: "Enable AI Auto-Reply",
        aiEnabledDesc: "Let AI respond to your customers automatically",
        model: "Model",
        systemPrompt: "System Prompt",
        systemPromptPh: "You are a helpful store assistant. Reply to customers in a friendly tone...",
        welcome: "Welcome Message",
        welcomePh: "Hi there! 👋 I'm the store's AI assistant, how can I help you?",
        bizHours: "Reply during business hours only",
        metaHelp: "Get these from Meta Business Manager → WhatsApp → API Setup",
      };

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("whatsapp_settings")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) setSettings(data);
      setLoading(false);
    })();
  }, [user]);

  const update = <K extends keyof WaSettings>(key: K, value: WaSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const payload = {
        user_id: user.id,
        connection_type: settings.connection_type ?? "meta_api",
        meta_phone_number_id: settings.meta_phone_number_id ?? null,
        meta_access_token: settings.meta_access_token ?? null,
        meta_business_account_id: settings.meta_business_account_id ?? null,
        meta_verify_token: settings.meta_verify_token ?? null,
        ai_enabled: settings.ai_enabled ?? false,
        ai_model: settings.ai_model ?? "google/gemini-2.5-flash",
        ai_system_prompt: settings.ai_system_prompt ?? null,
        ai_welcome_message: settings.ai_welcome_message ?? null,
        ai_business_hours_only: settings.ai_business_hours_only ?? false,
      };
      const { error } = await supabase
        .from("whatsapp_settings")
        .upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
      toast.success(t.saved);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const tabs = [
    { id: "meta" as const, icon: MessageCircle, label: t.metaApi },
    { id: "qr" as const, icon: QrCode, label: t.qrCode },
    { id: "ai" as const, icon: Bot, label: t.ai },
  ];

  return (
    <DashboardLayout title={t.title}>
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-white shadow-lg">
              <MessageCircle className="h-6 w-6" strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">{t.title}</h2>
              <p className="text-sm text-muted-foreground">{t.subtitle}</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex gap-1 rounded-xl bg-muted p-1">
            {tabs.map((tabItem) => {
              const Icon = tabItem.icon;
              return (
                <button
                  key={tabItem.id}
                  onClick={() => setTab(tabItem.id)}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    tab === tabItem.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tabItem.label}</span>
                </button>
              );
            })}
          </div>

          {/* Meta API tab */}
          {tab === "meta" && (
            <div className="space-y-4">
              <div className="rounded-xl bg-primary/5 p-4 text-sm text-muted-foreground">
                💡 {t.metaHelp}
              </div>
              <Field label={t.phoneId} value={settings.meta_phone_number_id ?? ""} onChange={(v) => update("meta_phone_number_id", v)} />
              <Field label={t.accessToken} type="password" value={settings.meta_access_token ?? ""} onChange={(v) => update("meta_access_token", v)} />
              <Field label={t.businessId} value={settings.meta_business_account_id ?? ""} onChange={(v) => update("meta_business_account_id", v)} />
              <Field label={t.verifyToken} value={settings.meta_verify_token ?? ""} onChange={(v) => update("meta_verify_token", v)} />
            </div>
          )}

          {/* QR placeholder */}
          {tab === "qr" && (
            <div className="rounded-xl border-2 border-dashed border-border bg-muted/30 p-12 text-center">
              <QrCode className="mx-auto mb-4 h-16 w-16 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{t.qrSoon}</p>
            </div>
          )}

          {/* AI tab */}
          {tab === "ai" && (
            <div className="space-y-4">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background p-4 hover:border-primary/30">
                <input
                  type="checkbox"
                  checked={settings.ai_enabled ?? false}
                  onChange={(e) => update("ai_enabled", e.target.checked)}
                  className="mt-1 h-5 w-5 accent-primary"
                />
                <div className="flex-1">
                  <p className="font-medium text-foreground">{t.aiEnabled}</p>
                  <p className="text-sm text-muted-foreground">{t.aiEnabledDesc}</p>
                </div>
                {settings.ai_enabled && <CheckCircle2 className="h-5 w-5 text-green-500" />}
              </label>

              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">{t.model}</label>
                <select
                  value={settings.ai_model ?? "google/gemini-2.5-flash"}
                  onChange={(e) => update("ai_model", e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="google/gemini-2.5-flash">Gemini 2.5 Flash (سريع)</option>
                  <option value="google/gemini-2.5-pro">Gemini 2.5 Pro (دقيق)</option>
                  <option value="google/gemini-2.5-flash-lite">Gemini 2.5 Flash Lite (أرخص)</option>
                  <option value="openai/gpt-5-mini">GPT-5 Mini</option>
                  <option value="openai/gpt-5">GPT-5</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">{t.systemPrompt}</label>
                <textarea
                  rows={4}
                  value={settings.ai_system_prompt ?? ""}
                  onChange={(e) => update("ai_system_prompt", e.target.value)}
                  placeholder={t.systemPromptPh}
                  className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">{t.welcome}</label>
                <textarea
                  rows={2}
                  value={settings.ai_welcome_message ?? ""}
                  onChange={(e) => update("ai_welcome_message", e.target.value)}
                  placeholder={t.welcomePh}
                  className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-background p-4 hover:border-primary/30">
                <input
                  type="checkbox"
                  checked={settings.ai_business_hours_only ?? false}
                  onChange={(e) => update("ai_business_hours_only", e.target.checked)}
                  className="h-5 w-5 accent-primary"
                />
                <span className="text-sm font-medium text-foreground">{t.bizHours}</span>
              </label>
            </div>
          )}

          {/* Save button (hide on QR tab) */}
          {tab !== "qr" && (
            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/30 transition-all hover:shadow-xl hover:shadow-primary/40 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? t.saving : t.save}
              </button>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-mono focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}
