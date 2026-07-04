import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BridgeError, inferStatus, waBridge } from "./wa-bridge.server";
import { deriveWebhookUrl } from "./wa-helpers.server";

export function isBridgeSessionMissingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const status = err instanceof BridgeError ? err.status : 0;
  return status === 404 || /session.*(not.?found|closed|logged.?out)|not.?found/i.test(message);
}

function freshSessionId(userId: string): string {
  return `flowtix-${userId.replace(/-/g, "").slice(0, 16)}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

async function syncSettingsConnected(userId: string, connected: boolean) {
  const patch: Record<string, unknown> = { is_connected: connected };
  if (!connected) patch.last_connected_at = null;
  await supabaseAdmin
    .from("whatsapp_settings")
    .update(patch)
    .eq("user_id", userId);
}

/**
 * Attempt a SOFT recovery of a bridge session (v1.8.5 /revive) before falling
 * back to the nuclear "delete + createSession = new QR" flow. This is the
 * fix for the recurring "customer has to re-scan QR every day" loop: most
 * "session lost" errors from the bridge are actually transient socket drops
 * on a still-paired session, not a real logout.
 *
 * Behavior:
 *   1. Try POST /api/sessions/:id/revive on the SAME session id.
 *   2. Poll getStatus briefly; if it comes back connected/connecting/qr with
 *      the same credentials, we're done — no DB mutation, no new QR.
 *   3. Only if revive returns 404 (session truly gone from the bridge) OR
 *      after revive the status is still disconnected, do we fall through to
 *      the old destructive path (delete + create fresh QR session).
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
  let reviveFailedHard = false;
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
      // Status came back disconnected — fall through to destructive path.
      reviveFailedHard = true;
    } catch (statusErr) {
      // If we can't even read status, treat as revive-failed.
      reviveFailedHard = true;
      if (statusErr instanceof BridgeError && statusErr.status && ![404, 500, 502, 503, 504].includes(statusErr.status)) {
        // Non-404 status probe error — bail safely without destroying session.
        console.warn("[wa-session-repair] status probe failed after revive; skipping destructive reset", {
          sessionId: oldSessionId,
          error: statusErr.message,
        });
        await syncSettingsConnected(userId, false);
        return { sessionId: oldSessionId, error: statusErr.message, revived: false };
      }
    }
  } catch (err) {
    // Revive endpoint itself failed.
    if (err instanceof BridgeError) {
      if (err.status === 404) {
        // Session is truly gone from the bridge — proceed with fresh QR.
        reviveFailedHard = true;
      } else if ([405, 501].includes(err.status)) {
        // Older bridge without /revive — fall through to legacy path.
        reviveFailedHard = true;
      } else {
        // Transient / auth / config error: DO NOT destroy the session.
        console.warn("[wa-session-repair] revive returned transient error; skipping destructive reset", {
          sessionId: oldSessionId,
          status: err.status,
          error: err.message,
        });
        await syncSettingsConnected(userId, false);
        return { sessionId: oldSessionId, error: err.message, revived: false };
      }
    } else {
      // Network / unknown error — fail safe, do not recreate.
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[wa-session-repair] revive threw unknown error; skipping destructive reset", {
        sessionId: oldSessionId,
        error: message,
      });
      await syncSettingsConnected(userId, false);
      return { sessionId: oldSessionId, error: message, revived: false };
    }
  }

  if (!reviveFailedHard) {
    // Shouldn't reach here, but be explicit: nothing to do.
    return { sessionId: oldSessionId, error: null, revived: true };
  }

  // ---- 2) Legacy destructive reset (only when session is truly gone) --------
  const sessionId = freshSessionId(userId);
  const now = new Date().toISOString();
  const webhookUrl = await deriveWebhookUrl().catch(() => null);

  try {
    await waBridge.deleteSession(oldSessionId);
  } catch {
    // The bridge already lost this session; deleting is best-effort only.
  }

  try {
    await waBridge.createSession(sessionId, {
      webhookUrl: webhookUrl ?? undefined,
      tenantId: userId,
      syncFullHistory: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "Bridge session reset failed");
    console.error("[wa-session-repair] create fresh session failed:", message);
    await syncSettingsConnected(userId, false);
    return { sessionId: oldSessionId, error: message };
  }

  const { error } = await supabaseAdmin
    .from("wa_sessions")
    .update({
      session_id: sessionId,
      status: "qr",
      qr_data_url: null,
      phone_number: null,
      last_seen_at: now,
    })
    .eq("user_id", userId)
    .eq("session_id", oldSessionId);

  await syncSettingsConnected(userId, false);

  if (error) {
    console.error("[wa-session-repair] DB update failed:", error.message);
    return { sessionId, error: error.message };
  }

  console.warn("[wa-session-repair] soft revive failed; created fresh QR session", {
    oldSessionId,
    sessionId,
    reason,
  });
  return { sessionId, error: null, revived: false };
}
