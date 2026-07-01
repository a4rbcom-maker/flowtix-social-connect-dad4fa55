// Shared inbound webhook handler for the BotXtra/Baileys WhatsApp bridge.
// Mounted at /api/public/wa-webhook (canonical) and /api/public/wa/webhook (alias).
// Designed to be tolerant of different bridge payload shapes.
//
// NOTE: All pure parsing/normalization logic lives in ./wa-webhook-parsers and
// is covered by wa-webhook-contract.test.ts to lock the Bot-Xtra v1.8.x
// payload contract. Do NOT inline parsing here — extend the parsers module
// (and its tests) instead.
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { handleAiAutoReply, upsertConversationFromMessage } from "./wa-ai.server";
import { cleanMessageText, mediaTypeFromRaw, mediaUrlFromRaw } from "./wa-chat-helpers.server";
import { tryKeywordAutoReply } from "./wa-keyword.server";
import { extractSessionReason, updateWaSessionStatus } from "./wa-session-events.server";
import {
  asObj,
  collectMessageEntries,
  digits,
  findSessionId,
  messageIdFrom,
  normalizeMessageStatus,
  parseMessageEntry,
  pickStr,
  SESSION_STATUS_MAP,
  verifySignature,
  isTruthy,
  type ParsedMessage,
} from "./wa-webhook-parsers";


const WA_MEDIA_BUCKET = "wa-media";
const HISTORY_EVENTS = new Set(["history_messages", "messaging-history.set", "messaging_history.set", "history.sync", "history_sync"]);
const HISTORICAL_MESSAGE_AGE_MS = 10 * 60 * 1000;

function isTruthyFlag(value: unknown): boolean {
  return value === true || ["true", "1", "yes", "history", "historical"].includes(String(value ?? "").toLowerCase());
}

function isHistoricalMessage(event: string, payload: Record<string, unknown>, data: Record<string, unknown>, waTimestamp: string | null): boolean {
  if (HISTORY_EVENTS.has(event)) return true;
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

// Re-export type for downstream files that imported it from here historically.
export type { ParsedMessage };



async function updateMessageStatuses(userId: string, sessionId: string, payload: Record<string, unknown>): Promise<number> {
  const entries = collectMessageEntries(payload);
  let updated = 0;
  for (const entry of entries) {
    const providerMessageId = messageIdFrom(entry);
    const rawStatus = pickStr(entry, "status", "ack", "messageStatus", "deliveryStatus");
    if (!providerMessageId || !rawStatus) continue;
    const status = normalizeMessageStatus(rawStatus, true);
    const { data: matchedRows, error } = await supabaseAdmin
      .from("wa_messages")
      .update({ status })
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .eq("provider_message_id", providerMessageId)
      .select("id");
    if (error) console.error("[wa-webhook] status update failed:", error.message);
    else if (matchedRows?.length) {
      updated += matchedRows.length;
      continue;
    }

    // Bot-Xtra v1.8.x may acknowledge queued sends with a later webhook shaped as:
    //   { event: "status", data: { messageId, status: "delivered" } }
    // That payload has no text/target/queuedId, so it cannot be parsed as a normal
    // message. Match it to the newest pending outbound row for this session. This
    // is the missing link that makes queued AI sends become confirmed deliveries
    // instead of timing out as "accepted by bridge but not sent".
    if (!["sent", "delivered", "read"].includes(status)) continue;
    const { data: pendingAi, error: pendingErr } = await supabaseAdmin
      .from("wa_messages")
      .select("id, raw, remote_jid, text_body, to_phone, created_at")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .eq("direction", "out")
      .eq("status", "pending")
      .is("provider_message_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pendingErr) {
      console.error("[wa-webhook] pending status match failed:", pendingErr.message);
      continue;
    }
    if (!pendingAi?.id) continue;

    const raw = asObj(pendingAi.raw);
    const nextStatus = status === "read" ? "read" : status === "delivered" ? "delivered" : "sent";
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

  const eventStatus = SESSION_STATUS_MAP[event];
  if (eventStatus) {
    const phoneNumber = digits(data.phoneNumber ?? data.phone ?? payload.phoneNumber ?? payload.phone);
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
    });
    return new Response("ok");
  }

  // Bot-Xtra overloads event="status": it can mean either a WhatsApp session
  // state (open/qr/disconnected) or a message delivery ACK
  // (sent/delivered/read + messageId). Handle message ACKs first so confirmed
  // AI deliveries are attached to the pending outbound message instead of being
  // swallowed as a session status="unknown" update.
  if (isMessageStatusOnlyEvent(event, payload, data)) {
    await updateMessageStatuses(userId, sessionId, payload);
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

    const phoneNumber = digits(data.phoneNumber ?? data.phone ?? payload.phoneNumber);
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
    });
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
    const chats = Array.isArray(data.chats) ? (data.chats as Record<string, unknown>[]) : [];
    let upserted = 0;
    for (const c of chats) {
      const rawJid = pickStr(c, "rawJid", "jid", "id");
      const phone = digits(pickStr(c, "jid") ?? rawJid);
      const remoteJid =
        rawJid && (rawJid.includes("@") ? rawJid : `${rawJid}@s.whatsapp.net`) ||
        (phone ? `${phone}@s.whatsapp.net` : null);
      if (!remoteJid) continue;
      const isGroup = Boolean(c.isGroup) || String(remoteJid).endsWith("@g.us");
      const name = pickStr(c, "name", "subject") ?? null;
      const lastTsRaw = c.lastMessageTimestamp;
      const lastTs =
        typeof lastTsRaw === "number"
          ? new Date(lastTsRaw * 1000).toISOString()
          : typeof lastTsRaw === "string" && lastTsRaw
            ? new Date(Number(lastTsRaw) * 1000).toISOString()
            : undefined;
      const lastText = pickStr(c, "lastMessage") ?? null;
      const cid = await upsertConversationFromMessage({
        userId,
        sessionId,
        remoteJid,
        contactName: name,
        contactPhone: isGroup ? null : phone || null,
        text: lastText,
        direction: "in",
        messageAt: lastTs,
        historical: true,
      });
      if (cid) upserted++;
    }
    return new Response(JSON.stringify({ ok: true, historyChats: upserted }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── HISTORY SYNC: backfilled messages ──
  if (HISTORY_EVENTS.has(event)) {
    const msgs = Array.isArray(data.messages) ? (data.messages as Record<string, unknown>[]) : [];
    let saved = 0;
    let dup = 0;
    for (const h of msgs) {
      const parsed = parseMessageEntry(h);
      const providerMessageId = parsed?.providerMessageId || pickStr(h, "id", "messageId", "message_id", "msgId", "msg_id") || null;
      const phone = parsed?.fromPhone || digits(pickStr(h, "from", "to", "sender", "participant"));
      const rawJid = parsed?.remoteJid || pickStr(h, "rawJid", "remoteJid", "remote_jid", "jid", "chatId") || pickStr(asObj(h.key), "remoteJid") || null;
      const isGroup = Boolean(parsed?.isGroup) || Boolean(h.isGroup) || (rawJid?.endsWith("@g.us") ?? false);
      const remoteJid =
        rawJid ||
        (phone ? `${phone}${isGroup ? "@g.us" : "@s.whatsapp.net"}` : null);
      if (!remoteJid) continue;
      const fromMe = parsed?.fromMe ?? isTruthy(h.fromMe);
      const msgType = mediaTypeFromRaw(h, (parsed?.msgType || pickStr(h, "type", "msgType", "messageType") || "text").toLowerCase());
      const text = cleanMessageText(
        parsed?.text || pickStr(h, "body", "text", "message", "content", "caption") || pickStr(asObj(h.message), "conversation"),
        h,
        msgType,
      );
      const tsRaw = h.timestamp;
      const waTimestamp =
        parsed?.waTimestamp ?? (typeof tsRaw === "number"
          ? new Date(tsRaw * 1000).toISOString()
          : typeof tsRaw === "string" && tsRaw
            ? new Date(Number(tsRaw) * 1000).toISOString()
            : new Date().toISOString());
      const contactName = parsed?.contactName || pickStr(h, "pushName", "senderName", "notifyName", "contactName", "name") || null;
      const senderPhone = parsed?.fromPhone || digits(pickStr(h, "sender", "participant")) || phone;

      if (providerMessageId) {
        const { data: existing } = await supabaseAdmin
          .from("wa_messages")
          .select("id")
          .eq("user_id", userId)
          .eq("session_id", sessionId)
          .eq("provider_message_id", providerMessageId)
          .maybeSingle();
        if (existing?.id) {
          dup++;
          continue;
        }
      }

      const { error: insErr, data: insData } = await supabaseAdmin
        .from("wa_messages")
        .upsert(
          {
            user_id: userId,
            session_id: sessionId,
            direction: fromMe ? "out" : "in",
            remote_jid: remoteJid,
            from_phone: fromMe ? null : (isGroup ? senderPhone || null : phone || null),
            to_phone: fromMe ? (phone || null) : null,
            msg_type: msgType,
            text_body: text,
            media_url: null,
            status: fromMe ? "sent" : "received",
            provider_message_id: providerMessageId,
            wa_timestamp: waTimestamp,
            raw: {
              ...h,
              is_historical: true,
              normalizedRemoteJid: remoteJid,
              normalizedWaTimestamp: waTimestamp,
            } as never,
          },
          {
            onConflict: "user_id,session_id,provider_message_id",
            ignoreDuplicates: true,
          },
        )
        .select("id");
      if (insErr) {
        console.error("[wa-webhook] history_messages insert failed:", insErr.message);
        continue;
      }
      if (!insData || insData.length === 0) {
        dup++;
        continue;
      }

      saved++;

      await upsertConversationFromMessage({
        userId,
        sessionId,
        remoteJid,
        contactName,
        contactPhone: isGroup ? null : phone || null,
        text: text ?? (msgType !== "text" ? `[${msgType}]` : null),
        direction: fromMe ? "out" : "in",
        messageAt: waTimestamp,
        historical: true,
      });
    }
    return new Response(JSON.stringify({ ok: true, historyMessages: saved, duplicates: dup }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }



  const statusUpdates = await updateMessageStatuses(userId, sessionId, payload);

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
    const rawMediaUrl = m.mediaUrl ?? mediaUrlFromRaw(entry, msgType);
    const mediaUrl = await persistWaMedia({ userId, sessionId, entry, msgType, mediaUrl: rawMediaUrl });
    const text = cleanMessageText(m.text, entry, msgType);

    if (m.providerMessageId) {
      const { data: existing } = await supabaseAdmin
        .from("wa_messages")
        .select("id")
        .eq("user_id", userId)
        .eq("session_id", sessionId)
        .eq("provider_message_id", m.providerMessageId)
        .maybeSingle();
      if (existing?.id) {
        await supabaseAdmin.from("wa_messages").update({ status: m.status }).eq("id", existing.id);
        continue;
      }
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
        .eq("status", "pending")
        .eq("text_body", text)
        .is("provider_message_id", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pendingAi?.id) {
        await supabaseAdmin
          .from("wa_messages")
          .update({
            status: m.status === "received" ? "sent" : m.status,
            provider_message_id: m.providerMessageId,
            wa_timestamp: waTimestamp,
            raw: {
              ...(asObj(pendingAi.raw) as Record<string, unknown>),
              ...entry,
              ai: asObj(pendingAi.raw).ai === true,
              providerMessageId: m.providerMessageId,
              bridgeAckRemoteJid: m.remoteJid,
              normalizedRemoteJid: m.remoteJid,
              normalizedContactPhone: m.fromPhone,
              normalizedStatus: m.status,
              normalizedWaTimestamp: waTimestamp,
              delivery: "whatsapp_acknowledged",
              ...(isHistorical ? { is_historical: true } : {}),
              storedMediaUrl: mediaUrl?.startsWith("wa-media:") ? mediaUrl : null,
            } as never,
          })
          .eq("id", pendingAi.id);
        saved++;

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
    });


    if (text && !m.fromMe && !isHistorical) {
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
        const aiTask = handleAiAutoReply({
          userId,
          sessionId,
          conversationId,
          remoteJid: m.remoteJid,
          fromPhone: m.fromPhone,
          inboundText: text,
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
    });
  }

  return new Response(JSON.stringify({ ok: true, saved, skipped, statusUpdates }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
