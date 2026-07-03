import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { toast } from "sonner";
import { clearImpersonationBackup, readImpersonationBackup } from "@/lib/impersonation";

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

type RedirectReason = "expired" | "signed_out" | "auth_required";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState<RedirectReason | null>(null);
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

      // Dedupe across redirects/reloads: only show one toast per reason
      // within a short window so the user never sees the same notice twice.
      let shouldToast = true;
      try {
        const key = "auth:lastReason";
        const now = Date.now();
        const raw = window.sessionStorage.getItem(key);
        if (raw) {
          const prev = JSON.parse(raw) as { reason?: string; at?: number };
          if (prev?.reason === reason && typeof prev.at === "number" && now - prev.at < 10_000) {
            shouldToast = false;
          }
        }
        window.sessionStorage.setItem(key, JSON.stringify({ reason, at: now }));
      } catch {
        /* sessionStorage unavailable — fall through and toast once */
      }

      if (shouldToast) {
        try {
          toast.error(
            reason === "signed_out"
              ? "تم تسجيل خروجك، أعد تسجيل الدخول للمتابعة"
              : reason === "auth_required"
                ? "يجب تسجيل الدخول للوصول لهذه الصفحة"
                : "انتهت جلستك، يرجى تسجيل الدخول مرة أخرى",
            { id: `auth-reason-${reason}` },
          );
        } catch {
          /* toast unavailable during SSR — ignore */
        }
      }

      const redirect = encodeURIComponent(path + window.location.search);
      // Show an overlay so the user never sees a blank screen during navigation.
      setRedirecting(reason);
      // Small delay lets React paint the overlay before the hard navigation.
      window.setTimeout(() => {
        window.location.replace(`/login?reason=${reason}&redirect=${redirect}`);
      }, 30);
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

    // If an admin is currently impersonating another user, "logout" should
    // restore the admin's original session and return them to /admin/users,
    // NOT sign everyone out and dump them on /login?reason=expired.
    const backup = readImpersonationBackup();
    if (backup) {
      try {
        await supabase.auth.signOut({ scope: "local" });
        const { error } = await supabase.auth.setSession({
          access_token: backup.access_token,
          refresh_token: backup.refresh_token,
        });
        clearImpersonationBackup();
        if (!error) {
          toast.success("تم الرجوع لحساب الأدمن");
          window.location.href = "/admin/users";
          return;
        }
        // Backup tokens are expired/invalid — fall through to a normal signout.
        toast.error("انتهت جلسة الأدمن الأصلية، يرجى تسجيل الدخول مجدداً");
      } catch {
        clearImpersonationBackup();
      }
    } else {
      clearImpersonationBackup();
    }

    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
      {redirecting && <AuthRedirectOverlay reason={redirecting} />}
    </AuthContext.Provider>
  );
}

function AuthRedirectOverlay({ reason }: { reason: RedirectReason }) {
  const title =
    reason === "signed_out"
      ? "جارٍ تسجيل خروجك…"
      : reason === "auth_required"
        ? "يلزم تسجيل الدخول"
        : "انتهت جلستك";
  const subtitle =
    reason === "signed_out"
      ? "نُحوّلك لصفحة تسجيل الدخول الآن"
      : reason === "auth_required"
        ? "نُحوّلك لصفحة تسجيل الدخول للمتابعة"
        : "نُحوّلك لتسجيل الدخول مرة أخرى";
  return (
    <div
      dir="rtl"
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/85 backdrop-blur-md"
    >
      <div className="w-[92%] max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
          </span>
          <div className="text-sm font-bold text-foreground">{title}</div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{subtitle}</p>
        <div className="mt-5 space-y-2">
          <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
        <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-[loading_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
        </div>
      </div>
      <style>{`@keyframes loading { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }`}</style>
    </div>
  );
}


export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

