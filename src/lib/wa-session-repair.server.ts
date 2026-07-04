import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BridgeError, inferStatus, waBridge } from "./wa-bridge.server";

export function isBridgeSessionMissingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const status = err instanceof BridgeError ? err.status : 0;
  return status === 404 || /session.*(not.?found|closed|logged.?out)|not.?found/i.test(message);
}

async function syncSettingsConnected(userId: string, connected: boolean) {
  const patch = connected
    ? { is_connected: true }
    : { is_connected: false, last_connected_at: null };
  await supabaseAdmin
    .from("whatsapp_settings")
    .update(patch)
    .eq("user_id", userId);
}

/**
 * Attempt a SOFT recovery of a bridge session only. This helper is called from
 * automatic send/AI paths, so it must never delete credentials or create a new
 * QR. Most "session lost" errors are transient socket drops on a still-paired
 * session, not a real logout.
 *
 * Behavior:
 *   1. Try POST /api/sessions/:id/revive on the SAME session id.
 *   2. Poll getStatus briefly; if it comes back connected/connecting/qr with
 *      the same credentials, we're done — no DB mutation, no new QR.
 *   3. If revive is unavailable or status is still not connected, return a
 *      safe error and let the bridge watchdog / explicit user actions handle it.
 *   4. Sync whatsapp_settings.is_connected with the actual bridge status so
 *      the UI + AI queue stop pretending the session is alive.
 */
export async function resetWaSessionAfterBridgeLoss(params: {
  userId: string;
  oldSessionId: string;
  reason: string;
}): Promise<{ sessionId: string; error: string | null; revived?: boolean }> {
  const { userId, oldSessionId, reason } = params;

  // ---- 1) Soft revive on the same session id --------------------------------
  try {
    await waBridge.reviveSession(oldSessionId);
    // Give the socket ~1.2s to actually come up before probing status.
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const status = inferStatus(await waBridge.getStatus(oldSessionId));
      if (status === "connected" || status === "connecting" || status === "qr") {
        // Session is alive (or coming up) on the SAME id. Do not touch DB,
        // do not force a new QR. Sync is_connected only when confirmed.
        if (status === "connected") await syncSettingsConnected(userId, true);
        console.warn("[wa-session-repair] soft revive succeeded", {
          sessionId: oldSessionId,
          status,
          reason,
        });
        return { sessionId: oldSessionId, error: null, revived: true };
      }
      await syncSettingsConnected(userId, false);
      return { sessionId: oldSessionId, error: `session_not_connected:${status}`, revived: false };
    } catch (statusErr) {
      if (statusErr instanceof BridgeError && statusErr.status && ![404, 500, 502, 503, 504].includes(statusErr.status)) {
        console.warn("[wa-session-repair] status probe failed after revive; skipping destructive reset", {
          sessionId: oldSessionId,
          error: statusErr.message,
        });
        await syncSettingsConnected(userId, false);
        return { sessionId: oldSessionId, error: statusErr.message, revived: false };
      }
      const message = statusErr instanceof Error ? statusErr.message : String(statusErr);
      await syncSettingsConnected(userId, false);
      return { sessionId: oldSessionId, error: message, revived: false };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "Bridge session reset failed");
    console.warn("[wa-session-repair] soft revive failed; preserving session and skipping QR reset", {
      sessionId: oldSessionId,
      reason,
      error: message,
      status: err instanceof BridgeError ? err.status : undefined,
    });
    await syncSettingsConnected(userId, false);
    return { sessionId: oldSessionId, error: message, revived: false };
  }
}
