// WhatsApp Bridge — TanStack server functions.
// All bridge calls happen here so secrets stay on the server.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./admin-middleware";
import {
  assertBridgeSendQueued,
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
import { isHardSessionGoneError, logWaSessionEvent, updateWaSessionStatus } from "./wa-session-events.server";

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

export interface WaSessionEventRow {
  createdAt: string;
  sessionId: string;
  fromStatus: string | null;
  toStatus: string;
  source: string;
  reason: string | null;
  rawStatus: string | null;
  bridgeEvent: string | null;
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
        if (existing?.session_id && !isHardSessionGoneError(err)) {
          await updateWaSessionStatus(supabase, {
            userId,
            sessionId,
            nextStatus: (existing.status as BridgeSessionStatus) || "unknown",
            source: "connect_error",
            reason: errMsg,
            rawStatus: err instanceof BridgeError ? `http_${err.status}` : null,
            logEvenIfUnchanged: true,
          });
          return {
            status: (existing.status as BridgeSessionStatus) || "unknown",
            sessionId,
            qrDataUrl: existing.qr_data_url ?? null,
            qrRaw: null,
            phoneNumber: existing.phone_number ?? null,
            lastSeenAt: existing.last_seen_at ?? now,
            error: errMsg,
          };
        }
        await updateWaSessionStatus(supabase, {
          userId,
          sessionId,
          nextStatus: "disconnected",
          source: "connect_error",
          reason: errMsg,
          rawStatus: err instanceof BridgeError ? `http_${err.status}` : null,
          qrDataUrl: null,
          logEvenIfUnchanged: true,
        });
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
      .select("session_id, status")
      .eq("user_id", userId)
      .maybeSingle();
    if (!row?.session_id) return null;
    return readState(supabase, userId, row.session_id);
  });

export const getWaSessionEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WaSessionEventRow[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("wa_session_events")
      .select("created_at, session_id, from_status, to_status, source, reason, raw_status, bridge_event")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => ({
      createdAt: row.created_at,
      sessionId: row.session_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      source: row.source,
      reason: row.reason,
      rawStatus: row.raw_status,
      bridgeEvent: row.bridge_event,
    }));
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
      providerMessageId = assertBridgeSendQueued(res);
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
      .select("session_id, status")
      .eq("user_id", userId)
      .maybeSingle();
    if (row?.session_id) {
      try {
        await waBridge.deleteSession(row.session_id);
      } catch {
        // best-effort; we still clear our row
      }
      await logWaSessionEvent(supabase, {
        userId,
        sessionId: row.session_id,
        fromStatus: row.status ?? null,
        toStatus: "disconnected",
        source: "disconnect",
        reason: "manual_disconnect",
      });
    }
    const { error: msgErr } = await supabase.from("wa_messages").delete().eq("user_id", userId);
    if (msgErr) throw new Error(`Failed to clear WhatsApp messages: ${msgErr.message}`);
    const { error: convErr } = await supabase.from("wa_conversations").delete().eq("user_id", userId);
    if (convErr) throw new Error(`Failed to clear WhatsApp conversations: ${convErr.message}`);
    const { error: sessErr } = await supabase.from("wa_sessions").delete().eq("user_id", userId);
    if (sessErr) throw new Error(`Failed to clear WhatsApp session: ${sessErr.message}`);
    const { error: settingsErr } = await supabase
      .from("whatsapp_settings")
      .update({ is_connected: false, last_connected_at: null })
      .eq("user_id", userId);
    if (settingsErr) throw new Error(`Failed to update WhatsApp settings: ${settingsErr.message}`);
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
      .select("session_id, status")
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
      await logWaSessionEvent(supabase, {
        userId,
        sessionId: existing.session_id,
        fromStatus: existing.status ?? null,
        toStatus: "disconnected",
        source: "reset",
        reason: "manual_reset_new_qr",
      });
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

    await logWaSessionEvent(supabase, {
      userId,
      sessionId: newSessionId,
      fromStatus: null,
      toStatus: "qr",
      source: "reset",
      reason: "new_qr_session_created",
    });

    return readState(supabase, userId, newSessionId);
  });


export interface WaWebhookTestResult {
  ok: boolean;
  httpStatus: number;
  responseBody: string;
  saved: number;
  sessionId: string | null;
  messageStored: boolean;
  aiLogStatus: string | null;
  aiError: string | null;
  aiResponseStored: boolean;
  error: string | null;
}

/**
 * Sends a synthetic inbound message to our own /api/public/wa-webhook handler
 * so the user can verify reception end-to-end. Signs the payload with the
 * configured WA_BRIDGE_WEBHOOK_SECRET and returns the handler response plus
 * whether a wa_messages row was actually persisted.
 */
export const testWaWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WaWebhookTestResult> => {
    const { supabase, userId } = context;

    const { data: sess } = await supabase
      .from("wa_sessions")
      .select("session_id")
      .eq("user_id", userId)
      .maybeSingle();

    const sessionId = sess?.session_id ?? null;
    if (!sessionId) {
      return {
        ok: false, httpStatus: 0, responseBody: "", saved: 0,
        sessionId: null, messageStored: false, aiLogStatus: null, aiError: null, aiResponseStored: false,
        error: "no_session: اربط واتساب أولًا قبل تشغيل الاختبار.",
      };
    }

    const secret = process.env.WA_BRIDGE_WEBHOOK_SECRET;
    if (!secret) {
      return {
        ok: false, httpStatus: 0, responseBody: "", saved: 0,
        sessionId, messageStored: false, aiLogStatus: null, aiError: null, aiResponseStored: false,
        error: "missing_secret: WA_BRIDGE_WEBHOOK_SECRET غير مهيّأ على الخادم.",
      };
    }

    const providerMessageId = `TEST_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const testText = `🔧 رسالة اختبار AI/Webhook ${providerMessageId}`;
    const payload = {
      event: "message",
      sessionId,
      data: {
        id: providerMessageId,
        messageId: providerMessageId,
        from: "201000000000",
        fromMe: false,
        pushName: "Webhook Test",
        type: "text",
        content: testText,
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    };
    const raw = JSON.stringify(payload);

    const { createHmac } = await import("crypto");
    const sig = createHmac("sha256", secret).update(raw, "utf8").digest("hex");

    try {
      const { handleWaWebhook } = await import("./wa-webhook.server");
      const req = new Request("http://internal.local/api/public/wa-webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bridge-signature": `sha256=${sig}`,
        },
        body: raw,
      });
      const res = await handleWaWebhook(req);
      const body = await res.text();
      let saved = 0;
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed?.saved === "number") saved = parsed.saved;
      } catch { /* non-JSON */ }

      const { data: stored } = await supabase
        .from("wa_messages")
        .select("id")
        .eq("user_id", userId)
        .eq("provider_message_id", providerMessageId)
        .maybeSingle();

      const messageStored = Boolean(stored?.id);
      const { data: aiLog } = await supabase
        .from("wa_ai_logs")
        .select("status, error_message, response_text")
        .eq("user_id", userId)
        .eq("remote_jid", "201000000000@s.whatsapp.net")
        .eq("prompt_excerpt", testText.slice(0, 500))
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: settings } = await supabase
        .from("whatsapp_settings")
        .select("ai_enabled")
        .eq("user_id", userId)
        .maybeSingle();
      const aiLogStatus = aiLog?.status ?? null;
      const aiError = aiLog?.error_message ?? (settings?.ai_enabled === false
        ? "ai_disabled: وكيل AI غير مفعّل لهذا الحساب. فعّله من صفحة وكيل AI ثم احفظ."
        : aiLogStatus
          ? null
          : "no_ai_log: تم تخزين الرسالة لكن لم يظهر أي تشغيل للـ AI. راجع إعدادات الوكيل ومفاتيح Kie.");
      const aiResponseStored = Boolean(aiLog?.response_text);
      const aiOk = aiLogStatus === "success" && aiResponseStored;
      const ok = res.status >= 200 && res.status < 300 && messageStored && aiOk;
      return {
        ok,
        httpStatus: res.status,
        responseBody: body.slice(0, 500),
        saved,
        sessionId,
        messageStored,
        aiLogStatus,
        aiError,
        aiResponseStored,
        error: ok
          ? null
          : res.status >= 400
            ? `webhook_rejected: HTTP ${res.status} — ${body.slice(0, 200)}`
            : !messageStored
              ? "not_persisted: الـ webhook ردّ بنجاح لكن لم يتم تخزين الرسالة (تأكد إن session_id مسجّل على الخادم)."
              : !aiOk
                ? `ai_not_replied: ${aiError || "لم يتم حفظ رد AI."}`
              : null,
      };
    } catch (err) {
      return {
        ok: false, httpStatus: 0, responseBody: "", saved: 0,
        sessionId, messageStored: false, aiLogStatus: null, aiError: null, aiResponseStored: false,
        error: `internal_error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
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
    if (isHardSessionGoneError(err)) {
      status = "disconnected";
    } else {
      // A timeout/502/temporary bridge failure is not proof that the WhatsApp
      // device logged out. Preserve the last DB status so polling cannot
      // accidentally mark a healthy Bot-Xtra session as disconnected.
      const { data: current } = await supabase
        .from("wa_sessions")
        .select("status")
        .eq("user_id", userId)
        .eq("session_id", sessionId)
        .maybeSingle();
      const existingStatus = current?.status as BridgeSessionStatus | undefined;
      status = existingStatus && ["connected", "qr", "connecting", "disconnected", "unknown"].includes(existingStatus)
        ? existingStatus
        : "unknown";
    }
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
  await updateWaSessionStatus(supabase, {
    userId,
    sessionId,
    nextStatus: status,
    source: error ? "poll_error" : "poll",
    reason: error,
    rawStatus: status,
    phoneNumber,
    qrDataUrl: null,
    logEvenIfUnchanged: Boolean(error),
  });


  // If bridge didn't give us a number, surface the last-known one from DB.
  let surfacedPhone = phoneNumber;
  if (!surfacedPhone) {
    const { data: row } = await supabase
      .from("wa_sessions")
      .select("phone_number")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
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

