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
  },
): Promise<string | null> {
  let previousStatus: string | null = null;
  try {
    const { data } = await db
      .from("wa_sessions")
      .select("status")
      .eq("user_id", input.userId)
      .eq("session_id", input.sessionId)
      .maybeSingle();
    previousStatus = data?.status ?? null;
  } catch {
    // best effort only
  }

  const update: Record<string, unknown> = {
    status: input.nextStatus,
    last_seen_at: new Date().toISOString(),
  };
  if (input.phoneNumber) update.phone_number = input.phoneNumber;
  if (input.qrDataUrl !== undefined) update.qr_data_url = input.qrDataUrl;

  await db
    .from("wa_sessions")
    .update(update)
    .eq("user_id", input.userId)
    .eq("session_id", input.sessionId);

  const shouldLog =
    input.logEvenIfUnchanged ||
    previousStatus !== input.nextStatus ||
    input.nextStatus === "disconnected";

  if (shouldLog) {
    await logWaSessionEvent(db, {
      userId: input.userId,
      sessionId: input.sessionId,
      fromStatus: previousStatus,
      toStatus: input.nextStatus,
      source: input.source,
      reason: input.reason,
      rawStatus: input.rawStatus,
      bridgeEvent: input.bridgeEvent,
      payload: input.payload,
    });
  }

  return previousStatus;
}