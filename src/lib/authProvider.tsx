import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import {
  type AuthState,
  type RoleKey,
  fetchProfile,
  fetchUserRole,
  getHomeRoute,
} from "@/lib/auth";

interface AuthContextValue extends AuthState {
  role: RoleKey;
  refreshProfile: () => Promise<void>;
  homeRoute: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    profile: null,
    role: "user",
    loading: true,
  });

  const refreshProfile = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setState({ session: null, profile: null, role: "user", loading: false });
        return;
      }
      const profile = await fetchProfile(session.user.id);
      const role = await fetchUserRole(session.user.id, (profile as any)?.workspace_id ?? null);
      setState({ session, profile, role, loading: false });
    } catch (err) {
      console.error("[AuthProvider] refreshProfile error:", err);
      setState({ session: null, profile: null, role: "user", loading: false });
    }
  }, []);

  useEffect(() => {
    refreshProfile();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        try {
          if (!session?.user) {
            setState({ session: null, profile: null, role: "user", loading: false });
            return;
          }
          const profile = await fetchProfile(session.user.id);
          const role = await fetchUserRole(session.user.id, (profile as any)?.workspace_id ?? null);
          setState({ session, profile, role, loading: false });
        } catch (err) {
          console.error("[AuthProvider] onAuthStateChange error:", err);
          setState({ session: null, profile: null, role: "user", loading: false });
        }
      },
    );

    return () => subscription.unsubscribe();
  }, [refreshProfile]);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        role: state.role,
        refreshProfile,
        homeRoute: getHomeRoute(state.role),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
