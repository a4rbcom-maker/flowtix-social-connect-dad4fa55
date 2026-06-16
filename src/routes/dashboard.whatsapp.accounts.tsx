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
  Plus,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import {
  connectWaSession,
  getWaConnectionState,
  disconnectWaSession,
  pingWaBridgeUser,
  type WaConnectionState,
  type WaBridgeHealth,
} from "@/lib/wa.functions";

export const Route = createFileRoute("/dashboard/whatsapp/accounts")({
  ssr: false,
  component: WhatsAppPage,
});

const WA_CLOUD_API_BASE = (
  (import.meta.env.VITE_FLOWTIX_WA_CLOUD_API_BASE as string | undefined) ||
  "https://project--60cc135f-fba6-4c85-a3db-3604a51301ae.lovable.app"
).replace(/\/+$/, "");
const WA_BRIDGE_MODE_STORAGE_KEY = "flowtix-wa-bridge-mode";

type WaCloudAction = "state" | "connect" | "disconnect" | "ping";

function isBridgeConfigMissing(message?: string | null) {
  return /WA_BRIDGE_API_KEY|BOTXTRA_API_KEY|WHATSAPP_BRIDGE_API_KEY|not configured/i.test(message ?? "");
}

async function callWaCloudApi<T>(action: WaCloudAction, token: string): Promise<T> {
  const res = await fetch(`${WA_CLOUD_API_BASE}/api/public/wa-client`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action }),
  });
  const body = (await res.json().catch(() => null)) as unknown;
  const error =
    body && typeof body === "object" && "error" in body
      ? String((body as { error?: unknown }).error ?? "")
      : "";
  if (!res.ok) throw new Error(error || `Bridge API ${res.status}`);
  return body as T;
}

function WhatsAppPage() {
  const { session } = useAuth();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const qc = useQueryClient();
  const connectFn = useServerFn(connectWaSession);
  const statusFn = useServerFn(getWaConnectionState);
  const disconnectFn = useServerFn(disconnectWaSession);
  const pingFn = useServerFn(pingWaBridgeUser);
  const [polling, setPolling] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [useCloudBridge, setUseCloudBridge] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem(WA_BRIDGE_MODE_STORAGE_KEY) === "cloud",
  );
  const startedRef = useRef(false);

  const t = ar
    ? {
        title: "حسابي على واتساب",
        subtitle: "إدارة الرقم المربوط بحسابك واستعراض حالة الاتصال.",
        connected: "متصل",
        disconnected: "غير متصل",
        pendingQr: "في انتظار المسح",
        connecting: "جارٍ الاتصال",
        unknown: "غير معروف",
        myAccount: "حسابي المربوط",
        noAccount: "لا يوجد حساب مربوط بعد",
        noAccountDesc: "اربط رقم واتساب لبدء استقبال وإرسال الرسائل.",
        phoneLabel: "رقم الهاتف",
        sessionLabel: "معرّف الجلسة",
        lastSeenLabel: "آخر نشاط",
        bridgeLabel: "خادم الربط",
        actions: "الإجراءات",
        connect: "ربط رقم جديد",
        reconnect: "إعادة الربط (QR جديد)",
        disconnect: "قطع الاتصال نهائياً",
        showQr: "عرض QR للمسح",
        hideQr: "إخفاء QR",
        refresh: "تحديث الحالة",
        ping: "اختبار خادم الربط",
        cloudBridge: "تم تفعيل الجسر المركزي تلقائياً لهذا السيرفر.",
        authRequired: "يرجى تسجيل الدخول مرة أخرى لتفعيل الربط.",
        scan: "افتح واتساب → الأجهزة المرتبطة → ربط جهاز، ثم امسح الكود",
        scanWaiting: "في انتظار المسح…",
        howTitle: "خطوات الربط",
        step1: "اضغط «ربط رقم جديد»",
        step2: "افتح واتساب على هاتفك",
        step3: "من القائمة: الأجهزة المرتبطة → ربط جهاز",
        step4: "وجّه الكاميرا نحو الكود الظاهر",
        qrExpire: "ينتهي QR كل دقيقة تقريباً. لو لم تستطع المسح، اضغط «إعادة الربط».",
        confirmDisconnect: "هل أنت متأكد من قطع الاتصال نهائياً؟ ستحتاج إلى إعادة المسح لاحقاً.",
        successConnected: "تم ربط واتساب بنجاح",
        successDisc: "تم قطع الاتصال",
        errorTitle: "حدث خطأ",
      }
    : {
        title: "My WhatsApp Account",
        subtitle: "Manage the number linked to your account and monitor connection status.",
        connected: "Connected",
        disconnected: "Not connected",
        pendingQr: "Awaiting scan",
        connecting: "Connecting",
        unknown: "Unknown",
        myAccount: "My Linked Account",
        noAccount: "No account linked yet",
        noAccountDesc: "Link a WhatsApp number to start sending and receiving messages.",
        phoneLabel: "Phone number",
        sessionLabel: "Session ID",
        lastSeenLabel: "Last seen",
        bridgeLabel: "Bridge server",
        actions: "Actions",
        connect: "Link new number",
        reconnect: "Reconnect (new QR)",
        disconnect: "Disconnect permanently",
        showQr: "Show QR to scan",
        hideQr: "Hide QR",
        refresh: "Refresh status",
        ping: "Test bridge",
        cloudBridge: "Central bridge fallback is active for this server.",
        authRequired: "Please sign in again to link WhatsApp.",
        scan: "Open WhatsApp → Linked Devices → Link a Device, then scan the code",
        scanWaiting: "Waiting for scan…",
        howTitle: "How to link",
        step1: "Click «Link new number»",
        step2: "Open WhatsApp on your phone",
        step3: "Menu → Linked Devices → Link a Device",
        step4: "Point the camera at the QR shown",
        qrExpire: "QR expires every ~60s. If you can't scan in time, click «Reconnect».",
        confirmDisconnect: "Disconnect permanently? You'll need to re-scan later.",
        successConnected: "WhatsApp linked successfully",
        successDisc: "Disconnected",
        errorTitle: "An error occurred",
      };

  const requireToken = () => {
    if (!session?.access_token) throw new Error(t.authRequired);
    return session.access_token;
  };

  const enableCloudBridge = () => {
    setUseCloudBridge(true);
    if (typeof window !== "undefined") localStorage.setItem(WA_BRIDGE_MODE_STORAGE_KEY, "cloud");
  };

  const callCloud = <T,>(action: WaCloudAction) => callWaCloudApi<T>(action, requireToken());

  const stateQuery = useQuery<WaConnectionState | null>({
    queryKey: ["wa-state", useCloudBridge ? "cloud" : "local"],
    enabled: !!session?.access_token,
    queryFn: async () => {
      if (useCloudBridge) return callCloud<WaConnectionState | null>("state");
      const data = await statusFn();
      if (data?.error && isBridgeConfigMissing(data.error)) {
        enableCloudBridge();
        return callCloud<WaConnectionState | null>("state");
      }
      return data;
    },
    refetchInterval: polling ? 3000 : false,
  });

  const state = stateQuery.data;
  const status = state?.status ?? "disconnected";
  const hasAccount = !!state && !!state.sessionId;
  const qrValue = state?.qrRaw ?? state?.qrDataUrl ?? null;
  const errorMsg = state?.error ?? null;

  // Auto-stop polling once connected
  useEffect(() => {
    if (status === "connected" && polling) {
      setPolling(false);
      setShowQr(false);
      toast.success(t.successConnected);
    }
  }, [status, polling, t.successConnected]);

  // Auto-start polling if QR/connecting on load
  useEffect(() => {
    if (startedRef.current || !state) return;
    if (state.status === "qr" || state.status === "connecting") {
      startedRef.current = true;
      setPolling(true);
      setShowQr(true);
    }
  }, [state]);

  // Stop polling if bridge unreachable
  useEffect(() => {
    if (errorMsg && polling) setPolling(false);
  }, [errorMsg, polling]);

  const connectMut = useMutation({
    mutationFn: async () => {
      if (useCloudBridge) return callCloud<WaConnectionState>("connect");
      const data = await connectFn();
      if (isBridgeConfigMissing(data.error)) {
        enableCloudBridge();
        return callCloud<WaConnectionState>("connect");
      }
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["wa-state", "local"], data);
      qc.setQueryData(["wa-state", "cloud"], data);
      if (data.error) {
        toast.error(t.errorTitle, { description: data.error });
        return;
      }
      if (data.status !== "connected") {
        setPolling(true);
        setShowQr(true);
      }
    },
    onError: (err: Error) => toast.error(t.errorTitle, { description: err.message }),
  });

  const disconnectMut = useMutation({
    mutationFn: () => useCloudBridge ? callCloud<{ ok: boolean }>("disconnect") : disconnectFn(),
    onSuccess: () => {
      qc.setQueryData(["wa-state", "local"], null);
      qc.setQueryData(["wa-state", "cloud"], null);
      setPolling(false);
      setShowQr(false);
      toast.success(t.successDisc);
    },
    onError: (err: Error) => toast.error(t.errorTitle, { description: err.message }),
  });

  const pingMut = useMutation({
    mutationFn: async () => {
      if (useCloudBridge) return callCloud<WaBridgeHealth>("ping");
      const health = await pingFn();
      if (!health.hasApiKey || isBridgeConfigMissing(health.error)) {
        enableCloudBridge();
        return callCloud<WaBridgeHealth>("ping");
      }
      return health;
    },
    onSuccess: (h) => {
      if (h.ok) {
        toast.success(ar ? "خادم الربط يعمل ✅" : "Bridge online ✅", {
          description: `${h.status ?? "ok"} • ${h.latencyMs}ms${h.version ? ` • v${h.version}` : ""}`,
        });
      } else {
        toast.error(ar ? "تعذر الوصول إلى خادم الربط" : "Bridge unreachable", { description: h.error ?? "Unknown error" });
      }
    },
  });

  const handleDisconnect = () => {
    if (!window.confirm(t.confirmDisconnect)) return;
    disconnectMut.mutate();
  };

  const fmtTime = (s: string | null) => {
    if (!s) return "—";
    try {
      return new Date(s).toLocaleString(ar ? "ar-EG" : "en-US", {
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch { return s; }
  };

  return (
    <DashboardLayout title={t.title}>
      <div className="mx-auto max-w-5xl space-y-6" dir={ar ? "rtl" : "ltr"}>
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] text-white shadow-lg">
              <MessageCircle className="h-7 w-7" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{t.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
            </div>
          </div>
          <StatusBadge status={status} t={t} />
        </div>

        {stateQuery.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            {/* Main: account card OR empty */}
            <div className="space-y-6">
              {hasAccount ? (
                <>
                  {/* Linked account card */}
                  <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <h2 className="text-base font-bold text-foreground">{t.myAccount}</h2>
                      <StatusDot status={status} />
                    </div>

                    {/* Phone hero */}
                    <div className="flex flex-col items-center gap-2 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 py-6 text-center">
                      <Smartphone className="h-8 w-8 text-primary" />
                      {state.phoneNumber ? (
                        <div className="text-2xl font-bold tracking-wide text-foreground" dir="ltr">
                          +{state.phoneNumber}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          {ar ? "لم يتم تحديد الرقم بعد" : "Phone not detected yet"}
                        </div>
                      )}
                    </div>

                    {/* Meta */}
                    <dl className="mt-5 grid grid-cols-1 gap-2.5 text-sm sm:grid-cols-2">
                      <MetaRow label={t.sessionLabel} value={<span className="truncate font-mono text-xs" dir="ltr">{state.sessionId}</span>} />
                      <MetaRow label={t.lastSeenLabel} value={fmtTime(state.lastSeenAt)} />
                    </dl>

                    {errorMsg && (
                      <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="leading-relaxed">
                          <div className="font-semibold">{t.errorTitle}</div>
                          <div className="mt-0.5 text-xs opacity-90">{errorMsg}</div>
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => stateQuery.refetch()}
                        disabled={stateQuery.isFetching}
                        className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted/60 disabled:opacity-60"
                      >
                        <RefreshCw className={`h-4 w-4 ${stateQuery.isFetching ? "animate-spin" : ""}`} />
                        {t.refresh}
                      </button>

                      {status !== "connected" && (
                        <button
                          type="button"
                          onClick={() => setShowQr((v) => !v)}
                          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted/60"
                        >
                          <QrCode className="h-4 w-4" />
                          {showQr ? t.hideQr : t.showQr}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => connectMut.mutate()}
                        disabled={connectMut.isPending}
                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-muted px-4 text-sm font-semibold text-foreground hover:bg-muted/80 disabled:opacity-60"
                      >
                        {connectMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        {t.reconnect}
                      </button>

                      {/* Disconnect — always visible when account row exists */}
                      <button
                        type="button"
                        onClick={handleDisconnect}
                        disabled={disconnectMut.isPending}
                        className="ms-auto inline-flex h-10 items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 text-sm font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-60"
                      >
                        {disconnectMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                        {t.disconnect}
                      </button>
                    </div>
                  </div>

                  {/* QR section (collapsible, only when needed) */}
                  {showQr && status !== "connected" && (
                    <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
                      <h3 className="mb-4 text-base font-bold text-foreground">
                        {ar ? "امسح الكود لإكمال الربط" : "Scan the code to complete linking"}
                      </h3>
                      {qrValue ? (
                        <QrView qr={qrValue} polling={polling} t={t} />
                      ) : (
                        <div className="flex flex-col items-center gap-3 py-6">
                          <Loader2 className="h-8 w-8 animate-spin text-primary" />
                          <p className="text-sm text-muted-foreground">
                            {ar ? "جارٍ توليد الكود…" : "Generating code…"}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                /* Empty state */
                <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border/60 bg-muted/20 px-6 py-16 text-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10">
                    <Smartphone className="h-10 w-10 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{t.noAccount}</h2>
                    <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t.noAccountDesc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => connectMut.mutate()}
                    disabled={connectMut.isPending}
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] px-6 text-sm font-semibold text-primary-foreground shadow-md hover:opacity-95 disabled:opacity-60"
                  >
                    {connectMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    {t.connect}
                  </button>
                </div>
              )}
            </div>

            {/* Side panel: how-to + bridge */}
            <div className="space-y-6">
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
                <div className="mt-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                  <AlertCircle className="mb-1 me-1 inline h-3.5 w-3.5" />
                  {t.qrExpire}
                </div>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <Wifi className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-bold text-foreground">{t.bridgeLabel}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => pingMut.mutate()}
                  disabled={pingMut.isPending}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-xs font-semibold text-foreground hover:bg-muted/60 disabled:opacity-60"
                >
                  {pingMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {t.ping}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function StatusBadge({
  status,
  t,
}: {
  status: string;
  t: { connected: string; disconnected: string; pendingQr: string; connecting: string; unknown: string };
}) {
  const map: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
    connected: { label: t.connected, cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", icon: CheckCircle2 },
    qr: { label: t.pendingQr, cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30", icon: QrCode },
    connecting: { label: t.connecting, cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30", icon: Loader2 },
    disconnected: { label: t.disconnected, cls: "bg-muted text-muted-foreground border-border", icon: WifiOff },
    unknown: { label: t.unknown, cls: "bg-muted text-muted-foreground border-border", icon: AlertCircle },
  };
  const s = map[status] || map.unknown;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold ${s.cls}`}>
      <Icon className={`h-3.5 w-3.5 ${status === "connecting" ? "animate-spin" : ""}`} />
      {s.label}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "connected" ? "bg-emerald-500" :
    status === "qr" || status === "connecting" ? "bg-amber-500" :
    "bg-muted-foreground/40";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color} ${status !== "connected" ? "animate-pulse" : ""}`} />;
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/30 px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="min-w-0 text-end text-xs font-semibold text-foreground">{value}</span>
    </div>
  );
}

function QrView({ qr, polling, t }: { qr: string; polling: boolean; t: { scan: string; scanWaiting: string } }) {
  const isDataUrl = qr.startsWith("data:image");
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-2xl border-4 border-primary/20 bg-white p-3 shadow-lg">
        {isDataUrl ? (
          <img src={qr} alt="WhatsApp QR Code" className="h-56 w-56" />
        ) : (
          <QRCodeSVG value={qr} size={224} level="M" includeMargin={false} />
        )}
      </div>
      <p className="max-w-md text-center text-xs leading-relaxed text-muted-foreground">{t.scan}</p>
      {polling && (
        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t.scanWaiting}
        </div>
      )}
    </div>
  );
}
