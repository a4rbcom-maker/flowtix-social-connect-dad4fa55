// Server-only HTTP client for the BotXtra WhatsApp Bridge (v1.8.x).
// Wraps the bridge REST API with X-API-Key auth + typed helpers.
// Never import from client code.

import { normalizeWhatsappPhone } from "./wa-chat-helpers.server";

const BRIDGE_TIMEOUT_MS = 15_000;
const DEFAULT_BRIDGE_URL = "https://bridge.botxtra.com";
const API_KEY_ENV_NAMES = [
  "WA_BRIDGE_API_KEY",
  "BOTXTRA_API_KEY",
  "BOT_XTRA_API_KEY",
  "WHATSAPP_BRIDGE_API_KEY",
  "WA_API_KEY",
] as const;

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function getConfiguredApiKey() {
  for (const name of API_KEY_ENV_NAMES) {
    const value = readEnv(name);
    if (value) return { name, value };
  }
  return { name: null, value: "" };
}

export function getWaBridgeConfigStatus() {
  const rawUrl = readEnv("WA_BRIDGE_URL");
  const apiKey = getConfiguredApiKey();
  return {
    url: (rawUrl || DEFAULT_BRIDGE_URL).replace(/\/+$/, ""),
    hasApiKey: Boolean(apiKey.value),
    apiKeyName: apiKey.name,
    usingDefaultUrl: !rawUrl,
  };
}

function getConfig() {
  const { url } = getWaBridgeConfigStatus();
  const apiKey = getConfiguredApiKey();
  if (!apiKey.value) {
    throw new Error(
      `WA_BRIDGE_API_KEY is not configured on this server. Set one of: ${API_KEY_ENV_NAMES.join(", ")}`,
    );
  }
  return { url, apiKey: apiKey.value };
}

// Transient errors we auto-retry. 401/403 are NOT retried: they indicate
// a config/permission problem and retrying just delays the real failure
// (and used to trigger an unnecessary session rebuild upstream).
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

async function bridgeFetch<T>(path: string, init: RequestInit = {}, attempt = 1): Promise<T> {
  const { url, apiKey } = getConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        // Bot-Xtra v1.8.x rejects "Authorization: Bearer" with 401 — only X-API-Key is honored.
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers || {}),
      },
    });

    const text = await res.text();
    const body = text ? safeParse(text) : null;
    if (!res.ok) {
      const msg =
        (body && typeof body === "object" && "error" in body
          ? String((body as Record<string, unknown>).error)
          : "") ||
        `Bridge ${res.status}`;
      if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
        console.warn(`[wa-bridge] retry ${attempt}/${MAX_ATTEMPTS - 1} for ${path} after HTTP ${res.status}`);
        await sleep(backoffMs(attempt));
        return bridgeFetch<T>(path, init, attempt + 1);
      }
      throw new BridgeError(msg, res.status, body);
    }
    return body as T;
  } catch (err) {
    if (err instanceof BridgeError) throw err;
    const isTimeout = err instanceof Error && err.name === "AbortError";
    if ((isTimeout || isNetworkError(err)) && attempt < MAX_ATTEMPTS) {
      console.warn(`[wa-bridge] retry ${attempt}/${MAX_ATTEMPTS - 1} for ${path} after ${isTimeout ? "timeout" : "network error"}`);
      clearTimeout(timer);
      await sleep(backoffMs(attempt));
      return bridgeFetch<T>(path, init, attempt + 1);
    }
    if (isTimeout) throw new BridgeError("Bridge request timed out", 504, null);
    throw new BridgeError(err instanceof Error ? err.message : "Bridge network error", 502, null);
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number) {
  // 400ms, 1200ms, …
  return Math.min(400 * Math.pow(3, attempt - 1), 5000);
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return (
    m.includes("fetch failed") ||
    m.includes("network") ||
    m.includes("econnreset") ||
    m.includes("etimedout") ||
    m.includes("socket")
  );
}


function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class BridgeError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "BridgeError";
    this.status = status;
    this.body = body;
  }
}

export interface BridgeSendResponse {
  id?: string;
  messageId?: string;
  message_id?: string;
  msgId?: string;
  msg_id?: string;
  wamid?: string;
  queuedId?: string;
  queued_id?: string;
  queueId?: string;
  queue_id?: string;
  requestId?: string;
  request_id?: string;
  jobId?: string;
  job_id?: string;
  queued?: boolean;
  ok?: boolean;
  success?: boolean;
  status?: string;
  error?: string;
  message?: string;
  data?: unknown;
  result?: unknown;
  payload?: unknown;
  [key: string]: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function extractBridgeMessageId(res: unknown, depth = 0): string | null {
  if (!res || depth > 3) return null;
  const obj = asRecord(res);
  const direct = pickString(obj, "id", "messageId", "message_id", "msgId", "msg_id", "wamid");
  if (direct && !isBridgeQueueToken(direct)) return direct;
  const keyId = pickString(asRecord(obj.key), "id");
  if (keyId && !isBridgeQueueToken(keyId)) return keyId;
  for (const key of ["data", "result", "payload", "message"]) {
    const nested = extractBridgeMessageId(obj[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

export function isBridgeQueueToken(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const id = value.trim().toLowerCase();
  return id === "queued" || /^q[_-]/.test(id) || /^queue[_-]/.test(id);
}

export function extractBridgeQueuedId(res: unknown, depth = 0): string | null {
  if (!res || depth > 3) return null;
  const obj = asRecord(res);
  const direct = pickString(obj, "queuedId", "queued_id", "queueId", "queue_id", "requestId", "request_id", "jobId", "job_id");
  if (direct) return direct;
  for (const key of ["data", "result", "payload", "message"]) {
    const nested = extractBridgeQueuedId(obj[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

export function bridgeSendQueuedMessage(res: unknown, depth = 0): string | null {
  if (!res || depth > 3) return null;
  const obj = asRecord(res);
  const status = String(obj.status ?? "").toLowerCase();
  const queuedId = extractBridgeQueuedId(obj);
  if (obj.queued === true || status === "queued" || queuedId) {
    return queuedId || "queued";
  }
  const nested = bridgeSendQueuedMessage(obj.data ?? obj.result ?? obj.payload, depth + 1);
  return nested;
}

export function bridgeSendFailureMessage(res: unknown, depth = 0): string | null {
  if (!res || depth > 3) return null;
  const obj = asRecord(res);
  if (!Object.keys(obj).length) return null;
  const status = String(obj.status ?? "").toLowerCase();
  if (obj.ok === false || obj.success === false || status === "failed" || status === "error") {
    return pickString(obj, "error", "message", "reason") || `Bridge send failed${status ? ` (${status})` : ""}`;
  }
  const nested = bridgeSendFailureMessage(obj.data ?? obj.result ?? obj.payload, depth + 1);
  return nested;
}

export function assertBridgeSendQueued(res: BridgeSendResponse | null | undefined): string {
  const failure = bridgeSendFailureMessage(res);
  if (failure) throw new BridgeError(failure, 200, res ?? null);
  const messageId = extractBridgeMessageId(res);
  if (!messageId || isBridgeQueueToken(messageId)) {
    throw new BridgeError(
      `Bridge accepted request but returned no message id (response: ${JSON.stringify(res ?? null).slice(0, 240)})`,
      200,
      res ?? null,
    );
  }
  return messageId;
}

export type BridgeSessionStatus = "connected" | "qr" | "disconnected" | "connecting" | "unknown";

export interface BridgeStatusResponse {
  status?: BridgeSessionStatus | string;
  state?: string;
  connected?: boolean;
  exists?: boolean;
  qr?: string | null;
  phoneNumber?: string;
  phone?: string;
  name?: string;
}

export interface BridgeQrResponse {
  qr?: string | null;
  qrCode?: string;
  dataUrl?: string;
  connected?: boolean;
  status?: string;
}

export const waBridge = {
  health: () => bridgeFetch<{ status: string; version?: string }>("/api/health"),
  listSessions: () =>
    bridgeFetch<{ sessions?: Array<{ id?: string; connected?: boolean; tenantId?: string; phone?: string; phoneNumber?: string }> }>(
      "/api/sessions",
    ),
  // Bot-Xtra: POST /api/sessions creates a session bound to a tenantId+webhookUrl.
  // For an existing session it returns { status: "already_connected" } and does NOT
  // update webhook/tenant — you must DELETE then recreate to change them.
  createSession: (
    id: string,
    opts: { webhookUrl?: string; tenantId?: string; syncFullHistory?: boolean } = {},
  ) =>
    bridgeFetch<{ id?: string; sessionId?: string; status?: string }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        sessionId: id,
        ...(opts.webhookUrl ? { webhookUrl: opts.webhookUrl, webhook: opts.webhookUrl } : {}),
        ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
        // Opt-in to WhatsApp history sync (Bot-Xtra v1.8+ honors this flag per session).
        // Safe default: true on new/reset sessions only — existing sessions are unaffected
        // because Bot-Xtra returns "already_connected" without re-applying options.
        ...(opts.syncFullHistory === true
          ? {
              syncFullHistory: true,
              syncHistory: true,
              historySync: true,
              fullHistory: true,
              fireInitQueries: true,
              // Extra aliases understood by different Bot-Xtra/Baileys builds.
              // Unknown flags are ignored by the bridge, while supported ones
              // increase the chance that WhatsApp emits the initial history set
              // right after QR pairing instead of new messages only.
              syncHistoryOnConnect: true,
              historySyncOnConnect: true,
              autoSyncHistory: true,
              downloadHistory: true,
              emitHistory: true,
              emitOwnEvents: true,
              shouldSyncHistoryMessage: true,
              historySyncMode: "full",
              historyLimit: 10_000,
            }
          : {}),
      }),
    }),
  requestHistorySync: async (id: string) => {
    const paths = [
      `/api/sessions/${encodeURIComponent(id)}/sync-history`,
      `/api/sessions/${encodeURIComponent(id)}/history/sync`,
      `/api/sessions/${encodeURIComponent(id)}/request-history`,
      `/api/sessions/${encodeURIComponent(id)}/resync`,
    ];
    const attempts: Array<{ path: string; ok: boolean; status?: number; error?: string; importedMessages?: number; importedChats?: number }> = [];
    for (const path of paths) {
      try {
        const body = await bridgeFetch<unknown>(path, {
          method: "POST",
          body: JSON.stringify({
            syncFullHistory: true,
            syncHistory: true,
            historySync: true,
            fullHistory: true,
          }),
        });
        attempts.push({ path, ok: true });
        return { ok: true, attempts, body };
      } catch (err) {
        const status = err instanceof BridgeError ? err.status : undefined;
        const error = err instanceof Error ? err.message : String(err);
        attempts.push({ path, ok: false, status, error });
        if (status && ![404, 405, 501].includes(status)) break;
      }
    }
    return { ok: false, attempts, body: null as unknown };
  },
  fetchChats: async (id: string) => {
    const encoded = encodeURIComponent(id);
    const attempts: Array<{ path: string; ok: boolean; status?: number; error?: string }> = [];
    const candidates: Array<{ method: "GET" | "POST"; path: string; body?: Record<string, unknown> }> = [
      { method: "GET", path: `/api/sessions/${encoded}/chats` },
      { method: "GET", path: `/api/sessions/${encoded}/contacts` },
      { method: "POST", path: `/api/sessions/${encoded}/fetch-chats`, body: { limit: 1000, syncFullHistory: true } },
      { method: "POST", path: `/api/sessions/${encoded}/fetch-contacts`, body: { limit: 1000, syncFullHistory: true } },
      { method: "POST", path: `/api/sessions/${encoded}/chats/sync`, body: { limit: 1000, syncFullHistory: true } },
    ];

    for (const candidate of candidates) {
      try {
        const body = await bridgeFetch<unknown>(candidate.path, {
          method: candidate.method,
          ...(candidate.body ? { body: JSON.stringify(candidate.body) } : {}),
        });
        attempts.push({ path: candidate.path, ok: true });
        return { ok: true, attempts, body };
      } catch (err) {
        const status = err instanceof BridgeError ? err.status : undefined;
        const error = err instanceof Error ? err.message : String(err);
        attempts.push({ path: candidate.path, ok: false, status, error });
        if (status && ![400, 404, 405, 501].includes(status)) break;
      }
    }

    return { ok: false, attempts, body: null as unknown };
  },
  fetchMessages: (
    id: string,
    jid: string,
    limit = 50,
    opts: { anchorMessageId?: string | null; anchorTimestamp?: number | null; fromMe?: boolean | null } = {},
  ) => {
    // Bot-Xtra's /fetch-messages endpoint divides a provided anchorTimestamp
    // by 1000 before passing it to Baileys. Our DB anchors are seconds, so send
    // milliseconds here; otherwise the bridge asks WhatsApp for history around
    // 1970 and returns no older messages.
    const anchorTimestampMs = opts.anchorTimestamp
      ? opts.anchorTimestamp < 1_000_000_000_000
        ? opts.anchorTimestamp * 1000
        : opts.anchorTimestamp
      : null;
    return bridgeFetch<unknown>(
      `/api/sessions/${encodeURIComponent(id)}/fetch-messages`,
      {
        method: "POST",
        body: JSON.stringify({
          jid,
          limit,
          syncFullHistory: true,
          syncHistory: true,
          historySync: true,
          fullHistory: true,
          historySyncMode: "full",
          ...(opts.anchorMessageId ? { anchorMessageId: opts.anchorMessageId } : {}),
          ...(anchorTimestampMs ? { anchorTimestamp: anchorTimestampMs } : {}),
          ...(opts.fromMe != null ? { fromMe: opts.fromMe } : {}),
        }),
      },
    );
  },
  getStatus: (id: string) =>
    bridgeFetch<BridgeStatusResponse>(`/api/sessions/${encodeURIComponent(id)}/status`),
  getQr: (id: string) =>
    bridgeFetch<BridgeQrResponse>(`/api/sessions/${encodeURIComponent(id)}/qr`),
  pairingCode: (id: string, phoneNumber: string) =>
    bridgeFetch<{ code?: string; pairingCode?: string }>(
      `/api/sessions/${encodeURIComponent(id)}/request-pairing-code`,
      { method: "POST", body: JSON.stringify({ phoneNumber }) },
    ),

  deleteSession: (id: string) =>
    bridgeFetch<{ ok?: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  sendText: (id: string, to: string, text: string, opts: { phone?: string | null } = {}) => {
    const explicitPhone = normalizeWhatsappPhone(opts.phone) || "";
    const phone = explicitPhone || normalizeWhatsappPhone(to) || "";
    const jid = to.includes("@") ? to : `${phone}@s.whatsapp.net`;
    const isLid = jid.endsWith("@lid");
    const publicJid = explicitPhone ? `${explicitPhone}@s.whatsapp.net` : null;
    return bridgeFetch<BridgeSendResponse>(
      `/api/sessions/${encodeURIComponent(id)}/send`,
      {
        method: "POST",
        body: JSON.stringify({
          to: jid,
          jid,
          chatId: jid,
          // For modern WhatsApp contacts Bot-Xtra/Baileys may require the LID
          // chat id for routing, while still needing the public phone as PN
          // metadata. Supplying both is backward compatible and prevents sends
          // from staying forever in the bridge queue with only queuedId.
          ...(phone && !isLid ? { phone } : {}),
          ...(isLid && publicJid ? { recipientPn: publicJid, participantPn: publicJid } : {}),
          type: "text",
          text,
          message: text,
          body: text,
          content: text,
          caption: text,
        }),
      },
    );
  },
  sendMedia: (
    id: string,
    to: string,
    mediaUrl: string,
    opts: {
      caption?: string;
      mediaType?: "image" | "video" | "document" | "audio";
      mimeType?: string;
      fileName?: string;
      phone?: string | null;
    } = {},
  ) => {
    const explicitPhone = normalizeWhatsappPhone(opts.phone) || "";
    const phone = explicitPhone || normalizeWhatsappPhone(to) || "";
    const jid = to.includes("@") ? to : `${phone}@s.whatsapp.net`;
    const isLid = jid.endsWith("@lid");
    const publicJid = explicitPhone ? `${explicitPhone}@s.whatsapp.net` : null;
    const mediaType = opts.mediaType ?? "image";
    const caption = opts.caption ?? "";
    // Bot-Xtra/Baileys accept several field shapes for media; supply the common
    // variants so the bridge picks whichever matches its handler.
    return bridgeFetch<BridgeSendResponse>(
      `/api/sessions/${encodeURIComponent(id)}/send`,
      {
        method: "POST",
        body: JSON.stringify({
          to: jid,
          jid,
          chatId: jid,
          ...(phone && !isLid ? { phone } : {}),
          ...(isLid && publicJid ? { recipientPn: publicJid, participantPn: publicJid } : {}),
          type: mediaType,
          mediaType,
          mediaUrl,
          url: mediaUrl,
          [mediaType]: { url: mediaUrl, caption, mimetype: opts.mimeType, fileName: opts.fileName },
          caption,
          text: caption,
          message: caption,
          ...(opts.mimeType ? { mimetype: opts.mimeType, mimeType: opts.mimeType } : {}),
          ...(opts.fileName ? { fileName: opts.fileName, filename: opts.fileName } : {}),
        }),
      },
    );
  },
};

export async function sendMediaWithReconnect(
  id: string,
  to: string,
  mediaUrl: string,
  opts: {
    caption?: string;
    mediaType?: "image" | "video" | "document" | "audio";
    mimeType?: string;
    fileName?: string;
    recipientPhone?: string | null;
  },
): Promise<BridgeSendResponse> {
  return await waBridge.sendMedia(id, to, mediaUrl, {
    caption: opts.caption,
    mediaType: opts.mediaType,
    mimeType: opts.mimeType,
    fileName: opts.fileName,
    phone: opts.recipientPhone,
  });
}


/**
 * Resilient send: on a persistent 401 / disconnected error (session vanished
 * on the bridge), recreate the session with the supplied webhookUrl+tenantId
 * and retry sendText once. Use this instead of waBridge.sendText anywhere a
 * dropped session must auto-recover without user action.
 */
export async function sendTextWithReconnect(
  id: string,
  to: string,
  text: string,
  recover: { webhookUrl?: string; tenantId?: string; recipientPhone?: string | null },
): Promise<BridgeSendResponse> {
  try {
    return await waBridge.sendText(id, to, text, { phone: recover.recipientPhone });
  } catch (err) {
    if (!(err instanceof BridgeError)) throw err;

    // Only consider hard "session-gone" signals. Do NOT delete/recreate the
    // same session id here: Bot-Xtra keeps deleted ids in a short release
    // window, and immediate reuse can create orphan bridge sessions while our
    // DB still points at the dead id. Callers that know the user id reset the
    // DB to a fresh QR session instead.
    const sessionGoneByMessage =
      /session.*(not.?found|closed|logged.?out)/i.test(err.message);
    const maybeGone = err.status === 404 || err.status === 401 || sessionGoneByMessage;
    if (!maybeGone) throw err;

    // Confirm the session is actually dead before recreating.
    let confirmedDead = sessionGoneByMessage || err.status === 404;
    if (!confirmedDead) {
      try {
        const s = await waBridge.getStatus(id);
        const status = inferStatus(s);
        if (status === "connected" || status === "qr" || status === "connecting") {
          // Session is alive on the bridge — original error was transient.
          console.warn(`[wa-bridge] sendText failed but session ${id} is "${status}"; not recreating`);
          throw err;
        }
        confirmedDead = true;
      } catch (statusErr) {
        if (statusErr instanceof BridgeError && (statusErr.status === 404 || /not.?found/i.test(statusErr.message))) {
          confirmedDead = true;
        } else {
          // Can't confirm — fail safe, don't destroy a possibly-healthy session.
          throw err;
        }
      }
    }
    if (confirmedDead) console.warn(`[wa-bridge] session ${id} confirmed dead; fresh QR session required`);
    throw err;
  }
}



/**
 * Infer canonical status from the Bot-Xtra bridge status payload.
 */
export function inferStatus(res: BridgeStatusResponse | null): BridgeSessionStatus {
  if (!res) return "unknown";
  const explicit = String(res.status ?? res.state ?? "").toLowerCase();
  if (explicit) {
    if (explicit === "connected" || explicit === "open" || explicit === "ready") return "connected";
    if (["qr", "scan", "waiting_qr", "qr_required"].includes(explicit)) return "qr";
    if (["connecting", "starting", "pairing"].includes(explicit)) return "connecting";
    if (["disconnected", "closed", "logged_out"].includes(explicit)) return "disconnected";
  }
  if (res.connected === true) return "connected";
  if (res.exists === false) return "disconnected";
  if (res.qr) return "qr";
  return "connecting";
}

export const normalizeStatus = (raw: unknown): BridgeSessionStatus => {
  const s = String(raw ?? "").toLowerCase();
  if (s === "connected" || s === "open" || s === "ready") return "connected";
  if (["qr", "scan", "waiting_qr", "qr_required"].includes(s)) return "qr";
  if (["connecting", "starting", "pairing"].includes(s)) return "connecting";
  if (["disconnected", "closed", "logged_out"].includes(s)) return "disconnected";
  return "unknown";
};

/**
 * Extract a QR Data URL from a bridge QR response.
 */
export async function pickQrDataUrl(res: BridgeQrResponse | null): Promise<string | null> {
  if (!res) return null;
  const raw = res.dataUrl || res.qrCode || res.qr;
  if (!raw) return null;
  if (raw.startsWith("data:image")) return raw;
  if (raw.includes(",") || raw.length < 200) {
    try {
      const QRCode = (await import("qrcode")).default;
      return await QRCode.toDataURL(raw, { errorCorrectionLevel: "M", margin: 1, width: 320 });
    } catch (err) {
      console.warn("[wa] QR render failed:", err);
      return null;
    }
  }
  return `data:image/png;base64,${raw}`;
}
