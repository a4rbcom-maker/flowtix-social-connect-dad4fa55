import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  waSessionsRepository, type WaSession, type WaSessionStatus,
  type WaSessionStats, type TransitionResult,
} from "@/lib/wa-sessions";
import { waLifecycleService, WaSessionTransitionError, WaSessionValidationError } from "@/lib/wa-lifecycle-service";
import { useAuth } from "@/lib/authProvider";

const SESSIONS_KEY = "wa-sessions";
const SESSION_KEY = "wa-session";
const SESSION_EVENTS_KEY = "wa-session-events";
const SESSION_ACTIVITY_KEY = "wa-session-activity";
const SESSION_STATUS_HISTORY_KEY = "wa-session-status-history";
const SESSION_STATS_KEY = "wa-session-stats";
const SESSION_LIFECYCLE_LOGS_KEY = "wa-session-lifecycle-logs";

export function useWaSessions(filters?: { status?: WaSessionStatus }) {
  const { session: authSession } = useAuth();
  const userId = authSession?.user?.id;
  return useQuery({
    queryKey: [SESSIONS_KEY, userId, filters],
    queryFn: () => (userId ? waSessionsRepository.list(userId, filters) : Promise.resolve([] as WaSession[])),
    enabled: !!userId,
  });
}

export function useWaSession(id: string | undefined) {
  return useQuery({
    queryKey: [SESSION_KEY, id],
    queryFn: () => waSessionsRepository.getById(id!),
    enabled: !!id,
  });
}

export function useWaSessionStats() {
  const { session: authSession } = useAuth();
  const userId = authSession?.user?.id;
  return useQuery({
    queryKey: [SESSION_STATS_KEY, userId],
    queryFn: () => (userId
      ? waSessionsRepository.getStats(userId)
      : Promise.resolve({ total: 0, connected: 0, disconnected: 0, expired: 0 } as WaSessionStats)),
    enabled: !!userId,
  });
}

export function useWaSessionEvents(id: string | undefined) {
  return useQuery({ queryKey: [SESSION_EVENTS_KEY, id], queryFn: () => waSessionsRepository.getEvents(id!), enabled: !!id });
}

export function useWaSessionActivity(id: string | undefined) {
  return useQuery({ queryKey: [SESSION_ACTIVITY_KEY, id], queryFn: () => waSessionsRepository.getActivity(id!), enabled: !!id });
}

export function useWaSessionStatusHistory(id: string | undefined) {
  return useQuery({ queryKey: [SESSION_STATUS_HISTORY_KEY, id], queryFn: () => waSessionsRepository.getStatusHistory(id!), enabled: !!id });
}

export function useWaSessionLifecycleLogs(id: string | undefined) {
  return useQuery({ queryKey: [SESSION_LIFECYCLE_LOGS_KEY, id], queryFn: () => waSessionsRepository.getLifecycleLogs(id!), enabled: !!id });
}

export function useWaSessionMutations() {
  const queryClient = useQueryClient();
  const { session: authSession } = useAuth();
  const userId = authSession?.user?.id;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: [SESSIONS_KEY] });
    queryClient.invalidateQueries({ queryKey: [SESSION_STATS_KEY] });
  };
  const invalidateSession = (id: string) => {
    queryClient.invalidateQueries({ queryKey: [SESSION_KEY, id] });
    queryClient.invalidateQueries({ queryKey: [SESSION_EVENTS_KEY, id] });
    queryClient.invalidateQueries({ queryKey: [SESSION_ACTIVITY_KEY, id] });
    queryClient.invalidateQueries({ queryKey: [SESSION_STATUS_HISTORY_KEY, id] });
    queryClient.invalidateQueries({ queryKey: [SESSION_LIFECYCLE_LOGS_KEY, id] });
  };

  const createMutation = useMutation({
    mutationFn: async (input: { name: string; providerType?: "baileys" | "cloud_api" | null; phoneNumber?: string | null }) => {
      if (!userId) throw new Error("Not authenticated");
      return waLifecycleService.createSession({ workspaceId: userId, userId, ...input });
    },
    onSuccess: () => invalidateAll(),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => waSessionsRepository.rename(id, name),
    onSuccess: (_d, v) => { invalidateSession(v.id); invalidateAll(); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!userId) throw new Error("Not authenticated");
      return waLifecycleService.delete(id, userId);
    },
    onSuccess: (_d, id) => { invalidateSession(id); invalidateAll(); },
  });

  const requestQRMutation = useMutation({
    mutationFn: async (id: string) => waLifecycleService.requestQR(id),
    onSuccess: (_d, id) => { invalidateSession(id); invalidateAll(); },
  });

  const connectMutation = useMutation({
    mutationFn: async ({ id, phone, pushName }: { id: string; phone?: string; pushName?: string }) =>
      waLifecycleService.connect(id, phone, pushName),
    onSuccess: (_d, v) => { invalidateSession(v.id); invalidateAll(); },
  });

  const reconnectMutation = useMutation({
    mutationFn: async (id: string) => waLifecycleService.reconnect(id),
    onSuccess: (_d, id) => { invalidateSession(id); invalidateAll(); },
  });

  const disconnectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => waLifecycleService.disconnect(id, reason),
    onSuccess: (_d, v) => { invalidateSession(v.id); invalidateAll(); },
  });

  const pauseMutation = useMutation({
    mutationFn: async (id: string) => waLifecycleService.pause(id),
    onSuccess: (_d, id) => { invalidateSession(id); invalidateAll(); },
  });

  const resumeMutation = useMutation({
    mutationFn: async (id: string) => waLifecycleService.resume(id),
    onSuccess: (_d, id) => { invalidateSession(id); invalidateAll(); },
  });

  const markExpiredMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => waLifecycleService.markExpired(id, reason),
    onSuccess: (_d, v) => { invalidateSession(v.id); invalidateAll(); },
  });

  const markErrorMutation = useMutation({
    mutationFn: async ({ id, message }: { id: string; message: string }) => waLifecycleService.markError(id, message),
    onSuccess: (_d, v) => { invalidateSession(v.id); invalidateAll(); },
  });

  const refreshMutation = useMutation({
    mutationFn: async (id: string) => waLifecycleService.refresh(id),
    onSuccess: (_d, id) => { invalidateSession(id); invalidateAll(); },
  });

  return {
    create: createMutation, rename: renameMutation, delete: deleteMutation,
    requestQR: requestQRMutation, connect: connectMutation, reconnect: reconnectMutation,
    disconnect: disconnectMutation, pause: pauseMutation, resume: resumeMutation,
    markExpired: markExpiredMutation, markError: markErrorMutation, refresh: refreshMutation,
  };
}

export function useActiveWaSessionsForSelect() {
  const { data: sessions, ...rest } = useWaSessions();
  const options = (sessions ?? []).map((s) => ({ value: s.id, label: s.name }));
  return { data: options, ...rest };
}

export { WaSessionValidationError, WaSessionTransitionError };
export type { WaSession, WaSessionStatus, TransitionResult };
