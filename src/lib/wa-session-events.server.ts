// Server-side audit trail for WhatsApp session status changes.
// This does not call or modify Bot-Xtra; it only records what our app receives
// from the bridge/webhook so disconnect causes are visible later.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { BridgeError } from "./wa-bridge.server";

export type WaSessionEventSource =
  | "webhook_status"
  | "webhook_qr"
  | "poll"
  | "poll_error"
  | "connect_error"
  | "disconnect"
  | "history_sync"
  | "reset";

type DbClient = {
  from: (table: string) => any;
};

const QR_BURST_WINDOW_MS = 120_000;
const QR_BURST_MIN_IGNORED_EVENTS = 10;
const RECENT_ALIVE_GRACE_MS = 90_000;

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function digits(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number" && typeof v !== "bigint") return null;
  const d = String(v).replace(/[^0-9]/g, "");
  return d.length >= 8 ? d : null;
}

function verifiedPhoneFromPayload(payload: unknown): string | null {
  const root = asObj(payload);
  const data = asObj(root.data);
  const session = asObj(root.session);
  const instance = asObj(root.instance);
  return (
    digits(data.phoneNumber) ||
    digits(data.phone) ||
    digits(root.phoneNumber) ||
    digits(root.phone) ||
    digits(session.phoneNumber) ||
    digits(session.phone) ||
    digits(instance.phoneNumber) ||
    digits(instance.phone)
  );
}

async function adoptArchiveForVerifiedPhone(input: {
  userId: string;
  sessionId: string;
  phoneNumber: string;
}): Promise<{ conversations: number; messages: number; sourceSessions: number }> {
  const phone = digits(input.phoneNumber);
  if (!phone) return { conversations: 0, messages: 0, sourceSessions: 0 };

  const candidates = new Map<string, { userId: string; sessionId: string }>();

  const { data: sessionRows } = await supabaseAdmin
    .from("wa_sessions")
    .select("user_id, session_id, phone_number")
    .not("phone_number", "is", null)
    .limit(200);

  for (const row of sessionRows ?? []) {
    if (digits(row.phone_number) !== phone) continue;
    if (row.user_id === input.userId && row.session_id === input.sessionId) continue;
    candidates.set(`${row.user_id}:${row.session_id}`, { userId: row.user_id, sessionId: row.session_id });
  }

  // Reset/re-pair flows replace wa_sessions.session_id and may clear phone_number,
  // while old messages remain under the previous session ID. The verified
  // connected webhook keeps the WhatsApp phone, so use it to safely recover
  // orphaned local history for the SAME WhatsApp number only.
  const { data: eventRows } = await supabaseAdmin
    .from("wa_session_events")
    .select("user_id, session_id, raw_status, bridge_payload")
    .eq("raw_status", "connected")
    .order("created_at", { ascending: false })
    .limit(2000);

  for (const row of eventRows ?? []) {
    if (verifiedPhoneFromPayload(row.bridge_payload) !== phone) continue;
    if (row.user_id === input.userId && row.session_id === input.sessionId) continue;
    candidates.set(`${row.user_id}:${row.session_id}`, { userId: row.user_id, sessionId: row.session_id });
  }

  let conversations = 0;
  let messages = 0;
  for (const candidate of candidates.values()) {
    const { count: msgCount, error: msgErr } = await supabaseAdmin
      .from("wa_messages")
      .update({ user_id: input.userId, session_id: input.sessionId }, { count: "exact" })
      .eq("user_id", candidate.userId)
      .eq("session_id", candidate.sessionId)
      .neq("session_id", input.sessionId);
    if (msgErr) console.warn("[wa-session-events] archive message adoption failed:", msgErr.message);
    else messages += msgCount ?? 0;

    const { count: convCount, error: convErr } = await supabaseAdmin
      .from("wa_conversations")
      .update({ user_id: input.userId, session_id: input.sessionId }, { count: "exact" })
      .eq("user_id", candidate.userId)
      .eq("session_id", candidate.sessionId)
      .neq("session_id", input.sessionId);
    if (convErr) console.warn("[wa-session-events] archive conversation adoption failed:", convErr.message);
    else conversations += convCount ?? 0;
  }

  return { conversations, messages, sourceSessions: candidates.size };
}

function valueToReason(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Error) return v.message || v.name;
  try {
    const s = JSON.stringify(v);
    return s && s !== "{}" ? s.slice(0, 500) : null;
  } catch {
    return null;
  }
}

export function extractSessionReason(payload: Record<string, unknown> = {}, data: Record<string, unknown> = {}): string | null {
  const lastDisconnect = asObj(data.lastDisconnect ?? payload.lastDisconnect);
  const lastError = asObj(lastDisconnect.error);
  const errorObj = asObj(data.error ?? payload.error);
  const candidates: unknown[] = [
    data.reason,
    payload.reason,
    data.disconnectReason,
    payload.disconnectReason,
    data.message,
    payload.message,
    errorObj.message,
    data.error,
    payload.error,
    lastDisconnect.reason,
    lastDisconnect.statusCode,
    lastError.message,
    lastError.name,
  ];
  for (const candidate of candidates) {
    const reason = valueToReason(candidate);
    if (reason) return reason;
  }
  return null;
}

export function isHardSessionGoneError(err: unknown): boolean {
  if (!(err instanceof BridgeError)) return false;
  if (err.status === 404) return true;
  const message = err.message.toLowerCase();
  return /session.*(not.?found|closed|logged.?out)/i.test(message) || /logged.?out|closed/.test(message);
}

export function isTrustedUserDisconnect(input: {
  source?: WaSessionEventSource | string | null;
  reason?: string | null;
  rawStatus?: string | null;
  bridgeEvent?: string | null;
}): boolean {
  if (input.source === "disconnect") return true;

  const text = [input.reason, input.rawStatus, input.bridgeEvent]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const hasLogoutWords = /logged[\s_-]*out|logout|log[\s_-]*out|removed.*device|device.*removed|unlinked|unlink|signed[\s_-]*out/.test(text);
  const hasAuthoritativeMissingSession =
    (input.source === "poll_error" || input.source === "connect_error" || input.source === "reset") &&
    /bridge_session_missing|session[_\s-]*(not[_\s-]*found|missing|closed)|not[_\s-]*found|\b404\b/.test(text);
  const hasWebhookLogoutCode =
    (input.source === "webhook_status" || input.source === "history_sync") &&
    /\b401\b|unauthorized/.test(text) &&
    /disconnect|logged|logout|unlinked|closed/.test(text);
  const hasAuthoritativeBridgeOffline =
    (input.source === "poll" || input.source === "poll_error" || input.source === "reset" || input.source === "history_sync") &&
    /bridge_live_connected_false|bridge_session_not_live|bridge_session_not_connected|history_sync_skipped_non_connected_status|safe_maintenance_bridge_not_live|send_blocked_bridge_not_live|session_not_connected:disconnected/.test(text);

  return hasLogoutWords || hasAuthoritativeMissingSession || hasWebhookLogoutCode || hasAuthoritativeBridgeOffline;
}

function isTransientQrAfterConnected(input: {
  previousStatus?: string | null;
  nextStatus: string;
  source?: WaSessionEventSource | string | null;
  reason?: string | null;
  rawStatus?: string | null;
  bridgeEvent?: string | null;
}): boolean {
  if (input.previousStatus !== "connected" || input.nextStatus !== "qr") return false;
  // Poll/status reads are authoritative. Only raw webhook QR events can be
  // transient during WhatsApp reconnect; if /status itself says QR, surface QR.
  if (input.source !== "webhook_status" && input.source !== "webhook_qr") return false;
  return !isTrustedUserDisconnect(input);
}

export async function logWaSessionEvent(
  db: DbClient,
  event: {
    userId: string;
    sessionId: string;
    fromStatus?: string | null;
    toStatus: string;
    source: WaSessionEventSource;
    reason?: string | null;
    rawStatus?: string | null;
    bridgeEvent?: string | null;
    payload?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    await db.from("wa_session_events").insert({
      user_id: event.userId,
      session_id: event.sessionId,
      from_status: event.fromStatus ?? null,
      to_status: event.toStatus,
      source: event.source,
      reason: event.reason ?? null,
      raw_status: event.rawStatus ?? null,
      bridge_event: event.bridgeEvent ?? null,
      bridge_payload: event.payload ?? null,
    });
  } catch (err) {
    // Never break WhatsApp handling because the audit table is unavailable.
    console.warn("[wa-session-events] insert failed:", err instanceof Error ? err.message : err);
  }
}

async function hasActiveBulkCampaign(db: DbClient, userId: string): Promise<boolean> {
  try {
    const { data } = await db
      .from("bulk_jobs")
      .select("id")
      .eq("user_id", userId)
      .in("status", ["running", "scheduled"])
      .limit(1);
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

export async function updateWaSessionStatus(
  db: DbClient,
  input: {
    userId: string;
    sessionId: string;
    nextStatus: string;
    source: WaSessionEventSource;
    reason?: string | null;
    rawStatus?: string | null;
    bridgeEvent?: string | null;
    phoneNumber?: string | null;
    qrDataUrl?: string | null;
    payload?: Record<string, unknown> | null;
    logEvenIfUnchanged?: boolean;
    /** Payload timestamp (seconds/ms epoch or ISO). Used to reject late webhooks. */
    eventAt?: string | number | null;
  },
): Promise<string | null> {
  let previousStatus: string | null = null;
  let previousLastSeen: string | null = null;
  try {
    const { data } = await db
      .from("wa_sessions")
      .select("status,last_seen_at")
      .eq("user_id", input.userId)
      .eq("session_id", input.sessionId)
      .maybeSingle();
    previousStatus = data?.status ?? null;
    previousLastSeen = data?.last_seen_at ?? null;
  } catch {
    // best effort only
  }

  // Late-event guard: an older webhook arriving after fresher activity should
  // not flip a "connected" session to "disconnected".
  let isLateEvent = false;
  if (input.eventAt != null && previousLastSeen) {
    const raw = input.eventAt;
    const eventMs =
      typeof raw === "number"
        ? raw < 1e12
          ? raw * 1000
          : raw
        : Date.parse(String(raw));
    const lastSeenMs = Date.parse(previousLastSeen);
    if (Number.isFinite(eventMs) && Number.isFinite(lastSeenMs) && eventMs + 2_000 < lastSeenMs) {
      isLateEvent = true;
    }
  }

  const trustedDisconnect = input.nextStatus === "disconnected" && isTrustedUserDisconnect(input);
  let transientQrAfterConnected = isTransientQrAfterConnected({
    previousStatus,
    nextStatus: input.nextStatus,
    source: input.source,
    reason: input.reason,
    rawStatus: input.rawStatus,
    bridgeEvent: input.bridgeEvent,
  });

  // QR burst break: if the bridge is emitting continuous QR events after a
  // "connected" state, the underlying socket may have dropped and the pairing
  // may need a fresh scan. Do not break during the first moments after a scan or
  // connected/activity signal: Bot-Xtra can emit stale QR webhooks while
  // WhatsApp finishes the auth handshake. Only break on a sustained QR-only
  // burst with no recent alive signal.
  let qrBurstBroken = false;
  if (transientQrAfterConnected) {
    try {
      const nowMs = Date.now();
      const aliveSince = new Date(nowMs - RECENT_ALIVE_GRACE_MS).toISOString();
      const { data: aliveEvents } = await db
        .from("wa_session_events")
        .select("id")
        .eq("user_id", input.userId)
        .eq("session_id", input.sessionId)
        .eq("to_status", "connected")
        .in("raw_status", ["connected", "activity"])
        .gte("created_at", aliveSince)
        .limit(1);

      const hasRecentAliveSignal = Array.isArray(aliveEvents) && aliveEvents.length > 0;
      if (!hasRecentAliveSignal) {
        const since = new Date(nowMs - QR_BURST_WINDOW_MS).toISOString();
        const { data: bursts } = await db
          .from("wa_session_events")
          .select("id")
          .eq("user_id", input.userId)
          .eq("session_id", input.sessionId)
          .eq("raw_status", "qr")
          .eq("to_status", previousStatus ?? "connected")
          .like("reason", "ignored_transient_qr%")
          .gte("created_at", since)
          .limit(QR_BURST_MIN_IGNORED_EVENTS + 1);
        if (Array.isArray(bursts) && bursts.length >= QR_BURST_MIN_IGNORED_EVENTS) {
          transientQrAfterConnected = false;
          qrBurstBroken = true;
        }
      }
    } catch {
      // best effort — if the audit query fails, keep the transient guard on.
    }
  }

  // Backward-compatible escape hatch: if the app was left in QR by an over-eager
  // burst break, a fresh connected webhook or proven live poll may promote it
  // back to connected. History/message catch-up alone is not authoritative.
  const isAuthoritativeConnected =
    input.nextStatus === "connected" &&
    (input.rawStatus === "connected" || input.source === "poll" || input.source === "reset");

  if (previousStatus === "qr" && input.nextStatus === "connected" && !isAuthoritativeConnected) {
    await logWaSessionEvent(db, {
      userId: input.userId,
      sessionId: input.sessionId,
      fromStatus: previousStatus,
      toStatus: previousStatus,
      source: input.source,
      reason: `ignored_activity_promotion_while_qr: ${input.reason ?? input.rawStatus ?? input.bridgeEvent ?? ""}`,
      rawStatus: input.rawStatus,
      bridgeEvent: input.bridgeEvent,
      payload: input.payload,
    });
    return previousStatus;
  }

  // Debounce during bulk campaigns: transient disconnect events that arrive
  // while a bulk campaign is running/scheduled for the same user are almost
  // always spurious. Preserve the previous status unless we have a trusted
  // logout signal.
  const bulkActive =
    input.nextStatus === "disconnected" && !trustedDisconnect
      ? await hasActiveBulkCampaign(db, input.userId)
      : false;

  const shouldPreserveConnectedSession =
    (input.nextStatus === "disconnected" && (!trustedDisconnect || isLateEvent)) || transientQrAfterConnected;
  const nextStatus = shouldPreserveConnectedSession ? (previousStatus ?? "unknown") : input.nextStatus;

  const update: Record<string, unknown> = {
    status: nextStatus,
    last_seen_at: new Date().toISOString(),
  };
  if (input.phoneNumber) update.phone_number = input.phoneNumber;
  if (input.qrDataUrl !== undefined && !transientQrAfterConnected) update.qr_data_url = input.qrDataUrl;

  await db
    .from("wa_sessions")
    .update(update)
    .eq("user_id", input.userId)
    .eq("session_id", input.sessionId);

  let adoptedArchive: { conversations: number; messages: number; sourceSessions: number } | null = null;
  const phoneIsVerifiedByBridge =
    input.source === "webhook_status" ||
    input.source === "history_sync" ||
    (input.source === "poll" && input.rawStatus === "connected" && input.reason !== "outgoing_message_accepted");
  if (nextStatus === "connected" && input.phoneNumber && phoneIsVerifiedByBridge) {
    try {
      adoptedArchive = await adoptArchiveForVerifiedPhone({
        userId: input.userId,
        sessionId: input.sessionId,
        phoneNumber: input.phoneNumber,
      });
    } catch (err) {
      console.warn("[wa-session-events] archive adoption crashed:", err instanceof Error ? err.message : err);
    }
  }

  try {
    if (nextStatus === "connected") {
      await db
        .from("whatsapp_settings")
        .update({ is_connected: true, last_connected_at: new Date().toISOString() })
        .eq("user_id", input.userId);
    } else if ((trustedDisconnect && !isLateEvent) || qrBurstBroken) {
      await db
        .from("whatsapp_settings")
        .update({ is_connected: false, last_connected_at: null })
        .eq("user_id", input.userId);
    }
  } catch {
    // Session status is the source of truth; settings sync is best-effort.
  }

  const shouldLog =
    input.logEvenIfUnchanged ||
    previousStatus !== nextStatus ||
    trustedDisconnect ||
    transientQrAfterConnected ||
    qrBurstBroken;

  if (shouldLog) {
    const suppressedTag = isLateEvent
      ? "late_event"
      : bulkActive
        ? "bulk_active_debounce"
        : transientQrAfterConnected
          ? "transient_qr_after_connected"
        : "untrusted_disconnect";
    await logWaSessionEvent(db, {
      userId: input.userId,
      sessionId: input.sessionId,
      fromStatus: previousStatus,
      toStatus: nextStatus,
      source: input.source,
      reason: qrBurstBroken
        ? `qr_burst_break_after_connected: ${input.reason ?? input.rawStatus ?? input.bridgeEvent ?? ""}`
        : shouldPreserveConnectedSession
          ? `ignored_transient_${input.nextStatus === "qr" ? "qr" : "disconnect"}(${suppressedTag}): ${input.reason ?? input.rawStatus ?? input.bridgeEvent ?? ""}`
          : input.reason,
      rawStatus: input.rawStatus,
      bridgeEvent: input.bridgeEvent,
      payload: input.payload,
    });
  }

  if (adoptedArchive && (adoptedArchive.conversations > 0 || adoptedArchive.messages > 0)) {
    await logWaSessionEvent(db, {
      userId: input.userId,
      sessionId: input.sessionId,
      fromStatus: nextStatus,
      toStatus: nextStatus,
      source: "history_sync",
      reason: `adopted_verified_phone_archive:${adoptedArchive.conversations}_conversations:${adoptedArchive.messages}_messages:${adoptedArchive.sourceSessions}_sessions`,
      rawStatus: "connected",
      bridgeEvent: input.bridgeEvent,
      payload: null,
    });
  }

  return previousStatus;
}