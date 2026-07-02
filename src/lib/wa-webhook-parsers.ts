// Pure parsers for the Bot-Xtra / Baileys WhatsApp bridge webhook payloads.
// Extracted from wa-webhook.server.ts so they can be unit-tested without
// pulling in Supabase admin / Node crypto / Cloudflare runtime dependencies.
//
// CONTRACT: These functions implement the Bot-Xtra v1.8.x payload contract.
// Do NOT modify them in ways that change accepted payload shapes without
// updating the matching tests in wa-webhook-contract.test.ts.

import { createHmac, timingSafeEqual } from "crypto";

export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
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

export function digits(s: unknown): string | null {
  if (typeof s !== "string" && typeof s !== "number" && typeof s !== "bigint") return null;
  const d = String(s).replace(/[^0-9]/g, "");
  return d || null;
}

export function pickStr(obj: unknown, ...keys: string[]): string | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.length > 0) return v;
    if ((typeof v === "number" || typeof v === "bigint") && String(v).length > 0) return String(v);
  }
  return null;
}

export function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function hasKeys(v: unknown): v is Record<string, unknown> {
  return Boolean(v && typeof v === "object" && Object.keys(v as Record<string, unknown>).length > 0);
}

function looksLikeMessage(v: unknown): v is Record<string, unknown> {
  if (!hasKeys(v)) return false;
  const rec = v as Record<string, unknown>;
  return Boolean(
    rec.messages ||
      rec.message ||
      rec.key ||
      rec.messageId ||
      rec.msgId ||
      rec.id ||
      rec.wamid ||
      rec.from ||
      rec.sender ||
      rec.senderJid ||
      rec.remoteJid ||
      rec.chatId ||
      rec.body ||
      rec.text ||
      rec.content ||
      rec.caption ||
      rec.mediaData,
  );
}

function pickContactRef(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if ((typeof value === "number" || typeof value === "bigint") && String(value).length > 0) return String(value);
  const obj = asObj(value);
  return pickStr(obj, "jid", "id", "remoteJid", "phoneNumber", "phone", "number", "user", "pn");
}

export function normalizeRemoteJid(remoteJid: string | null, phone: string | null, isGroup = false): string {
  const jid = remoteJid || "";
  if (jid.includes("@")) return jid;
  const d = digits(jid) || phone;
  return d ? `${d}@${isGroup ? "g.us" : "s.whatsapp.net"}` : "unknown";
}

export function isTruthy(v: unknown): boolean {
  return v === true || String(v ?? "").toLowerCase() === "true";
}

export function normalizeMessageStatus(value: unknown, fromMe: boolean): string {
  const raw = String(value ?? "").toLowerCase();
  if (["read", "played"].includes(raw)) return "read";
  if (["delivered", "delivery", "server_ack", "device_ack"].includes(raw)) return "delivered";
  if (["sent", "pending", "queued"].includes(raw)) return raw;
  if (["failed", "error", "undelivered"].includes(raw)) return "failed";
  return fromMe ? "sent" : "received";
}

export function messageIdFrom(entry: Record<string, unknown>): string | null {
  return (
    pickStr(entry, "messageId", "message_id", "msgId", "msg_id", "id", "wamid") ||
    pickStr(asObj(entry.key), "id") ||
    pickStr(asObj(entry.message), "id")
  );
}

export function findSessionId(payload: Record<string, unknown>, headers: Headers): string | null {
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

export function parseWaTimestamp(entry: Record<string, unknown>): string | null {
  const timestampNumber = (raw: unknown): number | null => {
    if (typeof raw === "number") return raw;
    if (typeof raw === "string" && raw.trim()) return Number(raw.trim());
    const obj = asObj(raw);
    // Baileys/Long timestamps can arrive as { low, high, unsigned }. Reading
    // only Number(object) returns NaN, which made old history messages look
    // like "now" and broke WhatsApp-style ordering.
    if (typeof obj.low === "number" || typeof obj.low === "string") {
      const low = Number(obj.low);
      const high = Number(obj.high ?? 0);
      if (Number.isFinite(low) && Number.isFinite(high)) return high * 2 ** 32 + (low >>> 0);
    }
    return null;
  };
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
    const num = timestampNumber(raw);
    if (num == null || !Number.isFinite(num) || num <= 0) continue;
    const ms = num < 1_000_000_000_000 ? num * 1000 : num;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

export interface ParsedMessage {
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

export function extractTextFromMessage(m: Record<string, unknown>): { text: string | null; type: string; mediaUrl: string | null } {
  // ── BotXtra flat shape: entry.type + entry.mediaData ──
  const flatType = String(m.type ?? "").toLowerCase();
  const mediaData = asObj(m.mediaData);
  const contentData = asObj(m.content);
  const contentText =
    typeof m.content === "string"
      ? m.content
      : pickStr(contentData, "text", "body", "caption", "message", "content");
  const hasMediaData = Object.keys(mediaData).length > 0;
  const flatMediaUrl =
    pickStr(mediaData, "url", "directPath", "fileUrl", "downloadUrl", "mediaUrl") ||
    pickStr(contentData, "url", "directPath", "fileUrl", "downloadUrl", "mediaUrl") ||
    pickStr(m, "mediaUrl", "fileUrl", "url");
  const flatCaption =
    pickStr(m, "caption", "body", "text", "content") ||
    contentText ||
    pickStr(mediaData, "caption", "fileName");

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
  const direct = pickStr(m, "text", "body", "message", "caption", "content") || contentText;
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

export function parseMessageEntry(entry: Record<string, unknown>): ParsedMessage | null {
  const key = asObj(entry.key);
  const senderObj = asObj(entry.sender);
  const fromObj = asObj(entry.from);
  const participantObj = asObj(entry.participant);
  const recipientObj = asObj(entry.recipient);
  const toObj = asObj(entry.to);
  const fromMe =
    isTruthy(entry.fromMe) ||
    isTruthy(entry.fromme) ||
    isTruthy(key.fromMe);
  const isGroup =
    isTruthy(entry.isGroup) ||
    Boolean(pickStr(entry, "groupJid", "groupId")) ||
    Boolean(pickStr(key, "remoteJid")?.endsWith("@g.us"));

  // Bot-Xtra v1.8.x / Baileys can deliver modern WhatsApp chats with two IDs:
  //   from:     "182239858000081"            ← real chat address (LID)
  //   senderPn: "201273747262@s.whatsapp.net" ← public phone number
  // If we normalize the chat to senderPn, Bot-Xtra may accept outgoing sends as
  // queued but never deliver them. Preserve the LID as remoteJid while keeping
  // senderPn as fromPhone/contact_phone.
  const rawFromRef = pickContactRef(entry.from);
  const rawFromDigits = digits(rawFromRef);
  const jidType = String(entry.jidType ?? entry.jid_type ?? "").toLowerCase();
  const explicitPhone =
    digits(pickStr(entry, "senderPn", "participantPn", "phoneNumber", "phone")) ||
    digits(pickContactRef(senderObj)) ||
    digits(pickContactRef(participantObj)) ||
    digits(pickContactRef(fromObj));
  const rawFromLidJid =
    !isGroup &&
    !fromMe &&
    rawFromDigits &&
    ((explicitPhone && rawFromDigits !== explicitPhone) || jidType === "lid")
      ? `${rawFromDigits}@lid`
      : null;
  const realPhone =
    explicitPhone || (!rawFromLidJid && jidType !== "lid" ? rawFromDigits : null);
  const keyRemote = pickStr(key, "remoteJid");
  const groupJid = pickStr(entry, "groupJid", "groupId") || (keyRemote?.endsWith("@g.us") ? keyRemote : null);
  const directChatJid = pickStr(entry, "rawJid", "remoteJid", "remote_jid", "jid", "chatId");
  const recipientJid =
    pickStr(entry, "recipientJid", "targetJid", "toJid") ||
    pickContactRef(entry.to) ||
    pickContactRef(entry.recipient) ||
    pickContactRef(toObj) ||
    pickContactRef(recipientObj);
  const senderJid =
    pickStr(entry, "senderJid", "participantJid") ||
    pickContactRef(entry.sender) ||
    pickContactRef(entry.from) ||
    pickContactRef(senderObj) ||
    pickContactRef(fromObj);
  const inboundLidJid = [rawFromLidJid, senderJid, directChatJid, keyRemote].find((jid) => jid?.endsWith("@lid")) || null;
  const remoteJid = isGroup
    ? groupJid
    : fromMe
      ? (recipientJid || directChatJid || keyRemote)
      : (inboundLidJid || directChatJid || keyRemote || senderJid || realPhone);

  const digitsUnlessLid = (value: string | null | undefined): string | null => {
    const d = digits(value);
    if (!d) return null;
    if (value?.endsWith("@lid")) return null;
    if (jidType === "lid" && rawFromDigits && d === rawFromDigits) return null;
    return d;
  };

  const fromPhone = isGroup
    ? realPhone || digitsUnlessLid(senderJid)
    : fromMe
      ? digitsUnlessLid(recipientJid || directChatJid || keyRemote || remoteJid) || realPhone
      : realPhone || digitsUnlessLid(senderJid) || digitsUnlessLid(remoteJid);

  const { text, type, mediaUrl } = extractTextFromMessage(entry);
  const outboundRecipientName =
    pickStr(entry, "recipientName", "toName", "targetName", "chatName") ||
    pickStr(recipientObj, "pushName", "name", "shortName", "verifiedName") ||
    pickStr(toObj, "pushName", "name", "shortName", "verifiedName");
  const inboundContactName =
    pickStr(entry, "pushName", "contactName", "senderName", "name", "notifyName", "notify") ||
    pickStr(senderObj, "pushName", "name", "shortName", "verifiedName") ||
    pickStr(fromObj, "pushName", "name", "shortName", "verifiedName");

  const jid = remoteJid || fromPhone || "";
  if (jid.endsWith("@broadcast") || jid === "status@broadcast") return null;
  if (!text && type === "unknown" && !mediaUrl) return null;
  if (!remoteJid && !fromPhone) return null;

  return {
    remoteJid: normalizeRemoteJid(remoteJid, isGroup ? digits(groupJid) : fromPhone, isGroup),
    fromPhone,
    text,
    msgType: type,
    mediaUrl,
    contactName: isGroup
      ? pickStr(entry, "groupSubject", "groupName")
      : fromMe
        ? outboundRecipientName
        : inboundContactName,
    fromMe,
    isGroup,
    providerMessageId: messageIdFrom(entry),
    status: normalizeMessageStatus(pickStr(entry, "status", "ack", "messageStatus"), fromMe),
    waTimestamp: parseWaTimestamp(entry),
  };
}

export function collectMessageEntries(payload: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const push = (v: unknown) => {
    if (Array.isArray(v)) v.forEach((x) => looksLikeMessage(x) && out.push(x));
    else if (looksLikeMessage(v)) out.push(v);
  };
  const data = asObj(payload.data);
  push(payload.messages);
  push(data.messages);
  push(payload.message);
  push(data.message);
  if (!out.length) push(payload);
  if (!out.length) push(data);
  return out;
}

export const SESSION_STATUS_MAP: Record<string, string> = {
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
