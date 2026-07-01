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
    const handleExpiredSession = () => {
      if (typeof window === "undefined") return;
      if (expiredHandledRef.current) return;
      const path = window.location.pathname;
      if (isPublicPath(path)) return;
      expiredHandledRef.current = true;
      try {
        toast.error("انتهت جلستك، يرجى تسجيل الدخول مرة أخرى");
      } catch {
        /* toast unavailable during SSR — ignore */
      }
      const redirect = encodeURIComponent(path + window.location.search);
      // Use full navigation so router state + query cache reset cleanly.
      window.location.replace(`/login?reason=expired&redirect=${redirect}`);
    };

    // Subscribe FIRST so we don't miss the initial SIGNED_IN event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);

      if (nextSession) {
        hadSessionRef.current = true;
        expiredHandledRef.current = false;
      }

      // Silent auto-refresh: nothing to do, supabase already updated the session.
      if (event === "TOKEN_REFRESHED") return;

      // Refresh failure or expiration → supabase emits SIGNED_OUT with no session.
      if ((event === "SIGNED_OUT" || event === "USER_UPDATED") && !nextSession && hadSessionRef.current) {
        handleExpiredSession();
      }
    });

    // Then restore any persisted session.
    supabase.auth.getSession().then(({ data: { session: restored }, error }) => {
      if (error) {
        console.error("[auth] failed to restore session", error);
        void supabase.auth.signOut({ scope: "local" });
        setSession(null);
        setUser(null);
      } else {
        setSession(restored);
        setUser(restored?.user ?? null);
        if (restored) hadSessionRef.current = true;
      }
      setLoading(false);
    }).catch((err) => {
      console.error("[auth] session restore crashed", err);
      void supabase.auth.signOut({ scope: "local" });
      setSession(null);
      setUser(null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
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

