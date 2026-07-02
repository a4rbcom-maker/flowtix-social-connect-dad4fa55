// Server-side audit trail for WhatsApp session status changes.
// This does not call or modify Bot-Xtra; it only records what our app receives
// from the bridge/webhook so disconnect causes are visible later.

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

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
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
  const hasWebhookLogoutCode =
    (input.source === "webhook_status" || input.source === "history_sync") &&
    /\b401\b|unauthorized/.test(text) &&
    /disconnect|logged|logout|unlinked|closed/.test(text);

  return hasLogoutWords || hasWebhookLogoutCode;
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

  // Debounce during bulk campaigns: transient disconnect events that arrive
  // while a bulk campaign is running/scheduled for the same user are almost
  // always spurious. Preserve the previous status unless we have a trusted
  // logout signal.
  const bulkActive =
    input.nextStatus === "disconnected" && !trustedDisconnect
      ? await hasActiveBulkCampaign(db, input.userId)
      : false;

  const shouldPreserveConnectedSession =
    input.nextStatus === "disconnected" && (!trustedDisconnect || isLateEvent);
  const nextStatus = shouldPreserveConnectedSession ? (previousStatus ?? "unknown") : input.nextStatus;

  const update: Record<string, unknown> = {
    status: nextStatus,
    last_seen_at: new Date().toISOString(),
  };
  if (input.phoneNumber) update.phone_number = input.phoneNumber;
  if (input.qrDataUrl !== undefined) update.qr_data_url = input.qrDataUrl;

  await db
    .from("wa_sessions")
    .update(update)
    .eq("user_id", input.userId)
    .eq("session_id", input.sessionId);

  try {
    if (nextStatus === "connected") {
      await db
        .from("whatsapp_settings")
        .update({ is_connected: true, last_connected_at: new Date().toISOString() })
        .eq("user_id", input.userId);
    } else if (trustedDisconnect && !isLateEvent) {
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
    trustedDisconnect;

  if (shouldLog) {
    const suppressedTag = isLateEvent
      ? "late_event"
      : bulkActive
        ? "bulk_active_debounce"
        : "untrusted_disconnect";
    await logWaSessionEvent(db, {
      userId: input.userId,
      sessionId: input.sessionId,
      fromStatus: previousStatus,
      toStatus: nextStatus,
      source: input.source,
      reason: shouldPreserveConnectedSession
        ? `ignored_transient_disconnect(${suppressedTag}): ${input.reason ?? input.rawStatus ?? input.bridgeEvent ?? ""}`
        : input.reason,
      rawStatus: input.rawStatus,
      bridgeEvent: input.bridgeEvent,
      payload: input.payload,
    });
  }

  return previousStatus;
}