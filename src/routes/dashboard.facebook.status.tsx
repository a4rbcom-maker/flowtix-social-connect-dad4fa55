import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import {
  Facebook, Loader2, RefreshCw, ShieldCheck, ShieldAlert, CheckCircle2,
  XCircle, Clock, KeyRound, User2, Mail, Calendar, ArrowLeft, Sparkles,
  Copy, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { toast } from "sonner";
import { inspectFacebookConnection, disconnectFacebook } from "@/lib/facebook.functions";

export const Route = createFileRoute("/dashboard/facebook/status")({
  component: FacebookStatusPage,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callServerFn(fn: any, payload?: unknown) {
  return payload === undefined ? fn() : fn({ data: payload });
}

type Inspection = Awaited<ReturnType<typeof inspectFacebookConnection>>;

function FacebookStatusPage() {
  const { user, loading: authLoading } = useAuth();
  const { lang } = useI18n();
  const navigate = useNavigate();
  const [data, setData] = useState<Inspection | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const t = lang === "ar" ? {
    title: "حالة اتصال فيسبوك",
    subtitle: "تفاصيل التوكن المخزّن، الصلاحيات الممنوحة، وتاريخ الانتهاء",
    refresh: "تحديث الفحص",
    refreshing: "جاري الفحص...",
    back: "العودة لربط فيسبوك",
    notConnected: "لا يوجد اتصال بفيسبوك حالياً",
    notConnectedDesc: "اربط حسابك من صفحة فيسبوك لتظهر هنا تفاصيل الاتصال.",
    connect: "ربط حساب فيسبوك",
    statusValid: "التوكن صالح وفعّال",
    statusInvalid: "التوكن غير صالح",
    statusExpired: "انتهت صلاحية التوكن",
    statusValidDesc: "يمكنك تحميل الجروبات والصفحات بدون مشاكل.",
    statusInvalidDesc: "يجب إعادة توليد توكن جديد من Graph Explorer.",
    statusExpiredDesc: "أنشئ توكن جديد وأعد الربط لاستئناف العمل.",
    profile: "الملف الشخصي",
    name: "الاسم",
    email: "البريد",
    fbId: "معرّف فيسبوك",
    tokenInfo: "معلومات التوكن",
    preview: "معاينة آمنة",
    length: "الطول",
    chars: "حرف",
    expiresAt: "ينتهي في",
    dataExpiresAt: "صلاحية الوصول للبيانات حتى",
    neverExpires: "لا ينتهي (long-lived)",
    appName: "التطبيق",
    lastSync: "آخر مزامنة",
    createdAt: "تاريخ الربط",
    notSynced: "لم تتم بعد",
    scopes: "الصلاحيات",
    granted: "ممنوحة",
    missing: "ناقصة",
    declined: "مرفوضة",
    allGranted: "جميع الصلاحيات المطلوبة موجودة ✓",
    missingScopes: "صلاحيات مفقودة — أعد إنشاء التوكن مع إضافتها",
    copyId: "نسخ المعرّف",
    copied: "تم النسخ",
    disconnect: "إلغاء الربط",
    disconnected: "تم إلغاء الربط",
    expiresIn: "تنتهي خلال",
    days: "يوم",
    hours: "ساعة",
    expired: "منتهية",
    refreshToken: "تحديث/تجديد التوكن",
  } : {
    title: "Facebook Connection Status",
    subtitle: "Stored token details, granted scopes, and expiry info",
    refresh: "Re-check status",
    refreshing: "Checking...",
    back: "Back to Facebook page",
    notConnected: "No Facebook connection",
    notConnectedDesc: "Connect your account from the Facebook page to see status details here.",
    connect: "Connect Facebook",
    statusValid: "Token is valid & active",
    statusInvalid: "Token is invalid",
    statusExpired: "Token has expired",
    statusValidDesc: "You can load groups and pages without issues.",
    statusInvalidDesc: "Generate a new token from Graph Explorer.",
    statusExpiredDesc: "Generate a new token and reconnect to resume.",
    profile: "Profile",
    name: "Name",
    email: "Email",
    fbId: "Facebook ID",
    tokenInfo: "Token info",
    preview: "Safe preview",
    length: "Length",
    chars: "chars",
    expiresAt: "Expires at",
    dataExpiresAt: "Data access expires at",
    neverExpires: "Never expires (long-lived)",
    appName: "Application",
    lastSync: "Last synced",
    createdAt: "Connected since",
    notSynced: "Not yet",
    scopes: "Permissions",
    granted: "Granted",
    missing: "Missing",
    declined: "Declined",
    allGranted: "All required permissions granted ✓",
    missingScopes: "Missing permissions — regenerate the token with these added",
    copyId: "Copy ID",
    copied: "Copied",
    disconnect: "Disconnect",
    disconnected: "Disconnected",
    expiresIn: "Expires in",
    days: "days",
    hours: "hours",
    expired: "Expired",
    refreshToken: "Refresh / renew token",
  };

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await callServerFn(inspectFacebookConnection);
      setData(res);
      if (silent) toast.success(t.refresh);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast.error(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t.refresh]);

  useEffect(() => {
    if (user) load(false);
  }, [user, load]);

  const fmtDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString(lang === "ar" ? "ar-EG" : "en-US");
  };

  const expiresIn = (iso: string | null): string => {
    if (!iso) return t.neverExpires;
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return t.expired;
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    if (days > 0) return `${days} ${t.days}`;
    return `${hours} ${t.hours}`;
  };

  const handleDisconnect = async () => {
    try {
      await callServerFn(disconnectFacebook);
      toast.success(t.disconnected);
      navigate({ to: "/dashboard/facebook" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const copy = (val: string) => {
    navigator.clipboard.writeText(val);
    toast.success(t.copied);
  };

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <DashboardLayout title={t.title}>
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/dashboard/facebook"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            {t.back}
          </Link>
          <button
            onClick={() => load(true)}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/20 hover:opacity-95 disabled:opacity-60"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {refreshing ? t.refreshing : t.refresh}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center rounded-2xl border border-border/50 bg-card p-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !data || !data.connected ? (
          <div className="rounded-2xl border border-border/50 bg-card p-12 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
              <Facebook className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="mb-2 text-xl font-bold text-foreground">{t.notConnected}</h2>
            <p className="mb-6 text-sm text-muted-foreground">{t.notConnectedDesc}</p>
            <Link
              to="/dashboard/facebook"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] px-5 py-2.5 text-sm font-semibold text-white shadow-lg"
            >
              <Facebook className="h-4 w-4" /> {t.connect}
            </Link>
          </div>
        ) : (
          <>
            {/* Hero status banner */}
            <div className={`overflow-hidden rounded-2xl border shadow-sm ${
              data.isExpired ? "border-amber-500/40 bg-gradient-to-br from-amber-500/10 to-amber-500/5"
              : !data.valid ? "border-destructive/40 bg-gradient-to-br from-destructive/10 to-destructive/5"
              : "border-green-500/40 bg-gradient-to-br from-green-500/10 to-emerald-500/5"
            }`}>
              <div className="flex flex-wrap items-center gap-4 p-6">
                <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl shadow-lg ${
                  data.isExpired ? "bg-amber-500 text-white"
                  : !data.valid ? "bg-destructive text-white"
                  : "bg-green-500 text-white"
                }`}>
                  {data.isExpired ? <Clock className="h-7 w-7" />
                    : !data.valid ? <ShieldAlert className="h-7 w-7" />
                    : <ShieldCheck className="h-7 w-7" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-bold text-foreground">
                    {data.isExpired ? t.statusExpired : !data.valid ? t.statusInvalid : t.statusValid}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {data.isExpired ? t.statusExpiredDesc : !data.valid ? t.statusInvalidDesc : t.statusValidDesc}
                  </p>
                  {data.validationError && (
                    <p className="mt-1 text-xs text-destructive">{data.validationError}</p>
                  )}
                </div>
                {(!data.valid || data.isExpired) && (
                  <Link
                    to="/dashboard/facebook"
                    className="inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background hover:opacity-90"
                  >
                    <Sparkles className="h-4 w-4" /> {t.refreshToken}
                  </Link>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Profile card */}
              <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <User2 className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{t.profile}</h3>
                </div>
                <dl className="space-y-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">{t.name}</dt>
                    <dd className="font-medium text-foreground">{data.profile?.name ?? data.storedProfile.name ?? "—"}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="flex items-center gap-1.5 text-muted-foreground"><Mail className="h-3.5 w-3.5" />{t.email}</dt>
                    <dd className="break-all text-end font-medium text-foreground">{data.profile?.email ?? data.storedProfile.email ?? "—"}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">{t.fbId}</dt>
                    <dd className="flex items-center gap-2">
                      <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{data.profile?.id ?? data.storedProfile.id}</code>
                      <button
                        onClick={() => copy(data.profile?.id ?? data.storedProfile.id ?? "")}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label={t.copyId}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="flex items-center gap-1.5 text-muted-foreground"><Calendar className="h-3.5 w-3.5" />{t.createdAt}</dt>
                    <dd className="text-end font-medium text-foreground">{fmtDate(data.createdAt)}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">{t.lastSync}</dt>
                    <dd className="text-end font-medium text-foreground">{data.lastSyncedAt ? fmtDate(data.lastSyncedAt) : t.notSynced}</dd>
                  </div>
                </dl>
              </div>

              {/* Token card */}
              <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{t.tokenInfo}</h3>
                </div>
                <dl className="space-y-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">{t.preview}</dt>
                    <dd>
                      <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">{data.tokenPreview}</code>
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">{t.length}</dt>
                    <dd className="font-medium text-foreground">{data.tokenLength} {t.chars}</dd>
                  </div>
                  {data.appName && (
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-muted-foreground">{t.appName}</dt>
                      <dd className="font-medium text-foreground">{data.appName}</dd>
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">{t.expiresAt}</dt>
                    <dd className="text-end">
                      <div className="font-medium text-foreground">{data.expiresAt ? fmtDate(data.expiresAt) : t.neverExpires}</div>
                      {data.expiresAt && (
                        <div className={`text-xs ${data.isExpired ? "text-destructive" : "text-muted-foreground"}`}>
                          {t.expiresIn}: {expiresIn(data.expiresAt)}
                        </div>
                      )}
                    </dd>
                  </div>
                  {data.dataAccessExpiresAt && (
                    <div className="flex items-start justify-between gap-3">
                      <dt className="text-muted-foreground">{t.dataExpiresAt}</dt>
                      <dd className="text-end font-medium text-foreground">{fmtDate(data.dataAccessExpiresAt)}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>

            {/* Scopes */}
            <div className="rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{t.scopes}</h3>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 font-medium text-green-700 dark:text-green-400">
                    <CheckCircle2 className="h-3 w-3" /> {data.granted.length} {t.granted}
                  </span>
                  {data.missingScopes.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3" /> {data.missingScopes.length} {t.missing}
                    </span>
                  )}
                  {data.declined.length > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
                      <XCircle className="h-3 w-3" /> {data.declined.length} {t.declined}
                    </span>
                  )}
                </div>
              </div>

              {data.missingScopes.length === 0 ? (
                <div className="mb-4 rounded-xl bg-green-500/5 p-3 text-sm font-medium text-green-700 dark:text-green-400">
                  {t.allGranted}
                </div>
              ) : (
                <div className="mb-4 rounded-xl bg-amber-500/5 p-3 text-sm font-medium text-amber-700 dark:text-amber-400">
                  {t.missingScopes}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.granted}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.requiredScopes.map((scope) => {
                      const isGranted = data.granted.includes(scope);
                      return (
                        <span
                          key={scope}
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-xs ring-1 ${
                            isGranted
                              ? "bg-green-500/10 text-green-700 ring-green-500/30 dark:text-green-400"
                              : "bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-400"
                          }`}
                        >
                          {isGranted ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                          {scope}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {data.declined.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.declined}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {data.declined.map((s) => (
                        <span key={s} className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 font-mono text-xs text-destructive ring-1 ring-destructive/30">
                          <XCircle className="h-3 w-3" /> {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Disconnect */}
            <div className="flex justify-end">
              <button
                onClick={handleDisconnect}
                className="inline-flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
              >
                <XCircle className="h-4 w-4" />
                {t.disconnect}
              </button>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
