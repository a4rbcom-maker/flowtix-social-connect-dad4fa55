// WhatsApp Bridge — TanStack server functions.
// All bridge calls happen here so secrets stay on the server.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./admin-middleware";
import {
  waBridge,
  inferStatus,
  BridgeError,
  type BridgeSessionStatus,
} from "./wa-bridge.server";
import {
  deriveWebhookUrl,
  describeBridgeError,
  doPing,
  type WaBridgeHealth,
} from "./wa-helpers.server";
import { upsertConversationFromMessage } from "./wa-ai.server";

export type { WaBridgeHealth };

export const pingWaBridge = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async (): Promise<WaBridgeHealth> => doPing());

/** User-facing health check (no admin role required). */
export const pingWaBridgeUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<WaBridgeHealth> => doPing());

export interface WaConnectionState {
  status: BridgeSessionStatus;
  sessionId: string;
  qrDataUrl: string | null;
  qrRaw: string | null;
  phoneNumber: string | null;
  lastSeenAt: string | null;
  error: string | null;
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
    const webhookUrl = await deriveWebhookUrl();
    try {
      await waBridge.createSession(sessionId, {
        webhookUrl: webhookUrl ?? undefined,
        tenantId: userId,
      });
    } catch (err) {
      if (err instanceof BridgeError && (err.status === 409 || err.status === 400)) {
        // already exists — fine
      } else {
        const now = new Date().toISOString();
        const errMsg = describeBridgeError(err);
        console.warn("[wa] createSession bridge error:", errMsg);
        await supabase
          .from("wa_sessions")
          .update({ status: "disconnected", qr_data_url: null, last_seen_at: now })
          .eq("user_id", userId);
        return {
          status: "disconnected",
          sessionId,
          qrDataUrl: null,
          qrRaw: null,
          phoneNumber: existing?.phone_number ?? null,
          lastSeenAt: now,
          error: errMsg,
        };
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
    let providerMessageId: string | null = null;
    try {
      const res = await waBridge.sendText(row.session_id, phone, data.text);
      providerMessageId = typeof res?.id === "string" ? res.id : null;
    } catch (err) {
      throw new Error(describeBridgeError(err));
    }

    const remoteJid = `${phone}@s.whatsapp.net`;

    await supabase.from("wa_messages").insert({
      user_id: userId,
      session_id: row.session_id,
      direction: "out",
      remote_jid: remoteJid,
      to_phone: phone,
      msg_type: "text",
      text_body: data.text,
      status: "sent",
      provider_message_id: providerMessageId,
      raw: providerMessageId ? ({ bridgeMessageId: providerMessageId } as never) : null,
    });

    await upsertConversationFromMessage({
      userId,
      sessionId: row.session_id,
      remoteJid,
      contactName: null,
      contactPhone: phone,
      text: data.text,
      direction: "out",
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

/**
 * Hard-reset the receiver: deletes the bridge session and creates a fresh
 * one bound to this user's tenantId + our stable webhook URL. The session
 * comes back in QR state — the user must re-scan to finish pairing.
 *
 * This is the ONLY way to (re)bind a webhook on Bot-Xtra v1.8.x, because
 * the bridge has no API to update webhook/tenant on an existing session.
 */
export const resetWaReceiver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WaConnectionState> => {
    const { supabase, userId } = context;

    const { data: existing } = await supabase
      .from("wa_sessions")
      .select("session_id")
      .eq("user_id", userId)
      .maybeSingle();

    // 1) Delete the old bridge session (best-effort)
    if (existing?.session_id) {
      try {
        await waBridge.deleteSession(existing.session_id);
      } catch (err) {
        console.warn("[wa] resetWaReceiver: deleteSession failed:", err instanceof Error ? err.message : err);
      }
    }

    // 2) Mint a new session id and recreate with tenantId + webhookUrl
    const newSessionId = `flowtix-${userId.replace(/-/g, "").slice(0, 16)}-${Date.now().toString(36)}`;
    const webhookUrl = await deriveWebhookUrl();
    try {
      await waBridge.createSession(newSessionId, {
        webhookUrl: webhookUrl ?? undefined,
        tenantId: userId,
      });
    } catch (err) {
      const msg = describeBridgeError(err);
      console.error("[wa] resetWaReceiver: createSession failed:", msg);
      throw new Error(msg);
    }

    // 3) Persist new session id and reset row to QR state
    const now = new Date().toISOString();
    if (existing) {
      await supabase
        .from("wa_sessions")
        .update({
          session_id: newSessionId,
          status: "qr",
          qr_data_url: null,
          phone_number: null,
          last_seen_at: now,
        })
        .eq("user_id", userId);
    } else {
      await supabase
        .from("wa_sessions")
        .insert({ user_id: userId, session_id: newSessionId, status: "qr" });
    }

    return readState(supabase, userId, newSessionId);
  });


// ── helpers ────────────────────────────────────────────────────────────────

async function readState(
  supabase: any,
  userId: string,
  sessionId: string,
): Promise<WaConnectionState> {
  let status: BridgeSessionStatus = "unknown";
  let qrRaw: string | null = null;
  let phoneNumber: string | null = null;
  let error: string | null = null;

  try {
    const s = await waBridge.getStatus(sessionId);
    status = inferStatus(s);
    phoneNumber = s.phoneNumber ?? s.phone ?? null;
    if ((status === "qr" || status === "connecting") && s.qr) {
      qrRaw = s.qr;
      if (status === "connecting") status = "qr";
    }
  } catch (err) {
    error = describeBridgeError(err);
    console.warn("[wa] readState bridge error:", error);
    status = "disconnected";
  }

  // Fallback: poll dedicated /qr endpoint if status didn't include one.
  if (!qrRaw && (status === "qr" || status === "connecting" || status === "unknown")) {
    try {
      const q = await waBridge.getQr(sessionId);
      qrRaw = q?.qr ?? q?.qrCode ?? q?.dataUrl ?? null;
      if (qrRaw && status !== "qr") status = "qr";
    } catch {
      // no QR available yet
    }
  }

  const now = new Date().toISOString();
  // Preserve last-known phone_number when bridge transiently reports null
  // (e.g. session re-paired). Only overwrite when we actually got a number.
  const update: Record<string, unknown> = {
    status,
    qr_data_url: null,
    last_seen_at: now,
  };
  if (phoneNumber) update.phone_number = phoneNumber;
  await supabase
    .from("wa_sessions")
    .update(update)
    .eq("user_id", userId);


  // If bridge didn't give us a number, surface the last-known one from DB.
  let surfacedPhone = phoneNumber;
  if (!surfacedPhone) {
    const { data: row } = await supabase
      .from("wa_sessions")
      .select("phone_number")
      .eq("user_id", userId)
      .maybeSingle();
    surfacedPhone = row?.phone_number ?? null;
  }

  return {
    status,
    sessionId,
    qrDataUrl: null,
    qrRaw: status === "qr" ? qrRaw : null,
    phoneNumber: surfacedPhone,
    lastSeenAt: now,
    error,
  };
}

