// Shared inbound webhook handler for the BotXtra/Baileys WhatsApp bridge.
// Mounted at /api/public/wa-webhook (canonical) and /api/public/wa/webhook (alias).
// Designed to be tolerant of different bridge payload shapes.
//
// NOTE: All pure parsing/normalization logic lives in ./wa-webhook-parsers and
// is covered by wa-webhook-contract.test.ts to lock the Bot-Xtra v1.8.x
// payload contract. Do NOT inline parsing here — extend the parsers module
// (and its tests) instead.
import { createHmac, randomUUID } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { handleAiAutoReply, upsertConversationFromMessage } from "./wa-ai.server";
import { cleanMessageText, mediaTypeFromRaw, mediaUrlFromRaw } from "./wa-chat-helpers.server";
import { inferStatus, waBridge } from "./wa-bridge.server";
import { tryKeywordAutoReply } from "./wa-keyword.server";
import { extractSessionReason, logWaSessionEvent, updateWaSessionStatus } from "./wa-session-events.server";
import {
  asObj,
  collectMessageEntries,
  normalizePhoneDigits,
  findSessionId,
  messageIdFrom,
  normalizeMessageStatus,
  parseWaTimestamp,
  parseMessageEntry,
  pickStr,
  SESSION_STATUS_MAP,
  verifySignature,
  isTruthy,
  sessionIdLooksOwnedByTenant,
  tenantIdFromWebhookPayload,
  type ParsedMessage,
} from "./wa-webhook-parsers";


const WA_MEDIA_BUCKET = "wa-media";
const HISTORY_EVENTS = new Set(["history_messages", "messaging-history.set", "messaging_history.set", "history.sync", "history_sync"]);
const CONTACT_EVENTS = new Set([
  "contacts",
  "contacts.set",
  "contacts.update",
  "contacts.upsert",
  "chats",
  "chats.set",
  "chats.update",
  "chats.upsert",
]);
const HISTORICAL_MESSAGE_AGE_MS = 10 * 60 * 1000;
const REALTIME_CATCHUP_THROTTLE_MS = 90 * 1000;
const REALTIME_CATCHUP_LOOKBACK_MS = 2 * 60 * 60 * 1000;
const REALTIME_CATCHUP_MAX_CHATS = 12;
const REALTIME_CATCHUP_PAGE_SIZE = 35;
const realtimeCatchupMemory = new Map<string, number>();
// For bulk campaigns, a bridge/API "sent" ACK is not enough to tell the user
// the campaign succeeded: it only means WhatsApp accepted the outbound message.
// Count success only when WhatsApp confirms delivery/read. Otherwise the worker
// will leave the recipient in processing and fail it after the stale timeout.
const BULK_DELIVERY_SUCCESS_STATUSES = new Set(["delivered", "read"]);

function isBulkDeliverySuccess(status: string): boolean {
  return BULK_DELIVERY_SUCCESS_STATUSES.has(status);
}

async function bumpHistorySyncJob(userId: string, sessionId: string, delta: { messages?: number; conversations?: number }) {
  const messages = Math.max(0, delta.messages ?? 0);
  const conversations = Math.max(0, delta.conversations ?? 0);
  if (messages === 0 && conversations === 0) return;
  try {
    const { data } = await supabaseAdmin
      .from("wa_history_sync_jobs")
      .select("imported_msg, imported_conv, status")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return;
    await supabaseAdmin
      .from("wa_history_sync_jobs")
      .update({
        status: data.status === "error" ? "running" : data.status,
        imported_msg: (data.imported_msg ?? 0) + messages,
        imported_conv: (data.imported_conv ?? 0) + conversations,
        message: null,
      })
      .eq("user_id", userId)
      .eq("session_id", sessionId);
  } catch (err) {
    console.warn("[wa-webhook] history job bump failed:", err instanceof Error ? err.message : err);
  }
}

function recordsFromUnknown(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const values = Object.values(rec);
    const records = values.filter(
      (item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)),
    );
    // Baileys sometimes sends maps keyed by jid. Treat object values as rows only
    // when most values are objects; otherwise this is one row, not a collection.
    if (records.length && records.length >= Math.max(1, Math.floor(values.length * 0.6))) return records;
  }
  return [];
}

function collectRecordArraysDeep(root: unknown, keys: string[], maxDepth = 5): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const seenNodes = new Set<unknown>();
  const wanted = new Set(keys);
  const visit = (node: unknown, depth: number) => {
    if (!node || depth > maxDepth || seenNodes.has(node)) return;
    if (typeof node !== "object") return;
    seenNodes.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const rec = node as Record<string, unknown>;
    for (const key of wanted) {
      const rows = recordsFromUnknown(rec[key]);
      if (rows.length) found.push(...rows);
    }
    for (const key of [
      "data",
      "payload",
      "result",
      "response",
      "body",
      "history",
      "sync",
      "messagingHistory",
      "messaging_history",
      "chats",
      "contacts",
      "items",
    ]) {
      if (rec[key] && rec[key] !== node) visit(rec[key], depth + 1);
    }
  };
  visit(root, 0);
  const seen = new Set<string>();
  return found.filter((item) => {
    const id = messageIdFrom(item) || pickStr(item, "jid", "id", "rawJid", "remoteJid", "chatId") || JSON.stringify(item).slice(0, 300);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function pickContactArray(payload: Record<string, unknown>, data: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [data.contacts, payload.contacts, data.items, payload.items, data.chats, payload.chats, payload.data];
  for (const value of candidates) {
    const rows = recordsFromUnknown(value);
    if (rows.length) return rows;
  }
  return collectRecordArraysDeep({ payload, data }, ["contacts", "chats", "items"]);
}

function pickHistoryMessages(payload: Record<string, unknown>, data: Record<string, unknown>): Record<string, unknown>[] {
  const direct = [data.messages, payload.messages, data.items, payload.items, payload.data]
    .flatMap(recordsFromUnknown)
    .filter((item) => Object.keys(item).length > 0);
  // Some Bot-Xtra/Baileys full-history batches arrive as event="chats.set"
  // with messages nested inside each chat row. The old implementation returned
  // `data.items`/`payload.data` early and therefore silently skipped those
  // nested historical messages. Always merge the deep scan as well.
  const deep = collectRecordArraysDeep({ payload, data }, ["messages", "items", "historyMessages", "history_messages"]);
  const seen = new Set<string>();
  return [...direct, ...deep].filter((item) => {
    const id = messageIdFrom(item) || pickStr(item, "jid", "id", "rawJid", "remoteJid", "chatId") || JSON.stringify(item).slice(0, 300);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function bestContactName(contact: Record<string, unknown>): string | null {
  const name = pickStr(contact, "pushName", "notifyName", "verifiedName", "displayName", "shortName", "name", "subject");
  const cleaned = name?.trim();
  if (!cleaned || /^\+?\d{6,}$/.test(cleaned.replace(/\s+/g, ""))) return null;
  return cleaned;
}

function timestampFromContact(contact: Record<string, unknown>): string | undefined {
  return parseWaTimestamp({
    messageTimestamp: contact.lastMessageTimestamp ?? contact.last_msg_timestamp ?? contact.conversationTimestamp ?? contact.lastMsgTimestamp,
    timestamp: contact.timestamp,
    t: contact.t,
  }) ?? undefined;
}

function contactLooksLikeChat(contact: Record<string, unknown>): boolean {
  return Boolean(
    contact.isChat === true ||
      contact.is_chat === true ||
      contact.lastMessage ||
      contact.last_message ||
      contact.lastMessageTimestamp ||
      contact.last_msg_timestamp ||
      contact.conversationTimestamp ||
      contact.lastMsgTimestamp ||
      contact.messages ||
      contact.unreadCount ||
      contact.unread_count,
  );
}

async function importHistoryChats(params: {
  userId: string;
  sessionId: string;
  chats: Record<string, unknown>[];
}): Promise<number> {
  let upserted = 0;
  for (const c of params.chats) {
    const rawJid = pickStr(c, "rawJid", "jid", "id", "remoteJid", "remote_jid", "chatId");
    const phone = normalizePhoneDigits(pickStr(c, "phoneNumber", "phone", "number", "user", "pn") ?? rawJid);
    const remoteJid =
      rawJid && (rawJid.includes("@") ? rawJid : `${rawJid}@s.whatsapp.net`) ||
      (phone ? `${phone}@s.whatsapp.net` : null);
    if (!remoteJid || remoteJid === "status@broadcast" || remoteJid.endsWith("@broadcast")) continue;
    const isGroup = Boolean(c.isGroup) || String(remoteJid).endsWith("@g.us");
    const name = pickStr(c, "name", "subject", "pushName", "notifyName", "verifiedName", "displayName") ?? null;
    const lastTs = timestampFromContact(c);
    const lastText = pickStr(c, "lastMessage", "last_message", "preview", "message", "body", "text") ?? null;
    const cid = await upsertConversationFromMessage({
      userId: params.userId,
      sessionId: params.sessionId,
      remoteJid,
      // Direct-chat names from a history chat catalogue are not always reliable;
      // group subjects are safe, DMs are later enriched by inbound/contact rows.
      contactName: isGroup ? name : null,
      contactPhone: isGroup ? null : phone || null,
      text: lastText,
      direction: "in",
      messageAt: lastTs,
      historical: true,
    });
    if (cid) upserted++;
  }
  return upserted;
}

async function updateConversationContacts(params: {
  userId: string;
  sessionId: string;
  businessPhone: string | null;
  contacts: Record<string, unknown>[];
}): Promise<number> {
  let updated = 0;
  const businessPhone = normalizePhoneDigits(params.businessPhone) || null;
  for (const c of params.contacts.slice(0, 1000)) {
    const rawJid = pickStr(c, "jid", "id", "rawJid", "remoteJid", "chatId");
    const phone = normalizePhoneDigits(pickStr(c, "phoneNumber", "phone", "number", "user", "pn") || rawJid);
    if (!rawJid && !phone) continue;
    if (phone && businessPhone && phone === businessPhone) continue;
    const remoteJid = rawJid?.includes("@") ? rawJid : phone ? `${phone}@s.whatsapp.net` : null;
    if (!remoteJid || remoteJid === "status@broadcast" || remoteJid.endsWith("@broadcast") || remoteJid.endsWith("@g.us")) continue;

    const name = bestContactName(c);
    const { data: rows } = await supabaseAdmin
      .from("wa_conversations")
      .select("id, session_id, contact_name, contact_phone, remote_jid")
      .eq("user_id", params.userId)
      .or(`remote_jid.eq.${remoteJid}${phone ? `,contact_phone.eq.${phone}` : ""}`)
      .limit(5);

    if ((!rows || rows.length === 0) && contactLooksLikeChat(c)) {
      const cid = await upsertConversationFromMessage({
        userId: params.userId,
        sessionId: params.sessionId,
        remoteJid,
        contactName: name,
        contactPhone: phone || null,
        text: pickStr(c, "lastMessage", "last_message", "preview", "message", "body", "text"),
        direction: "in",
        messageAt: timestampFromContact(c),
        historical: true,
      });
      if (cid) updated++;
      continue;
    }

    for (const row of rows ?? []) {
      const currentName = String(row.contact_name ?? "").trim();
      const currentLooksLikePlaceholder =
        !currentName ||
        currentName === row.remote_jid ||
        currentName === row.contact_phone ||
        currentName.replace(/[^0-9]/g, "") === (row.contact_phone || "");
      const patch: { contact_phone?: string; contact_name?: string; session_id?: string } = {};
      if (row.session_id !== params.sessionId) patch.session_id = params.sessionId;
      if (phone && !row.contact_phone) patch.contact_phone = phone;
      if (name && currentLooksLikePlaceholder) patch.contact_name = name;
      if (!Object.keys(patch).length) continue;
      const { error } = await supabaseAdmin.from("wa_conversations").update(patch).eq("id", row.id);
      if (!error) updated++;
      else console.error("[wa-webhook] contact update failed:", error.message);
    }
  }
  return updated;
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || ["true", "1", "yes", "history", "historical"].includes(String(value ?? "").toLowerCase());
}

function jidLocal(jid: string | null | undefined): string {
  return String(jid ?? "").split("@")[0] ?? "";
}

function isLidLocal(local: string | null | undefined): boolean {
  return /^\d{14,}$/.test(String(local ?? ""));
}

function phoneDigitsUnlessLidAlias(value: unknown, remoteJid: string | null | undefined, jidType: unknown): string | null {
  const d = normalizePhoneDigits(value);
  if (!d) return null;
  const local = jidLocal(remoteJid);
  const looksLid = String(remoteJid ?? "").endsWith("@lid") || String(jidType ?? "").toLowerCase() === "lid";
  if (looksLid && (d === local || isLidLocal(d))) return null;
  return d;
}

function isHistoricalMessage(event: string, payload: Record<string, unknown>, data: Record<string, unknown>, waTimestamp: string | null): boolean {
  if (HISTORY_EVENTS.has(event)) return true;
  if (isTruthyFlag(payload.realtimeCatchup) || isTruthyFlag(data.realtimeCatchup)) return false;
  if (
    isTruthyFlag(payload.isHistorical) ||
    isTruthyFlag(payload.is_historical) ||
    isTruthyFlag(payload.history) ||
    isTruthyFlag(data.isHistorical) ||
    isTruthyFlag(data.is_historical) ||
    isTruthyFlag(data.history)
  ) {
    return true;
  }
  const source = String(payload.source ?? data.source ?? "").toLowerCase();
  if (source.includes("history") || source.includes("sync")) return true;

  if (!waTimestamp) return false;
  const ts = new Date(waTimestamp).getTime();
  return Number.isFinite(ts) && Date.now() - ts > HISTORICAL_MESSAGE_AGE_MS;
}

function attachBackgroundTask(request: Request, task: Promise<unknown>, label: string): boolean {
  const waitUntil = (request as Request & { waitUntil?: (promise: Promise<unknown>) => void }).waitUntil;
  const guarded = task.catch((err) => console.error(`[wa-webhook] ${label} background task failed:`, err));
  if (typeof waitUntil === "function") {
    waitUntil.call(request, guarded);
  } else {
    // TanStack/Node Request does not expose Cloudflare waitUntil. Do NOT await
    // AI sending inside the inbound webhook: Bot-Xtra only drains its outbound
    // queue after we answer the inbound webhook. Awaiting here makes the AI
    // message sit forever as { queued: true, queuedId } without reaching WhatsApp.
    void guarded;
  }
  return true;
}

function mediaDataFromEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const nestedMessage = asObj(entry.message);
  const typedMessage = Object.keys(nestedMessage)
    .map((key) => asObj(nestedMessage[key]))
    .find((value) => Object.keys(value).length > 0);
  return [
    asObj(entry.mediaData),
    asObj(entry.media),
    asObj(entry.attachment),
    asObj(entry.image),
    asObj(entry.video),
    asObj(entry.audio),
    asObj(entry.document),
    asObj(entry.sticker),
    typedMessage ?? {},
    entry,
  ].find((value) => Object.keys(value).some((key) => ["dataUrl", "base64", "fileData", "data", "url", "fileUrl", "downloadUrl", "mediaUrl", "directPath"].includes(key))) ?? {};
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
  if (clean === "application/msword") return "doc";
  if (clean === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (clean === "application/vnd.ms-excel") return "xls";
  if (clean === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (clean === "application/vnd.ms-powerpoint") return "ppt";
  if (clean === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  if (clean === "application/zip") return "zip";
  if (clean === "text/plain") return "txt";
  if (clean === "text/csv") return "csv";
  if (msgType === "image") return "jpg";
  if (msgType === "video") return "mp4";
  if (msgType === "audio") return "ogg";
  if (msgType === "sticker") return "webp";
  return "bin";
}

// Normalize raw mime strings coming from the bridge/Baileys before we hand
// them to Supabase Storage. Storage stores this string verbatim and echoes
// it as the `Content-Type` header for every download — a wrong or unusual
// value (e.g. `application/octet-stream`, `audio/ogg; codecs=opus`, or an
// upper-case codec) makes Safari, iOS and some Chromium builds refuse to
// play the file inside a plain <audio> element. Strip codec parameters,
// map known aliases to canonical types, and fall back by msgType so the
// browser always receives a clean, well-known media MIME.
function sanitizeStoredContentType(rawMime: string, msgType: string): string {
  const base = (rawMime || "").split(";")[0]?.trim().toLowerCase() || "";
  if (base === "audio/opus" || base === "audio/x-opus" || base === "audio/ogg") return "audio/ogg";
  if (base === "audio/mp4" || base === "audio/x-m4a" || base === "audio/aac") return "audio/mp4";
  if (base === "audio/mpeg" || base === "audio/mp3") return "audio/mpeg";
  if (base === "audio/webm") return "audio/webm";
  if (base === "audio/wav" || base === "audio/x-wav") return "audio/wav";
  if (
    base.startsWith("image/") ||
    base.startsWith("video/") ||
    base.startsWith("audio/") ||
    base.startsWith("text/") ||
    base === "application/pdf" ||
    base === "application/msword" ||
    base === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    base === "application/vnd.ms-excel" ||
    base === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    base === "application/vnd.ms-powerpoint" ||
    base === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    base === "application/zip"
  ) {
    return base;
  }
  return fallbackMimeType(msgType);
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

  const cleanMime = sanitizeStoredContentType(payload.mimeType, params.msgType);
  const fallbackName = `${Date.now()}_${randomUUID()}.${extensionFromMime(cleanMime, params.msgType)}`;
  const fileName = safeBaseName(pickStr(media, "fileName", "filename", "name"), fallbackName);
  const path = `${params.userId}/${params.sessionId}/${Date.now()}_${fileName}`;
  const { error } = await supabaseAdmin.storage.from(WA_MEDIA_BUCKET).upload(path, payload.bytes, {
    contentType: cleanMime,
    cacheControl: "3600",
    upsert: true,
  });
  if (error) {
    console.error("[wa-webhook] media upload failed:", error.message);
    return params.mediaUrl || null;
  }
  return `wa-media:${path}`;
}

function rawMediaUrlFromEntry(entry: Record<string, unknown>, parsedMediaUrl: string | null): string | null {
  const media = mediaDataFromEntry(entry);
  return parsedMediaUrl || pickStr(media, "dataUrl", "url", "fileUrl", "downloadUrl", "mediaUrl", "directPath") || pickStr(entry, "mediaUrl", "fileUrl", "downloadUrl", "url", "directPath");
}

// Re-export type for downstream files that imported it from here historically.
export type { ParsedMessage };



async function updateMessageStatuses(userId: string, sessionId: string, payload: Record<string, unknown>): Promise<number> {
  const entries = collectMessageEntries(payload);
  let updated = 0;
  for (const entry of entries) {
    const providerMessageId = messageIdFrom(entry);
    const rawStatus = pickStr(entry, "status", "ack", "messageStatus", "deliveryStatus");
    if (!providerMessageId || !rawStatus) continue;
    const status = persistedOutboundStatus(normalizeMessageStatus(rawStatus, true), true);
    const { data: matchedRows, error } = await supabaseAdmin
      .from("wa_messages")
      .update({ status })
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .eq("provider_message_id", providerMessageId)
      .select("id, raw");
    if (error) console.error("[wa-webhook] status update failed:", error.message);
    else if (matchedRows?.length) {
      updated += matchedRows.length;
      const successStatus = isBulkDeliverySuccess(status);
      const failureStatus = status === "failed";
      for (const row of matchedRows) {
        const raw = asObj(row.raw);
        const bulkRecipientId = pickStr(raw, "bulkRecipientId", "bulk_recipient_id");
        const bulkJobId = pickStr(raw, "bulkJobId", "bulk_job_id");
        if ((!successStatus && !failureStatus) || !bulkRecipientId) continue;
        await supabaseAdmin
          .from("bulk_job_recipients")
          .update({
            status: successStatus ? "success" : "failed",
            error_message: successStatus ? null : "فشل تأكيد الإرسال من واتساب",
            sent_at: new Date().toISOString(),
          })
          .eq("id", bulkRecipientId);
        if (bulkJobId) {
          const { data: rows } = await supabaseAdmin
            .from("bulk_job_recipients")
            .select("status")
            .eq("job_id", bulkJobId);
          const sentCount = (rows ?? []).filter((r) => r.status === "success").length;
          const failedCount = (rows ?? []).filter((r) => r.status === "failed").length;
          await supabaseAdmin
            .from("bulk_jobs")
            .update({ sent_count: sentCount, failed_count: failedCount, updated_at: new Date().toISOString() })
            .eq("id", bulkJobId);
          await supabaseAdmin
            .from("send_log")
            .update({
              status: successStatus ? "success" : "failed",
              error_message: successStatus ? null : "فشل تأكيد الإرسال من واتساب",
              metadata: {
                ...raw,
                job_id: bulkJobId,
                bulk_recipient_id: bulkRecipientId,
                provider_message_id: providerMessageId,
                whatsapp_ack_status: status,
                awaiting_whatsapp_ack: false,
              } as never,
            })
            .eq("channel", "bulk")
            .eq("action", "bulk_send")
            .eq("metadata->>bulk_recipient_id", bulkRecipientId);
        }
      }
      continue;
    }

    // Bot-Xtra v1.8.x may acknowledge queued sends with a later webhook shaped as:
    //   { event: "status", data: { messageId, status: "delivered" } }
    // Media sends often start with only raw.queuedId=q_* and no provider id.
    // Match the q_* token first; only then fall back to the newest pending row.
    if (!["sent", "delivered", "read", "failed"].includes(status)) continue;
    const { data: queuedMatch, error: queuedErr } = await supabaseAdmin
      .from("wa_messages")
      .select("id, raw, remote_jid, text_body, to_phone, created_at")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .eq("direction", "out")
      .in("status", ["pending", "sent"])
      .is("provider_message_id", null)
      .or(`raw->>queuedId.eq.${providerMessageId},raw->>queued_id.eq.${providerMessageId},raw->>queueId.eq.${providerMessageId}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (queuedErr) {
      console.error("[wa-webhook] queued status match failed:", queuedErr.message);
    }

    const fallbackAllowed = !queuedMatch?.id;
    const { data: fallbackPending, error: pendingErr } = fallbackAllowed ? await supabaseAdmin
      .from("wa_messages")
      .select("id, raw, remote_jid, text_body, to_phone, created_at")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .eq("direction", "out")
      .eq("status", "pending")
      .is("provider_message_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle() : { data: null, error: null };
    if (pendingErr) {
      console.error("[wa-webhook] pending status match failed:", pendingErr.message);
      continue;
    }
    const pendingAi = queuedMatch?.id ? queuedMatch : fallbackPending;
    if (!pendingAi?.id) continue;

    const raw = asObj(pendingAi.raw);
    const nextStatus = status === "read" ? "read" : status === "delivered" ? "delivered" : status === "failed" ? "failed" : "pending";
    const { error: updErr } = await supabaseAdmin
      .from("wa_messages")
      .update({
        status: nextStatus,
        provider_message_id: providerMessageId,
        raw: {
          ...raw,
          ...entry,
          ai: raw.ai === true,
          providerMessageId,
          normalizedStatus: nextStatus,
          delivery: "whatsapp_status_acknowledged",
        } as never,
      })
      .eq("id", pendingAi.id);
    if (updErr) {
      console.error("[wa-webhook] pending delivery confirmation failed:", updErr.message);
      continue;
    }
    updated++;
    const bulkRecipientId = pickStr(raw, "bulkRecipientId", "bulk_recipient_id");
    const bulkJobId = pickStr(raw, "bulkJobId", "bulk_job_id");
    if (bulkRecipientId && (isBulkDeliverySuccess(nextStatus) || nextStatus === "failed")) {
      await supabaseAdmin
        .from("bulk_job_recipients")
        .update({
          status: isBulkDeliverySuccess(nextStatus) ? "success" : "failed",
          error_message: isBulkDeliverySuccess(nextStatus) ? null : "فشل تأكيد الإرسال من واتساب",
          sent_at: new Date().toISOString(),
        })
        .eq("id", bulkRecipientId);
      if (bulkJobId) {
        const { data: rows } = await supabaseAdmin
          .from("bulk_job_recipients")
          .select("status")
          .eq("job_id", bulkJobId);
        const sentCount = (rows ?? []).filter((r) => r.status === "success").length;
        const failedCount = (rows ?? []).filter((r) => r.status === "failed").length;
        await supabaseAdmin
          .from("bulk_jobs")
          .update({ sent_count: sentCount, failed_count: failedCount, updated_at: new Date().toISOString() })
          .eq("id", bulkJobId);
        await supabaseAdmin
          .from("send_log")
          .update({
            status: isBulkDeliverySuccess(nextStatus) ? "success" : "failed",
            error_message: isBulkDeliverySuccess(nextStatus) ? null : "فشل تأكيد الإرسال من واتساب",
            metadata: {
              ...raw,
              job_id: bulkJobId,
              bulk_recipient_id: bulkRecipientId,
              provider_message_id: providerMessageId,
              whatsapp_ack_status: nextStatus,
              awaiting_whatsapp_ack: false,
            } as never,
          })
          .eq("channel", "bulk")
          .eq("action", "bulk_send")
          .eq("metadata->>bulk_recipient_id", bulkRecipientId);
      }
    }
    await upsertConversationFromMessage({
      userId,
      sessionId,
      remoteJid: pendingAi.remote_jid,
      contactName: null,
      contactPhone: pendingAi.to_phone,
      text: pendingAi.text_body,
      direction: "out",
    });
  }
  return updated;
}

async function markSessionAlive(params: {
  userId: string;
  sessionId: string;
  phoneNumber?: string | null;
  source: "webhook_status" | "history_sync";
  reason: string;
}) {
  await updateWaSessionStatus(supabaseAdmin, {
    userId: params.userId,
    sessionId: params.sessionId,
    nextStatus: "connected",
    source: params.source,
    reason: params.reason,
    rawStatus: "activity",
    phoneNumber: params.phoneNumber ?? null,
  });
}

async function verifyBridgeConnectedForWebhook(sessionId: string): Promise<{
  ok: boolean;
  status: string;
  phoneNumber: string | null;
  reason: string | null;
}> {
  try {
    const live = await waBridge.getStatus(sessionId);
    const status = inferStatus(live);
    const phoneNumber = normalizePhoneDigits(live.phoneNumber ?? live.phone);
    if (status === "connected") return { ok: true, status, phoneNumber, reason: null };
    return {
      ok: false,
      status,
      phoneNumber,
      reason: live.exists === false ? "bridge_session_missing" : `bridge_live_connected_false:${status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: "unknown",
      phoneNumber: null,
      reason: `bridge_status_probe_failed:${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function purgeStaleBridgeSession(sessionId: string, reason: string) {
  try {
    await waBridge.deleteSession(sessionId);
    console.warn("[wa-webhook] Purged stale bridge session", { sessionId, reason });
  } catch (err) {
    console.warn("[wa-webhook] Stale bridge session purge failed", {
      sessionId,
      reason,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function isMessageStatusOnlyEvent(event: string, payload: Record<string, unknown>, data: Record<string, unknown>): boolean {
  if (event !== "status" && event !== "message.status" && event !== "messages.update") return false;
  const providerMessageId = messageIdFrom(data) || messageIdFrom(payload);
  const rawStatus = pickStr(data, "status", "ack", "messageStatus", "deliveryStatus") ||
    pickStr(payload, "status", "ack", "messageStatus", "deliveryStatus");
  if (!providerMessageId || !rawStatus) return false;

  // If the status value is not a session state, it is an outbound message ACK,
  // not a WhatsApp session status. Never let "delivered" turn the session into
  // "unknown" again.
  return !SESSION_STATUS_MAP[String(rawStatus).toLowerCase()];
}

function persistedOutboundStatus(status: string, fromMe: boolean): string {
  if (!fromMe) return status;
  // Once the bridge/WhatsApp accepts the message we surface it as "sent" so
  // the UI reflects the send instantly. Delivered/read upgrades still flow
  // through when the provider reports them.
  if (status === "queued") return "sent";
  return status;
}

async function recentlyRanRealtimeCatchup(userId: string, sessionId: string): Promise<boolean> {
  const now = Date.now();
  const lastInMemory = realtimeCatchupMemory.get(sessionId) ?? 0;
  if (now - lastInMemory < REALTIME_CATCHUP_THROTTLE_MS) return true;

  const since = new Date(now - REALTIME_CATCHUP_THROTTLE_MS).toISOString();
  const { data } = await supabaseAdmin
    .from("wa_session_events")
    .select("id")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .eq("source", "history_sync")
    .eq("reason", "recent_message_catchup_started")
    .gte("created_at", since)
    .limit(1);
  if (data?.length) return true;

  realtimeCatchupMemory.set(sessionId, now);
  await logWaSessionEvent(supabaseAdmin, {
    userId,
    sessionId,
    fromStatus: "connected",
    toStatus: "connected",
    source: "history_sync",
    reason: "recent_message_catchup_started",
    rawStatus: "connected",
  });
  return false;
}

function sameConversationJid(a: string, b: string): boolean {
  if (a === b) return true;
  const [aLocal, aDomain] = a.split("@");
  const [bLocal, bDomain] = b.split("@");
  if (!aLocal || !bLocal || aLocal !== bLocal) return false;
  return (aDomain === "lid" && bDomain === "s.whatsapp.net") || (aDomain === "s.whatsapp.net" && bDomain === "lid");
}

async function replayRealtimeCatchupMessages(params: {
  sessionId: string;
  messages: Record<string, unknown>[];
}): Promise<{ saved: number; skipped: number; error: string | null }> {
  const secret = process.env.WA_BRIDGE_WEBHOOK_SECRET;
  if (!secret) return { saved: 0, skipped: params.messages.length, error: "missing_webhook_secret" };
  if (params.messages.length === 0) return { saved: 0, skipped: 0, error: null };

  const raw = JSON.stringify({
    event: "message",
    sessionId: params.sessionId,
    realtimeCatchup: true,
    data: { messages: params.messages, realtimeCatchup: true },
  });
  const sig = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const res = await handleWaWebhook(new Request("http://internal.local/api/public/wa-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bridge-signature": `sha256=${sig}`,
    },
    body: raw,
  }));
  const text = await res.text();
  if (!res.ok) return { saved: 0, skipped: params.messages.length, error: text || `http_${res.status}` };
  try {
    const body = text ? JSON.parse(text) as { saved?: unknown; skipped?: unknown } : {};
    return {
      saved: Number(body.saved ?? 0) || 0,
      skipped: Number(body.skipped ?? 0) || 0,
      error: null,
    };
  } catch {
    return { saved: 0, skipped: 0, error: null };
  }
}

async function catchUpRecentMessagesFromBridge(params: {
  userId: string;
  sessionId: string;
  phoneNumber?: string | null;
}): Promise<void> {
  if (await recentlyRanRealtimeCatchup(params.userId, params.sessionId)) return;

  let requested = 0;
  let replayed = 0;
  let saved = 0;
  let discoveredChats = 0;
  let lastError: string | null = null;
  const fallbackSince = Date.now() - REALTIME_CATCHUP_LOOKBACK_MS;

  try {
    const chatCatalogue = await waBridge.fetchChats(params.sessionId);
    if (chatCatalogue.body) {
      const payload = { event: "chats", sessionId: params.sessionId, data: chatCatalogue.body } as Record<string, unknown>;
      const data = asObj(chatCatalogue.body);
      const contacts = pickContactArray(payload, data);
      discoveredChats += await importHistoryChats({ userId: params.userId, sessionId: params.sessionId, chats: contacts });
      await updateConversationContacts({
        userId: params.userId,
        sessionId: params.sessionId,
        businessPhone: normalizePhoneDigits(params.phoneNumber),
        contacts,
      });
      const imported = await importHistoryMessages({ userId: params.userId, sessionId: params.sessionId, payload, data });
      saved += imported.saved;
      replayed += imported.total;
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.warn("[wa-webhook] recent catch-up chat catalogue failed:", lastError);
  }

  const { data: conversations, error } = await supabaseAdmin
    .from("wa_conversations")
    .select("remote_jid,last_message_at,updated_at")
    .eq("user_id", params.userId)
    .not("remote_jid", "is", null)
    .order("last_message_at", { ascending: false })
    .limit(REALTIME_CATCHUP_MAX_CHATS);
  if (error) {
    console.warn("[wa-webhook] recent catch-up conversation lookup failed:", error.message);
    return;
  }

  for (const conversation of conversations ?? []) {
    const jid = String(conversation.remote_jid ?? "").trim();
    if (!jid || jid === "status@broadcast" || jid.endsWith("@broadcast")) continue;
    const lastMessageMs = conversation.last_message_at ? Date.parse(String(conversation.last_message_at)) : NaN;
    const sinceMs = Math.max(
      Number.isFinite(lastMessageMs) ? lastMessageMs - 5 * 60 * 1000 : fallbackSince,
      fallbackSince,
    );

    try {
      requested++;
      const body = await waBridge.fetchMessages(params.sessionId, jid, REALTIME_CATCHUP_PAGE_SIZE);
      const candidates: Record<string, unknown>[] = [];
      for (const entry of pickHistoryMessages({ event: "message", data: body } as Record<string, unknown>, asObj(body))) {
        const parsed = parseMessageEntry(entry);
        if (!parsed) continue;
        if (!sameConversationJid(parsed.remoteJid, jid)) continue;
        if (!parsed.waTimestamp) continue;
        const ts = Date.parse(parsed.waTimestamp);
        if (!Number.isFinite(ts) || ts < sinceMs) continue;
        candidates.push(entry);
      }
      if (!candidates.length) continue;
      replayed += candidates.length;
      const replay = await replayRealtimeCatchupMessages({ sessionId: params.sessionId, messages: candidates });
      saved += replay.saved;
      lastError = lastError ?? replay.error;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn("[wa-webhook] recent catch-up failed:", { jid, error: lastError });
    }
  }

  await logWaSessionEvent(supabaseAdmin, {
    userId: params.userId,
    sessionId: params.sessionId,
    fromStatus: "connected",
    toStatus: "connected",
    source: "history_sync",
    reason: `recent_message_catchup_done:${saved}_saved:${replayed}_seen:${requested}_chats:${discoveredChats}_discovered${lastError ? `:${lastError.slice(0, 80)}` : ""}`,
    rawStatus: "connected",
  });
}

function scheduleRecentMessageCatchup(request: Request, params: { userId: string; sessionId: string; phoneNumber?: string | null }) {
  attachBackgroundTask(
    request,
    catchUpRecentMessagesFromBridge(params),
    "recent message catch-up",
  );
}

async function importHistoryMessages(params: {
  userId: string;
  sessionId: string;
  payload: Record<string, unknown>;
  data: Record<string, unknown>;
}): Promise<{ saved: number; duplicates: number; total: number }> {
  const msgs = pickHistoryMessages(params.payload, params.data);
  let saved = 0;
  let dup = 0;
  for (const h of msgs) {
    const parsed = parseMessageEntry(h);
    const rawJid = parsed?.remoteJid || pickStr(h, "rawJid", "remoteJid", "remote_jid", "jid", "chatId") || pickStr(asObj(h.key), "remoteJid") || null;
    const providerMessageId = parsed?.providerMessageId || pickStr(h, "id", "messageId", "message_id", "msgId", "msg_id") || null;
    const phone =
      parsed?.fromPhone ||
      phoneDigitsUnlessLidAlias(pickStr(h, "senderPn", "participantPn", "phoneNumber", "phone"), rawJid, h.jidType) ||
      phoneDigitsUnlessLidAlias(pickStr(h, "from", "to", "sender", "participant"), rawJid, h.jidType);
    const isGroup = Boolean(parsed?.isGroup) || Boolean(h.isGroup) || (rawJid?.endsWith("@g.us") ?? false);
    const remoteJid =
      rawJid ||
      (phone ? `${phone}${isGroup ? "@g.us" : "@s.whatsapp.net"}` : null);
    if (!remoteJid) continue;
    const fromMe = parsed?.fromMe ?? isTruthy(h.fromMe);
    const msgType = mediaTypeFromRaw(h, (parsed?.msgType || pickStr(h, "type", "msgType", "messageType") || "text").toLowerCase());
    const mediaUrl = await persistWaMedia({
      userId: params.userId,
      sessionId: params.sessionId,
      entry: h,
      msgType,
      mediaUrl: rawMediaUrlFromEntry(h, parsed?.mediaUrl ?? null),
    });
    const text = cleanMessageText(
      parsed?.text || pickStr(h, "body", "text", "message", "content", "caption") || pickStr(asObj(h.message), "conversation"),
      h,
      msgType,
    );
    if (msgType === "text" && !text) {
      continue;
    }
    const tsRaw = h.timestamp;
    const waTimestamp =
      parsed?.waTimestamp ?? (typeof tsRaw === "number"
        ? new Date(tsRaw * 1000).toISOString()
        : typeof tsRaw === "string" && tsRaw
          ? new Date(Number(tsRaw) * 1000).toISOString()
          : new Date().toISOString());
    const contactName = fromMe
      ? parsed?.contactName || null
      : parsed?.contactName || pickStr(h, "pushName", "senderName", "notifyName", "contactName", "name") || null;
    const senderPhone = parsed?.fromPhone || normalizePhoneDigits(pickStr(h, "sender", "participant")) || phone;

    if (providerMessageId) {
      const { data: existing } = await supabaseAdmin
        .from("wa_messages")
        .select("id, media_url, text_body, raw")
        .eq("user_id", params.userId)
        .eq("provider_message_id", providerMessageId)
        .maybeSingle();
      if (existing?.id) {
        if (mediaUrl && !existing.media_url) {
          await supabaseAdmin
            .from("wa_messages")
            .update({
              media_url: mediaUrl,
              text_body: existing.text_body || text,
              raw: {
                ...asObj(existing.raw),
                ...h,
                is_historical: true,
                normalizedRemoteJid: remoteJid,
                normalizedWaTimestamp: waTimestamp,
                storedMediaUrl: mediaUrl.startsWith("wa-media:") ? mediaUrl : null,
              } as never,
            })
            .eq("id", existing.id);
        }
        dup++;
        continue;
      }
    }

    const { error: insErr, data: insData } = await supabaseAdmin
      .from("wa_messages")
      .insert({
        user_id: params.userId,
        session_id: params.sessionId,
        direction: fromMe ? "out" : "in",
        remote_jid: remoteJid,
        from_phone: fromMe ? null : (isGroup ? senderPhone || null : phone || null),
        to_phone: fromMe ? (phone || null) : null,
        msg_type: msgType,
        text_body: text,
        media_url: mediaUrl,
        status: fromMe ? "sent" : "received",
        provider_message_id: providerMessageId,
        wa_timestamp: waTimestamp,
        raw: {
          ...h,
          is_historical: true,
          normalizedRemoteJid: remoteJid,
          normalizedWaTimestamp: waTimestamp,
        } as never,
      })
      .select("id");
    if (insErr) {
      if ((insErr as { code?: string }).code === "23505") {
        dup++;
        continue;
      }
      console.error("[wa-webhook] history_messages insert failed:", insErr.message);
      continue;
    }
    if (!insData || insData.length === 0) {
      dup++;
      continue;
    }

    saved++;

    await upsertConversationFromMessage({
      userId: params.userId,
      sessionId: params.sessionId,
      remoteJid,
      contactName,
      contactPhone: isGroup ? null : phone || null,
      text: text ?? (msgType !== "text" ? `[${msgType}]` : null),
      direction: fromMe ? "out" : "in",
      messageAt: waTimestamp,
      historical: true,
    });
  }

  return { saved, duplicates: dup, total: msgs.length };
}

// Idempotency: dedupe repeated webhook deliveries. The bridge may retry the
// same event (e.g. after a 5xx or network timeout); processing it twice can
// re-toggle session status or duplicate messages. We accept the first delivery
// and answer 200 for the rest without side effects.
async function isDuplicateWebhookDelivery(params: {
  sessionId: string;
  event: string;
  payload: Record<string, unknown>;
  data: Record<string, unknown>;
  rawBody: string;
}): Promise<boolean> {
  const { sessionId, event, payload, data, rawBody } = params;
  const providerId =
    messageIdFrom(data) ||
    messageIdFrom(payload) ||
    pickStr(data, "eventId", "event_id", "id", "deliveryId", "delivery_id") ||
    pickStr(payload, "eventId", "event_id", "id", "deliveryId", "delivery_id");
  const tsRaw =
    pickStr(data, "timestamp", "ts", "t") ||
    pickStr(payload, "timestamp", "ts", "t") ||
    "";
  let eventKey: string;
  if (providerId) {
    eventKey = `${sessionId}:${event}:${providerId}`;
  } else {
    // Fall back to a content hash so identical retried payloads still dedupe.
    let hash = 0;
    for (let i = 0; i < rawBody.length; i++) hash = (hash * 31 + rawBody.charCodeAt(i)) | 0;
    eventKey = `${sessionId}:${event}:${tsRaw}:h${hash.toString(36)}`;
  }
  if (eventKey.length > 240) eventKey = eventKey.slice(0, 240);

  const { error } = await supabaseAdmin
    .from("wa_webhook_events")
    .insert({ event_key: eventKey, session_id: sessionId, event });
  if (!error) return false;
  const code = (error as { code?: string }).code;
  if (code === "23505") {
    // If an older deployment recorded the webhook key but failed to persist the
    // message (e.g. empty text body rows), do not let idempotency blackhole a
    // later replay from /fetch-messages. Treat it as retryable until the message
    // row actually exists.
    if (providerId && (event === "message" || HISTORY_EVENTS.has(event))) {
      const { data: existing } = await supabaseAdmin
        .from("wa_messages")
        .select("id")
        .eq("provider_message_id", providerId)
        .limit(1)
        .maybeSingle();
      if (!existing?.id) {
        console.warn("[wa-webhook] Reprocessing previously deduped message with no saved row", { sessionId, event, providerId });
        return false;
      }
    }
    return true; // primary-key conflict → duplicate
  }
  // Best-effort table: if insert fails for another reason, do not block delivery.
  console.warn("[wa-webhook] dedup insert failed, proceeding:", error.message);
  return false;
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
  const signatureVerified = Boolean(sig && verifySignature(raw, sig, secret));
  if (sig && !signatureVerified) {
    console.warn("[wa-webhook] Invalid signature, rejecting");
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  let sessionId = findSessionId(payload, request.headers);
  if (!sessionId) {
    console.warn("[wa-webhook] Missing sessionId in payload keys:", Object.keys(payload));
    return new Response("Missing sessionId", { status: 400 });
  }

  let { data: sess, error: sessErr } = await supabaseAdmin
    .from("wa_sessions")
    .select("user_id, phone_number, session_id")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (sessErr) {
    console.error("[wa-webhook] session lookup error:", sessErr.message);
    return new Response("DB error", { status: 500 });
  }
  if (!sess?.user_id) {
    const tenantId = tenantIdFromWebhookPayload(payload);
    const canTrustTenantFallback = Boolean(
      tenantId && (signatureVerified || sessionIdLooksOwnedByTenant(sessionId, tenantId)),
    );
    const incomingEvent = String(payload.event || payload.type || "").toLowerCase();
    const canRemapStaleSessionEvent =
      HISTORY_EVENTS.has(incomingEvent) ||
      CONTACT_EVENTS.has(incomingEvent) ||
      incomingEvent === "history_chats" ||
      incomingEvent === "qr" ||
      incomingEvent === "qr.update" ||
      incomingEvent === "status" ||
      incomingEvent === "connection.update" ||
      incomingEvent === "session.status" ||
      incomingEvent === "message" ||
      incomingEvent === "messages.upsert" ||
      incomingEvent === "message.upsert";
    if (tenantId && canTrustTenantFallback) {
      const { data: fallbackSess, error: fallbackErr } = await supabaseAdmin
        .from("wa_sessions")
        .select("user_id, phone_number, session_id")
        .eq("user_id", tenantId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (fallbackErr) {
        console.error("[wa-webhook] tenant session fallback lookup error:", fallbackErr.message);
        return new Response("DB error", { status: 500 });
      }
      if (fallbackSess?.user_id && fallbackSess.session_id && canRemapStaleSessionEvent) {
        console.warn("[wa-webhook] Remapped stale bridge sessionId to active tenant session", {
          incomingSessionId: sessionId,
          activeSessionId: fallbackSess.session_id,
          tenantId,
        });
        sess = fallbackSess;
        sessionId = fallbackSess.session_id;
      } else if (!fallbackSess?.session_id && sessionIdLooksOwnedByTenant(sessionId, tenantId)) {
        // Race-proof first QR/connect events: the bridge can emit a webhook
        // immediately after session creation, before the client/reset endpoint
        // has finished writing wa_sessions. Create the row instead of dropping
        // the event as "Unknown sessionId"; the normal status handler below will
        // update it to QR/connected and keep subsequent messages flowing.
        const initialStatus = incomingEvent === "qr" || incomingEvent === "qr.update" ? "qr" : "connecting";
        const { error: createErr } = await supabaseAdmin
          .from("wa_sessions")
          .insert({ user_id: tenantId, session_id: sessionId, status: initialStatus });
        if (createErr && (createErr as { code?: string }).code !== "23505") {
          console.error("[wa-webhook] tenant session race-create failed:", createErr.message);
          return new Response("DB error", { status: 500 });
        }
        sess = { user_id: tenantId, phone_number: null, session_id: sessionId };
      } else if (!fallbackSess?.session_id || fallbackSess.session_id !== sessionId) {
        // Stale QR/status-only bridge sessions keep emitting events every few
        // seconds. They are not useful to the app (no DB row points to them) and
        // can starve real message delivery on the bridge, so purge them as soon
        // as a trusted tenant-owned orphan event arrives.
        await purgeStaleBridgeSession(sessionId, `orphan_${incomingEvent || "event"}`);
      }
    } else if (tenantId && canTrustTenantFallback) {
      console.info("[wa-webhook] Ignored stale tenant session event without remap", {
        incomingSessionId: sessionId,
        tenantId,
        event: incomingEvent,
      });
    }
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

  if (
    await isDuplicateWebhookDelivery({ sessionId, event, payload, data, rawBody: raw })
  ) {
    return new Response(JSON.stringify({ ok: true, deduped: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }


  if (CONTACT_EVENTS.has(event)) {
    const contacts = pickContactArray(payload, data);
    const chatUpserted = event.includes("chat")
      ? await importHistoryChats({ userId, sessionId, chats: contacts })
      : 0;
    const updated = await updateConversationContacts({
      userId,
      sessionId,
      businessPhone: normalizePhoneDigits(sess.phone_number),
      contacts,
    });
    // Some bridge builds deliver the full-history batch as chats.set with
    // messages nested under each chat. Do not return after contact sync only;
    // import the nested historical messages in the same webhook.
    const history = event.includes("chat")
      ? await importHistoryMessages({ userId, sessionId, payload, data })
      : { saved: 0, duplicates: 0, total: 0 };
    await markSessionAlive({ userId, sessionId, phoneNumber: sess.phone_number, source: "webhook_status", reason: "webhook_contacts_activity" });
    return new Response(JSON.stringify({ ok: true, contacts: contacts.length, updated, chats: chatUpserted, historyMessages: history.saved, historyDuplicates: history.duplicates }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Timestamp used for late-event rejection in updateWaSessionStatus.
  const eventAt =
    pickStr(data, "timestamp", "ts", "t") ||
    pickStr(payload, "timestamp", "ts", "t") ||
    null;

  const eventStatus = SESSION_STATUS_MAP[event];
  if (eventStatus) {
    const phoneNumber = normalizePhoneDigits(data.phoneNumber ?? data.phone ?? payload.phoneNumber ?? payload.phone);
    if (eventStatus === "connected") {
      const live = await verifyBridgeConnectedForWebhook(sessionId);
      if (!live.ok) {
        await updateWaSessionStatus(supabaseAdmin, {
          userId,
          sessionId,
          nextStatus: live.status === "qr" ? "qr" : live.status === "connecting" ? "connecting" : "disconnected",
          source: "poll_error",
          reason: live.reason,
          rawStatus: live.status,
          bridgeEvent: event,
          phoneNumber: live.phoneNumber ?? phoneNumber,
          payload,
          logEvenIfUnchanged: true,
        });
        return new Response("ok");
      }
    }
    await updateWaSessionStatus(supabaseAdmin, {
      userId,
      sessionId,
      nextStatus: eventStatus,
      source: "webhook_status",
      reason: extractSessionReason(payload, data),
      rawStatus: event,
      bridgeEvent: event,
      phoneNumber,
      payload,
      eventAt,
    });
    if (eventStatus === "connected") {
      scheduleRecentMessageCatchup(request, { userId, sessionId, phoneNumber });
    }
    return new Response("ok");
  }

  // Bot-Xtra overloads event="status": it can mean either a WhatsApp session
  // state (open/qr/disconnected) or a message delivery ACK
  // (sent/delivered/read + messageId). Handle message ACKs first so confirmed
  // AI deliveries are attached to the pending outbound message instead of being
  // swallowed as a session status="unknown" update.
  if (isMessageStatusOnlyEvent(event, payload, data)) {
    const updated = await updateMessageStatuses(userId, sessionId, payload);
    if (updated > 0) {
      await markSessionAlive({ userId, sessionId, phoneNumber: sess.phone_number, source: "webhook_status", reason: "message_status_ack_activity" });
    }
    return new Response("ok");
  }

  // ── status update ──
  if (event === "status" || event === "connection.update" || event === "session.status") {
    const rawStatus = String(data.status ?? data.state ?? payload.status ?? "").toLowerCase();
    if (!SESSION_STATUS_MAP[rawStatus]) {
      const updated = await updateMessageStatuses(userId, sessionId, payload);
      console.info("[wa-webhook] ignored non-session status event", { rawStatus, statusUpdates: updated });
      return new Response("ok");
    }
    const next = SESSION_STATUS_MAP[rawStatus] ?? "unknown";
    const reason = extractSessionReason(payload, data);

    const phoneNumber = normalizePhoneDigits(data.phoneNumber ?? data.phone ?? payload.phoneNumber);
    if (next === "connected") {
      const live = await verifyBridgeConnectedForWebhook(sessionId);
      if (!live.ok) {
        await updateWaSessionStatus(supabaseAdmin, {
          userId,
          sessionId,
          nextStatus: live.status === "qr" ? "qr" : live.status === "connecting" ? "connecting" : "disconnected",
          source: "poll_error",
          reason: live.reason,
          rawStatus: live.status,
          bridgeEvent: event,
          phoneNumber: live.phoneNumber ?? phoneNumber,
          payload,
          logEvenIfUnchanged: true,
        });
        return new Response("ok");
      }
    }
    await updateWaSessionStatus(supabaseAdmin, {
      userId,
      sessionId,
      nextStatus: next,
      source: "webhook_status",
      reason,
      rawStatus,
      bridgeEvent: event,
      phoneNumber,
      payload,
      eventAt,
    });
    if (next === "connected") {
      scheduleRecentMessageCatchup(request, { userId, sessionId, phoneNumber });
    }
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
    await updateWaSessionStatus(supabaseAdmin, {
      userId,
      sessionId,
      nextStatus: "qr",
      source: "webhook_qr",
      reason: extractSessionReason(payload, data),
      rawStatus: "qr",
      bridgeEvent: event,
      qrDataUrl,
      payload,
    });
    return new Response("ok");
  }

  // ── HISTORY SYNC: chats catalogue ──
  if (event === "history_chats") {
    const chats = pickContactArray(payload, data);
    const upserted = await importHistoryChats({ userId, sessionId, chats });
    await bumpHistorySyncJob(userId, sessionId, { conversations: upserted });
    await markSessionAlive({ userId, sessionId, phoneNumber: sess.phone_number, source: "history_sync", reason: "history_chats_activity" });
    return new Response(JSON.stringify({ ok: true, historyChats: upserted }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── HISTORY SYNC: backfilled messages ──
  if (HISTORY_EVENTS.has(event)) {
    const history = await importHistoryMessages({ userId, sessionId, payload, data });
    await bumpHistorySyncJob(userId, sessionId, { messages: history.saved });
    if (history.saved > 0 || history.total > 0) {
      await markSessionAlive({ userId, sessionId, phoneNumber: sess.phone_number, source: "history_sync", reason: "history_messages_activity" });
    }
    return new Response(JSON.stringify({ ok: true, historyMessages: history.saved, duplicates: history.duplicates }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }



  const statusUpdates = await updateMessageStatuses(userId, sessionId, payload);
  if (statusUpdates > 0) {
    await markSessionAlive({ userId, sessionId, phoneNumber: sess.phone_number, source: "webhook_status", reason: "message_status_ack_activity" });
  }

  // ── inbound/outbound messages ──
  const entries = collectMessageEntries(payload);
  if (entries.length === 0) {
    console.warn("[wa-webhook] No message entries found. Event:", event, "keys:", Object.keys(payload));
    return new Response("ok");
  }

  let saved = 0;
  let skipped = 0;
  for (const entry of entries) {
    const m = parseMessageEntry(entry);
    if (!m) {
      skipped++;
      continue;
    }
    const msgType = mediaTypeFromRaw(entry, m.msgType);
    const rawMediaUrl = rawMediaUrlFromEntry(entry, m.mediaUrl ?? mediaUrlFromRaw(entry, msgType));
    const mediaUrl = await persistWaMedia({ userId, sessionId, entry, msgType, mediaUrl: rawMediaUrl });
    const text = cleanMessageText(m.text, entry, msgType);

    if (m.providerMessageId) {
      const { data: existing } = await supabaseAdmin
        .from("wa_messages")
        .select("id, raw, media_url, text_body")
        .eq("user_id", userId)
        .eq("provider_message_id", m.providerMessageId)
        .maybeSingle();
      if (existing?.id) {
        const raw = asObj(existing.raw);
        const bulkRecipientId = pickStr(raw, "bulkRecipientId", "bulk_recipient_id");
        const bulkJobId = pickStr(raw, "bulkJobId", "bulk_job_id");
        const nextStatus = m.status === "received" && m.fromMe ? "pending" : persistedOutboundStatus(m.status, m.fromMe);
        await supabaseAdmin.from("wa_messages").update({
          status: nextStatus,
          ...(mediaUrl && !existing.media_url ? { media_url: mediaUrl } : {}),
          ...(text && !existing.text_body ? { text_body: text } : {}),
          raw: {
            ...raw,
            ...entry,
            normalizedRemoteJid: m.remoteJid,
            normalizedContactPhone: m.fromPhone,
            normalizedStatus: nextStatus,
            normalizedWaTimestamp: m.waTimestamp ?? raw.normalizedWaTimestamp,
            ...(mediaUrl?.startsWith("wa-media:") ? { storedMediaUrl: mediaUrl } : {}),
          } as never,
        }).eq("id", existing.id);
        if (m.fromMe && (isBulkDeliverySuccess(nextStatus) || nextStatus === "failed") && bulkRecipientId) {
          await supabaseAdmin
            .from("bulk_job_recipients")
            .update({
              status: isBulkDeliverySuccess(nextStatus) ? "success" : "failed",
              error_message: isBulkDeliverySuccess(nextStatus) ? null : "فشل تأكيد الإرسال من واتساب",
              sent_at: new Date().toISOString(),
            })
            .eq("id", bulkRecipientId);
          if (bulkJobId) {
            const { data: rows } = await supabaseAdmin
              .from("bulk_job_recipients")
              .select("status")
              .eq("job_id", bulkJobId);
            const sentCount = (rows ?? []).filter((r) => r.status === "success").length;
            const failedCount = (rows ?? []).filter((r) => r.status === "failed").length;
            await supabaseAdmin
              .from("bulk_jobs")
              .update({ sent_count: sentCount, failed_count: failedCount, updated_at: new Date().toISOString() })
              .eq("id", bulkJobId);
            await supabaseAdmin
              .from("send_log")
              .update({
                status: isBulkDeliverySuccess(nextStatus) ? "success" : "failed",
                error_message: isBulkDeliverySuccess(nextStatus) ? null : "فشل تأكيد الإرسال من واتساب",
                metadata: {
                  ...raw,
                  job_id: bulkJobId,
                  bulk_recipient_id: bulkRecipientId,
                  provider_message_id: m.providerMessageId,
                  whatsapp_ack_status: nextStatus,
                  awaiting_whatsapp_ack: false,
                } as never,
              })
              .eq("channel", "bulk")
              .eq("action", "bulk_send")
              .eq("metadata->>bulk_recipient_id", bulkRecipientId);
          }
        }
        continue;
      }
    }

    if (msgType === "text" && !text) {
      skipped++;
      continue;
    }

    const waTimestamp = m.waTimestamp ?? new Date().toISOString();
    const isHistorical = isHistoricalMessage(event, payload, data, waTimestamp);

    if (m.fromMe && m.providerMessageId && text) {
      const { data: pendingAi } = await supabaseAdmin
        .from("wa_messages")
        .select("id, raw, remote_jid")
        .eq("user_id", userId)
        .eq("session_id", sessionId)
        .eq("direction", "out")
        .in("status", ["pending", "sent"])
        .eq("text_body", text)
        .is("provider_message_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pendingAi?.id) {
        const raw = asObj(pendingAi.raw);
        const bulkRecipientId = pickStr(raw, "bulkRecipientId", "bulk_recipient_id");
        const bulkJobId = pickStr(raw, "bulkJobId", "bulk_job_id");
        const nextStatus = m.status === "received" ? "pending" : persistedOutboundStatus(m.status, true);
        await supabaseAdmin
          .from("wa_messages")
          .update({
            status: nextStatus,
            provider_message_id: m.providerMessageId,
            wa_timestamp: waTimestamp,
            raw: {
              ...(raw as Record<string, unknown>),
              ...entry,
              ai: raw.ai === true,
              providerMessageId: m.providerMessageId,
              bridgeAckRemoteJid: m.remoteJid,
              normalizedRemoteJid: m.remoteJid,
              normalizedContactPhone: m.fromPhone,
              normalizedStatus: nextStatus,
              normalizedWaTimestamp: waTimestamp,
              delivery: "whatsapp_acknowledged",
              ...(isHistorical ? { is_historical: true } : {}),
              storedMediaUrl: mediaUrl?.startsWith("wa-media:") ? mediaUrl : null,
            } as never,
          })
          .eq("id", pendingAi.id);
        saved++;

        if (bulkRecipientId && (isBulkDeliverySuccess(nextStatus) || nextStatus === "failed")) {
          await supabaseAdmin
            .from("bulk_job_recipients")
            .update({
              status: isBulkDeliverySuccess(nextStatus) ? "success" : "failed",
              error_message: isBulkDeliverySuccess(nextStatus) ? null : "فشل تأكيد الإرسال من واتساب",
              sent_at: new Date().toISOString(),
            })
            .eq("id", bulkRecipientId);
          if (bulkJobId) {
            const { data: rows } = await supabaseAdmin
              .from("bulk_job_recipients")
              .select("status")
              .eq("job_id", bulkJobId);
            const sentCount = (rows ?? []).filter((r) => r.status === "success").length;
            const failedCount = (rows ?? []).filter((r) => r.status === "failed").length;
            await supabaseAdmin
              .from("bulk_jobs")
              .update({ sent_count: sentCount, failed_count: failedCount, updated_at: new Date().toISOString() })
              .eq("id", bulkJobId);
            await supabaseAdmin
              .from("send_log")
              .update({
                status: isBulkDeliverySuccess(nextStatus) ? "success" : "failed",
                error_message: isBulkDeliverySuccess(nextStatus) ? null : "فشل تأكيد الإرسال من واتساب",
                metadata: {
                  ...raw,
                  job_id: bulkJobId,
                  bulk_recipient_id: bulkRecipientId,
                  provider_message_id: m.providerMessageId,
                  whatsapp_ack_status: nextStatus,
                  awaiting_whatsapp_ack: false,
                } as never,
              })
              .eq("channel", "bulk")
              .eq("action", "bulk_send")
              .eq("metadata->>bulk_recipient_id", bulkRecipientId);
          }
        }

        await upsertConversationFromMessage({
          userId,
          sessionId,
          remoteJid: pendingAi.remote_jid || m.remoteJid,
          contactName: m.contactName,
          contactPhone: m.isGroup ? null : m.fromPhone,
          text: text ?? (msgType !== "text" ? `[${msgType}]` : null),
          direction: "out",
          messageAt: waTimestamp,
          historical: isHistorical,
        });
        continue;
      }
    }

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
        ...(isHistorical ? { is_historical: true } : {}),
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
      historical: isHistorical,
      profilePicUrl:
        pickStr(entry, "profilePicUrl", "avatarUrl", "picture", "photoUrl") ||
        (m.isGroup ? pickStr(entry, "groupProfilePicUrl") : null),
    });



    const hasMedia = Boolean(mediaUrl) && msgType !== "text";
    if ((text || hasMedia) && !m.fromMe && !isHistorical) {
      // Try keyword auto-reply FIRST (text only). If it matches, skip AI entirely.
      const matched = text
        ? await tryKeywordAutoReply({
            userId,
            sessionId,
            remoteJid: m.remoteJid,
            fromPhone: m.fromPhone,
            inboundText: text,
          }).catch((err: unknown) => {
            console.error("[wa-webhook] keyword handler error:", err);
            return false;
          })
        : false;

      if (!matched) {
        const mediaObj = mediaDataFromEntry(entry);
        const mimeType =
          pickStr(mediaObj, "mimeType", "mimetype", "fileMimeType", "contentType") ||
          pickStr(entry, "mimeType", "mimetype", "contentType") ||
          fallbackMimeType(msgType);
        const fileName = pickStr(mediaObj, "fileName", "filename", "name") || null;
        const aiTask = handleAiAutoReply({
          userId,
          sessionId,
          conversationId,
          remoteJid: m.remoteJid,
          fromPhone: m.fromPhone,
          inboundText: text ?? "",
          inboundMedia: hasMedia
            ? { msgType, mediaUrl, mimeType, fileName }
            : null,
        }).catch((err) => console.error("[wa-webhook] AI handler error:", err));
        if (!attachBackgroundTask(request, aiTask, "AI handler")) {
          await aiTask;
        }
      }
    }
  }

  if (saved === 0 && skipped > 0) {
    console.warn("[wa-webhook] Message entries were received but none were saved", {
      event,
      skipped,
      entryKeys: entries.map((entry) => Object.keys(entry).slice(0, 12)),
      diagnostics: entries.slice(0, 3).map((entry) => {
        const rec = entry as Record<string, unknown>;
        const bodyRaw = rec.body ?? rec.text ?? rec.caption ?? rec.content ?? null;
        const bodyStr = typeof bodyRaw === "string" ? bodyRaw : bodyRaw == null ? null : JSON.stringify(bodyRaw).slice(0, 80);
        return {
          type: typeof rec.type === "string" ? rec.type : null,
          hasBody: Boolean(bodyStr && bodyStr.length > 0),
          bodyPreview: bodyStr ? bodyStr.slice(0, 60) : null,
          hasFrom: Boolean(rec.from),
          hasSender: Boolean(rec.sender),
          hasKey: Boolean(rec.key),
          hasMessage: Boolean(rec.message),
          isGroup: Boolean(rec.isGroup),
          fromMe: Boolean(rec.fromMe),
          id: typeof rec.id === "string" ? rec.id.slice(0, 24) : null,
        };
      }),
    });
  }

  if (saved > 0) {
    await markSessionAlive({ userId, sessionId, phoneNumber: sess.phone_number, source: "webhook_status", reason: "message_activity" });
  }

  return new Response(JSON.stringify({ ok: true, saved, skipped, statusUpdates }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
