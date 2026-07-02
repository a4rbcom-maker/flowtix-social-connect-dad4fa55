// Client-side notification center — full history of platform announcements
// targeted at the current user, with filters and read-state.
import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Megaphone, Info, AlertTriangle, CheckCircle2, Bell, Wrench, Gift, ShieldAlert,
  Filter, Check,
} from "lucide-react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useI18n } from "@/lib/i18n";
import {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/notifications.functions";

export const Route = createFileRoute("/dashboard/notifications")({
  ssr: false,
  component: NotificationCenter,
});

const TYPES = [
  { v: "all", ar: "الكل", en: "All" },
  { v: "info", ar: "معلومة", en: "Info" },
  { v: "update", ar: "تحديث", en: "Update" },
  { v: "alert", ar: "تنبيه", en: "Alert" },
  { v: "warning", ar: "تحذير", en: "Warning" },
  { v: "maintenance", ar: "صيانة", en: "Maintenance" },
  { v: "offer", ar: "عرض", en: "Offer" },
];

const META: Record<string, { Icon: typeof Info; color: string; ring: string }> = {
  info: { Icon: Info, color: "text-sky-500 bg-sky-500/15", ring: "ring-sky-500/20" },
  success: { Icon: CheckCircle2, color: "text-emerald-500 bg-emerald-500/15", ring: "ring-emerald-500/20" },
  warning: { Icon: AlertTriangle, color: "text-amber-500 bg-amber-500/15", ring: "ring-amber-500/20" },
  alert: { Icon: ShieldAlert, color: "text-rose-500 bg-rose-500/15", ring: "ring-rose-500/20" },
  update: { Icon: Bell, color: "text-violet-500 bg-violet-500/15", ring: "ring-violet-500/20" },
  maintenance: { Icon: Wrench, color: "text-slate-500 dark:text-slate-400 bg-slate-500/15", ring: "ring-slate-500/20" },
  offer: { Icon: Gift, color: "text-fuchsia-500 bg-fuchsia-500/15", ring: "ring-fuchsia-500/20" },
};

function NotificationCenter() {
  const { lang, dir } = useI18n();
  const qc = useQueryClient();
  const fetchFn = useServerFn(getMyNotifications);
  const readFn = useServerFn(markNotificationRead);
  const allReadFn = useServerFn(markAllNotificationsRead);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["my-notifications"],
    queryFn: async () => {
      return await fetchFn();
    },
    retry: 1,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });


  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [type, setType] = useState<string>("all");

  type Row = NonNullable<typeof data>["rows"][number];
  const rows: Row[] = data?.rows ?? [];
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const isUnread = !r._read?.read_at && !r._read?.ack_at;
      if (filter === "unread" && !isUnread) return false;
      if (type !== "all" && (r.notif_type ?? "info") !== type) return false;
      return true;
    });
  }, [rows, filter, type]);

  const readMut = useMutation({
    mutationFn: (it: Row) => readFn({ data: { announcementId: it.id, ack: !!it.require_ack } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-notifications"] }),
  });
  const allReadMut = useMutation({
    mutationFn: () => allReadFn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-notifications"] }),
  });

  return (
    <DashboardLayout title={lang === "ar" ? "مركز الإشعارات" : "Notification Center"}>
      <div dir={dir} className="space-y-6">
        <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold">
                {lang === "ar" ? "جميع الإشعارات" : "All notifications"}
              </h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                {data?.unreadCount ?? 0} {lang === "ar" ? "غير مقروء" : "unread"}
              </span>
            </div>
            <button
              onClick={() => allReadMut.mutate()}
              disabled={allReadMut.isPending || (data?.unreadCount ?? 0) === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
              {lang === "ar" ? "تعليم الكل كمقروء" : "Mark all read"}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-lg border border-border p-1">
              {(["all", "unread"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {f === "all" ? (lang === "ar" ? "الكل" : "All") : (lang === "ar" ? "غير مقروء" : "Unread")}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <select value={type} onChange={(e) => setType(e.target.value)}
                className="rounded-lg border border-border bg-background px-2 py-1 text-xs">
                {TYPES.map((t) => <option key={t.v} value={t.v}>{lang === "ar" ? t.ar : t.en}</option>)}
              </select>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            {lang === "ar" ? "جاري التحميل..." : "Loading..."}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
            <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-40" />
            {lang === "ar" ? "لا توجد إشعارات" : "No notifications"}
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map((it, i) => {
              const meta = META[it.notif_type ?? "info"] ?? META.info;
              const isUnread = !it._read?.read_at && !it._read?.ack_at;
              return (
                <motion.div key={it.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className={`rounded-2xl border bg-card/70 backdrop-blur-xl p-5 transition ${isUnread ? `border-primary/40 ring-1 ${meta.ring}` : "border-border"}`}>
                  <div className="flex items-start gap-3">
                    <div className={`rounded-lg p-2 ${meta.color}`}><meta.Icon className="h-4 w-4" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className={`font-bold ${isUnread ? "" : "text-muted-foreground"}`}>{it.title}</h3>
                        {isUnread && <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />}
                        {it.priority === "urgent" && (
                          <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-300 animate-pulse">
                            {lang === "ar" ? "عاجل" : "Urgent"}
                          </span>
                        )}
                        {it.require_ack && !it._read?.ack_at && (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-300">
                            {lang === "ar" ? "يتطلب تأكيد" : "Needs ack"}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{it.body}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                        <span>{new Date(it.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</span>
                        {it._read?.read_at && (
                          <span>• {lang === "ar" ? "قُرئ" : "Read"}: {new Date(it._read.read_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</span>
                        )}
                      </div>
                    </div>
                    {isUnread && (
                      <button onClick={() => readMut.mutate(it)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted">
                        {it.require_ack ? (lang === "ar" ? "تأكيد" : "Confirm") : (lang === "ar" ? "مقروء" : "Mark read")}
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
