import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import {
  sessionsRepository,
  type FbSession,
  type FbSessionStatus,
  type SessionStats,
  type TransitionResult,
} from "@/lib/fb-sessions";
import {
  sessionLifecycleService,
  SessionTransitionError,
  SessionValidationError,
} from "@/lib/session-lifecycle-service";
import { useAuth } from "@/lib/authProvider";

const SESSIONS_KEY = "fb-sessions";
const SESSION_KEY = "fb-session";
const SESSION_EVENTS_KEY = "fb-session-events";
const SESSION_ACTIVITY_KEY = "fb-session-activity";
const SESSION_STATUS_HISTORY_KEY = "fb-session-status-history";
const SESSION_STATS_KEY = "fb-session-stats";
const SESSION_LIFECYCLE_LOGS_KEY = "fb-session-lifecycle-logs";

export function useSessions(filters?: { status?: FbSessionStatus }) {
  const { session: authSession } = useAuth();
  const userId = authSession?.user?.id;

  return useQuery({
    queryKey: [SESSIONS_KEY, userId, filters],
    queryFn: () => {
      if (!userId) return [] as FbSession[];
      return sessionsRepository.list(userId, filters);
    },
    enabled: !!userId,
  });
}

export function useSession(id: string | undefined) {
  return useQuery({
    queryKey: [SESSION_KEY, id],
    queryFn: () => sessionsRepository.getById(id!),
    enabled: !!id,
  });
}

export function useSessionStats() {
  const { session: authSession } = useAuth();
  const userId = authSession?.user?.id;

  return useQuery({
    queryKey: [SESSION_STATS_KEY, userId],
    queryFn: () => {
      if (!userId) return { total: 0, connected: 0, disconnected: 0, expired: 0 } as SessionStats;
      return sessionsRepository.getStats(userId);
    },
    enabled: !!userId,
  });
}

export function useSessionEvents(id: string | undefined) {
  return useQuery({
    queryKey: [SESSION_EVENTS_KEY, id],
    queryFn: () => sessionsRepository.getEvents(id!),
    enabled: !!id,
  });
}

export function useSessionActivity(id: string | undefined) {
  return useQuery({
    queryKey: [SESSION_ACTIVITY_KEY, id],
    queryFn: () => sessionsRepository.getActivity(id!),
    enabled: !!id,
  });
}

export function useSessionStatusHistory(id: string | undefined) {
  return useQuery({
    queryKey: [SESSION_STATUS_HISTORY_KEY, id],
    queryFn: () => sessionsRepository.getStatusHistory(id!),
    enabled: !!id,
  });
}

export function useSessionLifecycleLogs(id: string | undefined) {
  return useQuery({
    queryKey: [SESSION_LIFECYCLE_LOGS_KEY, id],
    queryFn: () => sessionsRepository.getLifecycleLogs(id!),
    enabled: !!id,
  });
}

export function useSessionMutations() {
  const queryClient = useQueryClient();
  const { session: authSession } = useAuth();
  const userId = authSession?.user?.id;

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: [SESSIONS_KEY] });
    queryClient.invalidateQueries({ queryKey: [SESSION_STATS_KEY] });
  }

  function invalidateSession(id: string) {
    queryClient.invalidateQueries({ queryKey: [SESSION_KEY, id] });
    queryClient.invalidateQueries({ queryKey: [SESSION_EVENTS_KEY, id] });
    queryClient.invalidateQueries({ queryKey: [SESSION_ACTIVITY_KEY, id] });
    queryClient.invalidateQueries({ queryKey: [SESSION_STATUS_HISTORY_KEY, id] });
    queryClient.invalidateQueries({ queryKey: [SESSION_LIFECYCLE_LOGS_KEY, id] });
  }

  const createMutation = useMutation({
    mutationFn: async (input: {
      name: string;
      browser?: string | null;
      connectionMethod?: string | null;
      cookies?: string;
      proxyUrl?: string | null;
    }) => {
      if (!userId) throw new Error("Not authenticated");
      return sessionLifecycleService.createSession({
        userId,
        name: input.name,
        browser: input.browser,
        connectionMethod: input.connectionMethod,
        cookies: input.cookies,
        proxyUrl: input.proxyUrl,
      });
    },
    onSuccess: () => {
      invalidateAll();
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      return sessionsRepository.rename(id, name);
    },
    onSuccess: (_data, variables) => {
      invalidateSession(variables.id);
      invalidateAll();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!userId) throw new Error("Not authenticated");
      return sessionLifecycleService.delete(id);
    },
    onSuccess: (_data, id) => {
      invalidateSession(id);
      invalidateAll();
    },
    // Always invalidate — even if mutationFn throws (e.g. logging RPC fails
    // after the soft-delete UPDATE succeeded), the session IS deleted in the DB
    // and the list should refetch to reflect the new state.
    onSettled: () => {
      invalidateAll();
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (id: string) => {
      return sessionsRepository.duplicate(id);
    },
    onSuccess: () => {
      invalidateAll();
    },
  });

  const connectMutation = useMutation({
    mutationFn: async (id: string) => {
      return sessionLifecycleService.connect(id);
    },
    onSuccess: (_data, id) => {
      invalidateSession(id);
      invalidateAll();
    },
  });

  const reconnectMutation = useMutation({
    mutationFn: async (id: string) => {
      return sessionLifecycleService.reconnect(id);
    },
    onSuccess: (_data, id) => {
      invalidateSession(id);
      invalidateAll();
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      return sessionLifecycleService.disconnect(id, reason);
    },
    onSuccess: (_data, variables) => {
      invalidateSession(variables.id);
      invalidateAll();
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async (id: string) => {
      return sessionLifecycleService.pause(id);
    },
    onSuccess: (_data, id) => {
      invalidateSession(id);
      invalidateAll();
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async (id: string) => {
      return sessionLifecycleService.resume(id);
    },
    onSuccess: (_data, id) => {
      invalidateSession(id);
      invalidateAll();
    },
  });

  const markExpiredMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      return sessionLifecycleService.markExpired(id, reason);
    },
    onSuccess: (_data, variables) => {
      invalidateSession(variables.id);
      invalidateAll();
    },
  });

  const markErrorMutation = useMutation({
    mutationFn: async ({ id, message }: { id: string; message: string }) => {
      return sessionLifecycleService.markError(id, message);
    },
    onSuccess: (_data, variables) => {
      invalidateSession(variables.id);
      invalidateAll();
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async (id: string) => {
      return sessionLifecycleService.refresh(id);
    },
    onSuccess: (_data, id) => {
      invalidateSession(id);
      invalidateAll();
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async (id: string) => {
      // Use extraction service's /session-check endpoint which actually
      // navigates to Facebook and checks auth state (not just cookie expiry)
      const apiUrl = import.meta.env.VITE_EXTRACTION_API_URL || "http://localhost:3100";
      const apiKey = import.meta.env.VITE_EXTRACTION_API_KEY || "";
      const res = await fetch(`${apiUrl}/session-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ session_id: id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
        throw new Error(err?.error?.message || `Session check failed`);
      }
      const r = await res.json();
      return {
        session_id: r.session_id,
        status: r.status,
        auth_state: r.auth_state,
        message: r.message,
        fb_user_id: r.fb_user_id,
      } as { session_id: string; status: string; auth_state: string; message: string; fb_user_id?: string };
    },
    onSuccess: (_data, id) => {
      invalidateSession(id);
      invalidateAll();
    },
  });

  return {
    create: createMutation,
    rename: renameMutation,
    delete: deleteMutation,
    duplicate: duplicateMutation,
    connect: connectMutation,
    reconnect: reconnectMutation,
    disconnect: disconnectMutation,
    pause: pauseMutation,
    resume: resumeMutation,
    markExpired: markExpiredMutation,
    markError: markErrorMutation,
    refresh: refreshMutation,
    testConnection: testConnectionMutation,
  };
}

export function useActiveSessionsForSelect() {
  const { data: sessions, ...rest } = useSessions();

  const options = (sessions ?? []).map((s) => ({
    value: s.id,
    label: s.name,
  }));

  return { data: options, ...rest };
}

export { SessionValidationError, SessionTransitionError };
export type { FbSessionStatus, TransitionResult };
