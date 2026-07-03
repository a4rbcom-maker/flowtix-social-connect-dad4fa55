import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Sparkles,
  Save,
  Loader2,
  Plus,
  X,
  ThumbsUp,
  ThumbsDown,
  Clock,
  Zap,
  Brain,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

import { toast } from "sonner";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useI18n } from "@/lib/i18n";
import {
  getAiSettings,
  saveAiSettings,
  listAiLogs,
  rateAiLog,
  listAvailableModelTiers,
  type WaAiSettings,
} from "@/lib/wa-chat.functions";

export const Route = createFileRoute("/dashboard/whatsapp/bot")({
  ssr: false,
  component: BotPage,
});

type TierKey = "simple" | "smart" | "negotiation";

function BotPage() {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const getFn = useServerFn(getAiSettings);
  const saveFn = useServerFn(saveAiSettings);
  const logsFn = useServerFn(listAiLogs);
  const rateFn = useServerFn(rateAiLog);
  const tiersFn = useServerFn(listAvailableModelTiers);

  const tiersQ = useQuery({ queryKey: ["wa-ai-tiers"], queryFn: () => tiersFn() });

  const settingsQ = useQuery<WaAiSettings>({
    queryKey: ["wa-ai-settings"],
    queryFn: () => getFn(),
  });

  const logsQ = useQuery({
    queryKey: ["wa-ai-logs"],
    queryFn: () => logsFn(),
    refetchInterval: 30000,
  });

  const [form, setForm] = useState<WaAiSettings | null>(null);
  const [newPhone, setNewPhone] = useState("");
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsVisible, setLogsVisible] = useState(10);


  useEffect(() => {
    if (settingsQ.data && !form) setForm(settingsQ.data);
  }, [settingsQ.data, form]);

  const saveMut = useMutation({
    mutationFn: (data: WaAiSettings) => saveFn({ data }),
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم الحفظ" : "Settings saved");
      qc.invalidateQueries({ queryKey: ["wa-ai-settings"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rateMut = useMutation({
    mutationFn: (vars: { id: string; rating: number }) => rateFn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-ai-logs"] }),
  });

  const t = lang === "ar"
    ? {
        title: "وكيل AI لواتساب",
        subtitle: "ردود تلقائية ذكية على رسائل عملاءك على مدار الساعة.",
        enable: "تفعيل وكيل AI",
        enableDesc: "لما يبقى مُفعّل، الـ AI يرد تلقائياً على الرسائل الجديدة.",
        model: "موديل الذكاء الاصطناعي",
        modelDesc: "اختر السرعة مقابل الجودة.",
        systemPrompt: "تعليمات النظام (Personality)",
        systemPromptPh: "أنت موظف خدمة عملاء لشركة [الاسم]. ردودك مختصرة ومهذبة، وباللهجة المصرية…",
        welcome: "رسالة الترحيب",
        welcomeDesc: "تُرسل تلقائياً لأول رسالة من عميل جديد. اتركها فارغة لتعطيلها.",
        welcomePh: "أهلاً بك في [الشركة] 👋 ازاي نقدر نساعدك؟",
        kb: "قاعدة المعرفة",
        kbDesc: "نصوص/أسئلة شائعة يستخدمها الـ AI كمرجع.",
        kbPh: "ساعات العمل: 9 صباحاً - 6 مساءً.\nالشحن مجاني لطلبات أكثر من 500 جنيه.\n…",
        workHours: "ساعات العمل فقط",
        workHoursDesc: "الرد فقط في الفترة المحددة.",
        startTime: "بداية",
        endTime: "نهاية",
        blacklist: "قائمة سوداء",
        blacklistDesc: "أرقام لن يرد عليها الـ AI (يقدر يردّ عليها بنفسك).",
        addPhone: "إضافة رقم",
        maxContext: "عدد رسائل السياق",
        maxContextDesc: "كم رسالة سابقة تُرسل للـ AI كسياق.",
        delay: "تأخير الرد (ثواني)",
        delayDesc: "تأخير اختياري قبل الرد لمحاكاة شخص حقيقي.",
        save: "حفظ الإعدادات",
        logs: "سجل ردود AI",
        logsEmpty: "ما فيش ردود بعد. شغّل الـ AI واستنى أول رسالة.",
        rate: "تقييم الرد",
        ms: "م.ث",
        showLogs: "عرض السجل",
        hideLogs: "إخفاء السجل",
        loadMore: "عرض 10 إضافية",
        shown: "معروض",

      }
    : {
        title: "WhatsApp AI Agent",
        subtitle: "Smart auto-replies for your customers around the clock.",
        enable: "Enable AI Agent",
        enableDesc: "When on, AI will auto-reply to incoming messages.",
        model: "AI Model",
        modelDesc: "Choose speed vs. quality.",
        systemPrompt: "System Prompt (Personality)",
        systemPromptPh: "You are a customer support agent for [Company]. Reply concisely, politely…",
        welcome: "Welcome Message",
        welcomeDesc: "Sent automatically on a new customer's first message. Leave empty to disable.",
        welcomePh: "Welcome to [Company] 👋 How can we help?",
        kb: "Knowledge Base",
        kbDesc: "FAQs / context the AI can reference.",
        kbPh: "Business hours: 9am - 6pm.\nFree shipping over $50.\n…",
        workHours: "Working hours only",
        workHoursDesc: "Reply only during the specified window.",
        startTime: "Start",
        endTime: "End",
        blacklist: "Blacklist",
        blacklistDesc: "Phone numbers the AI will NOT reply to.",
        addPhone: "Add number",
        maxContext: "Context messages",
        maxContextDesc: "How many previous messages to include as context.",
        delay: "Reply delay (seconds)",
        delayDesc: "Optional delay before replying, to feel more human.",
        save: "Save Settings",
        logs: "AI Reply Log",
        logsEmpty: "No replies yet. Enable AI and wait for the first message.",
        rate: "Rate reply",
        ms: "ms",
      };

  if (!form) {
    return (
      <DashboardLayout title={t.title}>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  const update = (patch: Partial<WaAiSettings>) => setForm({ ...form, ...patch });
  const toggleAiEnabled = (enabled: boolean) => {
    const next = { ...form, ai_enabled: enabled };
    setForm(next);
    saveMut.mutate(next);
  };

  return (
    <DashboardLayout title={t.title}>
      <div className="mx-auto max-w-4xl space-y-5">
        {/* Header card */}
        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-white shadow-lg">
              <Bot className="h-6 w-6" strokeWidth={2.5} />
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold">{t.title}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">{t.subtitle}</p>
            </div>
            <label className="relative inline-flex shrink-0 cursor-pointer items-center">
              <input
                type="checkbox"
                checked={form.ai_enabled}
                onChange={(e) => toggleAiEnabled(e.target.checked)}
                disabled={saveMut.isPending}
                className="peer sr-only"
              />
              <div className="h-7 w-12 rounded-full bg-muted transition peer-checked:bg-primary" />
              <div className="absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ltr:left-1 rtl:right-1 peer-checked:ltr:translate-x-5 peer-checked:rtl:-translate-x-5" />
            </label>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{t.enableDesc}</p>
        </div>

        {/* Model tiers + Personality */}
        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <SectionTitle icon={Brain} label={t.model} desc={t.modelDesc} />
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {(["simple", "smart", "negotiation"] as TierKey[]).map((tier) => {
              const opts = (tiersQ.data?.rows ?? []).filter((r) => r.tier === tier);
              const field = `ai_tier_${tier}` as const;
              const tierLabel = lang === "ar"
                ? { simple: "بسيط (FAQ)", smart: "ذكي (ردود عامة)", negotiation: "تفاوض (مبيعات)" }[tier]
                : { simple: "Simple (FAQ)", smart: "Smart (General)", negotiation: "Negotiation (Sales)" }[tier];
              return (
                <div key={tier}>
                  <label className="text-xs font-medium text-muted-foreground">{tierLabel}</label>
                  <select
                    value={form[field] ?? ""}
                    onChange={(e) => update({ [field]: e.target.value || null } as Partial<WaAiSettings>)}
                    disabled={!tiersQ.data}
                    className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary disabled:opacity-50"
                  >
                    <option value="">{lang === "ar" ? "— اختر موديل —" : "— Select model —"}</option>
                    {opts.map((m) => (
                      <option key={`${m.tier}-${m.model_name}`} value={m.model_name}>
                        {lang === "ar" ? m.display_name_ar : m.display_name_en}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          <div className="mt-5">
            <SectionTitle label={t.systemPrompt} />
            <textarea
              value={form.ai_system_prompt}
              onChange={(e) => update({ ai_system_prompt: e.target.value })}
              rows={5}
              placeholder={t.systemPromptPh}
              className="mt-2 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="mt-5">
            <SectionTitle label={t.welcome} desc={t.welcomeDesc} />
            <textarea
              value={form.ai_welcome_message}
              onChange={(e) => update({ ai_welcome_message: e.target.value })}
              rows={2}
              placeholder={t.welcomePh}
              className="mt-2 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="mt-5">
            <SectionTitle label={t.kb} desc={t.kbDesc} />
            <textarea
              value={form.ai_knowledge_base}
              onChange={(e) => update({ ai_knowledge_base: e.target.value })}
              rows={6}
              placeholder={t.kbPh}
              className="mt-2 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {form.ai_knowledge_base.length} / 20000
            </p>
          </div>
        </div>

        {/* Behavior */}
        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <SectionTitle icon={Clock} label={t.workHours} desc={t.workHoursDesc} />
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={form.ai_business_hours_only}
              onChange={(e) => update({ ai_business_hours_only: e.target.checked })}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            <span className="text-sm">{t.workHours}</span>
          </label>
          {form.ai_business_hours_only && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">{t.startTime}</label>
                <input
                  type="time"
                  value={form.ai_working_hours_start ?? "09:00"}
                  onChange={(e) => update({ ai_working_hours_start: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t.endTime}</label>
                <input
                  type="time"
                  value={form.ai_working_hours_end ?? "18:00"}
                  onChange={(e) => update({ ai_working_hours_end: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <SectionTitle label={t.maxContext} desc={t.maxContextDesc} />
              <input
                type="number"
                min={2}
                max={30}
                value={form.ai_max_context_messages}
                onChange={(e) => update({ ai_max_context_messages: Number(e.target.value) || 10 })}
                className="mt-2 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <SectionTitle label={t.delay} desc={t.delayDesc} />
              <input
                type="number"
                min={0}
                max={60}
                value={form.ai_reply_delay_seconds}
                onChange={(e) => update({ ai_reply_delay_seconds: Number(e.target.value) || 0 })}
                className="mt-2 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="mt-5">
            <SectionTitle label={t.blacklist} desc={t.blacklistDesc} />
            <div className="mt-3 flex gap-2">
              <input
                type="tel"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="201234567890"
                className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => {
                  const cleaned = newPhone.replace(/[^0-9]/g, "");
                  if (cleaned.length < 6) return;
                  if (form.ai_blacklist.includes(cleaned)) return;
                  update({ ai_blacklist: [...form.ai_blacklist, cleaned] });
                  setNewPhone("");
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-muted px-3 text-sm font-semibold hover:bg-muted/80"
              >
                <Plus className="h-4 w-4" /> {t.addPhone}
              </button>
            </div>
            {form.ai_blacklist.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {form.ai_blacklist.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs"
                    dir="ltr"
                  >
                    +{p}
                    <button
                      type="button"
                      onClick={() =>
                        update({ ai_blacklist: form.ai_blacklist.filter((x) => x !== p) })
                      }
                      className="opacity-60 hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Save button */}
        <div className="sticky bottom-4 z-10 flex justify-end">
          <button
            type="button"
            onClick={() => saveMut.mutate(form)}
            disabled={saveMut.isPending}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] px-5 text-sm font-semibold text-primary-foreground shadow-lg hover:opacity-95 disabled:opacity-60"
          >
            {saveMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t.save}
          </button>
        </div>

        {/* Logs */}
        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <SectionTitle icon={Sparkles} label={t.logs} />
          {logsQ.isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !logsQ.data || logsQ.data.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t.logsEmpty}</p>
          ) : (
            <ul className="mt-3 divide-y divide-border/40">
              {logsQ.data.map((log) => (
                <li key={log.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-semibold" dir="ltr">
                          {log.remote_jid.replace(/@.*/, "")}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          {log.model.split("/").pop()}
                        </span>
                        {log.latency_ms && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                            <Zap className="h-3 w-3" /> {log.latency_ms} {t.ms}
                          </span>
                        )}
                        {log.status === "error" && (
                          <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                            error
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 truncate text-xs text-muted-foreground">
                        ❯ {log.prompt_excerpt}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed">
                        {log.response_text || log.error_message || "—"}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => rateMut.mutate({ id: log.id, rating: 1 })}
                        className={`flex h-7 w-7 items-center justify-center rounded-lg hover:bg-muted ${
                          log.rating === 1 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "text-muted-foreground"
                        }`}
                        aria-label="good"
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => rateMut.mutate({ id: log.id, rating: -1 })}
                        className={`flex h-7 w-7 items-center justify-center rounded-lg hover:bg-muted ${
                          log.rating === -1 ? "bg-destructive/15 text-destructive" : "text-muted-foreground"
                        }`}
                        aria-label="bad"
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function SectionTitle({
  icon: Icon,
  label,
  desc,
}: {
  icon?: typeof Bot;
  label: string;
  desc?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-primary" />}
        <h2 className="text-sm font-bold">{label}</h2>
      </div>
      {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
    </div>
  );
}
