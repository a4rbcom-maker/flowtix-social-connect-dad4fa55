// WhatsApp Bridge — TanStack server functions.
// All bridge calls happen here so secrets stay on the server.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./admin-middleware";
import {
  assertBridgeSendQueued,
  bridgeSendQueuedMessage,
  sendTextWithReconnect,
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
import { isHardSessionGoneError, isTrustedUserDisconnect, logWaSessionEvent, updateWaSessionStatus } from "./wa-session-events.server";
import { normalizeWhatsappPhone, phoneFromRaw } from "./wa-chat-helpers.server";
import { resolveOutgoingWhatsappTarget } from "./wa-recipient.server";

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
        syncFullHistory: true,
      });
    } catch (err) {
      if (err instanceof BridgeError && (err.status === 409 || err.status === 400)) {
        // already exists — fine
      } else {
        const now = new Date().toISOString();
        const errMsg = describeBridgeError(err);
        console.warn("[wa] createSession bridge error:", errMsg);
        if (existing?.session_id && (existing.status === "connected" || !isHardSessionGoneError(err))) {
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

export interface WaHistorySyncResult {
  ok: boolean;
  sessionId: string | null;
  requested: boolean;
  pending?: boolean;
  attempts: Array<{ path: string; ok: boolean; status?: number; error?: string; importedMessages?: number; importedChats?: number }>;
  error: string | null;
  before?: { conversations: number; messages: number };
  after?: { conversations: number; messages: number };
  fetchedKnownChats?: number;
}

export interface WaChatSyncResult {
  ok: boolean;
  sessionId: string | null;
  remoteJid: string;
  importedMessages: number;
  importedChats: number;
  attempts: Array<{ jid: string; ok: boolean; status?: number; error?: string }>;
  error: string | null;
}

function onlyDigits(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return null;
  const d = String(value).replace(/[^0-9]/g, "");
  return d.length >= 6 ? d : null;
}

function jidFromPhone(value: unknown): string | null {
  const phone = onlyDigits(value);
  return phone ? `${phone}@s.whatsapp.net` : null;
}

function looksLikeLidLocal(value: unknown): boolean {
  return /^\d{14,}$/.test(String(value ?? "").split("@")[0]?.replace(/[^0-9]/g, "") ?? "");
}

function realPhoneDigits(value: unknown): string | null {
  const phone = normalizeWhatsappPhone(typeof value === "string" ? value : value == null ? null : String(value));
  if (!phone || phone.length < 10 || phone.length > 13) return null;
  return phone;
}

function phoneFromContactRecord(row: Record<string, unknown>): string | null {
  return realPhoneDigits(
    row.senderPn ??
      row.participantPn ??
      row.recipientPn ??
      row.remoteJidAlt ??
      row.jid ??
      row.id ??
      row.remoteJid ??
      row.phoneNumber ??
      row.phone ??
      row.number ??
      row.user ??
      row.pn,
  );
}

function jidFromContactRecord(row: Record<string, unknown>): string | null {
  const raw = row.rawJid ?? row.jid ?? row.id ?? row.remoteJid ?? row.remote_jid ?? row.chatId;
  if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "bigint") return null;
  const text = String(raw).trim();
  if (!text || text === "status@broadcast" || text.endsWith("@broadcast")) return null;
  if (text.includes("@")) return text;
  const d = onlyDigits(text);
  if (!d) return null;
  return looksLikeLidLocal(d) ? `${d}@lid` : `${d}@s.whatsapp.net`;
}

function lidJidsFromEvents(events: Array<{ raw_status?: unknown; reason?: unknown; bridge_event?: unknown }>): string[] {
  const out = new Set<string>();
  for (const event of events) {
    const haystack = [event.raw_status, event.reason, event.bridge_event]
      .filter((value): value is string => typeof value === "string")
      .join("\n");
    for (const match of haystack.matchAll(/\b(\d{14,})@(lid|s\.whatsapp\.net)\b/g)) {
      const local = match[1];
      if (local) out.add(`${local}@lid`);
    }
  }
  return Array.from(out);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickArray(value: unknown, keys: string[]): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (node: unknown, depth = 0) => {
    if (!node || depth > 5) return;
    if (Array.isArray(node)) {
      const records = node.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
      if (records.length) found.push(...records);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    for (const key of keys) {
      const child = rec[key];
      if (Array.isArray(child)) {
        const records = child.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
        if (records.length) found.push(...records);
      }
    }
    for (const key of ["data", "result", "payload", "response", "body"]) {
      if (rec[key] && rec[key] !== node) visit(rec[key], depth + 1);
    }
  };
  visit(value);
  const seen = new Set<string>();
  return found.filter((item) => {
    const fingerprint = JSON.stringify(item).slice(0, 500);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

async function replayBridgeHistoryPayload(sessionId: string, payload: unknown): Promise<{ messages: number; chats: number; error: string | null }> {
  const secret = process.env.WA_BRIDGE_WEBHOOK_SECRET;
  if (!secret) return { messages: 0, chats: 0, error: "missing_webhook_secret" };

  const { handleWaWebhook } = await import("./wa-webhook.server");
  const { createHmac } = await import("crypto");
  const postInternalWebhook = async (body: Record<string, unknown>) => {
    const raw = JSON.stringify(body);
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
    return asRecord(text ? JSON.parse(text) : {});
  };

  let messages = 0;
  let chats = 0;
  const messageRows = pickArray(payload, ["messages", "items"]);
  if (messageRows.length) {
    const body = await postInternalWebhook({ event: "history_messages", sessionId, data: { messages: messageRows } });
    messages += Number(body.historyMessages ?? body.saved ?? 0) || 0;
  }

  const chatRows = pickArray(payload, ["chats", "contacts"]);
  if (chatRows.length) {
    const body = await postInternalWebhook({ event: "history_chats", sessionId, data: { chats: chatRows } });
    chats += Number(body.historyChats ?? body.updated ?? 0) || 0;
  }

  return { messages, chats, error: null };
}

export const requestWaHistorySync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WaHistorySyncResult> => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("wa_sessions")
      .select("session_id, status")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.session_id) return { ok: false, sessionId: null, requested: false, attempts: [], error: "no_session" };

    let liveStatus = row.status as BridgeSessionStatus;
    let livePhone: string | null = null;
    try {
      const live = await waBridge.getStatus(row.session_id);
      liveStatus = inferStatus(live);
      livePhone = typeof live.phoneNumber === "string" ? live.phoneNumber : typeof live.phone === "string" ? live.phone : null;
      if (liveStatus === "connected") {
        await updateWaSessionStatus(supabase, {
          userId,
          sessionId: row.session_id,
          nextStatus: "connected",
          source: "history_sync",
          reason: "bridge_session_confirmed_connected",
          rawStatus: String(live.status ?? live.state ?? "connected"),
          phoneNumber: livePhone,
        });
      } else if (live.exists === false || liveStatus === "disconnected" || liveStatus === "qr" || liveStatus === "connecting") {
        const reason = live.exists === false
          ? "bridge_session_missing"
          : liveStatus === "disconnected"
            ? "bridge_session_not_connected"
            : `bridge_session_${liveStatus}`;
        // History sync is a read-only maintenance action. It must never turn a
        // previously connected WhatsApp session into QR/connecting just because
        // the bridge is doing a transient socket rebuild. Log the observation
        // and stop the sync safely; real logout/QR state is handled only by
        // signed bridge webhooks or explicit user reset/disconnect actions.
        await logWaSessionEvent(supabase, {
          userId,
          sessionId: row.session_id,
          fromStatus: row.status ?? null,
          toStatus: row.status ?? liveStatus,
          source: "history_sync",
          reason: `history_sync_skipped_non_connected_status:${reason}`,
          rawStatus: String(live.status ?? live.state ?? liveStatus),
        });
        return {
          ok: false,
          sessionId: row.session_id,
          requested: false,
          attempts: [{ path: `/api/sessions/${row.session_id}/status`, ok: false, status: live.exists === false ? 404 : undefined, error: reason }],
          error: "session_not_connected",
        };
      }
    } catch (err) {
      return {
        ok: false,
        sessionId: row.session_id,
        requested: false,
        attempts: [{ path: `/api/sessions/${row.session_id}/status`, ok: false, status: err instanceof BridgeError ? err.status : undefined, error: err instanceof Error ? err.message : String(err) }],
        error: "session_status_unavailable",
      };
    }

    if (liveStatus !== "connected") {
      return { ok: false, sessionId: row.session_id, requested: false, attempts: [], error: "session_not_connected" };
    }

    // لا نستخدم count exact أثناء المزامنة نهائيًا؛ أرقام التقدم تأتي من الاستيراد المباشر فقط.
    const before = { conversations: 0, messages: 0 };

    // Persist the sync job so progress survives across browser reloads / device sleep.
    const deadlineMs = Date.now() + 5 * 60_000;
    await supabase
      .from("wa_history_sync_jobs")
      .upsert({
        user_id: userId,
        session_id: row.session_id,
        status: "running",
        baseline_msg: before.messages,
        baseline_conv: before.conversations,
        imported_msg: 0,
        imported_conv: 0,
        message: null,
        started_at: new Date().toISOString(),
        deadline_at: new Date(deadlineMs).toISOString(),
        finished_at: null,
      }, { onConflict: "user_id" });
    const chatCatalogue = await waBridge.fetchChats(row.session_id).catch((err) => ({
      ok: false,
      attempts: [
        {
          path: `/api/sessions/${row.session_id}/fetch-chats`,
          ok: false,
          status: err instanceof BridgeError ? err.status : undefined,
          error: err instanceof Error ? err.message : String(err),
        },
      ],
      body: null as unknown,
    }));
    const result = await waBridge.requestHistorySync(row.session_id);
    result.attempts.push(...chatCatalogue.attempts);
    let directImports = { messages: 0, chats: 0, error: null as string | null };
    if (chatCatalogue.body) {
      const importedChats = await replayBridgeHistoryPayload(row.session_id, chatCatalogue.body).catch((err) => ({
        messages: 0,
        chats: 0,
        error: err instanceof Error ? err.message : String(err),
      }));
      directImports.messages += importedChats.messages;
      directImports.chats += importedChats.chats;
      directImports.error = directImports.error ?? importedChats.error;
      result.attempts.push({
        path: "/api/sessions/:id/chats",
        ok: chatCatalogue.ok,
        importedMessages: importedChats.messages,
        importedChats: importedChats.chats,
      });
    }
    if (result.body) {
      const importedHistory = await replayBridgeHistoryPayload(row.session_id, result.body).catch((err) => ({
        messages: 0,
        chats: 0,
        error: err instanceof Error ? err.message : String(err),
      }));
      directImports.messages += importedHistory.messages;
      directImports.chats += importedHistory.chats;
      directImports.error = directImports.error ?? importedHistory.error;
    }

    const knownJids = new Set<string>();
    const addJid = (value: unknown) => {
      if (typeof value !== "string" || !value.trim() || value === "status@broadcast") return;
      knownJids.add(value.includes("@") ? value.trim() : `${value.replace(/[^0-9]/g, "")}@s.whatsapp.net`);
    };
    const addPhone = (value: unknown) => {
      const jid = jidFromPhone(value);
      if (jid) knownJids.add(jid);
    };

    const [{ data: chats }, { data: contacts }, { data: customers }, { data: recipients }, { data: logs }, { data: oldMessages }, { data: sessionEvents }] = await Promise.all([
      supabase
        .from("wa_conversations")
        .select("remote_jid, contact_phone")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(500),
      supabase.from("contacts").select("phone").eq("user_id", userId).limit(300),
      supabase.from("customer_database").select("phone, phone_norm").eq("user_id", userId).limit(300),
      supabase.from("bulk_job_recipients").select("phone").eq("user_id", userId).limit(300),
      supabase.from("send_log").select("recipient").eq("user_id", userId).eq("channel", "whatsapp").limit(300),
      supabase
        .from("wa_messages")
        .select("remote_jid, provider_message_id, wa_timestamp")
        .eq("user_id", userId)
        .not("provider_message_id", "is", null)
        .order("wa_timestamp", { ascending: true })
        .limit(5000),
      supabase
        .from("wa_session_events")
        .select("raw_status, reason, bridge_event")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(300),
    ]);


    // Track oldest message per JID (both id + timestamp) so we can paginate
    // backwards page-by-page as recommended by Bot-Xtra: each /fetch-messages
    // call returns up to ~50 messages older than the anchor.
    const anchorByJid = new Map<string, string>();
    const anchorTsByJid = new Map<string, number>();
    const addAnchor = (jid: unknown, providerMessageId: unknown, ts?: unknown) => {
      if (typeof jid !== "string" || typeof providerMessageId !== "string" || !jid.trim() || !providerMessageId.trim()) return;
      const cleanJid = jid.trim();
      const tsNum = typeof ts === "number" ? ts : ts ? Number(new Date(ts as string).getTime() / 1000) : NaN;
      if (!anchorByJid.has(cleanJid)) {
        anchorByJid.set(cleanJid, providerMessageId.trim());
        if (Number.isFinite(tsNum)) anchorTsByJid.set(cleanJid, Math.floor(tsNum));
      }
      const local = cleanJid.split("@")[0] ?? "";
      if (/^\d{8,}$/.test(local)) {
        const altSuffix = cleanJid.endsWith("@lid") ? "@s.whatsapp.net" : cleanJid.endsWith("@s.whatsapp.net") ? "@lid" : null;
        if (altSuffix) {
          const altJid = `${local}${altSuffix}`;
          if (!anchorByJid.has(altJid)) {
            anchorByJid.set(altJid, providerMessageId.trim());
            if (Number.isFinite(tsNum)) anchorTsByJid.set(altJid, Math.floor(tsNum));
          }
        }
      }
    };
    for (const msg of oldMessages ?? []) addAnchor(msg.remote_jid, msg.provider_message_id, msg.wa_timestamp);

    for (const chat of chats ?? []) {
      addJid(chat.remote_jid);
      addPhone(chat.contact_phone);
      const anchor = anchorByJid.get(chat.remote_jid);
      if (chat.contact_phone && anchor) addAnchor(jidFromPhone(chat.contact_phone), anchor, anchorTsByJid.get(chat.remote_jid));
    }
    for (const contact of contacts ?? []) addPhone(contact.phone);
    for (const customer of customers ?? []) addPhone(customer.phone_norm || customer.phone);
    for (const recipient of recipients ?? []) addPhone(recipient.phone);
    for (const log of logs ?? []) addPhone(log.recipient);
    for (const jid of lidJidsFromEvents(sessionEvents ?? [])) addJid(jid);
    if (livePhone) addPhone(livePhone);

    // Refresh oldest-anchor for a specific JID after each imported page, so
    // the next iteration walks further back in history.
    const refreshAnchor = async (jid: string) => {
      const { data } = await supabase
        .from("wa_messages")
        .select("provider_message_id, wa_timestamp")
        .eq("user_id", userId)
        .eq("remote_jid", jid)
        .not("provider_message_id", "is", null)
        .order("wa_timestamp", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (data?.provider_message_id) {
        anchorByJid.set(jid, data.provider_message_id);
        const ts = data.wa_timestamp ? Math.floor(new Date(data.wa_timestamp).getTime() / 1000) : NaN;
        if (Number.isFinite(ts)) anchorTsByJid.set(jid, ts);
      }
    };

    // جلب أعمق: حتى 6 صفحات × 50 رسالة = ~300 رسالة قديمة لكل محادثة، وحتى 500 محادثة.
    const MAX_PAGES_PER_JID = 6;
    const PAGE_SIZE = 50;
    let fetchedKnownChats = 0;
    let requestedKnownChats = 0;
    for (const jid of Array.from(knownJids).slice(0, 500)) {
      if (!jid || jid === "@s.whatsapp.net" || jid.endsWith("@broadcast")) continue;
      let jidTouched = false;
      for (let page = 0; page < MAX_PAGES_PER_JID; page++) {
        try {
          const anchorId = anchorByJid.get(jid) ?? null;
          const anchorTs = anchorTsByJid.get(jid) ?? null;
          let fetchBody: unknown;
          try {
            fetchBody = await waBridge.fetchMessages(row.session_id, jid, PAGE_SIZE, {
              anchorMessageId: anchorId,
              anchorTimestamp: anchorTs,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // Some Bot-Xtra builds reject anchored fetches even while the session
            // status endpoint reports connected. A plain jid+limit request still
            // queues the WhatsApp history batches, so retry without the anchor.
            if (page === 0 && anchorId && /session not connected|anchor|bad request|400/i.test(message)) {
              fetchBody = await waBridge.fetchMessages(row.session_id, jid, PAGE_SIZE);
            } else {
              throw err;
            }
          }
          requestedKnownChats++;

          const imported = await replayBridgeHistoryPayload(row.session_id, fetchBody).catch((err) => ({
            messages: 0,
            chats: 0,
            error: err instanceof Error ? err.message : String(err),
          }));
          directImports.messages += imported.messages;
          directImports.chats += imported.chats;
          directImports.error = directImports.error ?? imported.error;
          if (imported.messages > 0) {
            jidTouched = true;
            // Bot-Xtra delivers older batches via webhook events; give the
            // pipeline a moment before we re-anchor for the next page.
            await wait(600);
            await refreshAnchor(jid);
            result.attempts.push({ path: `/api/sessions/${row.session_id}/fetch-messages`, ok: true, importedMessages: imported.messages, importedChats: imported.chats });
            continue;
          }
          // No new messages returned for this page — stop paginating this JID.
          if (page === 0) {
            result.attempts.push({ path: `/api/sessions/${row.session_id}/fetch-messages`, ok: true, importedMessages: 0, importedChats: 0 });
          }
          break;
        } catch (err) {
          result.attempts.push({
            path: `/api/sessions/${row.session_id}/fetch-messages`,
            ok: false,
            status: err instanceof BridgeError ? err.status : undefined,
            error: err instanceof Error ? err.message : String(err),
          });
          break;
        }
      }
      if (jidTouched) fetchedKnownChats++;
    }

    if (!result.ok) {
      result.ok = fetchedKnownChats > 0 || requestedKnownChats > 0;
    }

    const after = { conversations: directImports.chats, messages: directImports.messages };

    const actuallyImported = directImports.messages > 0 || directImports.chats > 0 || after.conversations > before.conversations;
    const requestAccepted = result.ok || fetchedKnownChats > 0 || requestedKnownChats > 0;
    const pending = requestAccepted && !actuallyImported;
    await logWaSessionEvent(supabase, {
      userId,
      sessionId: row.session_id,
      fromStatus: "connected",
      toStatus: "connected",
      source: "history_sync",
      reason: actuallyImported
        ? "history_sync_imported_messages"
        : requestAccepted
          ? `history_sync_requested_waiting_for_bridge_batches${directImports.error ? ` (${directImports.error})` : ""}`
          : "history_sync_endpoint_unavailable",
    });
    const importedMsgDelta = Math.max(0, directImports.messages);
    const importedConvDelta = Math.max(0, directImports.chats);
    const finalStatus = actuallyImported ? "done" : requestAccepted ? "pending" : "error";
    const finalMessage = finalStatus === "error"
      ? "bridge_history_sync_endpoint_unavailable"
      : directImports.error ?? null;
    await supabase
      .from("wa_history_sync_jobs")
      .update({
        status: finalStatus,
        imported_msg: importedMsgDelta,
        imported_conv: importedConvDelta,
        message: finalMessage,
        finished_at: finalStatus === "pending" ? null : new Date().toISOString(),
      })
      .eq("user_id", userId);

    return {
      ok: actuallyImported || requestAccepted,
      sessionId: row.session_id,
      requested: true,
      pending,
      attempts: result.attempts,
      error: actuallyImported
        ? null
        : requestAccepted
          ? null
          : "bridge_history_sync_endpoint_unavailable",
      before,
      after,
      fetchedKnownChats,
    };
  });

export const requestWaChatSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ remoteJid: z.string().min(3).max(200) }).parse(input))
  .handler(async ({ context, data }): Promise<WaChatSyncResult> => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("wa_sessions")
      .select("session_id, status")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.session_id) {
      return { ok: false, sessionId: null, remoteJid: data.remoteJid, importedMessages: 0, importedChats: 0, attempts: [], error: "no_session" };
    }

    const { data: conv } = await supabase
      .from("wa_conversations")
      .select("contact_phone")
      .eq("user_id", userId)
      .eq("remote_jid", data.remoteJid)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const aliases = new Set<string>([data.remoteJid]);
    const local = data.remoteJid.split("@")[0] ?? "";
    if (/^\d{8,}$/.test(local)) {
      if (data.remoteJid.endsWith("@lid")) aliases.add(`${local}@s.whatsapp.net`);
      if (data.remoteJid.endsWith("@s.whatsapp.net")) aliases.add(`${local}@lid`);
    }
    const phone = normalizeWhatsappPhone(conv?.contact_phone || data.remoteJid);
    if (phone) aliases.add(`${phone}@s.whatsapp.net`);

    let importedMessages = 0;
    let importedChats = 0;
    let lastError: string | null = null;
    const attempts: WaChatSyncResult["attempts"] = [];
    for (const jid of Array.from(aliases).slice(0, 4)) {
      try {
        const body = await waBridge.fetchMessages(row.session_id, jid, 80);
        const imported = await replayBridgeHistoryPayload(row.session_id, body);
        importedMessages += imported.messages;
        importedChats += imported.chats;
        lastError = lastError ?? imported.error;
        attempts.push({ jid, ok: true });
      } catch (err) {
        const status = err instanceof BridgeError ? err.status : undefined;
        const message = err instanceof Error ? err.message : String(err);
        lastError = message;
        attempts.push({ jid, ok: false, status, error: message });
      }
    }

    return {
      ok: attempts.some((a) => a.ok),
      sessionId: row.session_id,
      remoteJid: data.remoteJid,
      importedMessages,
      importedChats,
      attempts,
      error: attempts.some((a) => a.ok) ? null : lastError,
    };
  });

export interface WaHistorySyncJob {
  status: "idle" | "running" | "pending" | "done" | "error";
  sessionId: string | null;
  baselineMsg: number;
  baselineConv: number;
  importedMsg: number;
  importedConv: number;
  message: string | null;
  startedAt: string | null;
  deadlineAt: string | null;
  finishedAt: string | null;
}

/** Read (and lazily finalize) the persisted history-sync job for the current user. */
export const getWaHistorySyncJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WaHistorySyncJob> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("wa_history_sync_jobs")
      .select("session_id, status, baseline_msg, baseline_conv, imported_msg, imported_conv, message, started_at, deadline_at, finished_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      return { status: "idle", sessionId: null, baselineMsg: 0, baselineConv: 0, importedMsg: 0, importedConv: 0, message: null, startedAt: null, deadlineAt: null, finishedAt: null };
    }

    let status = data.status as WaHistorySyncJob["status"];
    let importedMsg = data.imported_msg;
    let importedConv = data.imported_conv;
    let message = data.message;
    let finishedAt = data.finished_at;

    if (status === "running" || status === "pending") {
      const deadlinePassed = data.deadline_at ? Date.now() >= new Date(data.deadline_at).getTime() : false;
      if (deadlinePassed) {
        const hasImports = importedMsg > 0 || importedConv > 0;
        status = hasImports ? "done" : "error";
        message = hasImports ? null : "bridge_history_sync_endpoint_unavailable";
        finishedAt = new Date().toISOString();
        await supabase
          .from("wa_history_sync_jobs")
          .update({ status, imported_msg: importedMsg, imported_conv: importedConv, message, finished_at: finishedAt })
          .eq("user_id", userId);
      } else if (importedMsg !== data.imported_msg || importedConv !== data.imported_conv) {
        await supabase
          .from("wa_history_sync_jobs")
          .update({ imported_msg: importedMsg, imported_conv: importedConv })
          .eq("user_id", userId);
      }
    }

    return {
      status,
      sessionId: data.session_id,
      baselineMsg: data.baseline_msg,
      baselineConv: data.baseline_conv,
      importedMsg,
      importedConv,
      message,
      startedAt: data.started_at,
      deadlineAt: data.deadline_at,
      finishedAt,
    };
  });

/** Dismiss the current job card (e.g. after user reads a done/error state). */
export const dismissWaHistorySyncJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("wa_history_sync_jobs").delete().eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
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
    const notConnectedMsg = "لا توجد جلسة واتساب مربوطة. افتح صفحة WhatsApp واضغط ربط واتساب.";
    if (!row?.session_id) throw new Error(notConnectedMsg);

    const phone = normalizeWhatsappPhone(data.to) || data.to.replace(/[^0-9]/g, "");
    const target = await resolveOutgoingWhatsappTarget({
      userId,
      sessionId: row.session_id,
      remoteJid: `${phone}@s.whatsapp.net`,
      fallbackPhoneOrJid: phone,
    });
    const targetJid = target.jid;
    const targetPhone = target.phoneDigits || phone;
    let providerMessageId: string | null = null;
    let queuedId: string | null = null;
    let delivery = "whatsapp_acknowledged";
    let status = "sent";
    try {
      const webhookUrl = await deriveWebhookUrl();
      const res = await sendTextWithReconnect(row.session_id, targetJid, data.text, {
        webhookUrl: webhookUrl ?? undefined,
        tenantId: userId,
        recipientPhone: targetPhone,
      });
      queuedId = bridgeSendQueuedMessage(res);
      try {
        providerMessageId = assertBridgeSendQueued(res);
      } catch (err) {
        if (!queuedId) throw err;
        status = "sent";
        delivery = "bridge_queue_accepted_awaiting_ack";
      }
    } catch (err) {
      const msg = describeBridgeError(err);
      throw new Error(msg);
    }

    await updateWaSessionStatus(supabase, {
      userId,
      sessionId: row.session_id,
      nextStatus: "connected",
      source: "poll",
      reason: "outgoing_message_accepted",
      rawStatus: "connected",
    });

    await supabase.from("wa_messages").insert({
      user_id: userId,
      session_id: row.session_id,
      direction: "out",
      remote_jid: targetJid,
      to_phone: targetPhone,
      msg_type: "text",
      text_body: data.text,
      status,
      provider_message_id: providerMessageId,
      raw: { bridgeMessageId: providerMessageId, queuedId, delivery, targetJid, targetPhone, usedLid: target.usedLid } as never,
    });

    await upsertConversationFromMessage({
      userId,
      sessionId: row.session_id,
      remoteJid: targetJid,
      contactName: null,
      contactPhone: targetPhone,
      text: data.text,
      direction: "out",
    });

    return { ok: true, pending: false };
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
    // Disconnect should only unlink the live bridge session. Keep local inbox
    // history so reconnecting the same number does not make old conversations
    // disappear when the bridge cannot replay full WhatsApp history.
    const { error: jobErr } = await supabase.from("wa_history_sync_jobs").delete().eq("user_id", userId);
    if (jobErr) throw new Error(`Failed to clear WhatsApp sync jobs: ${jobErr.message}`);
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
        syncFullHistory: true,
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


export interface WaDeepResetReport {
  ok: boolean;
  removedBridgeSessions: string[];
  deleteErrors: Array<{ id: string; error: string }>;
  createdSessionId: string | null;
  webhookUrl: string | null;
  error: string | null;
  preserved?: boolean;
  status?: string | null;
}

/**
 * Safe maintenance action: verify/revive the same bridge session without
 * deleting credentials or creating a fresh QR. The old implementation was a
 * nuclear delete+new-QR path and could break a paired customer number.
 */
export const deepResetWaSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WaDeepResetReport> => {
    const { supabase, userId } = context;
    const report: WaDeepResetReport = {
      ok: false,
      removedBridgeSessions: [],
      deleteErrors: [],
      createdSessionId: null,
      webhookUrl: null,
      error: null,
      preserved: true,
      status: null,
    };

    const { data: existing } = await supabase
      .from("wa_sessions")
      .select("session_id, status")
      .eq("user_id", userId)
      .maybeSingle();

    if (!existing?.session_id) {
      report.error = "no_session";
      return report;
    }

    const webhookUrl = await deriveWebhookUrl();
    report.webhookUrl = webhookUrl;

    try {
      const statusPayload = await waBridge.getStatus(existing.session_id);
      const status = inferStatus(statusPayload);
      report.status = status;
      if (status === "connected") {
        await updateWaSessionStatus(supabase, {
          userId,
          sessionId: existing.session_id,
          nextStatus: "connected",
          source: "reset",
          reason: "safe_maintenance_confirmed_connected",
          rawStatus: String(statusPayload.status ?? statusPayload.state ?? "connected"),
          phoneNumber: typeof statusPayload.phoneNumber === "string" ? statusPayload.phoneNumber : typeof statusPayload.phone === "string" ? statusPayload.phone : null,
          logEvenIfUnchanged: true,
        });
        report.ok = true;
        report.createdSessionId = existing.session_id;
        return report;
      }
    } catch (err) {
      console.warn("[wa] safeMaintenance: status check failed:", err instanceof Error ? err.message : err);
    }

    await logWaSessionEvent(supabase, {
      userId,
      sessionId: existing.session_id,
      fromStatus: existing.status ?? null,
      toStatus: existing.status ?? "unknown",
      source: "reset",
      reason: "safe_maintenance_skipped_bridge_rebuild",
      rawStatus: report.status ?? existing.status ?? "unknown",
    });
    report.createdSessionId = existing.session_id;
    report.ok = report.status === "connected" || report.status === "connecting";
    report.preserved = true;
    if (!report.ok) report.error = `session_not_connected:${report.status ?? "unknown"}`;
    return report;
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
        .eq("session_id", sessionId)
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

  let previousStatus: BridgeSessionStatus | null = null;
  try {
    const { data: current } = await supabase
      .from("wa_sessions")
      .select("status")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .maybeSingle();
    previousStatus = (current?.status as BridgeSessionStatus | undefined) ?? null;
  } catch {
    previousStatus = null;
  }

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
    if (isHardSessionGoneError(err) && previousStatus !== "connected") {
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
  if (status === "connected") {
    let shouldRequestHistory = previousStatus !== "connected";
    if (!shouldRequestHistory) {
      const { data: existingConversation } = await supabase
        .from("wa_conversations")
        .select("id")
        .eq("user_id", userId)
        .eq("session_id", sessionId)
        .limit(1)
        .maybeSingle();
      shouldRequestHistory = !existingConversation;
    }
    if (shouldRequestHistory) {
      Promise.allSettled([waBridge.fetchChats(sessionId), waBridge.requestHistorySync(sessionId)]).catch((err) => {
        console.warn("[wa] requestHistorySync failed:", err instanceof Error ? err.message : err);
      });
    }
  }
  // Preserve last-known phone_number when bridge transiently reports null
  // (e.g. session re-paired). Only overwrite when we actually got a number.
  const trustedDisconnect = status === "disconnected" && isTrustedUserDisconnect({ source: error ? "poll_error" : "poll", reason: error, rawStatus: status });
  const effectiveStatus = status === "disconnected" && !trustedDisconnect ? (previousStatus || "unknown") : status;
  await updateWaSessionStatus(supabase, {
    userId,
    sessionId,
    nextStatus: effectiveStatus,
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
    status: effectiveStatus,
    sessionId,
    qrDataUrl: null,
    qrRaw: effectiveStatus === "qr" ? qrRaw : null,
    phoneNumber: surfacedPhone,
    lastSeenAt: now,
    error,
  };
}

/**
 * Backfill contact_phone for existing @lid conversations by scanning the
 * user's stored wa_messages for a real senderPn tied to the same JID.
 * Also opportunistically copies contact_name from a sibling conversation
 * that already has the same real phone. Runs under the user's RLS scope.
 */
export const matchLidPhoneNumbers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ scanned: number; matched: number }> => {
    const { supabase, userId } = context;

    // Candidates: LID convs missing a real phone.
    const { data: convs, error: convsErr } = await supabase
      .from("wa_conversations")
      .select("id, session_id, remote_jid, contact_phone, contact_name")
      .eq("user_id", userId)
      .like("remote_jid", "%@lid")
      .is("contact_phone", null)
      .limit(2000);
    if (convsErr) throw new Error(convsErr.message);
    if (!convs || convs.length === 0) return { scanned: 0, matched: 0 };

    const jids = convs
      .map((c) => c.remote_jid)
      .filter((jid): jid is string => typeof jid === "string" && jid.length > 0);
    const { data: phoneRows } = jids.length
      ? await supabase
          .from("wa_messages")
          .select("remote_jid, from_phone, to_phone, raw")
          .eq("user_id", userId)
          .in("remote_jid", jids)
          .order("created_at", { ascending: false })
          .limit(5000)
      : { data: [] as Array<{ remote_jid: string; from_phone: string | null; to_phone: string | null; raw: unknown }> };

    const phoneByJid = new Map<string, string>();
    for (const row of phoneRows ?? []) {
      if (phoneByJid.has(row.remote_jid)) continue;
      const lidLocal = String(row.remote_jid ?? "").split("@")[0] ?? "";
      const phone = realPhoneDigits(row.from_phone) || realPhoneDigits(row.to_phone) || phoneFromRaw(row.raw);
      if (phone && phone !== lidLocal) phoneByJid.set(row.remote_jid, phone);
    }

    // Ask the bridge for its current chat/contact catalogue as another safe
    // source. This only accepts explicit PN/phone fields; it never guesses a
    // public number from a 14+ digit LID alias.
    const sessionIds = Array.from(new Set((convs ?? []).map((c) => c.session_id).filter(Boolean)));
    for (const sessionId of sessionIds) {
      const catalogue = await waBridge.fetchChats(String(sessionId)).catch(() => null);
      const rows = pickArray(catalogue?.body, ["contacts", "chats", "items", "data"]);
      for (const row of rows) {
        const jid = jidFromContactRecord(row);
        if (!jid || !jids.includes(jid) || phoneByJid.has(jid)) continue;
        const phone = phoneFromContactRecord(row);
        const lidLocal = String(jid).split("@")[0] ?? "";
        if (phone && phone !== lidLocal) phoneByJid.set(jid, phone);
      }
    }

    const phones = Array.from(new Set(phoneByJid.values()));
    const { data: siblings } = phones.length
      ? await supabase
          .from("wa_conversations")
          .select("contact_phone, contact_name")
          .eq("user_id", userId)
          .in("contact_phone", phones)
          .not("contact_name", "is", null)
          .limit(2000)
      : { data: [] as Array<{ contact_phone: string | null; contact_name: string | null }> };
    const nameByPhone = new Map<string, string>();
    for (const row of siblings ?? []) {
      const phone = (row.contact_phone ?? "").replace(/[^0-9]/g, "");
      if (phone && row.contact_name && !nameByPhone.has(phone)) nameByPhone.set(phone, row.contact_name);
    }

    let matched = 0;

    for (const conv of convs) {
      const realPhone = phoneByJid.get(conv.remote_jid);
      if (!realPhone) continue;

      // Optionally borrow a name from a sibling conv that already knows this phone.
      const borrowedName = conv.contact_name ? null : nameByPhone.get(realPhone) ?? null;

      const patch: { contact_phone: string; contact_name?: string } = { contact_phone: realPhone };
      if (borrowedName) patch.contact_name = borrowedName;

      const { error: updErr } = await supabase
        .from("wa_conversations")
        .update(patch)
        .eq("id", conv.id)
        .eq("user_id", userId);
      if (!updErr) matched++;
    }

    return { scanned: convs.length, matched };
  });


