import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import {
  KeyRound,
  Cookie,
  ShieldCheck,
  FileText,
  Users,
  Megaphone,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Loader2,
  ExternalLink,
  Sparkles,
  Info,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { getFacebookConnection } from "@/lib/facebook.functions";
import { listBotAccounts } from "@/lib/fb-bot.functions";
import { listGraphAccounts, fetchGraphPages } from "@/lib/fb-graph-publish.functions";
import { safeArray, safeObject } from "@/lib/safe-data";

export const Route = createFileRoute("/dashboard/facebook/onboarding")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.getSession();
  },
  component: OnboardingPage,
});


const ONBOARDING_DONE_KEY = "fb_onboarding_completed_v1";

type StepStatus = "todo" | "done";

function OnboardingPage() {
  const { user, loading } = useAuth();
  const { lang, dir } = useI18n();
  const navigate = useNavigate();
  const callFn = useServerFn as unknown as <T>(fn: T) => T;

  const [checking, setChecking] = useState(true);
  const [hasToken, setHasToken] = useState(false);
  const [hasCookies, setHasCookies] = useState(false);
  const [hasPages, setHasPages] = useState(false);
  const [fetchingPages, setFetchingPages] = useState(false);
  const [current, setCurrent] = useState(0);

  const isAr = lang === "ar";
  const t = isAr
    ? {
        title: "دليل البدء السريع",
        subtitle: "خطوات مرتبة لربط حسابك بشكل صحيح قبل تشغيل أول حملة",
        stepLabel: (n: number, total: number) => `الخطوة ${n} من ${total}`,
        next: "التالي",
        back: "السابق",
        skip: "تخطي الدليل",
        finish: "ابدأ أول حملة",
        goStep: "اذهب لهذه الخطوة",
        done: "مكتملة",
        pending: "لم تكتمل بعد",
        recheck: "إعادة الفحص",
        openConnect: "افتح صفحة الربط",
        fetchPages: "جلب الصفحات الآن",
        step1Title: "اختر طريقة الربط",
        step1Body:
          "قبل أي حملة، لازم يكون عندك اتصال بحسابك على فيسبوك. عندك طريقتين رسميتين:",
        methodTokenTitle: "طريقة التوكن (Access Token)",
        methodTokenDesc:
          "الأنسب للنشر على صفحاتك الخاصة عبر Graph API الرسمي. سريعة وأكثر استقراراً، ومناسبة لأصحاب صفحات الأعمال.",
        methodCookiesTitle: "طريقة الكوكيز (Bot Worker)",
        methodCookiesDesc:
          "للنشر داخل الجروبات واستخراج جهات الاطلاع من ماسنجر. تعتمد على جلسة متصفح حقيقية.",
        step2Title: "ربط الحساب داخل لوحة التحكم",
        step2Body:
          "اذهب لصفحة \"حساب فيسبوك\"، اختر طريقة واحدة فقط، اتبع التعليمات الظاهرة على الشاشة، ثم انتظر ظهور رسالة تأكيد الحفظ.",
        step2Note:
          "الفصل بين الطريقتين مهم — لا تربط الاثنين في نفس الوقت لتجنّب تعارض الحسابات.",
        step3Title: "التحقق أن الحساب جاهز",
        step3Body:
          "بعد الحفظ، سيظهر اسم صاحب الحساب وحالة الاتصال. لو ظهرت أي رسالة خطأ (SESSION_EXPIRED مثلاً) أعد استخراج الكوكيز أو جدّد التوكن قبل الاستمرار.",
        step4Title: "جلب الصفحات/الجروبات",
        step4Body:
          "لن تظهر أي صفحات أو جروبات في نموذج الحملة تلقائياً. اضغط زر \"جلب الصفحات\" (طريقة التوكن) أو \"جلب الجروبات\" (طريقة الكوكيز) لسحبها من فيسبوك وحفظها في حسابك.",
        step4Note:
          "يتم حفظ القائمة داخل النظام حتى لا تعيد الجلب في كل مرة، ولكن كرّر العملية عند إضافة صفحة/جروب جديد.",
        step5Title: "أنشئ أول حملة",
        step5Body:
          "اذهب لصفحة الحملات، اختر طريقة النشر (توكن أو بوت)، حدّد الوجهات، اكتب المنشور، ثم شغّل الحملة. سيبدأ النظام النشر مع فاصل زمني آمن.",
        step5Note:
          "ابدأ بحملة تجريبية على وجهة أو اثنتين للتأكد من ظهور المنشور بشكل صحيح قبل الحملات الكبيرة.",
        readinessTitle: "حالة جاهزيتك الحالية",
        readyToken: "التوكن مربوط",
        readyCookies: "كوكيز بوت مربوطة",
        readyPages: "الصفحات/الجروبات مجلوبة",
        allReady: "كل شيء جاهز — يمكنك بدء الحملة الآن.",
        notReady: "أكمل الخطوات المتبقية أولاً.",
      }
    : {
        title: "Quick-start guide",
        subtitle: "Ordered steps to connect your account correctly before running your first campaign",
        stepLabel: (n: number, total: number) => `Step ${n} of ${total}`,
        next: "Next",
        back: "Back",
        skip: "Skip guide",
        finish: "Start first campaign",
        goStep: "Go to this step",
        done: "Complete",
        pending: "Not yet",
        recheck: "Recheck",
        openConnect: "Open connect page",
        fetchPages: "Fetch pages now",
        step1Title: "Choose a connection method",
        step1Body: "Before any campaign, you need an active connection to Facebook. Two official options:",
        methodTokenTitle: "Access Token (Graph API)",
        methodTokenDesc: "Best for posting on your own Pages via official Graph API. Fast, stable, ideal for business pages.",
        methodCookiesTitle: "Cookies (Bot Worker)",
        methodCookiesDesc: "For posting inside Groups and extracting Messenger contacts. Uses a real browser session.",
        step2Title: "Link the account in the dashboard",
        step2Body:
          'Open the "Facebook Account" page, pick a single method, follow the on-screen steps, then wait for the save confirmation.',
        step2Note: "Do not link both methods at once — pick one to avoid account conflicts.",
        step3Title: "Verify the account is ready",
        step3Body:
          "After saving, the account name and connection status will show up. If any error appears (e.g. SESSION_EXPIRED), refresh cookies or re-generate the token before continuing.",
        step4Title: "Fetch Pages / Groups",
        step4Body:
          'Pages and groups do not auto-load in the campaign form. Press "Fetch pages" (token flow) or "Fetch groups" (cookies flow) to pull them from Facebook into your account.',
        step4Note: "The list is cached, but re-run the fetch whenever you add a new Page or Group.",
        step5Title: "Create your first campaign",
        step5Body:
          "Open the Campaigns page, choose a publishing method (Token or Bot), select targets, write your post, and start the campaign. The system will publish with a safe delay.",
        step5Note: "Start with a small test campaign on 1–2 targets to confirm the post looks right.",
        readinessTitle: "Current readiness status",
        readyToken: "Token connected",
        readyCookies: "Bot cookies connected",
        readyPages: "Pages/Groups fetched",
        allReady: "All set — you can start your first campaign now.",
        notReady: "Finish the remaining steps first.",
      };

  const checkReadiness = useCallback(async () => {
    if (!user) return;
    setChecking(true);
    try {
      const [conn, bots, gAcc] = await Promise.all([
        callFn(getFacebookConnection)().catch(() => ({ connection: null })),
        callFn(listBotAccounts)().catch(() => ({ accounts: [] })),
        callFn(listGraphAccounts)().catch(() => ({ accounts: [] })),
      ]);
      const connection = safeObject<{ connection: unknown }>(conn)?.connection;
      const botsList = safeArray(safeObject<{ accounts?: unknown }>(bots)?.accounts);
      const graphList = safeArray(safeObject<{ accounts?: unknown }>(gAcc)?.accounts);
      setHasToken(!!connection || graphList.length > 0);
      setHasCookies(botsList.length > 0);
    } finally {
      setChecking(false);
    }
  }, [user, callFn]);

  useEffect(() => {
    if (!user) return;
    checkReadiness();
  }, [user, checkReadiness]);

  const handleFetchPages = async () => {
    setFetchingPages(true);
    try {
      const res = await (callFn(fetchGraphPages) as unknown as (a: Record<string, unknown>) => Promise<unknown>)({});
      const arr = safeArray((res as { pages?: unknown })?.pages);
      setHasPages(arr.length > 0);
    } catch {
      // ignore — user can retry from the main page
    } finally {
      setFetchingPages(false);
    }
  };

  const markDoneAndGo = () => {
    try {
      localStorage.setItem(ONBOARDING_DONE_KEY, "1");
    } catch {
      /* ignore */
    }
    navigate({ to: "/dashboard/facebook/campaigns/new" });
  };

  const steps = [
    { key: "method", icon: KeyRound, title: t.step1Title },
    { key: "link", icon: Cookie, title: t.step2Title },
    { key: "verify", icon: ShieldCheck, title: t.step3Title },
    { key: "fetch", icon: FileText, title: t.step4Title },
    { key: "campaign", icon: Megaphone, title: t.step5Title },
  ];
  const total = steps.length;

  const stepStatus: StepStatus[] = [
    "done", // Step 1: informational — reading is enough
    hasToken || hasCookies ? "done" : "todo",
    hasToken || hasCookies ? "done" : "todo",
    hasPages ? "done" : "todo",
    "todo",
  ];

  const goNext = () => setCurrent((c) => Math.min(total - 1, c + 1));
  const goBack = () => setCurrent((c) => Math.max(0, c - 1));

  if (loading) return null;

  return (
    <DashboardLayout title={t.title}>
      <div dir={dir} className="mx-auto max-w-3xl space-y-6">
        {/* Header */}
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            {isAr ? "دليل مصوّر" : "Guided walkthrough"}
          </div>
          <h1 className="text-2xl font-bold text-foreground">{t.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t.subtitle}</p>
        </div>

        {/* Progress rail */}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {steps.map((s, i) => {
              const Icon = s.icon;
              const status = stepStatus[i];
              const isCurrent = i === current;
              return (
                <button
                  key={s.key}
                  onClick={() => setCurrent(i)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${
                    isCurrent
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background hover:bg-accent"
                  }`}
                >
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                      status === "done"
                        ? "bg-emerald-500/15 text-emerald-600"
                        : isCurrent
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {status === "done" ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
                  </span>
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{s.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Current step body */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            {t.stepLabel(current + 1, total)}
          </p>
          <h2 className="text-xl font-bold text-foreground mb-3 flex items-center gap-2">
            {(() => {
              const Icon = steps[current].icon;
              return <Icon className="w-5 h-5 text-primary" />;
            })()}
            {steps[current].title}
          </h2>

          {current === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">{t.step1Body}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <KeyRound className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">{t.methodTokenTitle}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t.methodTokenDesc}
                  </p>
                </div>
                <div className="rounded-xl border border-border p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Cookie className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">{t.methodCookiesTitle}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t.methodCookiesDesc}
                  </p>
                </div>
              </div>
            </div>
          )}

          {current === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">{t.step2Body}</p>
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                <p>{t.step2Note}</p>
              </div>
              <Link
                to="/dashboard/facebook"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                {t.openConnect}
                <ExternalLink className="w-4 h-4" />
              </Link>
            </div>
          )}

          {current === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">{t.step3Body}</p>
              <button
                onClick={checkReadiness}
                disabled={checking}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
              >
                {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {t.recheck}
              </button>
            </div>
          )}

          {current === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">{t.step4Body}</p>
              <div className="flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-800 dark:text-blue-200">
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                <p>{t.step4Note}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {hasToken && (
                  <button
                    onClick={handleFetchPages}
                    disabled={fetchingPages}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {fetchingPages ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    {t.fetchPages}
                  </button>
                )}
                <Link
                  to="/dashboard/facebook/groups"
                  className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm hover:bg-accent"
                >
                  <Users className="w-4 h-4" />
                  {isAr ? "جلب الجروبات" : "Fetch groups"}
                </Link>
              </div>
            </div>
          )}

          {current === 4 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">{t.step5Body}</p>
              <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-200">
                <Info className="w-4 h-4 mt-0.5 shrink-0" />
                <p>{t.step5Note}</p>
              </div>
            </div>
          )}

          {/* Nav */}
          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              onClick={goBack}
              disabled={current === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-40"
            >
              {isAr ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
              {t.back}
            </button>
            {current < total - 1 ? (
              <button
                onClick={goNext}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                {t.next}
                {isAr ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
              </button>
            ) : (
              <button
                onClick={markDoneAndGo}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                <Megaphone className="w-4 h-4" />
                {t.finish}
              </button>
            )}
          </div>
        </div>

        {/* Readiness summary */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            {t.readinessTitle}
          </h3>
          <ul className="space-y-2 text-sm">
            <ReadinessRow label={t.readyToken} done={hasToken} tDone={t.done} tPending={t.pending} />
            <ReadinessRow label={t.readyCookies} done={hasCookies} tDone={t.done} tPending={t.pending} />
            <ReadinessRow label={t.readyPages} done={hasPages} tDone={t.done} tPending={t.pending} />
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            {(hasToken || hasCookies) && hasPages ? t.allReady : t.notReady}
          </p>
        </div>

        <div className="flex justify-center">
          <button
            onClick={() => {
              try { localStorage.setItem(ONBOARDING_DONE_KEY, "1"); } catch { /* ignore */ }
              navigate({ to: "/dashboard/facebook/campaigns" });
            }}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            {t.skip}
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}

function ReadinessRow({
  label, done, tDone, tPending,
}: { label: string; done: boolean; tDone: string; tPending: string }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background px-3 py-2">
      <span className="flex items-center gap-2 text-foreground">
        {done ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
        ) : (
          <Circle className="w-4 h-4 text-muted-foreground" />
        )}
        {label}
      </span>
      <span className={`text-xs font-medium ${done ? "text-emerald-600" : "text-muted-foreground"}`}>
        {done ? tDone : tPending}
      </span>
    </li>
  );
}
