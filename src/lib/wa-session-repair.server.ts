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
 * Attempt a SAFE recovery check of a bridge session only. This helper is called
 * from automatic send/AI paths, so it must never delete credentials, create a
 * new QR, or call bridge endpoints that rebuild the socket into QR state.
 *
 * Behavior:
 *   1. Poll getStatus briefly; if it comes back connected/connecting, we're
 *      done — no DB mutation, no new QR.
 *   2. If status is QR/disconnected/missing, return a safe error and let the
 *      explicit user reconnect flow handle it.
 *   3. Sync whatsapp_settings.is_connected with the actual bridge status so
 *      the UI + AI queue stop pretending the session is alive.
 */
export async function resetWaSessionAfterBridgeLoss(params: {
  userId: string;
  oldSessionId: string;
  reason: string;
}): Promise<{ sessionId: string; error: string | null; revived?: boolean }> {
  const { userId, oldSessionId, reason } = params;

  try {
    const status = inferStatus(await waBridge.getStatus(oldSessionId));
    if (status === "connected" || status === "connecting") {
      if (status === "connected") await syncSettingsConnected(userId, true);
      console.warn("[wa-session-repair] session still alive; no bridge rebuild attempted", {
        sessionId: oldSessionId,
        status,
        reason,
      });
      return { sessionId: oldSessionId, error: null, revived: false };
    }
    await syncSettingsConnected(userId, false);
    return { sessionId: oldSessionId, error: `session_not_connected:${status}`, revived: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "Bridge session status failed");
    console.warn("[wa-session-repair] status probe failed; preserving session and skipping bridge rebuild", {
      sessionId: oldSessionId,
      reason,
      error: message,
      status: err instanceof BridgeError ? err.status : undefined,
    });
    await syncSettingsConnected(userId, false);
    return { sessionId: oldSessionId, error: message, revived: false };
  }
}
