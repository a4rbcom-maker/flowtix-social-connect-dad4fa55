// Unified client-side wrapper for every Facebook server function.
//
// Why this exists: previously each component spelled out
//   const { data: { session } } = await supabase.auth.getSession();
//   fn({ data, headers: { Authorization: `Bearer ${session.access_token}` } } as never);
// which (a) repeated boilerplate, (b) lost the typed return shape behind `as never`,
// (c) had no timeout, and (d) had no consistent retry on a stale session.
//
// `useFacebookApi` returns a single `call` function that:
//   1. ensures a fresh Supabase session is attached as `Authorization: Bearer ...`
//   2. enforces FB_CALL_TIMEOUT_MS via AbortController so the UI never hangs
//   3. on a 401-like failure, refreshes the session ONCE and retries
//   4. classifies errors into a stable, localizable shape
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FB_CALL_TIMEOUT_MS } from "./constants";
import { isExternalServiceSessionError } from "@/lib/reauth-classifier";

export type FbErrorKind =
  | "auth"
  | "network"
  | "timeout"
  | "permission"
  | "expired"
  | "invalid_token"
  | "app_rate_limited"
  | "rate_limited"
  | "unknown";

export class FbCallError extends Error {
  readonly kind: FbErrorKind;
  readonly status: number | null;
  constructor(message: string, kind: FbErrorKind, status: number | null = null) {
    super(message);
    this.name = "FbCallError";
    this.kind = kind;
    this.status = status;
  }
}

function classify(message: string, status: number | null): FbErrorKind {
  const m = message.toLowerCase();
  if (isExternalServiceSessionError(message)) return "expired";
  if (status === 401 || m.includes("unauthorized")) return "auth";
  if (m.includes("aborted") || m.includes("timeout")) return "timeout";
  if (m.includes("expired")) return "expired";
  if (m.includes("invalid") && m.includes("token")) return "invalid_token";
  if (m.includes("oauth") || m.includes("190")) return "invalid_token";
  if (m.includes("application request limit") || m.includes("(#4)")) return "app_rate_limited";
  if (m.includes("permission") || m.includes("scope")) return "permission";
  if (m.includes("rate") || m.includes("limit")) return "rate_limited";
  if (m.includes("fetch") || m.includes("network") || m.includes("failed to fetch"))
    return "network";
  return "unknown";
}

async function getBearer(forceRefresh = false): Promise<string> {
  if (forceRefresh) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) {
      throw new FbCallError("session_expired", "auth", 401);
    }
    return data.session.access_token;
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new FbCallError("session_expired", "auth", 401);
  return data.session.access_token;
}

type ServerFn<TInput, TOutput> = (opts: {
  data?: TInput;
  headers?: HeadersInit;
  signal?: AbortSignal;
}) => Promise<TOutput>;

export function useFacebookApi() {
  const call = useCallback(
    async <TInput, TOutput>(fn: ServerFn<TInput, TOutput>, input?: TInput): Promise<TOutput> => {
      const invoke = async (token: string): Promise<TOutput> => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), FB_CALL_TIMEOUT_MS);
        try {
          const out = await fn({
            data: input,
            headers: { Authorization: `Bearer ${token}` },
            signal: ctrl.signal,
          });
          return out;
        } finally {
          clearTimeout(t);
        }
      };

      try {
        const token = await getBearer(false);
        return await invoke(token);
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const status =
          (err as { status?: number; httpStatus?: number })?.status ??
          (err as { httpStatus?: number })?.httpStatus ??
          null;
        const kind = classify(raw, status);

        // Single retry on auth failure with a freshly-refreshed session.
        if (kind === "auth") {
          try {
            const fresh = await getBearer(true);
            return await invoke(fresh);
          } catch (retryErr) {
            const retryRaw = retryErr instanceof Error ? retryErr.message : String(retryErr);
            throw new FbCallError(retryRaw, "auth", 401);
          }
        }

        if (err instanceof FbCallError) throw err;
        throw new FbCallError(raw, kind, status);
      }
    },
    [],
  );

  return { call };
}

/**
 * Translate FbCallError into a user-friendly bilingual message.
 * Keep messages short, actionable, and self-contained.
 */
export function describeFbError(err: unknown, lang: "ar" | "en"): string {
  const e =
    err instanceof FbCallError
      ? err
      : new FbCallError(err instanceof Error ? err.message : String(err), "unknown");
  const ar = {
    auth: "انتهت الجلسة. أعد تسجيل الدخول.",
    network: "تعذّر الاتصال بالخادم. تحقّق من الإنترنت.",
    timeout: "استغرقت العملية وقتاً طويلاً. حاول مرة أخرى.",
    permission: "صلاحيات ناقصة في توكن فيسبوك. أعد التوليد بكل الصلاحيات.",
    expired: "انتهت صلاحية التوكن. أنشئ توكن جديد من Graph Explorer.",
    invalid_token: "التوكن غير صالح أو تم إبطاله.",
    app_rate_limited:
      "تطبيق فيسبوك وصل حد الاستدعاءات اليومي. انتظر حتى يُعاد ضبط الحد أو ارفع الحد من إعدادات Meta.",
    rate_limited: "تم تجاوز حد طلبات فيسبوك. حاول بعد قليل.",
    unknown: e.message || "حدث خطأ غير متوقع.",
  } as const;
  const en = {
    auth: "Session expired. Please sign in again.",
    network: "Couldn't reach the server. Check your internet.",
    timeout: "The request took too long. Please try again.",
    permission: "Missing permissions in your Facebook token. Re-generate with all required scopes.",
    expired: "Token has expired. Create a new one from Graph Explorer.",
    invalid_token: "Token is invalid or was revoked.",
    app_rate_limited:
      "The Facebook app reached its daily request limit. Wait for the limit to reset or increase it in Meta settings.",
    rate_limited: "Facebook rate limit hit. Try again shortly.",
    unknown: e.message || "Something went wrong.",
  } as const;
  return (lang === "ar" ? ar : en)[e.kind];
}
