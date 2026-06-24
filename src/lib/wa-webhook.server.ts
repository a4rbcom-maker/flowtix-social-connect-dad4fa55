// Shared inbound webhook handler for the BotXtra/Baileys WhatsApp bridge.
// Mounted at /api/public/wa-webhook (canonical) and /api/public/wa/webhook (alias).
// Designed to be tolerant of different bridge payload shapes.
import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { handleAiAutoReply, upsertConversationFromMessage } from "./wa-ai.server";
import { cleanMessageText, mediaTypeFromRaw, mediaUrlFromRaw } from "./wa-chat-helpers.server";
import { tryKeywordAutoReply } from "./wa-keyword.server";

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

function normalizeRemoteJid(remoteJid: string | null, phone: string | null, isGroup = false): string {
  const jid = remoteJid || "";
  if (jid.includes("@")) return jid;
  const d = digits(jid) || phone;
  return d ? `${d}@${isGroup ? "g.us" : "s.whatsapp.net"}` : "unknown";
}

function isTruthy(v: unknown): boolean {
  return v === true || String(v ?? "").toLowerCase() === "true";
}

function normalizeMessageStatus(value: unknown, fromMe: boolean): string {
  const raw = String(value ?? "").toLowerCase();
  if (["read", "played"].includes(raw)) return "read";
  if (["delivered", "delivery", "server_ack", "device_ack"].includes(raw)) return "delivered";
  if (["sent", "pending", "queued"].includes(raw)) return raw;
  if (["failed", "error", "undelivered"].includes(raw)) return "failed";
  return fromMe ? "sent" : "received";
}

function messageIdFrom(entry: Record<string, unknown>): string | null {
  return (
    pickStr(entry, "messageId", "message_id", "msgId", "msg_id", "id", "wamid") ||
    pickStr(asObj(entry.key), "id") ||
    pickStr(asObj(entry.message), "id")
  );
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

function parseWaTimestamp(entry: Record<string, unknown>): string | null {
  const candidates: unknown[] = [
    entry.messageTimestamp,
    entry.timestamp,
    entry.t,
    asObj(entry.key).timestamp,
    asObj(entry.message).messageTimestamp,
    asObj(entry.data).timestamp,
  ];
  for (const raw of candidates) {
    if (raw == null) continue;
    const num = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isFinite(num) || num <= 0) continue;
    // Heuristic: < 10^12 => seconds; otherwise milliseconds
    const ms = num < 1_000_000_000_000 ? num * 1000 : num;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

interface ParsedMessage {
  remoteJid: string;
  fromPhone: string | null;
  text: string | null;
  msgType: string;
  mediaUrl: string | null;
  contactName: string | null;
  fromMe: boolean;
  isGroup: boolean;
  providerMessageId: string | null;
  status: string;
  waTimestamp: string | null;
}


const WA_MEDIA_BUCKET = "wa-media";

function mediaDataFromEntry(entry: Record<string, unknown>): Record<string, unknown> {
  return asObj(entry.mediaData);
}

function fallbackMimeType(msgType: string): string {
  if (msgType === "image") return "image/jpeg";
  if (msgType === "video") return "video/mp4";
  if (msgType === "audio") return "audio/ogg";
  if (msgType === "sticker") return "image/webp";
  return "application/octet-stream";
}

function extensionFromMime(mimeType: string, msgType: string): string {
  const clean = mimeType.split(";")[0]?.trim().toLowerCase();
  if (clean === "image/jpeg") return "jpg";
  if (clean === "image/png") return "png";
  if (clean === "image/webp") return "webp";
  if (clean === "image/gif") return "gif";
  if (clean === "video/mp4") return "mp4";
  if (clean === "video/webm") return "webm";
  if (clean === "audio/mpeg") return "mp3";
  if (clean === "audio/mp4") return "m4a";
  if (clean === "audio/ogg" || clean === "audio/opus") return "ogg";
  if (clean === "application/pdf") return "pdf";
  if (msgType === "image") return "jpg";
  if (msgType === "video") return "mp4";
  if (msgType === "audio") return "ogg";
  if (msgType === "sticker") return "webp";
  return "bin";
}

function safeBaseName(value: string | null, fallback: string): string {
  const last = (value ?? "").split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  return (last || fallback).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 140) || fallback;
}

function mediaBytesFromEntry(
  entry: Record<string, unknown>,
  msgType: string,
  mediaUrl: string | null,
): { bytes: Buffer; mimeType: string } | null {
  const media = mediaDataFromEntry(entry);
  const dataUrl = mediaUrl?.startsWith("data:") ? mediaUrl : pickStr(media, "dataUrl");
  const mimeType =
    (dataUrl?.match(/^data:([^;]+(?:;[^,]+)?);base64,/)?.[1] ||
      pickStr(media, "mimeType", "mimetype", "fileMimeType", "contentType") ||
      fallbackMimeType(msgType)).trim();
  const base64 =
    dataUrl?.replace(/^data:[^,]+,/, "") || pickStr(media, "base64", "fileData", "data");
  if (!base64) return null;
  return { bytes: Buffer.from(base64.replace(/\s+/g, ""), "base64"), mimeType };
}

async function persistWaMedia(params: {
  userId: string;
  sessionId: string;
  entry: Record<string, unknown>;
  msgType: string;
  mediaUrl: string | null;
}): Promise<string | null> {
  if (params.mediaUrl?.startsWith("wa-media:")) return params.mediaUrl;
  const media = mediaDataFromEntry(params.entry);
  const payload = mediaBytesFromEntry(params.entry, params.msgType, params.mediaUrl);
  if (!payload) return params.mediaUrl && /^(https?:)?\/\//i.test(params.mediaUrl) ? params.mediaUrl : null;

  const fallbackName = `${Date.now()}_${randomUUID()}.${extensionFromMime(payload.mimeType, params.msgType)}`;
  const fileName = safeBaseName(pickStr(media, "fileName", "filename", "name"), fallbackName);
  const path = `${params.userId}/${params.sessionId}/${Date.now()}_${fileName}`;
  const { error } = await supabaseAdmin.storage.from(WA_MEDIA_BUCKET).upload(path, payload.bytes, {
    contentType: payload.mimeType,
    upsert: true,
  });
  if (error) {
    console.error("[wa-webhook] media upload failed:", error.message);
    return params.mediaUrl || null;
  }
  return `wa-media:${path}`;
}

function extractTextFromMessage(m: Record<string, unknown>): { text: string | null; type: string; mediaUrl: string | null } {
  // ── BotXtra flat shape: entry.type + entry.mediaData ──
  const flatType = String(m.type ?? "").toLowerCase();
  const mediaData = asObj(m.mediaData);
  const hasMediaData = Object.keys(mediaData).length > 0;
  const flatMediaUrl =
    pickStr(mediaData, "url", "directPath", "fileUrl", "downloadUrl", "mediaUrl") ||
    pickStr(m, "mediaUrl", "fileUrl", "url");
  const flatCaption = pickStr(m, "caption", "body", "text") || pickStr(mediaData, "caption", "fileName");

  if (["image", "video", "audio", "document", "sticker", "voice", "ptt"].includes(flatType) || hasMediaData) {
    const norm =
      flatType === "voice" || flatType === "ptt"
        ? "audio"
        : flatType && flatType !== "text"
          ? flatType
          : "document";
    return {
      text: norm === "audio" || norm === "sticker" ? null : flatCaption,
      type: norm,
      mediaUrl: flatMediaUrl,
    };
  }

  // Direct text fields
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
    return { text: pickStr(img, "caption"), type: "image", mediaUrl: pickStr(img, "url", "directPath") };
  }
  const vid = asObj(msg.videoMessage);
  if (Object.keys(vid).length) {
    return { text: pickStr(vid, "caption"), type: "video", mediaUrl: pickStr(vid, "url", "directPath") };
  }
  const aud = asObj(msg.audioMessage);
  if (Object.keys(aud).length) return { text: null, type: "audio", mediaUrl: pickStr(aud, "url", "directPath") };
  const doc = asObj(msg.documentMessage);
  if (Object.keys(doc).length) {
    return { text: pickStr(doc, "fileName", "caption"), type: "document", mediaUrl: pickStr(doc, "url", "directPath") };
  }
  const sticker = asObj(msg.stickerMessage);
  if (Object.keys(sticker).length) return { text: null, type: "sticker", mediaUrl: pickStr(sticker, "url", "directPath") };

  return { text: null, type: "unknown", mediaUrl: null };
}


function parseMessageEntry(entry: Record<string, unknown>): ParsedMessage | null {
  const key = asObj(entry.key);
  const fromMe =
    entry.fromMe === true ||
    entry.fromme === true ||
    (key.fromMe as boolean | undefined) === true;
  const isGroup =
    isTruthy(entry.isGroup) ||
    Boolean(pickStr(entry, "groupJid", "groupId")) ||
    Boolean(pickStr(key, "remoteJid")?.endsWith("@g.us"));
  const realPhone =
    digits(pickStr(entry, "senderPn", "participantPn", "phoneNumber", "phone")) ||
    digits(pickStr(asObj(entry.participant), "id", "phone", "jid"));
  const keyRemote = pickStr(key, "remoteJid");
  const groupJid = pickStr(entry, "groupJid", "groupId") || (keyRemote?.endsWith("@g.us") ? keyRemote : null);
  const directChatJid = pickStr(entry, "remoteJid", "remote_jid", "jid", "chatId");
  const recipientJid = pickStr(entry, "to", "recipient", "recipientJid", "targetJid", "toJid");
  const senderJid = pickStr(entry, "from", "sender", "senderJid", "participantJid");
  const remoteJid = isGroup
    ? groupJid
    : fromMe
      ? (recipientJid || directChatJid || keyRemote)
      : (realPhone || directChatJid || keyRemote || senderJid);

  const fromPhone = isGroup
    ? realPhone || digits(senderJid)
    : fromMe
      ? digits(recipientJid || directChatJid || keyRemote || remoteJid) || realPhone
      : realPhone || digits(senderJid) || digits(remoteJid);

  const { text, type, mediaUrl } = extractTextFromMessage(entry);

  // Skip status broadcast and pure system events
  const jid = remoteJid || fromPhone || "";
  if (jid.endsWith("@broadcast") || jid === "status@broadcast") return null;
  if (!text && type === "unknown" && !mediaUrl) return null;
  if (!remoteJid && !fromPhone) return null;

  // Skip orphan outbound echoes from the bridge: when fromMe is true but the
  // payload doesn't include a real recipient (only the user's own LID in
  // `from`/`sender`), we can't attribute the message to its conversation.
  // Storing it would create a fake conversation under the LID and hide the
  // user's reply from the real chat. Outbound messages sent through our UI
  // are stored directly by sendChatMessage with the correct remote_jid.
  if (!isGroup && fromMe) {
    const hasRealRecipient = Boolean(recipientJid || directChatJid || keyRemote);
    if (!hasRealRecipient) return null;
  }


  return {
    remoteJid: normalizeRemoteJid(remoteJid, isGroup ? digits(groupJid) : fromPhone, isGroup),
    fromPhone,
    text,
    msgType: type,
    mediaUrl,
    contactName: isGroup
      ? pickStr(entry, "groupSubject", "groupName")
      : pickStr(entry, "pushName", "contactName", "senderName", "name", "notifyName", "notify"),
    fromMe,
    isGroup,
    providerMessageId: messageIdFrom(entry),
    status: normalizeMessageStatus(pickStr(entry, "status", "ack", "messageStatus"), fromMe),
    waTimestamp: parseWaTimestamp(entry),
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

async function updateMessageStatuses(userId: string, payload: Record<string, unknown>): Promise<number> {
  const entries = collectMessageEntries(payload);
  let updated = 0;
  for (const entry of entries) {
    const providerMessageId = messageIdFrom(entry);
    const rawStatus = pickStr(entry, "status", "ack", "messageStatus", "deliveryStatus");
    if (!providerMessageId || !rawStatus) continue;
    const status = normalizeMessageStatus(rawStatus, true);
    const { error } = await supabaseAdmin
      .from("wa_messages")
      .update({ status })
      .eq("user_id", userId)
      .eq("provider_message_id", providerMessageId);
    if (error) console.error("[wa-webhook] status update failed:", error.message);
    else updated++;
  }
  return updated;
}

export async function handleWaWebhook(request: Request): Promise<Response> {
  const secret = process.env.WA_BRIDGE_WEBHOOK_SECRET;
  const raw = await request.text();
  const sig =
    request.headers.get("x-bridge-signature") ||
    request.headers.get("x-hub-signature-256") ||
    request.headers.get("x-signature") ||
    request.headers.get("x-webhook-signature");

  // Prefer HMAC signature when the bridge sends it. Bot-Xtra v1.8.x may not
  // send any signature headers, so unsigned deliveries are allowed only after
  // they resolve to a known sessionId below; invalid signatures are still rejected.
  if (!secret) {
    console.error("[wa-webhook] WA_BRIDGE_WEBHOOK_SECRET is not configured; rejecting all deliveries");
    return new Response("Webhook secret not configured", { status: 500 });
  }
  if (sig && !verifySignature(raw, sig, secret)) {
    console.warn("[wa-webhook] Invalid signature, rejecting");
    return new Response("Invalid signature", { status: 401 });
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
  if (!sig) {
    console.info("[wa-webhook] Accepted unsigned Bot-Xtra delivery for known session");
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

  const statusUpdates = await updateMessageStatuses(userId, payload);

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
    const msgType = mediaTypeFromRaw(entry, m.msgType);
    const rawMediaUrl = m.mediaUrl ?? mediaUrlFromRaw(entry, msgType);
    const mediaUrl = await persistWaMedia({ userId, sessionId, entry, msgType, mediaUrl: rawMediaUrl });
    const text = cleanMessageText(m.text, entry, msgType);

    if (m.providerMessageId) {
      const { data: existing } = await supabaseAdmin
        .from("wa_messages")
        .select("id")
        .eq("user_id", userId)
        .eq("provider_message_id", m.providerMessageId)
        .maybeSingle();
      if (existing?.id) {
        await supabaseAdmin.from("wa_messages").update({ status: m.status }).eq("id", existing.id);
        continue;
      }
    }

    const waTimestamp = m.waTimestamp ?? new Date().toISOString();
    const { error: insErr } = await supabaseAdmin.from("wa_messages").insert({
      user_id: userId,
      session_id: sessionId,
      direction: m.fromMe ? "out" : "in",
      remote_jid: m.remoteJid,
      from_phone: m.fromMe ? null : m.fromPhone,
      to_phone: m.fromMe ? m.fromPhone : null,
      msg_type: msgType,
      text_body: text,
      media_url: mediaUrl,
      status: m.status,
      provider_message_id: m.providerMessageId,
      wa_timestamp: waTimestamp,
      raw: {
        ...entry,
        normalizedRemoteJid: m.remoteJid,
        normalizedContactPhone: m.fromPhone,
        normalizedStatus: m.status,
        normalizedWaTimestamp: waTimestamp,
        providerMessageId: m.providerMessageId,
        storedMediaUrl: mediaUrl?.startsWith("wa-media:") ? mediaUrl : null,
      } as never,
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
      contactPhone: m.isGroup ? null : m.fromPhone,
      text: text ?? (msgType !== "text" ? `[${msgType}]` : null),
      direction: m.fromMe ? "out" : "in",
      messageAt: waTimestamp,
    });


    if (text && !m.fromMe) {
      // Try keyword auto-reply FIRST. If it matches, skip AI entirely.
      const matched = await tryKeywordAutoReply({
        userId,
        sessionId,
        remoteJid: m.remoteJid,
        fromPhone: m.fromPhone,
        inboundText: text,
      }).catch((err: unknown) => {
        console.error("[wa-webhook] keyword handler error:", err);
        return false;
      });

      if (!matched) {
        // IMPORTANT: must await — on Cloudflare Workers, detached promises
        // are cancelled the moment the Response is returned, so a fire-and-forget
        // handleAiAutoReply() never actually runs (no wa_ai_logs row, no reply).
        await handleAiAutoReply({
          userId,
          sessionId,
          conversationId,
          remoteJid: m.remoteJid,
          fromPhone: m.fromPhone,
          inboundText: text,
        }).catch((err) => console.error("[wa-webhook] AI handler error:", err));
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, saved, statusUpdates }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
