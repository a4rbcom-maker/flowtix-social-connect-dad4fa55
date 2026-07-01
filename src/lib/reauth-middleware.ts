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
      const message = err instanceof Error ? err.message : String(err ?? "");
      const isAuthError = /unauthorized|401|jwt|token/i.test(message);
      if (!isAuthError) throw err;

      // Try to refresh the session once. If it works, retry the call.
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data.session) {
        return await next();
      }

      // Refresh failed → signal SIGNED_OUT so AuthProvider handles the redirect.
      await supabase.auth.signOut({ scope: "local" });
      throw err;
    }
  },
);
