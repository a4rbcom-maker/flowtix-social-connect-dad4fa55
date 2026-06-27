import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Settings as SettingsIcon,
  Copy,
  CheckCircle2,
  Webhook,
  Bell,
  BellOff,
  Link2,
  ShieldCheck,
  Clock,
  AlertCircle,
  PlayCircle,
  Loader2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useI18n } from "@/lib/i18n";
import { pingWaBridgeUser, testWaWebhook, type WaWebhookTestResult } from "@/lib/wa.functions";


export const Route = createFileRoute("/dashboard/whatsapp/settings")({
  ssr: false,
  component: WaSettingsPage,
});

const NOTIF_KEY = "wa_notify_new_messages";
const SOUND_KEY = "wa_notify_sound";

function WaSettingsPage() {
  const { lang } = useI18n();
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [sound, setSound] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<WaWebhookTestResult | null>(null);
  const ping = useServerFn(pingWaBridgeUser);
  const runTest = useServerFn(testWaWebhook);

  const onRunTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await runTest({ data: {} as any });
      setTestResult(r);
      if (r.ok) toast.success(lang === "ar" ? "تم استلام الرسالة بنجاح" : "Webhook delivery succeeded");
      else toast.error(lang === "ar" ? "فشل اختبار الـ webhook" : "Webhook test failed");
    } catch (e) {
      setTestResult({
        ok: false, httpStatus: 0, responseBody: "", saved: 0,
        sessionId: null, messageStored: false, aiLogStatus: null, aiError: null, aiResponseStored: false,
        error: e instanceof Error ? e.message : String(e),
      });
      toast.error(lang === "ar" ? "خطأ في تشغيل الاختبار" : "Test failed to run");
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    setOrigin(typeof window !== "undefined" ? window.location.origin : "");
    setNotify(localStorage.getItem(NOTIF_KEY) !== "0");
    setSound(localStorage.getItem(SOUND_KEY) !== "0");
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
    ping({ data: {} as any })
      .then((r: any) => setBridgeOk(Boolean(r?.ok)))
      .catch(() => setBridgeOk(false));
  }, []);


  const webhookUrl = origin ? `${origin}/api/public/wa-webhook` : "";

  const t = lang === "ar"
    ? {
        title: "إعدادات واتساب",
        subtitle: "إعدادات الـ Bridge والإشعارات والاتصال.",
        bridgeTitle: "اتصال الـ Bridge",
        bridgeStatusOk: "متصل وشغّال",
        bridgeStatusDown: "مش متصل دلوقتي",
        bridgeStatusChecking: "بنفحص الاتصال…",
        bridgeDescOk: "الـ Bridge Worker متصل والـ Webhook بتاعك جاهز يستقبل الرسائل الواردة من واتساب.",
        bridgeDescDown: "مش قادرين نوصل للـ Bridge Worker حاليًا. اتأكد إن السيرفر شغّال أو حاول تاني بعد شوية.",
        bridgeDescChecking: "بنتأكد من حالة الـ Bridge Worker…",
        webhookTitle: "Webhook URL",
        webhookDesc: "هتحط الرابط ده في إعدادات Bot Worker بتاعك عشان يبعت الرسائل الواردة.",
        copy: "نسخ",
        copied: "تم النسخ",
        notifTitle: "الإشعارات",
        notifDesc: "إعدادات إشعارات الرسائل الجديدة.",
        notifEnable: "إشعارات المتصفح",
        notifEnableDesc: "اعرض إشعار لما توصل رسالة جديدة وأنت بعيد عن الصفحة.",
        soundEnable: "صوت تنبيه",
        soundEnableDesc: "شغّل صوت قصير مع كل رسالة جديدة.",
        permGranted: "الإشعارات مفعّلة",
        permDenied: "الإشعارات مرفوضة — فعّلها من إعدادات المتصفح.",
        permRequest: "السماح بالإشعارات",
        comingTitle: "ميزات قادمة",
        comingDesc: "ميزات هنضيفها قريبًا للـ Bridge.",
        feat1: "ربط أكتر من رقم واتساب في نفس الحساب",
        feat2: "تصدير المحادثات (CSV / JSON)",
        feat3: "إعداد قوائم بث وتذكيرات",
        feat4: "تكامل مع متجرك لإرسال طلبات تلقائي",
      }
    : {
        title: "WhatsApp Settings",
        subtitle: "Bridge, notifications, and connection settings.",
        bridgeTitle: "Bridge Connection",
        bridgeStatusOk: "Connected & live",
        bridgeStatusDown: "Currently unreachable",
        bridgeStatusChecking: "Checking connection…",
        bridgeDescOk: "The Bridge Worker is connected and your Webhook is ready to receive incoming WhatsApp messages.",
        bridgeDescDown: "We can't reach the Bridge Worker right now. Make sure the server is running and try again shortly.",
        bridgeDescChecking: "Verifying the Bridge Worker status…",
        webhookTitle: "Webhook URL",
        webhookDesc: "Paste this URL in your Bot Worker config so it can deliver incoming messages.",
        copy: "Copy",
        copied: "Copied",
        notifTitle: "Notifications",
        notifDesc: "Configure notifications for new messages.",
        notifEnable: "Browser notifications",
        notifEnableDesc: "Show a notification when a new message arrives while you're away.",
        soundEnable: "Sound alert",
        soundEnableDesc: "Play a short sound for each new message.",
        permGranted: "Notifications are enabled",
        permDenied: "Notifications blocked — enable them from your browser settings.",
        permRequest: "Allow notifications",
        comingTitle: "Coming soon",
        comingDesc: "Available once the Bridge is deployed.",
        feat1: "Link multiple WhatsApp numbers per account",
        feat2: "Export conversations (CSV / JSON)",
        feat3: "Broadcast lists and reminders",
        feat4: "Store integration for automatic order replies",
      };

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      toast.success(t.copied);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error(t.copy);
    }
  };

  const toggleNotify = (val: boolean) => {
    setNotify(val);
    localStorage.setItem(NOTIF_KEY, val ? "1" : "0");
  };
  const toggleSound = (val: boolean) => {
    setSound(val);
    localStorage.setItem(SOUND_KEY, val ? "1" : "0");
  };

  const requestPermission = async () => {
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    setPermission(p);
  };

  return (
    <DashboardLayout title={t.title}>
      <div className="mx-auto grid max-w-5xl gap-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-white shadow-lg">
            <SettingsIcon className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">{t.title}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t.subtitle}</p>
          </div>
        </div>

        {/* Bridge status */}
        {(() => {
          const isOk = bridgeOk === true;
          const isDown = bridgeOk === false;
          const tone = isOk
            ? { iconBg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", Icon: CheckCircle2 }
            : isDown
              ? { iconBg: "bg-rose-500/10 text-rose-600 dark:text-rose-400", chip: "bg-rose-500/15 text-rose-700 dark:text-rose-300", Icon: AlertCircle }
              : { iconBg: "bg-amber-500/10 text-amber-600 dark:text-amber-400", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300", Icon: Clock };
          const desc = isOk ? t.bridgeDescOk : isDown ? t.bridgeDescDown : t.bridgeDescChecking;
          const status = isOk ? t.bridgeStatusOk : isDown ? t.bridgeStatusDown : t.bridgeStatusChecking;
          return (
            <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone.iconBg}`}>
                    <Link2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">{t.bridgeTitle}</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
                  </div>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tone.chip}`}>
                  <tone.Icon className="h-3.5 w-3.5" />
                  {status}
                </span>
              </div>
            </div>
          );
        })()}


        {/* Webhook test mode */}
        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Webhook className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">
                  {lang === "ar" ? "اختبار الـ Webhook" : "Webhook Test Mode"}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {lang === "ar"
                    ? "ابعت رسالة تجريبية موقّعة للـ webhook بتاعك واتأكد إنها وصلت وتم تخزينها."
                    : "Send a signed synthetic message to your webhook and verify it was received and stored."}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onRunTest}
              disabled={testing}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-60"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              {lang === "ar" ? "تشغيل الاختبار" : "Run test"}
            </button>
          </div>

          {testResult && (
            <div className={`mt-4 rounded-xl border p-4 text-sm ${
              testResult.ok
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-rose-500/30 bg-rose-500/5"
            }`}>
              <div className="flex items-center gap-2 font-semibold">
                {testResult.ok ? (
                  <><CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span className="text-emerald-700 dark:text-emerald-300">
                      {lang === "ar" ? "تم الاستلام بنجاح" : "Delivery succeeded"}
                    </span></>
                ) : (
                  <><XCircle className="h-4 w-4 text-rose-600" />
                    <span className="text-rose-700 dark:text-rose-300">
                      {lang === "ar" ? "فشل الاستلام" : "Delivery failed"}
                    </span></>
                )}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <dt>HTTP</dt><dd className="font-mono text-foreground">{testResult.httpStatus || "—"}</dd>
                <dt>{lang === "ar" ? "تم التخزين" : "Stored"}</dt>
                <dd className="font-mono text-foreground">{testResult.messageStored ? "✓" : "✗"}</dd>
                <dt>{lang === "ar" ? "عدد المحفوظ" : "Saved count"}</dt>
                <dd className="font-mono text-foreground">{testResult.saved}</dd>
                <dt>Session</dt>
                <dd className="truncate font-mono text-foreground">{testResult.sessionId ?? "—"}</dd>
                <dt>{lang === "ar" ? "تشغيل AI" : "AI run"}</dt>
                <dd className="font-mono text-foreground">{testResult.aiLogStatus ?? "—"}</dd>
                <dt>{lang === "ar" ? "رد AI محفوظ" : "AI response stored"}</dt>
                <dd className="font-mono text-foreground">{testResult.aiResponseStored ? "✓" : "✗"}</dd>
              </dl>
              {testResult.aiError && (
                <div className="mt-3 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                  <div className="font-semibold mb-1">{lang === "ar" ? "سبب فشل AI" : "AI failure reason"}</div>
                  <div className="font-mono break-all whitespace-pre-wrap">{testResult.aiError}</div>
                </div>
              )}
              {testResult.error && (
                <div className="mt-3 rounded-lg bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300">
                  <div className="font-semibold mb-1">{lang === "ar" ? "سبب الفشل" : "Failure reason"}</div>
                  <div className="font-mono break-all whitespace-pre-wrap">{testResult.error}</div>
                </div>
              )}
              {testResult.responseBody && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                    {lang === "ar" ? "رد الخادم" : "Server response"}
                  </summary>
                  <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-muted p-3 text-[11px] text-foreground">{testResult.responseBody}</pre>
                </details>
              )}
            </div>
          )}
        </div>

        {/* Webhook URL section is admin-only; hidden from client settings */}


        {/* Notifications */}
        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">{t.notifTitle}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{t.notifDesc}</p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <ToggleRow
              icon={notify ? Bell : BellOff}
              title={t.notifEnable}
              desc={t.notifEnableDesc}
              value={notify}
              onChange={toggleNotify}
            />
            <ToggleRow
              icon={Clock}
              title={t.soundEnable}
              desc={t.soundEnableDesc}
              value={sound}
              onChange={toggleSound}
            />

            {permission === "granted" && (
              <div className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" /> {t.permGranted}
              </div>
            )}
            {permission === "denied" && (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {t.permDenied}
              </div>
            )}
            {permission === "default" && (
              <button
                type="button"
                onClick={requestPermission}
                className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/70"
              >
                <Bell className="h-3.5 w-3.5" /> {t.permRequest}
              </button>
            )}
          </div>
        </div>

        {/* Coming soon */}
        <div className="rounded-2xl border border-dashed border-border/60 bg-muted/20 p-6">
          <h2 className="text-base font-bold text-foreground">{t.comingTitle}</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {[t.feat1, t.feat2, t.feat3, t.feat4].map((f, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-xl bg-background/60 px-3 py-2 text-sm text-foreground"
              >
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </DashboardLayout>
  );
}

function ToggleRow({
  icon: Icon,
  title,
  desc,
  value,
  onChange,
}: {
  icon: typeof Bell;
  title: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 p-3 hover:bg-background/70">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div>
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          value ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            value ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5 rtl:-translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}
