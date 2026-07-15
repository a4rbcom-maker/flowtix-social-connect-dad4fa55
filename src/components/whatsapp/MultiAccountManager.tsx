// Multi-account management card for the WhatsApp accounts page.
// Lists every WhatsApp session the user owns and lets them add / rename /
// remove / promote them, respecting the plan-level wa_accounts_max limit.
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { QRCodeSVG } from "qrcode.react";
import {
  Plus,
  Loader2,
  Star,
  StarOff,
  Trash2,
  Pencil,
  Check,
  X,
  Wifi,
  WifiOff,
  Phone,
  QrCode,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  listWaSessions,
  addWaSessionSlot,
  renameWaSession,
  setPrimaryWaSession,
  removeWaSessionSlot,
  getWaSessionStateFor,
  resetWaSessionFor,
  type WaAccountRow,
  type WaConnectionState,
} from "@/lib/wa.functions";

interface Props {
  ar: boolean;
  usage: { used: number; max: number; planName: string } | null;
}

export function MultiAccountManager({ ar, usage }: Props) {
  const qc = useQueryClient();
  const listFn = useServerFn(listWaSessions);
  const addFn = useServerFn(addWaSessionSlot);
  const renameFn = useServerFn(renameWaSession);
  const promoteFn = useServerFn(setPrimaryWaSession);
  const removeFn = useServerFn(removeWaSessionSlot);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [openQrFor, setOpenQrFor] = useState<string | null>(null);

  const t = ar
    ? {
        title: "أرقامي المرتبطة",
        subtitle: "أدر كل أرقام واتساب المفتوحة على حسابك.",
        add: "إضافة رقم جديد",
        limitReached: "وصلت الحد الأقصى للأرقام في باقتك",
        primary: "افتراضي",
        setPrimary: "اجعله افتراضي",
        rename: "تعديل الاسم",
        remove: "حذف الرقم",
        removeConfirm: "سيتم فصل هذا الرقم وحذفه من قائمة الأرقام. المتابعة؟",
        namePh: "اسم مميّز (اختياري) — مثال: متجر مصر",
        added: "تم إنشاء رقم جديد — امسح كود QR من صفحة الجلسة الرئيسية بعد جعله افتراضياً.",
        empty: "لا يوجد أرقام مربوطة بعد. اضغط «ربط رقم جديد» أعلاه لبدء الربط.",
        status_connected: "متصل",
        status_qr: "بانتظار QR",
        status_connecting: "جارٍ الاتصال",
        status_disconnected: "غير متصل",
        unnamed: "بدون اسم",
        no_phone: "لم يتم التعرف على الرقم بعد",
        planUpgrade: "لترقية باقتك اذهب لصفحة الباقات.",
        showQr: "عرض QR للربط",
        hideQr: "إخفاء QR",
        refreshQr: "تحديث الكود",
        scanHint: "افتح واتساب → الأجهزة المرتبطة → ربط جهاز، ثم امسح الكود.",
        loadingQr: "جارٍ توليد الكود…",
        qrConnected: "تم ربط هذا الرقم بنجاح ✓",
      }
    : {
        title: "My Linked Numbers",
        subtitle: "Manage every WhatsApp number linked to your account.",
        add: "Add new number",
        limitReached: "You reached your plan's number limit",
        primary: "Default",
        setPrimary: "Make default",
        rename: "Edit name",
        remove: "Remove number",
        removeConfirm: "This will disconnect and remove this number. Continue?",
        namePh: "Optional label — e.g. Cairo store",
        added: "New number slot created — click 'Show QR' on the new card to scan.",
        empty: "No numbers linked yet. Click 'Link new number' above to get started.",
        status_connected: "Connected",
        status_qr: "Awaiting QR",
        status_connecting: "Connecting",
        status_disconnected: "Disconnected",
        unnamed: "Unnamed",
        no_phone: "Phone not detected yet",
        planUpgrade: "Upgrade your plan for more numbers.",
        showQr: "Show QR to link",
        hideQr: "Hide QR",
        refreshQr: "Refresh code",
        scanHint: "Open WhatsApp → Linked devices → Link a device, then scan.",
        loadingQr: "Generating code…",
        qrConnected: "This number is now linked ✓",
      };

  const listQ = useQuery<WaAccountRow[]>({
    queryKey: ["wa-sessions-list"],
    queryFn: () => listFn(),
    refetchInterval: 15_000,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["wa-sessions-list"] });
    qc.invalidateQueries({ queryKey: ["wa-accounts-usage"] });
    qc.invalidateQueries({ queryKey: ["wa-state"] });
  };

  const addMut = useMutation({
    mutationFn: () => addFn({ data: {} }),
    onSuccess: () => {
      toast.success(t.added);
      invalidateAll();
    },
    onError: (err: Error) => {
      if (err.message === "PLAN_LIMIT_REACHED") {
        toast.error(t.limitReached, { description: t.planUpgrade });
      } else {
        toast.error(err.message);
      }
    },
  });

  const renameMut = useMutation({
    mutationFn: (vars: { sessionId: string; label: string }) => renameFn({ data: vars }),
    onSuccess: () => {
      setEditingId(null);
      invalidateAll();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const promoteMut = useMutation({
    mutationFn: (sessionId: string) => promoteFn({ data: { sessionId } }),
    onSuccess: invalidateAll,
    onError: (err: Error) => toast.error(err.message),
  });

  const removeMut = useMutation({
    mutationFn: (sessionId: string) => removeFn({ data: { sessionId } }),
    onSuccess: invalidateAll,
    onError: (err: Error) => toast.error(err.message),
  });

  const rows = listQ.data ?? [];
  const atLimit = usage ? usage.used >= usage.max : false;

  const statusLabel = (s: string) =>
    s === "connected" ? t.status_connected
    : s === "qr" ? t.status_qr
    : s === "connecting" ? t.status_connecting
    : t.status_disconnected;

  // Each account box gets a strong green/red visual identity.
  const isConnected = (s: string) => s === "connected";
  const isPending = (s: string) => s === "qr" || s === "connecting";

  const boxClasses = (s: string) =>
    isConnected(s)
      ? "border-emerald-500/60 bg-emerald-500/5 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]"
      : isPending(s)
      ? "border-amber-500/50 bg-amber-500/5"
      : "border-red-500/60 bg-red-500/5 shadow-[0_0_0_1px_rgba(239,68,68,0.15)]";

  const dotClasses = (s: string) =>
    isConnected(s)
      ? "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]"
      : isPending(s)
      ? "bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,0.15)]"
      : "bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.15)]";

  const badgeClasses = (s: string) =>
    isConnected(s)
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40"
      : isPending(s)
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40"
      : "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/40";

  const iconWrapClasses = (s: string) =>
    isConnected(s)
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : isPending(s)
      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
      : "bg-red-500/15 text-red-600 dark:text-red-400";

  const accountWord = ar ? "حساب" : "Account";

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-foreground">{t.title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <button
          type="button"
          disabled={atLimit || addMut.isPending}
          onClick={() => addMut.mutate()}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          title={atLimit ? t.limitReached : undefined}
        >
          {addMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {t.add}
        </button>
      </div>

      {listQ.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          {t.empty}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((r, idx) => {
            const editing = editingId === r.sessionId;
            const connected = isConnected(r.status);
            return (
              <div
                key={r.sessionId}
                className={`relative rounded-2xl border-2 p-4 transition ${boxClasses(r.status)}`}
              >
                {/* Header: account number + status */}
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-7 items-center justify-center rounded-lg bg-foreground/90 px-2.5 text-xs font-bold text-background">
                      {accountWord} {idx + 1}
                    </span>
                    {r.isPrimary ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                        <Star className="h-3 w-3 fill-primary" /> {t.primary}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${dotClasses(r.status)}`} />
                    <span
                      className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${badgeClasses(r.status)}`}
                    >
                      {statusLabel(r.status)}
                    </span>
                  </div>
                </div>

                {/* Body */}
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconWrapClasses(r.status)}`}
                  >
                    {connected ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          type="text"
                          value={editingLabel}
                          onChange={(e) => setEditingLabel(e.target.value)}
                          placeholder={t.namePh}
                          maxLength={60}
                          className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
                        />
                        <button
                          type="button"
                          onClick={() => renameMut.mutate({ sessionId: r.sessionId, label: editingLabel })}
                          className="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-500/10"
                          disabled={renameMut.isPending}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="truncate text-sm font-semibold text-foreground">
                          {r.label || t.unnamed}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground" dir="ltr">
                          <Phone className="h-3 w-3" />
                          <span className="tabular-nums">{r.phoneNumber ? `+${r.phoneNumber}` : t.no_phone}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Actions */}
                {!editing && (
                  <div className="mt-3 flex items-center justify-between gap-1 border-t border-border/50 pt-2">
                    {!connected ? (
                      <button
                        type="button"
                        onClick={() =>
                          setOpenQrFor((prev) => (prev === r.sessionId ? null : r.sessionId))
                        }
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/15"
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        {openQrFor === r.sessionId ? t.hideQr : t.showQr}
                      </button>
                    ) : (
                      <span />
                    )}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title={t.rename}
                        onClick={() => {
                          setEditingId(r.sessionId);
                          setEditingLabel(r.label ?? "");
                        }}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {!r.isPrimary && (
                        <button
                          type="button"
                          title={t.setPrimary}
                          onClick={() => promoteMut.mutate(r.sessionId)}
                          disabled={promoteMut.isPending}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                        >
                          <StarOff className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {!r.isPrimary && (
                        <button
                          type="button"
                          title={t.remove}
                          onClick={() => {
                            if (window.confirm(t.removeConfirm)) removeMut.mutate(r.sessionId);
                          }}
                          disabled={removeMut.isPending}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Inline QR panel (per session) */}
                {!editing && !connected && openQrFor === r.sessionId && (
                  <SessionQrPanel
                    sessionId={r.sessionId}
                    ar={ar}
                    t={t}
                    onConnected={() => {
                      invalidateAll();
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-session inline QR panel
// ---------------------------------------------------------------------------

interface SessionQrPanelProps {
  sessionId: string;
  ar: boolean;
  t: {
    showQr: string;
    hideQr: string;
    refreshQr: string;
    scanHint: string;
    loadingQr: string;
    qrConnected: string;
  };
  onConnected: () => void;
}

function SessionQrPanel({ sessionId, t, onConnected }: SessionQrPanelProps) {
  const getStateFn = useServerFn(getWaSessionStateFor);
  const resetFn = useServerFn(resetWaSessionFor);
  const notifiedRef = useRef(false);

  const stateQ = useQuery<WaConnectionState | null>({
    queryKey: ["wa-session-state", sessionId],
    queryFn: () => getStateFn({ data: { sessionId } }),
    refetchInterval: (query) =>
      query.state.data?.status === "connected" ? false : 4_000,
  });

  const resetMut = useMutation({
    mutationFn: () => resetFn({ data: { sessionId } }),
    onSuccess: () => stateQ.refetch(),
    onError: (err: Error) => toast.error(err.message),
  });

  useEffect(() => {
    if (stateQ.data?.status === "connected" && !notifiedRef.current) {
      notifiedRef.current = true;
      toast.success(t.qrConnected);
      onConnected();
    }
  }, [stateQ.data?.status, t.qrConnected, onConnected]);

  const qr = stateQ.data?.qrRaw ?? stateQ.data?.qrDataUrl ?? null;
  const connected = stateQ.data?.status === "connected";

  return (
    <div className="mt-3 rounded-xl border border-border/60 bg-background/50 p-3">
      {connected ? (
        <div className="flex items-center justify-center gap-2 py-4 text-sm font-semibold text-emerald-600">
          <Wifi className="h-4 w-4" /> {t.qrConnected}
        </div>
      ) : qr ? (
        <div className="flex flex-col items-center gap-2">
          <div className="rounded-lg border-2 border-primary/20 bg-white p-2 shadow-sm">
            {qr.startsWith("data:image") ? (
              <img src={qr} alt="WhatsApp QR" className="h-40 w-40" />
            ) : (
              <QRCodeSVG value={qr} size={160} level="M" includeMargin={false} />
            )}
          </div>
          <p className="max-w-xs text-center text-[11px] leading-relaxed text-muted-foreground">
            {t.scanHint}
          </p>
          <button
            type="button"
            onClick={() => resetMut.mutate()}
            disabled={resetMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted/60 disabled:opacity-60"
          >
            {resetMut.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {t.refreshQr}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">{t.loadingQr}</span>
          <button
            type="button"
            onClick={() => resetMut.mutate()}
            disabled={resetMut.isPending}
            className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted/60 disabled:opacity-60"
          >
            {resetMut.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {t.refreshQr}
          </button>
        </div>
      )}
    </div>
  );
}
            );
          })}
        </div>
      )}
    </div>
  );
}
