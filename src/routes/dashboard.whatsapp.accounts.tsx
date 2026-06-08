import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageCircle,
  Loader2,
  CheckCircle2,
  RefreshCw,
  LogOut,
  Smartphone,
  QrCode,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useI18n } from "@/lib/i18n";
import {
  connectWaSession,
  getWaConnectionState,
  disconnectWaSession,
  type WaConnectionState,
} from "@/lib/wa.functions";

export const Route = createFileRoute("/dashboard/whatsapp/accounts")({
  ssr: false,
  component: WhatsAppPage,
});

function WhatsAppPage() {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const connectFn = useServerFn(connectWaSession);
  const statusFn = useServerFn(getWaConnectionState);
  const disconnectFn = useServerFn(disconnectWaSession);
  const [polling, setPolling] = useState(false);
  const startedRef = useRef(false);

  const t = lang === "ar"
    ? {
        title: "واتساب",
        subtitle: "اربط رقم واتساب عبر QR Code وابدأ استقبال وإرسال الرسائل.",
        connect: "ابدأ الربط",
        connecting: "جارٍ التحضير…",
        scan: "افتح واتساب → الأجهزة المرتبطة → ربط جهاز، ثم امسح الكود",
        scanWaiting: "في انتظار المسح…",
        refresh: "تحديث QR",
        connected: "متصل",
        disconnect: "فصل الجلسة",
        disconnected: "غير متصل",
        sessionLabel: "معرف الجلسة",
        phoneLabel: "رقم الهاتف",
        errorTitle: "حدث خطأ",
        successConnected: "تم ربط واتساب بنجاح",
        successDisc: "تم فصل الجلسة",
        statusConnecting: "جارٍ الاتصال…",
        statusUnknown: "حالة غير معروفة",
        howTitle: "كيفية الربط",
        step1: "اضغط زر «ابدأ الربط»",
        step2: "افتح واتساب على هاتفك",
        step3: "من القائمة اختر: الأجهزة المرتبطة → ربط جهاز",
        step4: "وجّه الكاميرا نحو الكود الظاهر هنا",
      }
    : {
        title: "WhatsApp",
        subtitle: "Link a WhatsApp number via QR Code to start sending and receiving messages.",
        connect: "Start Connection",
        connecting: "Preparing…",
        scan: "Open WhatsApp → Linked Devices → Link a Device, then scan the code",
        scanWaiting: "Waiting for scan…",
        refresh: "Refresh QR",
        connected: "Connected",
        disconnect: "Disconnect",
        disconnected: "Not connected",
        sessionLabel: "Session ID",
        phoneLabel: "Phone Number",
        errorTitle: "An error occurred",
        successConnected: "WhatsApp connected successfully",
        successDisc: "Session disconnected",
        statusConnecting: "Connecting…",
        statusUnknown: "Unknown status",
        howTitle: "How to connect",
        step1: "Click the «Start Connection» button",
        step2: "Open WhatsApp on your phone",
        step3: "Tap Menu → Linked Devices → Link a Device",
        step4: "Point your camera at the QR code shown here",
      };

  const stateQuery = useQuery<WaConnectionState | null>({
    queryKey: ["wa-state"],
    queryFn: () => statusFn(),
    refetchInterval: polling ? 3000 : false,
  });

  const state = stateQuery.data;

  // Auto-stop polling once connected
  useEffect(() => {
    if (state?.status === "connected" && polling) {
      setPolling(false);
      toast.success(t.successConnected);
    }
  }, [state?.status, polling, t.successConnected]);

  // Auto-start polling if we have an active QR/connecting session on first load
  useEffect(() => {
    if (startedRef.current) return;
    if (state && (state.status === "qr" || state.status === "connecting")) {
      startedRef.current = true;
      setPolling(true);
    }
  }, [state]);

  const connectMut = useMutation({
    mutationFn: () => connectFn(),
    onSuccess: (data) => {
      qc.setQueryData(["wa-state"], data);
      if (data.status !== "connected") setPolling(true);
    },
    onError: (err: Error) => toast.error(t.errorTitle, { description: err.message }),
  });

  const disconnectMut = useMutation({
    mutationFn: () => disconnectFn(),
    onSuccess: () => {
      qc.setQueryData(["wa-state"], null);
      setPolling(false);
      toast.success(t.successDisc);
    },
    onError: (err: Error) => toast.error(t.errorTitle, { description: err.message }),
  });

  const isLoading = stateQuery.isLoading;
  const status = state?.status ?? "disconnected";
  const qrValue = state?.qrRaw ?? state?.qrDataUrl ?? null;
  const showQr = status === "qr" && !!qrValue;
  const errorMsg = state?.error ?? null;

  // Stop polling if bridge is unreachable — no point hammering it.
  useEffect(() => {
    if (errorMsg && polling) setPolling(false);
  }, [errorMsg, polling]);

  return (
    <DashboardLayout title={t.title}>
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.2fr_1fr]">
        {/* Main connection card */}
        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-white shadow-lg">
                <MessageCircle className="h-6 w-6" strokeWidth={2.5} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">{t.title}</h1>
                <p className="mt-0.5 text-sm text-muted-foreground">{t.subtitle}</p>
              </div>
            </div>
            <StatusBadge status={status} lang={lang} t={t} />
          </div>

          {errorMsg && (
            <div className="mt-5 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="leading-relaxed">
                <div className="font-semibold">{t.errorTitle}</div>
                <div className="mt-0.5 text-xs opacity-90">{errorMsg}</div>
              </div>
            </div>
          )}

          <div className="mt-6 flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/60 bg-muted/30 p-6 text-center">
            {isLoading ? (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            ) : status === "connected" ? (
              <ConnectedView state={state!} t={t} />
            ) : showQr ? (
              <QrView qr={qrValue!} polling={polling} t={t} />
            ) : status === "connecting" ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm font-medium text-foreground">{t.statusConnecting}</p>
              </div>
            ) : (
              <EmptyView t={t} />
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            {status === "connected" ? (
              <button
                type="button"
                onClick={() => disconnectMut.mutate()}
                disabled={disconnectMut.isPending}
                className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-60"
              >
                {disconnectMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4" />
                )}
                {t.disconnect}
              </button>
            ) : (
              <>
                {(status === "qr" || status === "connecting") && (
                  <button
                    type="button"
                    onClick={() => connectMut.mutate()}
                    disabled={connectMut.isPending}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-muted px-4 text-sm font-semibold text-foreground hover:bg-muted/80 disabled:opacity-60"
                  >
                    <RefreshCw className={`h-4 w-4 ${connectMut.isPending ? "animate-spin" : ""}`} />
                    {t.refresh}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => connectMut.mutate()}
                  disabled={connectMut.isPending}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] px-5 text-sm font-semibold text-primary-foreground shadow-md hover:opacity-95 disabled:opacity-60"
                >
                  {connectMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <QrCode className="h-4 w-4" />
                  )}
                  {connectMut.isPending ? t.connecting : t.connect}
                </button>
              </>
            )}
          </div>
        </div>

        {/* How-to side panel */}
        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <h2 className="text-base font-bold text-foreground">{t.howTitle}</h2>
          <ol className="mt-4 space-y-3">
            {[t.step1, t.step2, t.step3, t.step4].map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-foreground">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-5 rounded-xl bg-amber-50 dark:bg-amber-950/30 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
            <AlertCircle className="mb-1 inline h-3.5 w-3.5" />{" "}
            {lang === "ar"
              ? "ينتهي صلاحية رمز QR كل دقيقة تقريباً. لو ما عرفتش تمسحه في الوقت، اضغط «تحديث QR»."
              : "QR codes expire after ~1 minute. If you couldn't scan in time, click «Refresh QR»."}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function StatusBadge({
  status,
  lang: _lang,
  t,
}: {
  status: string;
  lang: "ar" | "en";
  t: { connected: string; disconnected: string; statusConnecting: string; statusUnknown: string };
}) {
  const map: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
    connected: { label: t.connected, cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
    qr: { label: t.statusConnecting, cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icon: QrCode },
    connecting: { label: t.statusConnecting, cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icon: Loader2 },
    disconnected: { label: t.disconnected, cls: "bg-muted text-muted-foreground", icon: AlertCircle },
    unknown: { label: t.statusUnknown, cls: "bg-muted text-muted-foreground", icon: AlertCircle },
  };
  const s = map[status] || map.unknown;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${s.cls}`}>
      <Icon className={`h-3.5 w-3.5 ${status === "connecting" ? "animate-spin" : ""}`} />
      {s.label}
    </span>
  );
}

function EmptyView({ t }: { t: { connect: string; subtitle: string } }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <Smartphone className="h-8 w-8 text-primary" />
      </div>
      <p className="max-w-sm text-sm text-muted-foreground">{t.subtitle}</p>
    </div>
  );
}

function QrView({ qr, polling, t }: { qr: string; polling: boolean; t: { scan: string; scanWaiting: string } }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-2xl border-4 border-primary/20 bg-white p-3 shadow-lg">
        <img src={qr} alt="WhatsApp QR Code" className="h-56 w-56" />
      </div>
      <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{t.scan}</p>
      {polling && (
        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t.scanWaiting}
        </div>
      )}
    </div>
  );
}

function ConnectedView({
  state,
  t,
}: {
  state: WaConnectionState;
  t: { connected: string; sessionLabel: string; phoneLabel: string };
}) {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15">
        <CheckCircle2 className="h-9 w-9 text-emerald-600 dark:text-emerald-400" />
      </div>
      <p className="text-base font-bold text-foreground">{t.connected}</p>
      <div className="w-full space-y-1.5 rounded-xl bg-background/60 p-3 text-left">
        {state.phoneNumber && (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{t.phoneLabel}</span>
            <span className="font-mono font-semibold text-foreground" dir="ltr">+{state.phoneNumber}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{t.sessionLabel}</span>
          <span className="truncate font-mono text-foreground/80" dir="ltr">{state.sessionId}</span>
        </div>
      </div>
    </div>
  );
}
