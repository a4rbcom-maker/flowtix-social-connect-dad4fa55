import { sessionsRepository, SessionTransitionError, SessionValidationError } from "@/lib/fb-sessions";
import { browserProfileService } from "@/lib/browser-profile-service";
import { sessionMonitorService } from "@/lib/session-monitor-service";
import type { FbSession, TransitionResult } from "@/types/fb-sessions.types";
import { isValidTransition, getAvailableTransitions, type FbSessionStatus } from "@/types/fb-sessions.types";

export { SessionTransitionError, SessionValidationError };

export const sessionLifecycleService = {
  async createSession(input: {
    userId: string;
    name: string;
    browser?: string | null;
    connectionMethod?: string | null;
    profileName?: string;
    cookies?: string;
  }): Promise<{ session: FbSession; profile: Awaited<ReturnType<typeof browserProfileService.create>> }> {
    const session = await sessionsRepository.create({
      userId: input.userId,
      name: input.name,
      browser: input.browser,
      connectionMethod: input.connectionMethod,
    });

    const profile = await browserProfileService.create({
      session_id: session.id,
      user_id: input.userId,
      profile_name: input.profileName ?? `${input.name} Profile`,
      cookies_enc: input.cookies ?? null,
    });

    await sessionsRepository.logActivity(session.id, "created", "Session created");

    return { session, profile };
  },

  async connect(
    sessionId: string,
    fbUserId?: string,
    fbName?: string,
    fbAvatarUrl?: string,
  ): Promise<TransitionResult> {
    const result = await sessionsRepository.transitionStatus(sessionId, "connecting", "Connection initiated");
    if (!result.success) return result;

    await sessionMonitorService.recordConnectionAttempt(sessionId, "success", undefined, 0);

    await sessionsRepository.update(sessionId, {
      fb_user_id: fbUserId ?? null,
      fb_name: fbName ?? null,
      fb_avatar_url: fbAvatarUrl ?? null,
    });

    const connectResult = await sessionsRepository.transitionStatus(sessionId, "connected", "Connection successful");

    if (connectResult.success) {
      await sessionsRepository.logActivity(sessionId, "connected", `Session connected as ${fbName ?? "unknown"}`);
    }

    return connectResult;
  },

  async reconnect(sessionId: string): Promise<TransitionResult> {
    const session = await sessionsRepository.getById(sessionId);
    if (!session) throw new SessionValidationError("Session not found", "NOT_FOUND");

    if (!isValidTransition(session.status, "reconnecting")) {
      throw new SessionTransitionError(session.status, "reconnecting");
    }

    const result = await sessionsRepository.transitionStatus(sessionId, "reconnecting", "Reconnect initiated");
    if (!result.success) return result;

    await sessionsRepository.logActivity(sessionId, "reconnected", "Session reconnecting");

    await sessionMonitorService.recordConnectionAttempt(sessionId, "success", undefined, 0);

    const connectResult = await sessionsRepository.transitionStatus(sessionId, "connected", "Reconnection successful");

    if (connectResult.success) {
      await sessionsRepository.logActivity(sessionId, "connected", "Session reconnected successfully");
    }

    return connectResult;
  },

  async disconnect(sessionId: string, reason?: string): Promise<TransitionResult> {
    const result = await sessionsRepository.transitionStatus(sessionId, "disconnected", reason ?? "Manual disconnect");
    if (result.success) {
      await sessionsRepository.logActivity(sessionId, "disconnected", reason ?? "Session disconnected");
      await sessionMonitorService.touchSession(sessionId);
    }
    return result;
  },

  async pause(sessionId: string): Promise<TransitionResult> {
    const result = await sessionsRepository.transitionStatus(sessionId, "paused", "Manual pause");
    if (result.success) {
      await sessionsRepository.logActivity(sessionId, "paused", "Session paused");
    }
    return result;
  },

  async resume(sessionId: string): Promise<TransitionResult> {
    const result = await sessionsRepository.transitionStatus(sessionId, "connected", "Resumed from pause");
    if (result.success) {
      await sessionsRepository.logActivity(sessionId, "resumed", "Session resumed");
    }
    return result;
  },

  async markExpired(sessionId: string, reason?: string): Promise<TransitionResult> {
    const result = await sessionsRepository.transitionStatus(sessionId, "expired", reason ?? "Session token expired");
    if (result.success) {
      await sessionsRepository.logActivity(sessionId, "expired", reason ?? "Session expired");
    }
    return result;
  },

  async markError(sessionId: string, errorMessage: string): Promise<TransitionResult> {
    const session = await sessionsRepository.getById(sessionId);
    if (!session) throw new SessionValidationError("Session not found", "NOT_FOUND");

    if (!isValidTransition(session.status, "error")) {
      throw new SessionTransitionError(session.status, "error");
    }

    await sessionMonitorService.recordConnectionAttempt(sessionId, "unknown_error", errorMessage);
    const result = await sessionsRepository.transitionStatus(sessionId, "error", errorMessage);
    if (result.success) {
      await sessionsRepository.logActivity(sessionId, "error", errorMessage);
    }
    return result;
  },

  async refresh(sessionId: string): Promise<FbSession> {
    await sessionMonitorService.validateSession(sessionId);
    await sessionMonitorService.touchSession(sessionId);
    await sessionsRepository.logActivity(sessionId, "refreshed", "Session refreshed");
    return (await sessionsRepository.getById(sessionId)) as FbSession;
  },

  async delete(sessionId: string): Promise<void> {
    await sessionsRepository.softDelete(sessionId);
  },

  async getLifecycleStatus(sessionId: string): Promise<{
    session: FbSession;
    health: Awaited<ReturnType<typeof sessionMonitorService.checkHealth>>;
    recentAttempts: Awaited<ReturnType<typeof sessionMonitorService.getConnectionAttempts>>;
    lifecycleLogs: Awaited<ReturnType<typeof sessionsRepository.getLifecycleLogs>>;
    availableTransitions: FbSessionStatus[];
  }> {
    const [session, health, recentAttempts, lifecycleLogs] = await Promise.all([
      sessionsRepository.getById(sessionId),
      sessionMonitorService.checkHealth(sessionId),
      sessionMonitorService.getConnectionAttempts(sessionId, 10),
      sessionsRepository.getLifecycleLogs(sessionId),
    ]);

    if (!session) throw new SessionValidationError("Session not found", "NOT_FOUND");

    return {
      session,
      health,
      recentAttempts,
      lifecycleLogs,
      availableTransitions: getAvailableTransitions(session.status),
    };
  },
};
