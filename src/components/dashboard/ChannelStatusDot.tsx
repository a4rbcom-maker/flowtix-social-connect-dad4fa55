// Visual status indicator for a channel (Facebook / WhatsApp) shown in the
// sidebar. Two layouts:
//   - inline (sidebar expanded): dot + optional days badge, with tooltip
//   - compact (sidebar collapsed): small dot absolutely-positioned over icon
import type { ChannelState } from "@/hooks/useChannelStatus";

const STATUS_STYLES: Record<ChannelState["status"], { dot: string; ring: string; pulse: boolean }> = {
  loading:      { dot: "bg-muted-foreground/30",  ring: "ring-muted-foreground/20", pulse: true  },
  connected:    { dot: "bg-emerald-500",          ring: "ring-emerald-500/30",      pulse: true  },
  expiring:     { dot: "bg-amber-500",            ring: "ring-amber-500/30",        pulse: true  },
  expired:      { dot: "bg-red-500",              ring: "ring-red-500/30",          pulse: false },
  disconnected: { dot: "bg-muted-foreground/40",  ring: "ring-muted-foreground/10", pulse: false },
};

interface Props {
  state: ChannelState;
  compact?: boolean;
  lang: "ar" | "en";
}

function toArabicDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

export function ChannelStatusDot({ state, compact, lang }: Props) {
  const styles = STATUS_STYLES[state.status];

  if (compact) {
    // Absolutely positioned over channel icon — caller wraps icon in `relative`.
    return (
      <span
        title={state.label}
        aria-label={state.label}
        className={`pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card ${styles.dot} ${styles.pulse ? "animate-pulse" : ""}`}
      />
    );
  }

  const showBadge = state.status === "expiring" && state.daysLeft != null;
  const dayUnit = lang === "ar" ? "ي" : "d";

  return (
    <span
      title={state.label}
      aria-label={state.label}
      className="inline-flex shrink-0 items-center gap-1.5"
    >
      <span className="relative inline-flex h-2 w-2">
        {styles.pulse && (
          <span
            className={`absolute inset-0 rounded-full opacity-60 ${styles.dot} animate-ping`}
            aria-hidden="true"
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ring-1 ${styles.dot} ${styles.ring}`} />
      </span>
      {showBadge && (
        <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-700 dark:text-amber-300">
          {(lang === "ar" ? toArabicDigits(state.daysLeft!) : state.daysLeft)}
          {dayUnit}
        </span>
      )}
    </span>
  );
}
