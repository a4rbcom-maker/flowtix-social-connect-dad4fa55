import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/authProvider";
import { supabase } from "@/lib/supabase";

const IG_SESSIONS_KEY = "ig-sessions";

export interface IgSession {
  id: string;
  user_id: string;
  name: string;
  status: string;
  ig_username: string | null;
  ig_user_id: string | null;
  avatar_url: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function useIgSessions() {
  const { session: authSession } = useAuth();
  const userId = authSession?.user?.id;

  return useQuery({
    queryKey: [IG_SESSIONS_KEY, userId],
    queryFn: async () => {
      if (!userId) return [] as IgSession[];
      const { data, error } = await supabase
        .from("ig_sessions" as any)
        .select("*")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any as IgSession[];
    },
    enabled: !!userId,
  });
}

export function useIgSessionMutations() {
  const queryClient = useQueryClient();

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: [IG_SESSIONS_KEY] });
  }

  const importMutation = useMutation({
    mutationFn: async (input: { user_id: string; name: string; cookies: unknown[] }) => {
      const apiUrl = import.meta.env.VITE_EXTRACTION_API_URL || "http://localhost:3100";
      const apiKey = import.meta.env.VITE_EXTRACTION_API_KEY || "";
      const res = await fetch(`${apiUrl}/ig/sessions/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
        throw new Error(err?.error?.message || "Import failed");
      }
      return res.json() as Promise<{ session_id: string; status: string; ig_username: string | null }>;
    },
    onSuccess: () => { invalidateAll(); },
  });

  const checkMutation = useMutation({
    mutationFn: async (id: string) => {
      const apiUrl = import.meta.env.VITE_EXTRACTION_API_URL || "http://localhost:3100";
      const apiKey = import.meta.env.VITE_EXTRACTION_API_KEY || "";
      const res = await fetch(`${apiUrl}/ig/session-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ session_id: id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
        throw new Error(err?.error?.message || "Check failed");
      }
      return res.json() as Promise<{ session_id: string; status: string; auth_state: string; ig_username: string | null; avatar_url: string | null }>;
    },
    onSuccess: () => { invalidateAll(); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("soft_delete_ig_session", { p_session_id: id });
      if (error) throw error;
    },
    onSuccess: () => { invalidateAll(); },
    onSettled: () => { invalidateAll(); },
  });

  return {
    import: importMutation,
    check: checkMutation,
    delete: deleteMutation,
  };
}
