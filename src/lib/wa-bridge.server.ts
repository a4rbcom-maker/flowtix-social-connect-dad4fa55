// Server-only HTTP client for the BotXtra WhatsApp Bridge (v1.7.7+).
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
  phoneNumber?: string;
  phone?: string;
}

export interface BridgeQrResponse {
  qr?: string;
  qrCode?: string;
  dataUrl?: string;
  status?: string;
}

export const waBridge = {
  health: () => bridgeFetch<{ status: string; version?: string }>("/api/health"),
  createSession: (id: string) =>
    bridgeFetch<{ id: string; status?: string }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  getStatus: (id: string) =>
    bridgeFetch<BridgeStatusResponse>(`/api/sessions/${encodeURIComponent(id)}/status`),
  getQr: (id: string) =>
    bridgeFetch<BridgeQrResponse>(`/api/sessions/${encodeURIComponent(id)}/qr`),
  deleteSession: (id: string) =>
    bridgeFetch<{ ok?: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  sendText: (id: string, to: string, text: string) =>
    bridgeFetch<{ id?: string; ok?: boolean }>(
      `/api/sessions/${encodeURIComponent(id)}/send`,
      {
        method: "POST",
        body: JSON.stringify({ to, type: "text", text }),
      },
    ),
};

/** Normalize various bridge status strings to our canonical set. */
export function normalizeStatus(raw: unknown): BridgeSessionStatus {
  const s = String(raw ?? "").toLowerCase();
  if (s === "connected" || s === "open" || s === "ready") return "connected";
  if (s === "qr" || s === "scan" || s === "waiting_qr" || s === "qr_required") return "qr";
  if (s === "connecting" || s === "starting" || s === "pairing") return "connecting";
  if (s === "disconnected" || s === "closed" || s === "logged_out") return "disconnected";
  return "unknown";
}

/** Extract a QR data URL from various possible bridge response shapes. */
export function pickQrDataUrl(res: BridgeQrResponse | null): string | null {
  if (!res) return null;
  const raw = res.dataUrl || res.qrCode || res.qr;
  if (!raw) return null;
  if (raw.startsWith("data:image")) return raw;
  // base64 payload without data URL prefix
  return `data:image/png;base64,${raw}`;
}
