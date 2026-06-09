// Server-only HTTP client for the BotXtra WhatsApp Bridge (v1.8.x).
// Wraps the bridge REST API with X-API-Key auth + typed helpers.
// Never import from client code.

const BRIDGE_TIMEOUT_MS = 15_000;

function getConfig() {
  const url = process.env.WA_BRIDGE_URL;
  const apiKey = process.env.WA_BRIDGE_API_KEY;
  if (!url) throw new Error("WA_BRIDGE_URL is not configured");
  if (!apiKey) throw new Error("WA_BRIDGE_API_KEY is not configured");
  return { url: url.replace(/\/+$/, ""), apiKey };
}

async function bridgeFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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
      throw new BridgeError(msg, res.status, body);
    }
    return body as T;
  } catch (err) {
    if (err instanceof BridgeError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new BridgeError("Bridge request timed out", 504, null);
    }
    throw new BridgeError(err instanceof Error ? err.message : "Bridge network error", 502, null);
  } finally {
    clearTimeout(timer);
  }
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
  // Bot-Xtra: POST /api/sessions creates a session bound to a tenantId+webhookUrl.
  // For an existing session it returns { status: "already_connected" } and does NOT
  // update webhook/tenant — you must DELETE then recreate to change them.
  createSession: (id: string, opts: { webhookUrl?: string; tenantId?: string } = {}) =>
    bridgeFetch<{ id?: string; sessionId?: string; status?: string }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        sessionId: id,
        ...(opts.webhookUrl ? { webhookUrl: opts.webhookUrl, webhook: opts.webhookUrl } : {}),
        ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
      }),
    }),
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
  sendText: (id: string, to: string, text: string) => {
    const phone = to.replace(/[^0-9]/g, "");
    const jid = to.includes("@") ? to : `${phone}@s.whatsapp.net`;
    return bridgeFetch<{ id?: string; ok?: boolean; error?: string; message?: string }>(
      `/api/sessions/${encodeURIComponent(id)}/send`,
      {
        method: "POST",
        body: JSON.stringify({
          to: jid,
          jid,
          phone,
          type: "text",
          text,
          message: text,
          body: text,
        }),
      },
    );
  },
};

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
