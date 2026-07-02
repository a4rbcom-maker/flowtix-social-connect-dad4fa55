// Server-only helpers used by wa.functions.ts. Moved out of the
// .functions.ts file so the tss-serverfn-split transformer can resolve them
// via import rather than as sibling declarations.
import { getRequest } from "@tanstack/react-start/server";
import { waBridge, BridgeError, getWaBridgeConfigStatus } from "./wa-bridge.server";

export const PROJECT_ID = "60cc135f-fba6-4c85-a3db-3604a51301ae";
export const STABLE_PROD_WEBHOOK_URL = `https://project--${PROJECT_ID}.lovable.app/api/public/wa-webhook`;
export const STABLE_PREVIEW_WEBHOOK_URL = `https://project--${PROJECT_ID}-dev.lovable.app/api/public/wa-webhook`;

export interface WaBridgeHealth {
  ok: boolean;
  status: string | null;
  version: string | null;
  latencyMs: number;
  url: string | null;
  hasApiKey: boolean;
  apiKeyName: string | null;
  hasWebhookSecret: boolean;
  error: string | null;
}

function uniqueUrls(urls: Array<string | null | undefined>): string[] {
  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
}

function isPreviewHost(host: string | null): boolean {
  if (!host) return false;
  return (
    host === "localhost:8080" ||
    host.includes("lovableproject.com") ||
    host.includes("id-preview--") ||
    host === `project--${PROJECT_ID}-dev.lovable.app`
  );
}

async function isValidWebhookUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("application/json")) return false;
    const body = (await res.json()) as { endpoint?: string } | null;
    return body?.endpoint === "wa-webhook";
  } catch {
    return false;
  }
}

export async function deriveWebhookUrl(): Promise<string | null> {
  const override = process.env.WA_PUBLIC_WEBHOOK_URL?.replace(/\/+$/, "");

  try {
    const req = getRequest();
    const u = new URL(req.url);
    const host = req.headers.get("x-forwarded-host") || u.host;
    const proto = req.headers.get("x-forwarded-proto") || u.protocol.replace(":", "");
    const currentHostCandidate = host && /\.lovable\.app$/i.test(host)
      ? `${proto}://${host}/api/public/wa-webhook`
      : null;

    const preferredStable = isPreviewHost(host) ? STABLE_PREVIEW_WEBHOOK_URL : STABLE_PROD_WEBHOOK_URL;
    const fallbackStable = isPreviewHost(host) ? STABLE_PROD_WEBHOOK_URL : STABLE_PREVIEW_WEBHOOK_URL;

    for (const candidate of uniqueUrls([override, currentHostCandidate, preferredStable, fallbackStable])) {
      if (await isValidWebhookUrl(candidate)) {
        return candidate;
      }
      console.warn("[wa] webhook candidate rejected:", candidate);
    }
  } catch {
    // fall through to stable defaults below
  }

  for (const fallback of uniqueUrls([override, STABLE_PREVIEW_WEBHOOK_URL, STABLE_PROD_WEBHOOK_URL])) {
    if (await isValidWebhookUrl(fallback)) {
      return fallback;
    }
  }

  return null;
}

export function describeBridgeError(err: unknown): string {
  const sessionGoneMsg =
    "الجلسة غير متصلة على خادم الربط. افتح صفحة WhatsApp واضغط «إعادة الاقتران» ثم امسح رمز QR من جوالك.";
  if (err instanceof BridgeError) {
    const m = String(err.message || "");
    if (err.status === 404 || /session.*(not.?found|closed|logged.?out|gone|expired)|no\s+session/i.test(m))
      return sessionGoneMsg;
    if (err.status === 401 || err.status === 403)
      return "مفتاح خادم الربط غير صحيح (WA_BRIDGE_API_KEY)";
    if (err.status === 502 || err.status === 504)
      return "تعذر الوصول إلى خادم الربط. حاول بعد قليل.";
    return err.message;
  }
  if (err instanceof Error) {
    const m = err.message || "";
    if (/session.*(not.?found|closed|logged.?out|gone|expired)|no\s+session/i.test(m)) return sessionGoneMsg;
    if (m.includes("ENOTFOUND") || m.includes("EAI_AGAIN"))
      return "عنوان خادم الربط غير صالح أو غير قابل للوصول (DNS).";
    if (m.includes("ECONNREFUSED")) return "خادم الربط رفض الاتصال. تأكد أنه يعمل.";
    if (m.includes("timed out")) return "انتهت مهلة الاتصال بخادم الربط.";
    return m;
  }
  return "خطأ غير معروف عند الاتصال بخادم الربط";
}

export async function doPing(): Promise<WaBridgeHealth> {
  const config = getWaBridgeConfigStatus();
  const url = config.url;
  const hasApiKey = config.hasApiKey;
  const hasWebhookSecret = !!process.env.WA_BRIDGE_WEBHOOK_SECRET;
  const started = Date.now();
  console.info("[wa] bridge config:", {
    url,
    hasApiKey,
    apiKeyName: config.apiKeyName,
    hasWebhookSecret,
    usingDefaultUrl: config.usingDefaultUrl,
  });
  try {
    const res = await waBridge.health();
    return {
      ok: true,
      status: res.status ?? "ok",
      version: res.version ?? null,
      latencyMs: Date.now() - started,
      url,
      hasApiKey,
      apiKeyName: config.apiKeyName,
      hasWebhookSecret,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      version: null,
      latencyMs: Date.now() - started,
      url,
      hasApiKey,
      apiKeyName: config.apiKeyName,
      hasWebhookSecret,
      error: describeBridgeError(err),
    };
  }
}
