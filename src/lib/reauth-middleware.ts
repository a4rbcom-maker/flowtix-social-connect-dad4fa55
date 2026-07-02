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
  async ({ next }) => {
    try {
      return await next();
    } catch (err: unknown) {
      const status =
        err instanceof Response
          ? err.status
          : (err as { status?: number; statusCode?: number })?.status ??
            (err as { statusCode?: number })?.statusCode;
      const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
      const isAuthError =
        status === 401 ||
        status === 403 ||
        /unauthorized|401|jwt|invalid.*token|token.*expired/i.test(message);
      if (!isAuthError) throw err;

      // Try to refresh the session once. If it works, retry the call.
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data.session) {
        try {
          return await next();
        } catch (retryErr) {
          err = retryErr;
        }
      }

      // Refresh failed → sign out locally and redirect to /login (prevents blank screen).
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        const current = window.location.pathname + window.location.search;
        window.location.replace(`/login?reason=expired&redirect=${encodeURIComponent(current)}`);
      }
      throw err;
    }
  },
);
