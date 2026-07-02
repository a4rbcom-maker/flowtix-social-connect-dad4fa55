// Inline quick-action row rendered inside the Facebook / WhatsApp sidebar
// groups so the user can connect or disconnect a channel without opening
// any subpage. Behavior is driven by the live ChannelState provided by
// useChannelStatus in the parent layout.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { LinkIcon, LogOut, RefreshCw, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { disconnectFacebook } from "@/lib/facebook.functions";
import { disconnectWaSession } from "@/lib/wa.functions";
import { useFacebookApi, describeFbError } from "@/features/facebook/api";
import type { ChannelState } from "@/hooks/useChannelStatus";

type Channel = "facebook" | "whatsapp";

interface Props {
  channel: Channel;
  state: ChannelState;
  lang: "ar" | "en";
  onChanged: () => void;
  onNavigate?: () => void;
}

const ROUTE: Record<Channel, "/dashboard/facebook" | "/dashboard/whatsapp/accounts"> = {
  facebook: "/dashboard/facebook",
  whatsapp: "/dashboard/whatsapp/accounts",
};

export function ChannelQuickActions({ channel, state, lang, onChanged, onNavigate }: Props) {
  const { call: fbCall } = useFacebookApi();
  const disconnectWa = useServerFn(disconnectWaSession);
  const [pending, setPending] = useState<null | "refresh" | "disconnect">(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const L = lang === "ar"
    ? {
        connect: channel === "facebook" ? "ربط فيسبوك" : "ربط واتساب",
        reconnect: "إعادة الربط",
        disconnect: "فصل",
        refresh: "تحديث",
        confirmTitle: channel === "facebook" ? "فصل حساب فيسبوك؟" : "فصل واتساب؟",
        confirmBody: channel === "whatsapp"
          ? "سيتم حذف كل المحادثات والرسائل من حسابك نهائياً ولا يمكن التراجع. عند إعادة المسح تبدأ من الصفر."
          : null,
        confirmYes: "تأكيد الفصل والحذف",
        confirmNo: "إلغاء",
        loading: "جارٍ التحقق…",
        successDisc: channel === "facebook" ? "تم فصل فيسبوك" : "تم فصل واتساب",
        failDisc: "تعذّر الفصل",
        refreshed: "تم التحديث",
      }
    : {
        connect: channel === "facebook" ? "Connect Facebook" : "Connect WhatsApp",
        reconnect: "Reconnect",
        disconnect: "Disconnect",
        refresh: "Refresh",
        confirmTitle: channel === "facebook" ? "Disconnect Facebook?" : "Disconnect WhatsApp?",
        confirmBody: channel === "whatsapp"
          ? "All your chats and messages will be permanently deleted. This cannot be undone. Re-scanning starts fresh."
          : null,
        confirmYes: "Disconnect & delete",
        confirmNo: "Cancel",
        loading: "Checking…",
        successDisc: channel === "facebook" ? "Facebook disconnected" : "WhatsApp disconnected",
        failDisc: "Could not disconnect",
        refreshed: "Refreshed",
      };

  const handleRefresh = async () => {
    setPending("refresh");
    try {
      await Promise.resolve(onChanged());
      // small visual hold so the spinner is perceivable
      await new Promise((r) => setTimeout(r, 400));
      toast.success(L.refreshed);
    } finally {
      setPending(null);
    }
  };

  const handleDisconnect = async () => {
    setPending("disconnect");
    try {
      if (channel === "facebook") {
        await fbCall(disconnectFacebook);
      } else {
        await disconnectWa();
      }
      toast.success(L.successDisc);
      setConfirmOpen(false);
      onChanged();
    } catch (err) {
      const msg = channel === "facebook"
        ? describeFbError(err, lang)
        : (err instanceof Error ? err.message : L.failDisc);
      toast.error(L.failDisc, { description: msg });
    } finally {
      setPending(null);
    }
  };

  // Shared button base
  const base =
    "inline-flex h-7 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-all duration-200 disabled:opacity-60 disabled:pointer-events-none";

  // Confirm popover (inline, anchored above the row)
  const confirmPopover = confirmOpen && (
    <div
      role="dialog"
      aria-label={L.confirmTitle}
      className="absolute bottom-full left-1/2 z-30 mb-2 w-[200px] -translate-x-1/2 rounded-xl border border-border/60 bg-popover p-2.5 shadow-[0_10px_30px_-12px_rgba(124,58,237,0.35)]"
    >
      <div className="mb-2 flex items-start gap-1.5 text-[12px] font-semibold text-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span className="leading-snug">{L.confirmTitle}</span>
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setConfirmOpen(false)}
          disabled={pending === "disconnect"}
          className={`${base} flex-1 bg-muted text-foreground hover:bg-muted/80`}
        >
          {L.confirmNo}
        </button>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={pending === "disconnect"}
          className={`${base} flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90`}
        >
          {pending === "disconnect" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : L.confirmYes}
        </button>
      </div>
    </div>
  );

  // ── Render by status ──────────────────────────────────────────────────
  if (state.status === "loading") {
    return (
      <div className="mt-2 border-t border-border/40 pt-2">
        <div className={`${base} w-full bg-muted/60 text-muted-foreground`}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>{L.loading}</span>
        </div>
      </div>
    );
  }

  if (state.status === "disconnected") {
    return (
      <div className="mt-2 border-t border-border/40 pt-2">
        <Link
          to={ROUTE[channel]}
          onClick={onNavigate}
          className={`${base} w-full bg-gradient-to-r from-primary to-[oklch(0.66_0.26_320)] text-primary-foreground shadow-sm hover:opacity-95`}
        >
          <LinkIcon className="h-3.5 w-3.5" />
          <span>{L.connect}</span>
        </Link>
      </div>
    );
  }

  if (state.status === "expired") {
    return (
      <div className="relative mt-2 border-t border-border/40 pt-2">
        {confirmPopover}
        <div className="flex gap-1.5">
          <Link
            to={ROUTE[channel]}
            onClick={onNavigate}
            className={`${base} flex-1 bg-amber-500 text-white shadow-sm hover:bg-amber-500/90`}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>{L.reconnect}</span>
          </Link>
          <button
            type="button"
            onClick={() => setConfirmOpen((v) => !v)}
            disabled={!!pending}
            aria-label={L.disconnect}
            className={`${base} shrink-0 px-2 text-destructive hover:bg-destructive/10`}
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // connected | expiring → Refresh + Disconnect
  return (
    <div className="relative mt-2 border-t border-border/40 pt-2">
      {confirmPopover}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={!!pending}
          className={`${base} flex-1 bg-accent/60 text-foreground hover:bg-accent`}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${pending === "refresh" ? "animate-spin" : ""}`} />
          <span>{L.refresh}</span>
        </button>
        <button
          type="button"
          onClick={() => setConfirmOpen((v) => !v)}
          disabled={!!pending}
          className={`${base} flex-1 text-destructive hover:bg-destructive/10`}
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>{L.disconnect}</span>
        </button>
      </div>
    </div>
  );
}
