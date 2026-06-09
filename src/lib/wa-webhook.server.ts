// Shared inbound webhook handler for the BotXtra WhatsApp bridge.
// Used by both /api/public/wa-webhook and /api/public/wa/webhook routes.
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { handleAiAutoReply, upsertConversationFromMessage } from "./wa-ai.server";

function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const received = header.startsWith("sha256=") ? header.slice(7) : header;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(received, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function digits(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const d = s.replace(/[^0-9]/g, "");
  return d || null;
}

function pickStr(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

export async function handleWaWebhook(request: Request): Promise<Response> {
  const secret = process.env.WA_BRIDGE_WEBHOOK_SECRET;
  if (!secret) {
    return new Response("Webhook secret not configured", { status: 500 });
  }

  const raw = await request.text();
  const sig =
    request.headers.get("x-bridge-signature") ||
    request.headers.get("x-hub-signature-256") ||
    request.headers.get("x-signature");
  if (!verifySignature(raw, sig, secret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const sessionId =
    pickStr(payload, "sessionId", "session_id", "session") ||
    pickStr((payload.data as Record<string, unknown>) || {}, "sessionId", "session_id");
  if (!sessionId) {
    return new Response("Missing sessionId", { status: 400 });
  }

  const { data: sess } = await supabaseAdmin
    .from("wa_sessions")
    .select("user_id")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (!sess?.user_id) {
    return new Response("ok", { status: 200 });
  }

  const userId = sess.user_id;
  const event = String(payload.event || payload.type || "").toLowerCase();
  const data = ((payload.data as Record<string, unknown>) || payload) as Record<string, unknown>;

  // ── status update ──
  if (event === "status" || event === "connection.update" || event === "session.status") {
    const rawStatus = String(data.status ?? data.state ?? "").toLowerCase();
    const map: Record<string, string> = {
      open: "connected",
      ready: "connected",
      connected: "connected",
      qr: "qr",
      scan: "qr",
      connecting: "connecting",
      starting: "connecting",
      disconnected: "disconnected",
      closed: "disconnected",
      logged_out: "disconnected",
    };
    const next = map[rawStatus] ?? "unknown";
    await supabaseAdmin
      .from("wa_sessions")
      .update({
        status: next,
        phone_number: digits(data.phoneNumber ?? data.phone),
        last_seen_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    return new Response("ok");
  }

  // ── QR refresh ──
  if (event === "qr" || event === "qr.update") {
    const qr = data.qr ?? data.qrCode ?? data.dataUrl;
    const qrDataUrl =
      typeof qr === "string"
        ? qr.startsWith("data:image")
          ? qr
          : `data:image/png;base64,${qr}`
        : null;
    await supabaseAdmin
      .from("wa_sessions")
      .update({
        status: "qr",
        qr_data_url: qrDataUrl,
        last_seen_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    return new Response("ok");
  }

  // ── inbound message ──
  // Accept multiple event names used by different bridge versions.
  const isMessageEvent =
    event === "message" ||
    event === "message.incoming" ||
    event === "messages.upsert" ||
    event === "message.new" ||
    event === "incoming" ||
    event === "" /* some bridges send just data */;

  if (isMessageEvent) {
    // Try to detect a message-shaped payload
    const from =
      digits(data.from) ||
      digits(data.sender) ||
      digits((data.key as Record<string, unknown> | undefined)?.remoteJid);
    const text =
      pickStr(data, "text", "body", "message") ||
      pickStr(
        ((data.message as Record<string, unknown>) || {}) as Record<string, unknown>,
        "conversation",
        "text",
      );
    const type = (pickStr(data, "type", "msgType") || (text ? "text" : "unknown")).toLowerCase();
    const mediaUrl = pickStr(data, "mediaUrl", "media_url", "url");

    // If we still couldn't find a sender, this is not a message — accept silently.
    if (!from && !text) {
      return new Response("ok");
    }

    const remoteJid =
      pickStr(data, "remoteJid", "remote_jid", "jid") ||
      from ||
      String(data.from ?? "unknown");
    const contactName = pickStr(data, "pushName", "contactName", "name", "notify");
    const fromOutbound = data.fromMe === true || data.fromme === true;

    await supabaseAdmin.from("wa_messages").insert({
      user_id: userId,
      session_id: sessionId,
      direction: fromOutbound ? "out" : "in",
      remote_jid: remoteJid,
      from_phone: from,
      msg_type: type,
      text_body: text,
      media_url: mediaUrl,
      raw: data as never,
    });

    const conversationId = await upsertConversationFromMessage({
      userId,
      sessionId,
      remoteJid,
      contactName,
      contactPhone: from,
      text: text ?? (type !== "text" ? `[${type}]` : null),
      direction: fromOutbound ? "out" : "in",
    });

    if (text && !fromOutbound) {
      handleAiAutoReply({
        userId,
        sessionId,
        conversationId,
        remoteJid,
        fromPhone: from,
        inboundText: text,
      }).catch((err) => console.error("[wa-webhook] AI handler error:", err));
    }

    return new Response("ok");
  }

  // Unknown event — accept silently
  return new Response("ok");
}
