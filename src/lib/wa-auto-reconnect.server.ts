// Automatic reconnection for WhatsApp bridge sessions.
//
// Goal: when a transient disconnect happens (network blip, socket close, Baileys
// stream error) do NOT leave the session dead — schedule a small, bounded
// sequence of `reviveSession()` attempts with exponential backoff. Trusted
// logouts (device unlinked, 401/logout) still require a fresh QR from the user
// and are NOT retried.
//
// Notes:
// - Attempts are tracked in-memory per session. Worker restarts reset the
//   counter, which is fine — the goal is to bound the burst, not to guarantee
//   exactly-N attempts across the fleet.
// - Runs as a background task off the current request via `waitUntil` when
//   available; otherwise best-effort void promise.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BridgeError, inferStatus, waBridge } from "./wa-bridge.server";
import { isTrustedUserDisconnect, logWaSessionEvent, updateWaSessionStatus } from "./wa-session-events.server";

const BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;
const MAX_ATTEMPTS = BACKOFF_MS.length;
const POST_REVIVE_WAIT_MS = 3_000;

interface Attempt {
  attempts: number;
  running: boolean;
  lastAttemptAt: number;
}

const state = new Map<string, Attempt>();

export function clearAutoReconnect(sessionId: string): void {
  state.delete(sessionId);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function attachBackgroundTask(request: Request | null, task: Promise<unknown>, label: string): void {
  const guarded = task.catch((err) =>
    console.error(`[wa-auto-reconnect] ${label} failed:`, err instanceof Error ? err.message : err),
  );
  const waitUntil = (request as (Request & { waitUntil?: (p: Promise<unknown>) => void }) | null)?.waitUntil;
  if (typeof waitUntil === "function") {
    waitUntil.call(request, guarded);
  } else {
    void guarded;
  }
}

interface ScheduleInput {
  userId: string;
  sessionId: string;
  reason: string;
  rawStatus?: string | null;
  bridgeEvent?: string | null;
  request?: Request | null;
}

/**
 * Schedule a bounded revive sequence for `sessionId`. Safe to call from any
 * webhook / status handler — no-op when already running, when max attempts are
 * reached, or when the trigger reason indicates a real logout.
 */
export function scheduleAutoRevive(input: ScheduleInput): void {
  const { userId, sessionId, reason, rawStatus, bridgeEvent, request } = input;

  if (isTrustedUserDisconnect({ source: "webhook_status", reason, rawStatus, bridgeEvent })) {
    // Real logout — user must scan a new QR; do not spin the revive loop.
    return;
  }

  const existing = state.get(sessionId);
  if (existing?.running) return;
  if (existing && existing.attempts >= MAX_ATTEMPTS) return;

  const entry: Attempt = existing ?? { attempts: 0, running: false, lastAttemptAt: 0 };
  entry.running = true;
  state.set(sessionId, entry);

  attachBackgroundTask(
    request ?? null,
    runRevive({ userId, sessionId, reason }),
    `revive:${sessionId}`,
  );
}

async function runRevive(params: { userId: string; sessionId: string; reason: string }): Promise<void> {
  const { userId, sessionId, reason } = params;
  const entry = state.get(sessionId);
  if (!entry) return;

  try {
    while (entry.attempts < MAX_ATTEMPTS) {
      const delay = BACKOFF_MS[entry.attempts]!;
      await sleep(delay);
      entry.attempts += 1;
      entry.lastAttemptAt = Date.now();

      // If the session is already back to connected (either by webhook or by
      // another concurrent revive), stop the loop and reset the counter.
      const { data: row } = await supabaseAdmin
        .from("wa_sessions")
        .select("status,phone_number")
        .eq("user_id", userId)
        .eq("session_id", sessionId)
        .maybeSingle();
      if (!row) {
        // Session row was deleted (user pressed disconnect). Stop.
        state.delete(sessionId);
        return;
      }
      if (row.status === "connected") {
        clearAutoReconnect(sessionId);
        return;
      }
      if (row.status === "qr") {
        // Bridge is asking for a fresh scan — QR flow owns it from here.
        return;
      }

      let reviveError: string | null = null;
      try {
        await waBridge.reviveSession(sessionId);
      } catch (err) {
        reviveError = err instanceof Error ? err.message : String(err);
        const status = err instanceof BridgeError ? err.status : 0;
        // Bridge doesn't know this session anymore → cannot revive without a QR.
        if (status === 404) {
          await logWaSessionEvent(supabaseAdmin, {
            userId,
            sessionId,
            toStatus: "disconnected",
            source: "poll_error",
            reason: `auto_reconnect_abandoned:bridge_session_missing:${reviveError}`,
            rawStatus: "http_404",
          });
          return;
        }
      }

      await sleep(POST_REVIVE_WAIT_MS);

      try {
        const live = await waBridge.getStatus(sessionId);
        const nextStatus = inferStatus(live);
        await updateWaSessionStatus(supabaseAdmin, {
          userId,
          sessionId,
          nextStatus,
          source: "poll",
          reason: `auto_reconnect_attempt_${entry.attempts}/${MAX_ATTEMPTS}(trigger:${reason})${
            reviveError ? `:revive_error(${reviveError})` : ""
          }`,
          rawStatus: nextStatus,
          phoneNumber: live.phoneNumber ?? live.phone ?? null,
          logEvenIfUnchanged: true,
        });
        if (nextStatus === "connected") {
          clearAutoReconnect(sessionId);
          return;
        }
        if (nextStatus === "qr") {
          // QR waiting for scan — leave it for the user.
          return;
        }
      } catch (err) {
        await logWaSessionEvent(supabaseAdmin, {
          userId,
          sessionId,
          toStatus: "disconnected",
          source: "poll_error",
          reason: `auto_reconnect_status_probe_failed_attempt_${entry.attempts}:${
            err instanceof Error ? err.message : String(err)
          }`,
          rawStatus: err instanceof BridgeError ? `http_${err.status}` : "status_probe_failed",
        });
      }
    }

    // Exhausted retries without success.
    await logWaSessionEvent(supabaseAdmin, {
      userId,
      sessionId,
      toStatus: "disconnected",
      source: "poll_error",
      reason: `auto_reconnect_exhausted:${MAX_ATTEMPTS}_attempts(trigger:${reason})`,
      rawStatus: "auto_reconnect_exhausted",
    });
  } finally {
    const finalEntry = state.get(sessionId);
    if (finalEntry) finalEntry.running = false;
  }
}
