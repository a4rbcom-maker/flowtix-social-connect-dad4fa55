// WhatsApp Bridge — TanStack server functions.
// All bridge calls happen here so secrets stay on the server.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./admin-middleware";
import {
  waBridge,
  inferStatus,
  pickQrDataUrl,
  BridgeError,
  type BridgeSessionStatus,
} from "./wa-bridge.server";


export interface WaBridgeHealth {
  ok: boolean;
  status: string | null;
  version: string | null;
  latencyMs: number;
  url: string | null;
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
  error: string | null;
}

export const pingWaBridge = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async (): Promise<WaBridgeHealth> => {
    const url = process.env.WA_BRIDGE_URL ?? null;
    const hasApiKey = !!process.env.WA_BRIDGE_API_KEY;
    const hasWebhookSecret = !!process.env.WA_BRIDGE_WEBHOOK_SECRET;
    const started = Date.now();
    try {
      const res = await waBridge.health();
      return {
        ok: true,
        status: res.status ?? "ok",
        version: res.version ?? null,
        latencyMs: Date.now() - started,
        url,
        hasApiKey,
        hasWebhookSecret,
        error: null,
      };
    } catch (err) {
      return {
        ok: false,
        status: null,
        version: null,
        latencyMs: Date.now() - started,
        url,
        hasApiKey,
        hasWebhookSecret,
        error: err instanceof Error ? err.message : "Bridge unreachable",
      };
    }
  });


export interface WaConnectionState {
  status: BridgeSessionStatus;
  sessionId: string;
  qrDataUrl: string | null;
  qrRaw: string | null;
  phoneNumber: string | null;
  lastSeenAt: string | null;
  error: string | null;
}

function describeBridgeError(err: unknown): string {
  if (err instanceof BridgeError) {
    if (err.status === 404) return "الجلسة غير موجودة على خادم الربط";
    if (err.status === 401 || err.status === 403)
      return "مفتاح خادم الربط غير صحيح (WA_BRIDGE_API_KEY)";
    if (err.status === 502 || err.status === 504)
      return "تعذر الوصول إلى خادم الربط (Bot-Xtra Bridge). تحقق من WA_BRIDGE_URL أو أن الخادم يعمل.";
    return err.message;
  }
  if (err instanceof Error) {
    const m = err.message || "";
    if (m.includes("ENOTFOUND") || m.includes("EAI_AGAIN"))
      return "عنوان خادم الربط غير صالح أو غير قابل للوصول (DNS). راجع قيمة WA_BRIDGE_URL.";
    if (m.includes("ECONNREFUSED")) return "خادم الربط رفض الاتصال. تأكد أنه يعمل.";
    if (m.includes("timed out")) return "انتهت مهلة الاتصال بخادم الربط.";
    return m;
  }
  return "خطأ غير معروف عند الاتصال بخادم الربط";
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
  await supabase
    .from("wa_sessions")
    .update({
      status,
      qr_data_url: null,
      phone_number: phoneNumber,
      last_seen_at: now,
    })
    .eq("user_id", userId);

  return {
    status,
    sessionId,
    qrDataUrl: null,
    qrRaw: status === "qr" ? qrRaw : null,
    phoneNumber,
    lastSeenAt: now,
    error,
  };
}
