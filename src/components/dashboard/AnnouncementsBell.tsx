// Compact bell that surfaces platform announcements (separate from send-log).
// Sits next to NotificationsBell in the dashboard header.
import { useState, useRef, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Info, AlertTriangle, CheckCircle2, Bell, Wrench, Gift, ShieldAlert } from "lucide-react";
import { getMyNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/notifications.functions";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";


const TYPE_ICONS: Record<string, { Icon: typeof Info; color: string }> = {
  info: { Icon: Info, color: "text-sky-500 bg-sky-500/15" },
  success: { Icon: CheckCircle2, color: "text-emerald-500 bg-emerald-500/15" },
  warning: { Icon: AlertTriangle, color: "text-amber-500 bg-amber-500/15" },
  alert: { Icon: ShieldAlert, color: "text-rose-500 bg-rose-500/15" },
  update: { Icon: Bell, color: "text-violet-500 bg-violet-500/15" },
  maintenance: { Icon: Wrench, color: "text-slate-500 bg-slate-500/15" },
  offer: { Icon: Gift, color: "text-fuchsia-500 bg-fuchsia-500/15" },
};

export function AnnouncementsBell() {
  const { lang, dir } = useI18n();
  const qc = useQueryClient();
  const fetchFn = useServerFn(getMyNotifications);
  const allReadFn = useServerFn(markAllNotificationsRead);
  const oneReadFn = useServerFn(markNotificationRead);

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
  });

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const allReadMut = useMutation({
    mutationFn: () => allReadFn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-notifications"] }),
  });
  const oneReadMut = useMutation({
    mutationFn: (id: string) => oneReadFn({ data: { announcementId: id, ack: false } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-notifications"] }),
  });

  type NotifRow = NonNullable<typeof data>["rows"][number];
  const items: NotifRow[] = (data?.rows ?? []).slice(0, 8);
  const unread = data?.unreadCount ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Announcements"
        className="relative rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Megaphone className="h-4 w-4" />
        {unread > 0 && (
          <>
            <span className="absolute -top-1.5 -end-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-pink-600 px-1 text-[10px] font-bold leading-none text-white shadow-md ring-2 ring-card">
              {unread > 99 ? "99+" : unread}
            </span>
            <span className="absolute -top-0.5 -end-0.5 h-2 w-2 animate-ping rounded-full bg-rose-500/60" />
          </>
        )}
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-2 w-80 origin-top overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl shadow-primary/10 ${
            dir === "rtl" ? "start-0" : "end-0"
          }`}
        >
          <div className="flex items-center justify-between border-b border-border/50 bg-gradient-to-br from-primary/5 to-transparent px-4 py-3">
            <div className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">{lang === "ar" ? "إشعارات المنصة" : "Announcements"}</h3>
              {unread > 0 && (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">{unread}</span>
              )}
            </div>
            {unread > 0 && (
              <button
                onClick={() => allReadMut.mutate()}
                disabled={allReadMut.isPending}
                className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
              >
                {lang === "ar" ? "تعليم الكل مقروء" : "Mark all read"}
              </button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Megaphone className="h-5 w-5 text-muted-foreground/60" />
                </div>
                <p className="mt-3 text-sm font-medium">{lang === "ar" ? "لا توجد إشعارات" : "No announcements"}</p>
              </div>
            ) : (
              <ul className="divide-y divide-border/40">
                {items.map((it) => {
                  const meta = TYPE_ICONS[it.notif_type ?? "info"] ?? TYPE_ICONS.info;
                  const isUnread = !it._read?.read_at && !it._read?.ack_at;
                  return (
                    <li key={it.id}>
                      <button
                        onClick={() => oneReadMut.mutate(it.id)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-start transition hover:bg-accent/50 ${isUnread ? "bg-primary/5" : ""}`}
                      >
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.color}`}>
                          <meta.Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`truncate text-sm ${isUnread ? "font-semibold" : "font-medium"}`}>{it.title}</p>
                            {isUnread && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{it.body}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground/70">
                            {new Date(it.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-border/50 p-2">
            <Link
              to="/dashboard/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1 rounded-lg py-2 text-xs font-semibold text-primary transition hover:bg-primary/5"
            >
              {lang === "ar" ? "مركز الإشعارات" : "Notification center"}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
