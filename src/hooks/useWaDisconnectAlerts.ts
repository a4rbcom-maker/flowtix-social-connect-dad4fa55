// Watches WhatsApp session state and fires:
//   • persistent banner count (disconnectedCount)
//   • instant toast when a session drops offline
//   • success toast when a previously-offline session comes back online
//
// Uses Supabase Realtime on wa_sessions + wa_session_events for instant
// reaction (no more waiting up to 30s for the poll), with a poll as
// safety net + initial hydration.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const POLL_MS = 60_000;
const LS_KEY = (uid: string) => `flowtix.waDisconnectAlert.lastId:${uid}`;

export type WaAggregateStatus =
  | "unknown"
  | "connected"
  | "disconnected"
  | "connecting";

export interface WaDisconnectAlertsState {
  disconnectedCount: number;
  connectedCount: number;
  status: WaAggregateStatus;
  lastReason: string | null;
  lastAt: string | null;
  refresh: () => void;
}

export function useWaDisconnectAlerts(lang: "ar" | "en"): WaDisconnectAlertsState {
  const [disconnectedCount, setDisconnectedCount] = useState(0);
  const [connectedCount, setConnectedCount] = useState(0);
  const [status, setStatus] = useState<WaAggregateStatus>("unknown");
  const [lastReason, setLastReason] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const mounted = useRef(true);
  const firstRunRef = useRef(true);
  const prevDisconnectedRef = useRef<number | null>(null);
  const prevConnectedRef = useRef<number | null>(null);
  const channelKeyRef = useRef(`wa-status-${Math.random().toString(36).slice(2, 10)}`);
  const effectSeqRef = useRef(0);

  const isAr = lang === "ar";

  const check = useCallback(async () => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id;
      if (!uid) return;

      const [{ data: sessionRows }, { data: settings }, { data: lastMessages }, { data: latestDisconnectEvents }] = await Promise.all([
        supabase.from("wa_sessions").select("id, status, last_seen_at, updated_at")
          .eq("user_id", uid)
          .order("updated_at", { ascending: false })
          .limit(5),
        supabase.from("whatsapp_settings").select("is_connected, last_connected_at")
          .eq("user_id", uid)
          .maybeSingle(),
        supabase.from("wa_messages").select("created_at")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(1),
        supabase.from("wa_session_events").select("id, reason, created_at, to_status")
          .eq("user_id", uid)
          .eq("to_status", "disconnected")
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      if (!mounted.current) return;

      const rows = sessionRows ?? [];
      const rawDisconnectedCount = rows.filter((row) => row.status === "disconnected").length;
      const cCount = rows.filter((row) => row.status === "connected").length;
      const gCount = rows.filter((row) => ["connecting", "qr", "pairing"].includes(String(row.status))).length;
      const settingsConnected = settings?.is_connected === true;
      const latestDisconnect = latestDisconnectEvents?.[0];
      const lastActivityAt = lastMessages?.[0]?.created_at ? Date.parse(lastMessages[0].created_at) : 0;
      const disconnectAt = latestDisconnect?.created_at ? Date.parse(latestDisconnect.created_at) : 0;
      const activityAfterDisconnect = lastActivityAt > 0 && (!disconnectAt || lastActivityAt >= disconnectAt);
      const effectiveConnectedCount = cCount > 0 || (settingsConnected && gCount === 0) || activityAfterDisconnect ? Math.max(1, cCount) : 0;
      const effectiveDisconnectedCount = effectiveConnectedCount > 0 ? 0 : rawDisconnectedCount;

      setDisconnectedCount(effectiveDisconnectedCount);
      setConnectedCount(effectiveConnectedCount);
      setStatus(
        effectiveConnectedCount > 0 ? "connected"
        : gCount > 0 ? "connecting"
        : rawDisconnectedCount > 0 ? "disconnected"
        : "unknown",
      );
      if (effectiveConnectedCount > 0) {
        setLastReason(null);
        setLastAt(null);
      }

      // Reconnected toast: previously disconnected, now not.
      if (
        !firstRunRef.current &&
        prevDisconnectedRef.current != null &&
        prevDisconnectedRef.current > 0 &&
        effectiveDisconnectedCount === 0 &&
        effectiveConnectedCount > (prevConnectedRef.current ?? 0)
      ) {
        toast.success(
          isAr ? "تم استعادة اتصال واتساب" : "WhatsApp reconnected",
          {
            description: isAr
              ? "الجلسة عادت للعمل — تقدر تستأنف حملاتك بأمان."
              : "Your session is back online — safe to resume campaigns.",
            duration: 8_000,
          },
        );
      }
      prevDisconnectedRef.current = effectiveDisconnectedCount;
      prevConnectedRef.current = effectiveConnectedCount;

      // Most recent disconnect event → one-shot toast on new id.
      if (effectiveConnectedCount > 0) {
        firstRunRef.current = false;
        return;
      }
      if (effectiveDisconnectedCount <= 0) {
        firstRunRef.current = false;
        return;
      }
      const latest = latestDisconnect;
      if (latest) {
        setLastReason(latest.reason ?? null);
        setLastAt(latest.created_at ?? null);

        let lastSeen: string | null = null;
        try { lastSeen = window.localStorage.getItem(LS_KEY(uid)); } catch {}

        const isNew = latest.id !== lastSeen;
        if (isNew && !firstRunRef.current) {
          const title = isAr ? "انقطع اتصال واتساب" : "WhatsApp session disconnected";
          const desc = isAr
            ? "أعد الاقتران قبل إطلاق أي حملة جماعية حتى لا تفشل الرسائل."
            : "Reconnect before launching any bulk campaign — messages will otherwise fail.";
          toast.error(title, {
            description: latest.reason ? `${desc}\n${latest.reason}` : desc,
            duration: 12_000,
          });
        }
        try { window.localStorage.setItem(LS_KEY(uid), latest.id); } catch {}
      }
      firstRunRef.current = false;
    } catch {
      // best-effort background check
    }
  }, [isAr]);

  useEffect(() => {
    mounted.current = true;
    void check();
    const id = window.setInterval(check, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVis);

    // Realtime: react instantly to any wa_sessions / wa_session_events change
    // for the current user. RLS scopes rows automatically.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const seq = ++effectSeqRef.current;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id;
      if (!uid || !mounted.current || effectSeqRef.current !== seq) return;
      channel = supabase
        .channel(`${channelKeyRef.current}-${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "wa_sessions", filter: `user_id=eq.${uid}` },
          () => { void check(); },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "wa_session_events", filter: `user_id=eq.${uid}` },
          () => { void check(); },
        )
        .subscribe();
    })();

    return () => {
      effectSeqRef.current++;
      mounted.current = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      if (channel) supabase.removeChannel(channel);
    };
  }, [check]);

  return {
    disconnectedCount,
    connectedCount,
    status,
    lastReason,
    lastAt,
    refresh: () => void check(),
  };
}
