import { supabase } from "@/lib/supabase";
import type {
  SessionHealth,
  SessionHealthSummary,
  SessionValidationResult,
  ConnectionAttemptResult,
  FbConnectionAttempt,
} from "@/types/fb-sessions.types";

// ============================================================
// Session Monitor Service
// Responsible for monitoring session health.
// Detects: expired, lost connection, auth failure, validation failure, healthy.
// Architecture is ready for future background jobs.
// ============================================================

export const sessionMonitorService = {
  // Validate a single session (calls the RPC function)
  async validateSession(sessionId: string): Promise<SessionValidationResult> {
    const { data, error } = await supabase.rpc("validate_fb_session", {
      p_session_id: sessionId,
    } as never);

    if (error) throw error;
    return data as unknown as SessionValidationResult;
  },

  // Validate all sessions in a workspace (batch)
  async validateWorkspaceSessions(userId: string): Promise<{
    workspace_id: string;
    checked_at: string;
    total_sessions: number;
    sessions: SessionValidationResult[];
  }> {
    const { data, error } = await supabase.rpc("check_workspace_sessions_health", {
      p_workspace_id: userId,
    } as never);

    if (error) throw error;
    return data as unknown as {
      workspace_id: string;
      checked_at: string;
      total_sessions: number;
      sessions: SessionValidationResult[];
    };
  },

  // Get health summary for a workspace
  async getHealthSummary(userId: string): Promise<SessionHealthSummary> {
    const { data, error } = await supabase.rpc("get_session_health_summary", {
      p_workspace_id: userId,
    } as never);

    if (error) throw error;
    return data as unknown as SessionHealthSummary;
  },

  // Record a connection attempt
  async recordConnectionAttempt(
    sessionId: string,
    result: ConnectionAttemptResult,
    errorMessage?: string,
    durationMs?: number,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await supabase.rpc("record_fb_connection_attempt", {
      p_session_id: sessionId,
      p_result: result,
      p_error_message: errorMessage ?? null,
      p_duration_ms: durationMs ?? null,
      p_metadata: (metadata ?? {}) as never,
    } as never);

    if (error) throw error;
  },

  // Touch session (heartbeat — update last_seen)
  async touchSession(sessionId: string): Promise<void> {
    const { error } = await supabase.rpc("touch_fb_session", {
      p_session_id: sessionId,
    } as never);

    if (error) throw error;
  },

  // Get connection attempts history for a session
  async getConnectionAttempts(
    sessionId: string,
    limit = 50,
  ): Promise<FbConnectionAttempt[]> {
    const { data, error } = await supabase
      .from("fb_connection_attempts")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data ?? [];
  },

  // Detect sessions that need attention (unhealthy or expired)
  async detectIssues(userId: string): Promise<{
    expired: number;
    unhealthy: number;
    degraded: number;
    needsValidation: number;
  }> {
    const summary = await this.getHealthSummary(userId);

    // Sessions that haven't been validated in a while
    const { count } = await supabase
      .from("fb_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .or("last_validation.is.null,last_validation.lt.now() - interval '1 hour'");

    return {
      expired: summary.expired,
      unhealthy: summary.unhealthy,
      degraded: summary.degraded,
      needsValidation: count ?? 0,
    };
  },

  // Health check for a single session — lightweight read-only
  async checkHealth(sessionId: string): Promise<{
    health: SessionHealth;
    needsAttention: boolean;
    isExpired: boolean;
  }> {
    const { data, error } = await supabase
      .from("fb_sessions")
      .select("session_health, status, session_token_expires_at, failure_counter, max_failure_retries, last_validation, last_activity")
      .eq("id", sessionId)
      .single();

    if (error) throw error;

    const isExpired =
      data.status === "expired" ||
      (data.session_token_expires_at != null && new Date(data.session_token_expires_at) < new Date());

    const isUnhealthy =
      data.session_health === "unhealthy" ||
      data.failure_counter >= data.max_failure_retries;

    return {
      health: data.session_health as SessionHealth,
      needsAttention: isExpired || isUnhealthy || data.session_health === "degraded",
      isExpired,
    };
  },
};
