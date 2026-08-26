import { waSessionsRepository, stopWaSocket, WaSessionTransitionError, WaSessionValidationError } from "@/lib/wa-sessions";
import type { WaSession, TransitionResult, WaSessionStatus } from "@/types/wa.types";
import { isValidTransition, getAvailableTransitions } from "@/types/wa.types";

export { WaSessionTransitionError, WaSessionValidationError };

export const waLifecycleService = {
  async createSession(input: {
    workspaceId: string; userId: string; name: string;
    providerType?: "baileys" | "cloud_api" | null; phoneNumber?: string | null;
  }): Promise<WaSession> {
    const session = await waSessionsRepository.create({
      workspaceId: input.workspaceId, userId: input.userId, name: input.name,
      providerType: input.providerType, phoneNumber: input.phoneNumber,
    });
    await waSessionsRepository.logActivity(session.id, "created", "WhatsApp session created");
    return session;
  },

  async requestQR(sessionId: string): Promise<TransitionResult> {
    const result = await waSessionsRepository.transitionStatus(sessionId, "qr_ready", "QR requested");
    if (result.success) await waSessionsRepository.logActivity(sessionId, "qr_requested", "QR code requested");
    return result;
  },

  async connect(sessionId: string, phone?: string, pushName?: string): Promise<TransitionResult> {
    const result = await waSessionsRepository.transitionStatus(sessionId, "connecting", "Connection initiated");
    if (!result.success) return result;
    await waSessionsRepository.update(sessionId, {
      phone_number: phone ?? null, push_name: pushName ?? null, last_connected: new Date().toISOString(),
    });
    const connected = await waSessionsRepository.transitionStatus(sessionId, "connected", "Connection successful");
    if (connected.success) await waSessionsRepository.logActivity(sessionId, "connected", `Connected as ${pushName ?? phone ?? "unknown"}`);
    return connected;
  },

  async reconnect(sessionId: string): Promise<TransitionResult> {
    const session = await waSessionsRepository.getById(sessionId);
    if (!session) throw new WaSessionValidationError("Session not found", "NOT_FOUND");
    if (!isValidTransition(session.status, "reconnecting")) throw new WaSessionTransitionError(session.status, "reconnecting");
    const r1 = await waSessionsRepository.transitionStatus(sessionId, "reconnecting", "Reconnect initiated");
    if (!r1.success) return r1;
    await waSessionsRepository.logActivity(sessionId, "reconnected", "Session reconnecting");
    const r2 = await waSessionsRepository.transitionStatus(sessionId, "connected", "Reconnection successful");
    if (r2.success) await waSessionsRepository.logActivity(sessionId, "connected", "Session reconnected successfully");
    return r2;
  },

  async disconnect(sessionId: string, reason?: string): Promise<TransitionResult> {
    const result = await waSessionsRepository.transitionStatus(sessionId, "disconnected", reason ?? "Manual disconnect");
    if (result.success) {
      await waSessionsRepository.logActivity(sessionId, "disconnected", reason ?? "Session disconnected");
      await stopWaSocket(sessionId);
    }
    return result;
  },

  async pause(sessionId: string): Promise<TransitionResult> {
    const result = await waSessionsRepository.transitionStatus(sessionId, "paused", "Manual pause");
    if (result.success) await waSessionsRepository.logActivity(sessionId, "paused", "Session paused");
    return result;
  },

  async resume(sessionId: string): Promise<TransitionResult> {
    const result = await waSessionsRepository.transitionStatus(sessionId, "connected", "Resumed from pause");
    if (result.success) await waSessionsRepository.logActivity(sessionId, "resumed", "Session resumed");
    return result;
  },

  async markExpired(sessionId: string, reason?: string): Promise<TransitionResult> {
    const result = await waSessionsRepository.transitionStatus(sessionId, "expired", reason ?? "Session expired");
    if (result.success) {
      await waSessionsRepository.logActivity(sessionId, "expired", reason ?? "Session expired");
      await stopWaSocket(sessionId);
    }
    return result;
  },

  async markError(sessionId: string, errorMessage: string): Promise<TransitionResult> {
    const session = await waSessionsRepository.getById(sessionId);
    if (!session) throw new WaSessionValidationError("Session not found", "NOT_FOUND");
    if (!isValidTransition(session.status, "error")) throw new WaSessionTransitionError(session.status, "error");
    const result = await waSessionsRepository.transitionStatus(sessionId, "error", errorMessage);
    if (result.success) await waSessionsRepository.logActivity(sessionId, "error", errorMessage);
    return result;
  },

  async refresh(sessionId: string): Promise<WaSession> {
    await waSessionsRepository.logActivity(sessionId, "refreshed", "Session refreshed");
    return (await waSessionsRepository.getById(sessionId)) as WaSession;
  },

  async delete(sessionId: string, userId: string): Promise<void> {
    await waSessionsRepository.softDelete(sessionId, userId);
  },

  async getLifecycleStatus(sessionId: string): Promise<{
    session: WaSession; availableTransitions: WaSessionStatus[];
  }> {
    const session = await waSessionsRepository.getById(sessionId);
    if (!session) throw new WaSessionValidationError("Session not found", "NOT_FOUND");
    return { session, availableTransitions: getAvailableTransitions(session.status) };
  },
};
