// Polls connection status for Facebook + WhatsApp channels so the sidebar can
// render a live status dot next to each channel. Keep this intentionally light:
// the sidebar must not call heavyweight server functions on every dashboard
// page mount, because those calls can race Vite's server-function registration
// after a dev-server restart and blank the preview with "Invalid server function ID".
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ChannelStatus =
  | "loading"
  | "connected"
  | "disconnected"
  | "expiring"
  | "expired";

export interface ChannelState {
  status: ChannelStatus;
  daysLeft?: number;
  label: string;
}

const REFRESH_MS = 5 * 60 * 1000; // 5 min
const EXPIRING_THRESHOLD_DAYS = 7;

function fmtLabel(state: Omit<ChannelState, "label">, lang: "ar" | "en"): string {
  const ar = {
    loading: "جارٍ التحقق…",
    connected: "متصل",
    disconnected: "غير متصل",
    expiring: state.daysLeft != null ? `ينتهي خلال ${state.daysLeft} يوم` : "ينتهي قريبًا",
    expired: "انتهت الصلاحية — أعد الربط",
  } as const;
  const en = {
    loading: "Checking…",
    connected: "Connected",
    disconnected: "Not connected",
    expiring: state.daysLeft != null ? `Expires in ${state.daysLeft} days` : "Expiring soon",
    expired: "Expired — reconnect",
  } as const;
  return (lang === "ar" ? ar : en)[state.status];
}

export function useChannelStatus(lang: "ar" | "en") {
  const [facebook, setFacebook] = useState<ChannelState>({ status: "loading", label: fmtLabel({ status: "loading" }, lang) });
  const [whatsapp, setWhatsapp] = useState<ChannelState>({ status: "loading", label: fmtLabel({ status: "loading" }, lang) });
  const mounted = useRef(true);

  const fetchFacebook = useCallback(async () => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const s: Omit<ChannelState, "label"> = { status: "disconnected" };
        if (mounted.current) setFacebook({ ...s, label: fmtLabel(s, lang) });
        return;
      }
      const { data, error } = await supabase
        .from("facebook_connections")
        .select("fb_user_id, fb_user_name, last_synced_at")
        .maybeSingle();
      if (!mounted.current) return;
      if (error || !data?.fb_user_id) {
        const s: Omit<ChannelState, "label"> = { status: "disconnected" };
        setFacebook({ ...s, label: fmtLabel(s, lang) });
        return;
      }
      const s: Omit<ChannelState, "label"> = { status: "connected" };
      setFacebook({ ...s, label: fmtLabel(s, lang) });
    } catch {
      if (!mounted.current) return;
      // On error (e.g. no auth, network), fall back to disconnected indicator
      // rather than a noisy red — reconnection is the natural next action.
      const s: Omit<ChannelState, "label"> = { status: "disconnected" };
      setFacebook({ ...s, label: fmtLabel(s, lang) });
    }
  }, [lang]);

  const fetchWhatsapp = useCallback(async () => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const s: Omit<ChannelState, "label"> = { status: "disconnected" };
        if (mounted.current) setWhatsapp({ ...s, label: fmtLabel(s, lang) });
        return;
      }
      const { data, error } = await supabase
        .from("whatsapp_settings")
        .select("is_connected, last_connected_at")
        .maybeSingle();
      if (!mounted.current) return;
      if (error || !data || !data.is_connected) {
        const s: Omit<ChannelState, "label"> = { status: "disconnected" };
        setWhatsapp({ ...s, label: fmtLabel(s, lang) });
        return;
      }
      const s: Omit<ChannelState, "label"> = { status: "connected" };
      setWhatsapp({ ...s, label: fmtLabel(s, lang) });
    } catch {
      if (!mounted.current) return;
      const s: Omit<ChannelState, "label"> = { status: "disconnected" };
      setWhatsapp({ ...s, label: fmtLabel(s, lang) });
    }
  }, [lang]);

  const refresh = useCallback(() => {
    void fetchFacebook();
    void fetchWhatsapp();
  }, [fetchFacebook, fetchWhatsapp]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    const onVis = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") refresh();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }
    return () => {
      mounted.current = false;
      clearInterval(interval);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
    };
  }, [refresh]);

  return { facebook, whatsapp, refresh };
}
