import type { Database, Json } from "./database.types";

export type FbSessionStatus = Database["public"]["Enums"]["fb_session_status"];
export type FbSessionEventType = Database["public"]["Enums"]["fb_session_event_type"];
export type SessionHealth = Database["public"]["Enums"]["session_health"];
export type ConnectionAttemptResult = Database["public"]["Enums"]["connection_attempt_result"];

export type FbSession = Database["public"]["Tables"]["fb_sessions"]["Row"];
export type FbSessionInsert = Database["public"]["Tables"]["fb_sessions"]["Insert"];
export type FbSessionUpdate = Database["public"]["Tables"]["fb_sessions"]["Update"];

export type FbSessionEvent = Database["public"]["Tables"]["fb_session_events"]["Row"];
export type FbSessionActivity = Database["public"]["Tables"]["fb_session_activity"]["Row"];
export type FbSessionStatusHistory = Database["public"]["Tables"]["fb_session_status_history"]["Row"];
export type FbBrowserProfile = Database["public"]["Tables"]["fb_browser_profiles"]["Row"];
export type FbBrowserProfileInsert = Database["public"]["Tables"]["fb_browser_profiles"]["Insert"];
export type FbBrowserProfileUpdate = Database["public"]["Tables"]["fb_browser_profiles"]["Update"];
export type FbConnectionAttempt = Database["public"]["Tables"]["fb_connection_attempts"]["Row"];
export type SessionLifecycleLog = Database["public"]["Tables"]["session_lifecycle_logs"]["Row"];

export interface SessionWithStats extends FbSession {
  events_count?: number;
  activities_count?: number;
}

export interface SessionHealthSummary {
  total: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  unknown: number;
  connected: number;
  expired: number;
  error: number;
  avg_failure_rate: number;
}

export interface SessionValidationResult {
  session_id: string;
  health: SessionHealth;
  is_expired: boolean;
  is_auth_failure: boolean;
  issues: string[];
  failure_counter: number;
  max_retries: number;
  validated_at: string;
}

export interface SessionStats {
  total: number;
  connected: number;
  disconnected: number;
  expired: number;
}

export interface TransitionResult {
  success: boolean;
  error: string | null;
  message: string;
  old_status: FbSessionStatus | null;
  new_status: FbSessionStatus | null;
}

export const VALID_TRANSITIONS: Record<FbSessionStatus, FbSessionStatus[]> = {
  disconnected: ["connecting"],
  connecting: ["connected", "error", "disconnected"],
  connected: ["disconnected", "paused", "expired", "error"],
  paused: ["connected", "disconnected", "expired"],
  expired: ["reconnecting", "disconnected"],
  error: ["reconnecting", "disconnected"],
  reconnecting: ["connected", "error", "disconnected"],
};

export function isValidTransition(from: FbSessionStatus, to: FbSessionStatus): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAvailableTransitions(current: FbSessionStatus): FbSessionStatus[] {
  return VALID_TRANSITIONS[current] ?? [];
}

export type { Database, Json };
export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
