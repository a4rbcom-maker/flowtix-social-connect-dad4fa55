// Multi-account management card for the WhatsApp accounts page.
// Lists every WhatsApp session the user owns and lets them add / rename /
// remove / promote them, respecting the plan-level wa_accounts_max limit.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
} from "lucide-react";
import { toast } from "sonner";
import {
  listWaSessions,
  addWaSessionSlot,
  renameWaSession,
  setPrimaryWaSession,
  removeWaSessionSlot,
  type WaAccountRow,
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
        added: "New number slot created — set it as default then scan the QR from the main session card.",
        empty: "No numbers linked yet. Click 'Link new number' above to get started.",
        status_connected: "Connected",
        status_qr: "Awaiting QR",
        status_connecting: "Connecting",
        status_disconnected: "Disconnected",
        unnamed: "Unnamed",
        no_phone: "Phone not detected yet",
        planUpgrade: "Upgrade your plan for more numbers.",
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

  const statusColor = (s: string) =>
    s === "connected"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
      : s === "qr" || s === "connecting"
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
      : "bg-muted text-muted-foreground border-border";

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
        <ul className="space-y-2">
          {rows.map((r) => {
            const editing = editingId === r.sessionId;
            return (
              <li
                key={r.sessionId}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2.5"
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    r.status === "connected" ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {r.status === "connected" ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
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
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {r.label || (ar ? t.unnamed : t.unnamed)}
                        </span>
                        {r.isPrimary ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                            <Star className="h-3 w-3 fill-primary" /> {t.primary}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground" dir="ltr">
                        <Phone className="h-3 w-3" />
                        <span className="tabular-nums">{r.phoneNumber ?? t.no_phone}</span>
                      </div>
                    </>
                  )}
                </div>

                <span
                  className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${statusColor(r.status)}`}
                >
                  {statusLabel(r.status)}
                </span>

                {!editing && (
                  <div className="flex shrink-0 items-center gap-1">
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
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
