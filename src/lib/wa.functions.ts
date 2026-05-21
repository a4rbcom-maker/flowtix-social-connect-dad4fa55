// WhatsApp Bridge — TanStack server functions.
// All bridge calls happen here so secrets stay on the server.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  waBridge,
  normalizeStatus,
  pickQrDataUrl,
  BridgeError,
  type BridgeSessionStatus,
} from "./wa-bridge.server";

export interface WaConnectionState {
  status: BridgeSessionStatus;
  sessionId: string;
  qrDataUrl: string | null;
  phoneNumber: string | null;
  lastSeenAt: string | null;
}

function describeBridgeError(err: unknown): string {
  if (err instanceof BridgeError) {
    if (err.status === 404) return "Session not found on bridge";
    if (err.status === 401 || err.status === 403) return "Bridge auth failed";
    return err.message;
  }
  return err instanceof Error ? err.message : "Bridge error";
}

/**
 * Ensure a wa_sessions row exists for the current user and that the
 * corresponding session is registered on the bridge. Returns the row.
 */
export const connectWaSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WaConnectionState> => {
    const { supabase, userId } = context;

    // 1) Look up or create a stable session row
    const { data: existing } = await supabase
      .from("wa_sessions")
      .select("session_id, status, qr_data_url, phone_number, last_seen_at")
      .eq("user_id", userId)
      .maybeSingle();

    let sessionId = existing?.session_id;
    if (!sessionId) {
      sessionId = `flowtix-${userId.replace(/-/g, "").slice(0, 16)}-${Date.now().toString(36)}`;
      const { error: insErr } = await supabase
        .from("wa_sessions")
        .insert({ user_id: userId, session_id: sessionId, status: "connecting" });
      if (insErr) throw new Error(`DB insert failed: ${insErr.message}`);
    }

    // 2) Try to create the session on the bridge (idempotent: 409/duplicate is ok)
    try {
      await waBridge.createSession(sessionId);
    } catch (err) {
      if (err instanceof BridgeError && (err.status === 409 || err.status === 400)) {
        // already exists — fine
      } else {
        throw new Error(describeBridgeError(err));
      }
    }

    // 3) Pull current status + QR
    return readState(supabase, userId, sessionId);
  });

/** Lightweight poll endpoint used by the UI while waiting for QR scan. */
export const getWaConnectionState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WaConnectionState | null> => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("wa_sessions")
      .select("session_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!row?.session_id) return null;
    return readState(supabase, userId, row.session_id);
  });

export const sendWaMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        to: z.string().trim().min(6).max(32).regex(/^[0-9+]+$/, "Invalid phone"),
        text: z.string().trim().min(1).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: row, error: rowErr } = await supabase
      .from("wa_sessions")
      .select("session_id, status")
      .eq("user_id", userId)
      .maybeSingle();
    if (rowErr) throw new Error(rowErr.message);
    if (!row?.session_id) throw new Error("WhatsApp is not connected");
    if (row.status !== "connected") throw new Error("WhatsApp is not connected");

    const phone = data.to.replace(/[^0-9]/g, "");
    try {
      await waBridge.sendText(row.session_id, phone, data.text);
    } catch (err) {
      throw new Error(describeBridgeError(err));
    }

    await supabase.from("wa_messages").insert({
      user_id: userId,
      session_id: row.session_id,
      direction: "out",
      remote_jid: phone,
      to_phone: phone,
      msg_type: "text",
      text_body: data.text,
    });

    return { ok: true };
  });

export const disconnectWaSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("wa_sessions")
      .select("session_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (row?.session_id) {
      try {
        await waBridge.deleteSession(row.session_id);
      } catch {
        // best-effort; we still clear our row
      }
      await supabase.from("wa_sessions").delete().eq("user_id", userId);
    }
    return { ok: true };
  });

// ── helpers ────────────────────────────────────────────────────────────────

async function readState(
  supabase: any,
  userId: string,
  sessionId: string,
): Promise<WaConnectionState> {
  let status: BridgeSessionStatus = "unknown";
  let qrDataUrl: string | null = null;
  let phoneNumber: string | null = null;

  try {
    const s = await waBridge.getStatus(sessionId);
    status = normalizeStatus(s.status ?? s.state ?? (s.connected ? "connected" : ""));
    phoneNumber = s.phoneNumber ?? s.phone ?? null;
  } catch (err) {
    if (!(err instanceof BridgeError && err.status === 404)) {
      throw new Error(describeBridgeError(err));
    }
    status = "disconnected";
  }

  if (status === "qr" || status === "connecting" || status === "unknown") {
    try {
      const q = await waBridge.getQr(sessionId);
      qrDataUrl = pickQrDataUrl(q);
      if (qrDataUrl && status === "unknown") status = "qr";
    } catch {
      // no QR available yet
    }
  }

  const now = new Date().toISOString();
  await supabase
    .from("wa_sessions")
    .update({
      status,
      qr_data_url: status === "qr" ? qrDataUrl : null,
      phone_number: phoneNumber,
      last_seen_at: now,
    })
    .eq("user_id", userId);

  return {
    status,
    sessionId,
    qrDataUrl: status === "qr" ? qrDataUrl : null,
    phoneNumber,
    lastSeenAt: now,
  };
}
