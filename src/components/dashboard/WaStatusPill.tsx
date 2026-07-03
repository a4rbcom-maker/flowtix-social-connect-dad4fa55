// Compact WhatsApp session status pill for the dashboard header.
// Always visible so the user knows at a glance whether messages will
// actually send. Clicking navigates to the WhatsApp accounts page.
import { Link } from "@tanstack/react-router";
import { useWaDisconnectAlerts } from "@/hooks/useWaDisconnectAlerts";

interface Props {
  lang: "ar" | "en";
}

export function WaStatusPill({ lang }: Props) {
  const { status, disconnectedCount } = useWaDisconnectAlerts(lang);
  const isAr = lang === "ar";

  const cfg = (() => {
    switch (status) {
      case "connected":
        return {
          dot: "bg-emerald-500",
          ring: "bg-emerald-500/50",
          text: "text-emerald-700 dark:text-emerald-400",
          border: "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10",
          label: isAr ? "واتساب متصل" : "WhatsApp connected",
          pulse: false,
        };
      case "needs_qr":
        return {
          dot: "bg-destructive",
          ring: "bg-destructive/60",
          text: "text-destructive",
          border: "border-destructive/40 bg-destructive/10 hover:bg-destructive/15",
          label: isAr
            ? disconnectedCount > 1 ? `${disconnectedCount} جلسات — امسح QR` : "امسح QR — واتساب مقطوع"
            : disconnectedCount > 1 ? `${disconnectedCount} sessions — scan QR` : "Scan QR — WhatsApp offline",
          pulse: true,
        };
      case "connecting":
        return {
          dot: "bg-amber-500",
          ring: "bg-amber-500/50",
          text: "text-amber-700 dark:text-amber-400",
          border: "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10",
          label: isAr ? "جاري الاتصال…" : "Connecting…",
          pulse: true,
        };
      case "disconnected":
        return {
          dot: "bg-destructive",
          ring: "bg-destructive/60",
          text: "text-destructive",
          border: "border-destructive/40 bg-destructive/5 hover:bg-destructive/10",
          label: isAr
            ? disconnectedCount > 1 ? `${disconnectedCount} جلسات مقطوعة` : "واتساب مقطوع"
            : disconnectedCount > 1 ? `${disconnectedCount} sessions offline` : "WhatsApp offline",
          pulse: true,
        };

      default:
        return {
          dot: "bg-muted-foreground/60",
          ring: "bg-muted-foreground/30",
          text: "text-muted-foreground",
          border: "border-border bg-background hover:bg-accent",
          label: isAr ? "واتساب غير مربوط" : "WhatsApp not linked",
          pulse: false,
        };
    }
  })();

  return (
    <Link
      to="/dashboard/whatsapp/accounts"
      title={cfg.label}
      className={`hidden items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors md:inline-flex ${cfg.border} ${cfg.text}`}
    >
      <span className="relative flex h-2 w-2">
        {cfg.pulse && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${cfg.ring}`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${cfg.dot}`} />
      </span>
      <span className="whitespace-nowrap">{cfg.label}</span>
    </Link>
  );
}
