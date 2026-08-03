import type { Database, Json } from "./database.types";

// ===== Enums (من TASK 2) =====
export type WaSessionStatus = Database["public"]["Enums"]["wa_session_status"];
export type WaProviderType = Database["public"]["Enums"]["wa_provider_type"];
export type SessionHealth = Database["public"]["Enums"]["session_health"];
export type ConnectionAttemptResult = Database["public"]["Enums"]["connection_attempt_result"];

// ===== Table rows =====
export type WaSession = Database["public"]["Tables"]["wa_sessions"]["Row"];
export type WaSessionInsert = Database["public"]["Tables"]["wa_sessions"]["Insert"];
export type WaSessionUpdate = Database["public"]["Tables"]["wa_sessions"]["Update"];

export type WaSessionEvent = Database["public"]["Tables"]["wa_session_events"]["Row"];
export type WaSessionActivity = Database["public"]["Tables"]["wa_session_activity"]["Row"];
export type WaSessionStatusHistory = Database["public"]["Tables"]["wa_session_status_history"]["Row"];
export type WaConnectionAttempt = Database["public"]["Tables"]["wa_connection_attempts"]["Row"];
export type WaSessionLifecycleLog = Database["public"]["Tables"]["wa_session_lifecycle_logs"]["Row"];

// ===== Composite / app types =====
export interface WaSessionWithStats extends WaSession {
  events_count?: number;
  activities_count?: number;
}

export interface WaSessionStats {
  total: number;
  connected: number;
  disconnected: number;
  expired: number;
}

export interface TransitionResult {
  success: boolean;
  error: string | null;
  message: string;
  old_status: WaSessionStatus | null;
  new_status: WaSessionStatus | null;
}

// ===== State machine (يطابق جدول wa_session_transitions من TASK 2) =====
export const VALID_TRANSITIONS: Record<WaSessionStatus, WaSessionStatus[]> = {
  disconnected:   ["qr_ready", "connecting", "connected", "error"],
  qr_ready:       ["authenticating", "connecting", "expired", "error", "disconnected"],
  authenticating: ["connecting", "connected", "qr_ready", "error"],
  connecting:     ["connected", "error", "disconnected"],
  connected:      ["reconnecting", "paused", "disconnected", "expired", "error", "qr_ready"],
  reconnecting:   ["connected", "disconnected", "error"],
  paused:         ["connected", "disconnected"],
  expired:        ["qr_ready", "disconnected"],
  error:          ["disconnected"],
};

export function isValidTransition(from: WaSessionStatus, to: WaSessionStatus): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAvailableTransitions(current: WaSessionStatus): WaSessionStatus[] {
  return VALID_TRANSITIONS[current] ?? [];
}

export type { Database, Json };
