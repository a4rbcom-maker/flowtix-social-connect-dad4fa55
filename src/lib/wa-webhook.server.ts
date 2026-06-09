// Shared inbound webhook handler for the BotXtra/Baileys WhatsApp bridge.
// Mounted at /api/public/wa-webhook (canonical) and /api/public/wa/webhook (alias).
// Designed to be tolerant of different bridge payload shapes.
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

function pickStr(obj: unknown, ...keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function findSessionId(payload: Record<string, unknown>, headers: Headers): string | null {
  return (
    pickStr(payload, "sessionId", "session_id", "session", "instanceId", "instance_id") ||
    pickStr(asObj(payload.data), "sessionId", "session_id", "instanceId") ||
    pickStr(asObj(payload.instance), "instanceId", "id", "name") ||
    pickStr(asObj(payload.session), "id", "sessionId") ||
    headers.get("x-session-id") ||
    headers.get("x-instance-id") ||
    null
  );
}

interface ParsedMessage {
  remoteJid: string;
  fromPhone: string | null;
  text: string | null;
  msgType: string;
  mediaUrl: string | null;
  contactName: string | null;
  fromMe: boolean;
}

function extractTextFromMessage(m: Record<string, unknown>): { text: string | null; type: string; mediaUrl: string | null } {
  // Direct fields
  const direct = pickStr(m, "text", "body", "message", "caption");
  if (direct) return { text: direct, type: "text", mediaUrl: null };

  // Baileys-style nested `message`
  const msg = asObj(m.message);
  const conv = pickStr(msg, "conversation");
  if (conv) return { text: conv, type: "text", mediaUrl: null };

  const ext = asObj(msg.extendedTextMessage);
  const extText = pickStr(ext, "text");
  if (extText) return { text: extText, type: "text", mediaUrl: null };

  const img = asObj(msg.imageMessage);
  if (Object.keys(img).length) {
    return { text: pickStr(img, "caption"), type: "image", mediaUrl: pickStr(img, "url") };
  }
  const vid = asObj(msg.videoMessage);
  if (Object.keys(vid).length) {
    return { text: pickStr(vid, "caption"), type: "video", mediaUrl: pickStr(vid, "url") };
  }
  const aud = asObj(msg.audioMessage);
  if (Object.keys(aud).length) return { text: null, type: "audio", mediaUrl: pickStr(aud, "url") };
  const doc = asObj(msg.documentMessage);
  if (Object.keys(doc).length) {
    return { text: pickStr(doc, "fileName", "caption"), type: "document", mediaUrl: pickStr(doc, "url") };
  }
  const sticker = asObj(msg.stickerMessage);
  if (Object.keys(sticker).length) return { text: null, type: "sticker", mediaUrl: pickStr(sticker, "url") };

  return { text: null, type: "unknown", mediaUrl: null };
}

function parseMessageEntry(entry: Record<string, unknown>): ParsedMessage | null {
  const key = asObj(entry.key);
  const remoteJid =
    pickStr(entry, "remoteJid", "remote_jid", "jid", "from", "sender") ||
    pickStr(key, "remoteJid") ||
    null;

  const fromPhone =
    digits(entry.from) ||
    digits(entry.sender) ||
    digits(entry.phoneNumber) ||
    digits(entry.phone) ||
    digits(pickStr(key, "remoteJid")) ||
    digits(remoteJid);

  const { text, type, mediaUrl } = extractTextFromMessage(entry);

  const fromMe =
    entry.fromMe === true ||
    entry.fromme === true ||
    (key.fromMe as boolean | undefined) === true;

  // Skip status broadcast and pure system events
  const jid = remoteJid || fromPhone || "";
  if (jid.endsWith("@broadcast") || jid === "status@broadcast") return null;
  if (!text && type === "unknown" && !mediaUrl) return null;
  if (!remoteJid && !fromPhone) return null;

  return {
    remoteJid: remoteJid || (fromPhone ? `${fromPhone}@s.whatsapp.net` : "unknown"),
    fromPhone,
    text,
    msgType: type,
    mediaUrl,
    contactName: pickStr(entry, "pushName", "contactName", "name", "notify"),
    fromMe,
  };
}

function collectMessageEntries(payload: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const push = (v: unknown) => {
    if (Array.isArray(v)) v.forEach((x) => x && typeof x === "object" && out.push(x as Record<string, unknown>));
    else if (v && typeof v === "object") out.push(v as Record<string, unknown>);
  };
  const data = asObj(payload.data);
  push(payload.messages);
  push(data.messages);
  push(payload.message);
  // The data object itself may BE the message
  if (!out.length) push(data);
  // The payload itself may be the message
  if (!out.length && (payload.from || payload.sender || payload.text || payload.body || payload.message || payload.key)) {
    out.push(payload);
  }
  return out;
}

export async function handleWaWebhook(request: Request): Promise<Response> {
  const secret = process.env.WA_BRIDGE_WEBHOOK_SECRET;
  const raw = await request.text();
  const sig =
    request.headers.get("x-bridge-signature") ||
    request.headers.get("x-hub-signature-256") ||
    request.headers.get("x-signature") ||
    request.headers.get("x-webhook-signature");

  // BotXtra bridge v1.8.x has webhook HMAC DISABLED by default, so most
  // production deliveries arrive unsigned. We therefore accept unsigned
  // requests, but ALWAYS verify when the bridge does include a signature.
  if (sig) {
    if (!secret) {
      console.error("[wa-webhook] signature present but WA_BRIDGE_WEBHOOK_SECRET is not configured");
      return new Response("Webhook secret not configured", { status: 500 });
    }
    if (!verifySignature(raw, sig, secret)) {
      console.warn("[wa-webhook] Invalid signature, rejecting");
      return new Response("Invalid signature", { status: 401 });
    }
  } else {
    console.info("[wa-webhook] unsigned delivery accepted (bridge HMAC disabled)");
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const sessionId = findSessionId(payload, request.headers);
  if (!sessionId) {
    console.warn("[wa-webhook] Missing sessionId in payload keys:", Object.keys(payload));
    return new Response("Missing sessionId", { status: 400 });
  }

  const { data: sess, error: sessErr } = await supabaseAdmin
    .from("wa_sessions")
    .select("user_id")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (sessErr) {
    console.error("[wa-webhook] session lookup error:", sessErr.message);
    return new Response("DB error", { status: 500 });
  }
  if (!sess?.user_id) {
    console.warn("[wa-webhook] Unknown sessionId:", sessionId);
    return new Response("ok", { status: 200 });
  }

  const userId = sess.user_id;
  const event = String(payload.event || payload.type || "").toLowerCase();
  const data = asObj(payload.data);

  // ── status update ──
  if (event === "status" || event === "connection.update" || event === "session.status") {
    const rawStatus = String(data.status ?? data.state ?? payload.status ?? "").toLowerCase();
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
        phone_number: digits(data.phoneNumber ?? data.phone ?? payload.phoneNumber),
        last_seen_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    return new Response("ok");
  }

  // ── QR refresh ──
  if (event === "qr" || event === "qr.update") {
    const qr = data.qr ?? data.qrCode ?? data.dataUrl ?? payload.qr;
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

  // ── inbound/outbound messages ──
  const entries = collectMessageEntries(payload);
  if (entries.length === 0) {
    console.warn("[wa-webhook] No message entries found. Event:", event, "keys:", Object.keys(payload));
    return new Response("ok");
  }

  let saved = 0;
  for (const entry of entries) {
    const m = parseMessageEntry(entry);
    if (!m) continue;

    const { error: insErr } = await supabaseAdmin.from("wa_messages").insert({
      user_id: userId,
      session_id: sessionId,
      direction: m.fromMe ? "out" : "in",
      remote_jid: m.remoteJid,
      from_phone: m.fromMe ? null : m.fromPhone,
      to_phone: m.fromMe ? m.fromPhone : null,
      msg_type: m.msgType,
      text_body: m.text,
      media_url: m.mediaUrl,
      raw: entry as never,
    });
    if (insErr) {
      console.error("[wa-webhook] insert wa_messages failed:", insErr.message);
      continue;
    }
    saved++;

    const conversationId = await upsertConversationFromMessage({
      userId,
      sessionId,
      remoteJid: m.remoteJid,
      contactName: m.contactName,
      contactPhone: m.fromPhone,
      text: m.text ?? (m.msgType !== "text" ? `[${m.msgType}]` : null),
      direction: m.fromMe ? "out" : "in",
    });

    if (m.text && !m.fromMe) {
      handleAiAutoReply({
        userId,
        sessionId,
        conversationId,
        remoteJid: m.remoteJid,
        fromPhone: m.fromPhone,
        inboundText: m.text,
      }).catch((err) => console.error("[wa-webhook] AI handler error:", err));
    }
  }

  return new Response(JSON.stringify({ ok: true, saved }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
