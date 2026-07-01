// Premium auto-popup modal that surfaces unread platform announcements.
// Mounted once at DashboardLayout level — listens to getMyNotifications and
// shows the first unread popup-eligible announcement.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Info, AlertTriangle, CheckCircle2, XCircle, Bell, Wrench, Gift, Megaphone, X, Check, ShieldAlert,
} from "lucide-react";
import {
  getMyNotifications,
  markNotificationOpened,
  markNotificationRead,
} from "@/lib/notifications.functions";
import { useI18n } from "@/lib/i18n";

const TYPE_META: Record<string, { icon: typeof Info; gradient: string; ring: string; ar: string; en: string }> = {
  info: { icon: Info, gradient: "from-sky-500 to-blue-600", ring: "ring-sky-500/30", ar: "معلومة", en: "Info" },
  success: { icon: CheckCircle2, gradient: "from-emerald-500 to-teal-600", ring: "ring-emerald-500/30", ar: "نجاح", en: "Success" },
  warning: { icon: AlertTriangle, gradient: "from-amber-500 to-orange-600", ring: "ring-amber-500/30", ar: "تحذير", en: "Warning" },
  alert: { icon: ShieldAlert, gradient: "from-rose-500 to-red-600", ring: "ring-rose-500/30", ar: "تنبيه", en: "Alert" },
  update: { icon: Bell, gradient: "from-violet-500 to-purple-600", ring: "ring-violet-500/30", ar: "تحديث", en: "Update" },
  maintenance: { icon: Wrench, gradient: "from-slate-500 to-zinc-700", ring: "ring-slate-500/30", ar: "صيانة", en: "Maintenance" },
  offer: { icon: Gift, gradient: "from-fuchsia-500 to-pink-600", ring: "ring-fuchsia-500/30", ar: "عرض", en: "Offer" },
};

const PRIORITY_BADGE: Record<string, { ar: string; en: string; cls: string }> = {
  low: { ar: "منخفضة", en: "Low", cls: "bg-muted text-muted-foreground" },
  normal: { ar: "عادية", en: "Normal", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  high: { ar: "عالية", en: "High", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  urgent: { ar: "عاجلة", en: "Urgent", cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400 animate-pulse" },
};

export function AnnouncementModal() {
  const { lang, dir } = useI18n();
  const qc = useQueryClient();
  const fetchFn = useServerFn(getMyNotifications);
  const openedFn = useServerFn(markNotificationOpened);
  const readFn = useServerFn(markNotificationRead);

  const { data } = useQuery({
    queryKey: ["my-notifications"],
    queryFn: async () => {
      try {
        return await fetchFn();
      } catch {
        return { rows: [], unreadCount: 0, popupId: null as string | null };
      }
    },
    retry: false,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const [dismissedSession, setDismissedSession] = useState<string[]>([]);
  const popup = (data?.rows ?? []).find(
    (r) => r.id === data?.popupId && !dismissedSession.includes(r.id),
  );

  // Mark opened the moment it surfaces
  useEffect(() => {
    if (!popup) return;
    openedFn({ data: { announcementId: popup.id } }).catch(() => {});
  }, [popup, openedFn]);

  const ackMut = useMutation({
    mutationFn: (ack: boolean) =>
      readFn({ data: { announcementId: popup!.id, ack } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-notifications"] });
      if (popup) setDismissedSession((d) => [...d, popup.id]);
    },
  });

  if (!popup) return null;

  const type = popup.notif_type ?? popup.level ?? "info";
  const meta = TYPE_META[type] ?? TYPE_META.info;
  const Icon = meta.icon;
  const prio = PRIORITY_BADGE[popup.priority ?? "normal"] ?? PRIORITY_BADGE.normal;
  const requiresAck = popup.require_ack;

  return (
    <AnimatePresence>
      <motion.div
        key="overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        dir={dir}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-md p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget && !requiresAck) {
            setDismissedSession((d) => [...d, popup.id]);
          }
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: "spring", stiffness: 280, damping: 28 }}
          className={`relative w-full max-w-lg overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl ring-4 ${meta.ring}`}
        >
          {/* Gradient header */}
          <div className={`relative bg-gradient-to-br ${meta.gradient} p-6 text-white`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-white/20 p-2.5 backdrop-blur">
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider opacity-90">
                    {lang === "ar" ? meta.ar : meta.en}
                  </span>
                  <span className={`ms-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${prio.cls}`}>
                    {lang === "ar" ? prio.ar : prio.en}
                  </span>
                </div>
              </div>
              {!requiresAck && (
                <button
                  onClick={() => setDismissedSession((d) => [...d, popup.id])}
                  className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <h2 className="mt-4 text-xl font-bold leading-tight">{popup.title}</h2>
          </div>

          {/* Body */}
          <div className="space-y-4 p-6">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {popup.body}
            </p>

            {requiresAck && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  {lang === "ar"
                    ? "يجب تأكيد قراءة هذا الإشعار قبل المتابعة."
                    : "You must confirm reading this notification before continuing."}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-border/40 pt-4">
              <p className="text-[11px] text-muted-foreground">
                {new Date(popup.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}
              </p>
              <div className="flex gap-2">
                {!requiresAck && (
                  <button
                    onClick={() => {
                      ackMut.mutate(false);
                    }}
                    disabled={ackMut.isPending}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50"
                  >
                    {lang === "ar" ? "تم القراءة" : "Mark as read"}
                  </button>
                )}
                <button
                  onClick={() => ackMut.mutate(requiresAck)}
                  disabled={ackMut.isPending}
                  className={`inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br ${meta.gradient} px-4 py-1.5 text-xs font-bold text-white shadow-lg shadow-primary/20 transition hover:opacity-90 disabled:opacity-50`}
                >
                  <Check className="h-3.5 w-3.5" />
                  {requiresAck
                    ? (lang === "ar" ? "أؤكد القراءة" : "Confirm reading")
                    : (lang === "ar" ? "حسناً" : "Got it")}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
