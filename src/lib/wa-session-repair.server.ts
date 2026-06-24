import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BridgeError, waBridge } from "./wa-bridge.server";
import { deriveWebhookUrl } from "./wa-helpers.server";

export function isBridgeSessionMissingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const status = err instanceof BridgeError ? err.status : 0;
  return status === 404 || /session.*(not.?found|closed|logged.?out)|not.?found/i.test(message);
}

function freshSessionId(userId: string): string {
  return `flowtix-${userId.replace(/-/g, "").slice(0, 16)}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

export async function resetWaSessionAfterBridgeLoss(params: {
  userId: string;
  oldSessionId: string;
  reason: string;
}): Promise<{ sessionId: string; error: string | null }> {
  const { userId, oldSessionId, reason } = params;
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
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "Bridge session reset failed");
    await supabaseAdmin
      .from("wa_sessions")
      .update({ status: "disconnected", qr_data_url: null, last_seen_at: now })
      .eq("user_id", userId);
    console.error("[wa-session-repair] create fresh session failed:", message);
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
    .eq("user_id", userId);

  if (error) {
    console.error("[wa-session-repair] DB update failed:", error.message);
    return { sessionId, error: error.message };
  }

  console.warn("[wa-session-repair] bridge session was lost; created fresh QR session", {
    oldSessionId,
    sessionId,
    reason,
  });
  return { sessionId, error: null };
}