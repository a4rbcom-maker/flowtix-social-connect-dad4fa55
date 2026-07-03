import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

/**
 * Client-side middleware for server-function calls.
 *
 * Runs AFTER `attachSupabaseAuth` and catches Unauthorized responses caused by
 * an expired / revoked Supabase access token. On the first 401 we attempt a
 * one-shot `refreshSession()` and retry silently. If the refresh itself fails
 * we sign the user out locally so the global `onAuthStateChange` listener in
 * `AuthProvider` can redirect to `/login?reason=expired` with a friendly
 * toast — instead of surfacing a raw "حدث خطأ غير متوقع" to the user.
 */
export const reauthOnExpiredSession = createMiddleware({ type: "function" }).client(
  async ({ next, fetch }) => {
    const getStatus = (err: unknown) =>
      err instanceof Response
        ? err.status
        : (err as { status?: number; statusCode?: number } | null)?.status ??
          (err as { statusCode?: number } | null)?.statusCode;

    const AUTH_ERROR_MESSAGE = /unauthorized|401|jwt|invalid.*token|token.*expired|session.*expired|انتهت.*الجلسة/i;

    const isAuthError = (err: unknown) => {
      const status = getStatus(err);
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
      if (status === 401) return true;
      // 403 can also be CSRF / permissions / edge protection. Treat it as an
      // auth-expired signal only when the message explicitly says token/session.
      if (status === 403) return AUTH_ERROR_MESSAGE.test(message);
      return AUTH_ERROR_MESSAGE.test(message);
    };

    const responseToError = async (response: Response) => {
      const body = await response.clone().text().catch(() => "");
      const contentType = response.headers.get("content-type") ?? "";
      const readableBody = contentType.includes("text/html") ? "" : body.trim();
      const normalized = new Error(
        readableBody || `REQUEST_FAILED: تعذر تنفيذ الطلب (${response.status})`,
      );
      (normalized as { status?: number }).status = response.status;
      (normalized as { cause?: unknown }).cause = response;
      return normalized;
    };

    const redirectToLogin = async (cause: unknown): Promise<never> => {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      const alreadyOnLogin =
        typeof window !== "undefined" && window.location.pathname.startsWith("/login");

      if (!alreadyOnLogin && typeof window !== "undefined") {
        const current = window.location.pathname + window.location.search;
        window.location.replace(`/login?reason=expired&redirect=${encodeURIComponent(current)}`);
      }

      // Whether we're already on /login or a hard navigation to /login is in
      // flight, we've committed to leaving the current page. Any pending
      // server-fn caller must NOT see a rejection — otherwise React Query /
      // route errorComponent surfaces "SESSION_EXPIRED" as a blank screen or
      // scary error toast right before the redirect paints. Silently abandon
      // the call by returning a never-resolving promise; the imminent hard
      // navigation tears down the whole JS context.
      void cause;
      return new Promise<never>(() => {});
    };


    let refreshAttempted = false;
    const baseFetch = fetch ?? globalThis.fetch.bind(globalThis);
    const fetchWithReauth: typeof fetch = async (input, init = {}) => {
      const response = await baseFetch(input, init);
      if (response.status !== 401 && response.status !== 403) return response;

      if (!refreshAttempted) {
        refreshAttempted = true;
        const { data, error } = await supabase.auth.refreshSession();
        const token = data.session?.access_token;

        if (!error && token) {
          const headers = new Headers(init.headers);
          headers.set("Authorization", `Bearer ${token}`);
          const retryResponse = await baseFetch(input, { ...init, headers });
          if (retryResponse.status !== 401 && retryResponse.status !== 403) {
            return retryResponse;
          }
          return redirectToLogin(retryResponse);
        }
      }

      return redirectToLogin(response);
    };

    try {
      const result = await next({ fetch: fetchWithReauth });
      const middlewareResult = result as { error?: unknown; result?: unknown };
      if (isAuthError(middlewareResult.error)) throw middlewareResult.error;
      if (isAuthError(middlewareResult.result)) return redirectToLogin(middlewareResult.result);
      if (middlewareResult.error instanceof Response) throw await responseToError(middlewareResult.error);
      if (middlewareResult.result instanceof Response) throw await responseToError(middlewareResult.result);
      return result;
    } catch (err: unknown) {
      if (isAuthError(err)) return redirectToLogin(err);
      if (err instanceof Response) throw await responseToError(err);
      throw err;
    }
  },
);
