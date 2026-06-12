import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

/**
 * Checks whether the current user has the 'admin' role.
 * Queries `user_roles` directly from the browser — the RLS policy
 * "Users can view own roles" (auth.uid() = user_id) allows this, so we
 * don't depend on a server-function round trip during the login redirect.
 */
export function useIsAdmin() {
  const { user, loading: authLoading } = useAuth();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["is-admin", user?.id ?? "anon"],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "admin")
        .maybeSingle();
      if (error) {
        console.error("[useIsAdmin] failed to read user_roles", error);
        return { isAdmin: false };
      }
      return { isAdmin: !!data };
    },
  });
  return {
    isAdmin: !!data?.isAdmin,
    isLoading: authLoading || (!!user && (isLoading || (data === undefined && isFetching))),
  };
}
