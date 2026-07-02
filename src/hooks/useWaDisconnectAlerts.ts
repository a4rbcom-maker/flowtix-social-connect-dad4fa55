// Polls `wa_session_events` for new disconnect transitions and surfaces an
// instant toast + a persistent banner-count so the dashboard can warn the
// user BEFORE they launch a bulk campaign on a dead session.
//
// Design notes:
// - Uses the browser Supabase client. RLS on wa_session_events + wa_sessions
//   scopes rows to the current user automatically.
// - Persists the "last seen event id" in localStorage per-user so a fresh
//   tab doesn't spam toasts for old disconnects, but a genuinely NEW event
//   (id > last seen) always fires exactly one toast.
// - Runs while the tab is visible; refetches immediately on focus.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const POLL_MS = 30_000;
const LS_KEY = (uid: string) => `flowtix.waDisconnectAlert.lastId:${uid}`;

export interface WaDisconnectAlertsState {
  /** How many wa_sessions are currently in the `disconnected` state. */
  disconnectedCount: number;
  /** The last (most recent) reason string for a disconnect, if any. */
  lastReason: string | null;
  /** Timestamp of the most recent disconnect event (ISO). */
  lastAt: string | null;
  refresh: () => void;
}

export function useWaDisconnectAlerts(lang: "ar" | "en"): WaDisconnectAlertsState {
  const [disconnectedCount, setDisconnectedCount] = useState(0);
  const [lastReason, setLastReason] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);
  const mounted = useRef(true);
  const firstRunRef = useRef(true);

  const check = useCallback(async () => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id;
      if (!uid) return;

      // 1) Current disconnected sessions (drives the persistent banner).
      const { count } = await supabase
        .from("wa_sessions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid)
        .eq("status", "disconnected");
      if (!mounted.current) return;
      setDisconnectedCount(count ?? 0);

      // 2) Most recent disconnect event — only toast when its id is newer
      //    than the last one we've already surfaced.
      const { data: events } = await supabase
        .from("wa_session_events")
        .select("id, reason, created_at, to_status")
        .eq("user_id", uid)
        .eq("to_status", "disconnected")
        .order("created_at", { ascending: false })
        .limit(1);
      if (!mounted.current) return;

      const latest = events?.[0];
      if (!latest) return;

      setLastReason(latest.reason ?? null);
      setLastAt(latest.created_at ?? null);

      let lastSeen: string | null = null;
      try {
        lastSeen = window.localStorage.getItem(LS_KEY(uid));
      } catch {
        // localStorage unavailable — fall back to no-toast on first run.
      }

      const isNew = latest.id !== lastSeen;
      // Skip toast on the very first hydration if we've never seen an event
      // before; we don't want to spam the user on every reload.
      if (isNew && !firstRunRef.current) {
        const title = lang === "ar"
          ? "انقطع اتصال واتساب"
          : "WhatsApp session disconnected";
        const desc = lang === "ar"
          ? "أعد الاقتران قبل إطلاق أي حملة جماعية حتى لا تفشل الرسائل."
          : "Reconnect before launching any bulk campaign — messages will otherwise fail.";
        toast.error(title, {
          description: latest.reason ? `${desc}\n${latest.reason}` : desc,
          duration: 12_000,
        });
      }

      try {
        window.localStorage.setItem(LS_KEY(uid), latest.id);
      } catch {
        // ignore
      }
      firstRunRef.current = false;
    } catch {
      // best-effort background check; never surface to UI
    }
  }, [lang]);

  useEffect(() => {
    mounted.current = true;
    void check();
    const id = window.setInterval(check, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      mounted.current = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [check]);

  return { disconnectedCount, lastReason, lastAt, refresh: () => void check() };
}
