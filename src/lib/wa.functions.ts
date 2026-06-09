// WhatsApp Bridge — TanStack server functions.
// All bridge calls happen here so secrets stay on the server.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./admin-middleware";
import {
  waBridge,
  inferStatus,
  BridgeError,
  type BridgeSessionStatus,
} from "./wa-bridge.server";

/**
 * Resolve the public, STABLE URL where the BotXtra bridge should POST
 * inbound WhatsApp events. Preview URLs change per build, so we prefer
 * (in order):
 *   1) explicit override via WA_PUBLIC_WEBHOOK_URL secret
 *   2) the stable Lovable-published URL (project alias never changes)
 *   3) the current request host (last-resort fallback)
 */
function deriveWebhookUrl(): string | null {
  const override = process.env.WA_PUBLIC_WEBHOOK_URL;
  if (override) return override.replace(/\/+$/, "");

  const PUBLISHED = "https://flowtix-social-connect.lovable.app/api/public/wa-webhook";
  try {
    const req = getRequest();
    const u = new URL(req.url);
    const host = req.headers.get("x-forwarded-host") || u.host;
    const proto = req.headers.get("x-forwarded-proto") || u.protocol.replace(":", "");
    // If we're already on a *.lovable.app host, trust it. Otherwise (preview
    // / lovableproject.com / localhost) use the stable published URL so the
    // bridge can always reach us even after a redeploy.
    if (host && /\.lovable\.app$/i.test(host)) {
      return `${proto}://${host}/api/public/wa-webhook`;
    }
    return PUBLISHED;
  } catch {
    return PUBLISHED;
  }
}



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
  .handler(async (): Promise<WaBridgeHealth> => doPing());

/** User-facing health check (no admin role required). */
export const pingWaBridgeUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<WaBridgeHealth> => doPing());

async function doPing(): Promise<WaBridgeHealth> {
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
      error: describeBridgeError(err),
    };
  }
}


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
    const webhookUrl = deriveWebhookUrl();
    try {
      await waBridge.createSession(sessionId, webhookUrl ?? undefined);
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

    // 2b) Always (re)register the webhook URL — covers existing sessions whose
    // bridge config was never updated. Best-effort, never blocks connection.
    if (webhookUrl) {
      waBridge.setWebhook(sessionId, webhookUrl).catch((err) =>
        console.warn("[wa] setWebhook failed:", err instanceof Error ? err.message : err),
      );
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

/**
 * Re-register the bridge webhook URL for the current user's session.
 * Call this if no inbound messages are appearing — the bridge may have
 * a stale preview URL from when the session was originally paired.
 */
export const resyncWaWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("wa_sessions")
      .select("session_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!row?.session_id) {
      return { ok: false, webhookUrl: null, error: "No WhatsApp session — connect first" };
    }
    const webhookUrl = deriveWebhookUrl();
    if (!webhookUrl) {
      return { ok: false, webhookUrl: null, error: "Cannot determine webhook URL" };
    }
    // Bridge has no per-session webhook endpoint — re-POST /api/sessions with
    // the same id and the canonical webhookUrl so the bridge updates its
    // stored target. This is idempotent.
    try {
      await waBridge.createSession(row.session_id, webhookUrl);
    } catch (err) {
      // already_connected / 409 are fine
      console.warn("[wa] resyncWaWebhook createSession:", err instanceof Error ? err.message : err);
    }
    waBridge.setWebhook(row.session_id, webhookUrl).catch(() => {});
    return { ok: true, webhookUrl, error: null };
  });

/**
 * Diagnostic: POST a fake inbound message to our own webhook endpoint
 * to verify the receive → DB → conversations chain works end-to-end.
 * Returns whether a row was created in wa_messages.
 */
export const sendWaWebhookTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: row } = await supabase
      .from("wa_sessions")
      .select("session_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!row?.session_id) {
      return { ok: false, error: "No WhatsApp session" };
    }
    const webhookUrl = deriveWebhookUrl();
    if (!webhookUrl) return { ok: false, error: "Cannot determine webhook URL" };

    const stamp = Date.now();
    const payload = {
      event: "messages.upsert",
      sessionId: row.session_id,
      data: {
        messages: [
          {
            key: { remoteJid: `999000${stamp}@s.whatsapp.net`, fromMe: false, id: `TEST_${stamp}` },
            pushName: "Flowtix Test",
            message: { conversation: `Test inbound message ${stamp}` },
          },
        ],
      },
    };
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, body: text.slice(0, 300), webhookUrl };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "fetch failed", webhookUrl };
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
