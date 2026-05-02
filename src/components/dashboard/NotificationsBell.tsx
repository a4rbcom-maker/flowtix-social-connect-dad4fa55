import { useState, useRef, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, CheckCircle2, XCircle, Loader2, Clock, MessageCircle, Facebook, Send, Settings } from "lucide-react";
import { useSendNotifications } from "@/hooks/useSendNotifications";
import { markAllRead, markRead, type SendChannel, type SendStatus, type SendLogRow } from "@/lib/notifications";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";

export function NotificationsBell() {
  const { items, unreadCount, loading } = useSendNotifications();
  const { user } = useAuth();
  const { lang, dir } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const t = lang === "ar"
    ? {
        title: "الإشعارات",
        empty: "لا توجد إشعارات بعد",
        emptyDesc: "ستظهر هنا حالات الإرسال (نجح، فشل، قيد المعالجة)",
        markAll: "تعليم الكل كمقروء",
        viewAll: "عرض السجل الكامل",
        loading: "جاري التحميل...",
      }
    : {
        title: "Notifications",
        empty: "No notifications yet",
        emptyDesc: "Send status updates (success, failed, processing) will appear here",
        markAll: "Mark all read",
        viewAll: "View full log",
        loading: "Loading...",
      };

  const recent = items.slice(0, 8);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -end-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.66_0.26_320)] px-1 text-[10px] font-bold leading-none text-primary-foreground shadow-md ring-2 ring-card">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -end-0.5 h-2 w-2 animate-ping rounded-full bg-primary/60" />
        )}
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-2 w-80 origin-top overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl shadow-primary/10 backdrop-blur-xl ${
            dir === "rtl" ? "start-0" : "end-0"
          }`}
        >
          <div className="flex items-center justify-between border-b border-border/50 bg-gradient-to-br from-primary/5 to-transparent px-4 py-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">{t.title}</h3>
              {unreadCount > 0 && (
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && user && (
              <button
                onClick={() => markAllRead(user.id)}
                className="text-xs font-medium text-primary hover:underline"
              >
                {t.markAll}
              </button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t.loading}
              </div>
            ) : recent.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Bell className="h-5 w-5 text-muted-foreground/60" />
                </div>
                <p className="mt-3 text-sm font-medium text-foreground">{t.empty}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t.emptyDesc}</p>
              </div>
            ) : (
              <ul className="divide-y divide-border/40">
                {recent.map((item) => (
                  <NotifItem key={item.id} item={item} lang={lang} onClick={() => markRead(item.id)} />
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border/50 p-2">
            <Link
              to="/dashboard/activity"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1 rounded-lg py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/5"
            >
              {t.viewAll}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

const channelMeta: Record<SendChannel, { icon: typeof Facebook; color: string }> = {
  whatsapp: { icon: MessageCircle, color: "from-green-500 to-emerald-600" },
  facebook: { icon: Facebook, color: "from-primary to-[oklch(0.66_0.26_320)]" },
  bulk: { icon: Send, color: "from-orange-500 to-amber-500" },
  system: { icon: Settings, color: "from-slate-500 to-slate-700" },
};

function NotifItem({
  item,
  lang,
  onClick,
}: {
  item: SendLogRow;
  lang: "ar" | "en";
  onClick: () => void;
}) {
  const meta = channelMeta[item.channel as SendChannel] ?? channelMeta.system;
  const Icon = meta.icon;
  return (
    <li>
      <button
        onClick={onClick}
        className={`flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-accent/50 ${
          !item.read ? "bg-primary/5" : ""
        }`}
      >
        <div className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${meta.color} text-white shadow-sm`}>
          <Icon className="h-4 w-4" />
          <StatusDot status={item.status as SendStatus} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={`truncate text-sm ${!item.read ? "font-semibold text-foreground" : "font-medium text-foreground/90"}`}>
              {item.title}
            </p>
            {!item.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
          </div>
          {(item.description || item.error_message) && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {item.error_message || item.description}
            </p>
          )}
          <p className="mt-1 text-[10px] text-muted-foreground/70">
            {formatTime(item.created_at, lang)}
          </p>
        </div>
      </button>
    </li>
  );
}

function StatusDot({ status }: { status: SendStatus }) {
  const cls = "absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-card flex items-center justify-center";
  if (status === "success") return <span className={`${cls} bg-green-500`}><CheckCircle2 className="h-2.5 w-2.5 text-white" /></span>;
  if (status === "failed") return <span className={`${cls} bg-destructive`}><XCircle className="h-2.5 w-2.5 text-white" /></span>;
  if (status === "processing") return <span className={`${cls} bg-blue-500`}><Loader2 className="h-2.5 w-2.5 animate-spin text-white" /></span>;
  return <span className={`${cls} bg-amber-500`}><Clock className="h-2 w-2 text-white" /></span>;
}

function formatTime(iso: string, lang: "ar" | "en"): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (lang === "ar") {
    if (min < 1) return "الآن";
    if (min < 60) return `منذ ${min} د`;
    if (hr < 24) return `منذ ${hr} س`;
    if (day < 7) return `منذ ${day} يوم`;
  } else {
    if (min < 1) return "now";
    if (min < 60) return `${min}m ago`;
    if (hr < 24) return `${hr}h ago`;
    if (day < 7) return `${day}d ago`;
  }
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US");
}
