import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { toast } from "sonner";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Routes that should NOT trigger a "session expired" redirect (they are already public / auth pages).
const PUBLIC_AUTH_PATHS = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/pricing",
  "/terms",
  "/privacy",
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_AUTH_PATHS.has(pathname)) return true;
  // Any /auth/* callback route stays public too.
  return pathname.startsWith("/auth/") || pathname.startsWith("/reset-password");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Track whether we've ever seen an authenticated session in this tab.
  const hadSessionRef = useRef(false);
  // Prevent stacking multiple redirects/toasts when several serverFn calls fail at once.
  const expiredHandledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const finishSessionRestore = (nextSession: Session | null) => {
      if (cancelled) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (nextSession) hadSessionRef.current = true;
      setLoading(false);
    };

    const handleProxySession = (event: Event) => {
      const nextSession = (event as CustomEvent<{ session?: Session | null }>).detail?.session ?? null;
      if (!nextSession) return;
      window.clearTimeout(restoreTimeout);
      clearGuard();
      finishSessionRestore(nextSession);
      expiredHandledRef.current = false;
    };

    // Supabase can occasionally hang while restoring a stale/corrupt session
    // from storage. Never leave protected pages on an endless blank spinner.
    const restoreTimeout = window.setTimeout(() => {
      console.warn("[auth] session restore timed out; continuing as signed out");
      finishSessionRestore(null);
    }, 8_000);

    const handleExpiredSession = (reason: "expired" | "signed_out" | "auth_required" = "expired") => {
      if (typeof window === "undefined") return;
      if (expiredHandledRef.current) return;
      const path = window.location.pathname;
      if (isPublicPath(path)) return;
      expiredHandledRef.current = true;
      try {
        toast.error(
          reason === "signed_out"
            ? "تم تسجيل خروجك، أعد تسجيل الدخول للمتابعة"
            : reason === "auth_required"
              ? "يجب تسجيل الدخول للوصول لهذه الصفحة"
              : "انتهت جلستك، يرجى تسجيل الدخول مرة أخرى",
        );
      } catch {
        /* toast unavailable during SSR — ignore */
      }
      const redirect = encodeURIComponent(path + window.location.search);
      // Use full navigation so router state + query cache reset cleanly.
      window.location.replace(`/login?reason=${reason}&redirect=${redirect}`);
    };

    // Guard: if user lands on a protected route without any session, redirect
    // immediately with a clear reason instead of showing a blank spinner.
    const guardTimeout = window.setTimeout(() => {
      if (cancelled) return;
      if (typeof window === "undefined") return;
      const path = window.location.pathname;
      if (isPublicPath(path)) return;
      // Only trigger if we still have no session after restore completes.
      supabase.auth.getSession().then(({ data }) => {
        if (cancelled) return;
        if (!data.session) handleExpiredSession("auth_required");
      });
    }, 2_500);
    // Cancel the guard as soon as auth resolves (either signed in or handled elsewhere).
    const clearGuard = () => window.clearTimeout(guardTimeout);

    window.addEventListener("flowtix-auth-session", handleProxySession);


    // Subscribe FIRST so we don't miss the initial SIGNED_IN event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      window.clearTimeout(restoreTimeout);
      clearGuard();
      finishSessionRestore(nextSession);

      if (nextSession) {
        expiredHandledRef.current = false;
      }

      // Silent auto-refresh: nothing to do, supabase already updated the session.
      if (event === "TOKEN_REFRESHED") return;

      // Refresh failure or expiration → supabase emits SIGNED_OUT with no session.
      if ((event === "SIGNED_OUT" || event === "USER_UPDATED") && !nextSession && hadSessionRef.current) {
        handleExpiredSession("expired");
      }
    });

    // Then restore any persisted session.
    supabase.auth.getSession().then(({ data: { session: restored }, error }) => {
      window.clearTimeout(restoreTimeout);
      if (error) {
        console.error("[auth] failed to restore session", error);
        void supabase.auth.signOut({ scope: "local" });
        finishSessionRestore(null);
      } else {
        finishSessionRestore(restored);
      }
    }).catch((err) => {
      window.clearTimeout(restoreTimeout);
      console.error("[auth] session restore crashed", err);
      void supabase.auth.signOut({ scope: "local" });
      finishSessionRestore(null);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(restoreTimeout);
      clearGuard();
      window.removeEventListener("flowtix-auth-session", handleProxySession);
      subscription.unsubscribe();
    };
  }, []);


  const signOut = async () => {
    // Manual sign-out shouldn't trigger the "expired" toast.
    expiredHandledRef.current = true;
    hadSessionRef.current = false;
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

