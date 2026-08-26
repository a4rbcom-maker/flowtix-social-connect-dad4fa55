import { supabase } from "@/lib/supabase";
import type {
  WaSessionStatus, WaSession, WaSessionUpdate, WaSessionEvent,
  WaSessionActivity, WaSessionStatusHistory, WaSessionLifecycleLog,
  WaSessionWithStats, WaSessionStats, TransitionResult, WaSessionInsert,
} from "@/types/wa.types";
import { isValidTransition } from "@/types/wa.types";
import { createWaSessionSchema, renameWaSessionSchema } from "@/lib/validations/wa-session";
import { ZodError } from "zod";

export type {
  WaSessionStatus, WaSession, WaSessionUpdate, WaSessionEvent,
  WaSessionActivity, WaSessionStatusHistory, WaSessionLifecycleLog,
  WaSessionWithStats, WaSessionStats, TransitionResult,
};

// Tell the extraction service to tear down the live Baileys socket so no more
// inbound messages arrive. The frontend can show the UI as disconnected
// immediately; this is best-effort and does not block the status transition.
export async function stopWaSocket(sessionId: string): Promise<void> {
  const url = import.meta.env.VITE_EXTRACTION_API_URL || "http://localhost:3100";
  const key = import.meta.env.VITE_EXTRACTION_API_KEY || "local-dev-key-change-in-production";
  try {
    await fetch(`${url}/wa/${sessionId}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": key },
    });
  } catch {
    // backend unreachable — the DB status transition still reflects disconnect
  }
}

export class WaSessionValidationError extends Error {
  code: string;
  constructor(message: string, code = "VALIDATION_ERROR") {
    super(message); this.name = "WaSessionValidationError"; this.code = code;
  }
}

export class WaSessionTransitionError extends Error {
  fromStatus: WaSessionStatus; toStatus: WaSessionStatus;
  constructor(from: WaSessionStatus, to: WaSessionStatus) {
    super(`Invalid transition from "${from}" to "${to}"`);
    this.name = "WaSessionTransitionError"; this.fromStatus = from; this.toStatus = to;
  }
}

function formatZodError(err: ZodError): string {
  return err.issues.map((e) => e.message).join(", ");
}

export const waSessionsRepository = {
  async list(workspaceId: string, filters?: { status?: WaSessionStatus }): Promise<WaSession[]> {
    let query = supabase
      .from("wa_sessions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("last_activity", { ascending: false, nullsFirst: false });
    if (filters?.status) query = query.eq("status", filters.status);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  },

  async getById(id: string): Promise<WaSessionWithStats | null> {
    const { data, error } = await supabase
      .from("wa_sessions").select("*").eq("id", id).is("deleted_at", null).single();
    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }
    const [eventsRes, activitiesRes] = await Promise.all([
      supabase.from("wa_session_events").select("id", { count: "exact", head: true }).eq("session_id", id),
      supabase.from("wa_session_activity").select("id", { count: "exact", head: true }).eq("session_id", id),
    ]);
    return { ...data, events_count: eventsRes.count ?? 0, activities_count: activitiesRes.count ?? 0 };
  },

  async create(input: {
    workspaceId: string; userId: string; name: string;
    providerType?: "baileys" | "cloud_api" | null;
    phoneNumber?: string | null;
  }): Promise<WaSession> {
    const parsed = createWaSessionSchema.safeParse({
      name: input.name,
      providerType: input.providerType ?? "baileys",
      phoneNumber: input.phoneNumber ?? null,
    });
    if (!parsed.success) throw new WaSessionValidationError(formatZodError(parsed.error), "INVALID_INPUT");
    if (!input.workspaceId) throw new WaSessionValidationError("Missing workspace", "MISSING_WORKSPACE");
    if (!input.userId) throw new WaSessionValidationError("Missing owner", "MISSING_OWNER");

    const { data: existing } = await supabase
      .from("wa_sessions").select("id")
      .eq("workspace_id", input.workspaceId).eq("name", parsed.data.name.trim())
      .is("deleted_at", null).maybeSingle();
    if (existing) throw new WaSessionValidationError("A WhatsApp session with this name already exists", "DUPLICATE_NAME");

    const insert: WaSessionInsert = {
      workspace_id: input.workspaceId,
      user_id: input.userId,
      name: parsed.data.name,
      provider_type: parsed.data.providerType ?? "baileys",
      phone_number: parsed.data.phoneNumber ?? null,
      status: "disconnected",
      metadata: {} as never,
    };
    const { data, error } = await supabase.from("wa_sessions").insert(insert).select().single();
    if (error) throw error;
    return data;
  },

  async update(id: string, updates: Partial<WaSessionUpdate>): Promise<WaSession> {
    if (updates.name !== undefined) {
      const parsed = renameWaSessionSchema.safeParse({ name: updates.name });
      if (!parsed.success) throw new WaSessionValidationError(formatZodError(parsed.error), "INVALID_NAME");
    }
    const { data, error } = await supabase
      .from("wa_sessions").update(updates as never).eq("id", id).is("deleted_at", null).select().single();
    if (error) throw error;
    return data;
  },

  async rename(id: string, newName: string): Promise<WaSession> {
    const parsed = renameWaSessionSchema.safeParse({ name: newName });
    if (!parsed.success) throw new WaSessionValidationError(formatZodError(parsed.error), "INVALID_NAME");
    const { data: session } = await supabase
      .from("wa_sessions").select("workspace_id").eq("id", id).is("deleted_at", null).single();
    if (!session) throw new WaSessionValidationError("Session not found", "NOT_FOUND");

    const { data: existing } = await supabase
      .from("wa_sessions").select("id").eq("workspace_id", session.workspace_id as any)
      .eq("name", parsed.data.name).neq("id", id).is("deleted_at", null).maybeSingle();
    if (existing) throw new WaSessionValidationError("A WhatsApp session with this name already exists", "DUPLICATE_NAME");

    const { data, error } = await supabase.from("wa_sessions").update({ name: parsed.data.name }).eq("id", id).select().single();
    if (error) throw error;

    await supabase.rpc("log_wa_session_activity", {
      p_session_id: id, p_action: "renamed",
      p_description: `Session renamed to "${parsed.data.name}"`, p_metadata: {},
    } as never);
    return data;
  },

  async softDelete(id: string, userId: string): Promise<void> {
    const { data: session } = await supabase
      .from("wa_sessions").select("workspace_id, status").eq("id", id).is("deleted_at", null).single();
    if (!session) throw new WaSessionValidationError("Session not found", "NOT_FOUND");
    const { error } = await supabase.from("wa_sessions")
      .update({ deleted_at: new Date().toISOString(), deleted_by: userId, status: "disconnected" } as never)
      .eq("id", id);
    if (error) throw error;
    await supabase.rpc("log_wa_session_activity", {
      p_session_id: id, p_action: "deleted", p_description: "Session soft-deleted", p_metadata: {},
    } as never);
  },

  async transitionStatus(id: string, newStatus: WaSessionStatus, reason?: string): Promise<TransitionResult> {
    const { data: session } = await supabase.from("wa_sessions").select("status").eq("id", id).is("deleted_at", null).single();
    if (!session) {
      return { success: false, error: "SESSION_NOT_FOUND", message: "Session not found", old_status: null, new_status: null };
    }
    if (!isValidTransition(session.status, newStatus)) throw new WaSessionTransitionError(session.status, newStatus);
    const { data, error } = await supabase.rpc("transition_wa_session_status", {
      p_session_id: id, p_new_status: newStatus, p_reason: reason ?? null, p_metadata: {},
    } as never);
    if (error) throw error;
    return data as unknown as TransitionResult;
  },

  async getEvents(id: string): Promise<WaSessionEvent[]> {
    const { data, error } = await supabase.from("wa_session_events").select("*").eq("session_id", id).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async getActivity(id: string): Promise<WaSessionActivity[]> {
    const { data, error } = await supabase.from("wa_session_activity").select("*").eq("session_id", id).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async getStatusHistory(id: string): Promise<WaSessionStatusHistory[]> {
    const { data, error } = await supabase.from("wa_session_status_history").select("*").eq("session_id", id).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async getLifecycleLogs(id: string): Promise<WaSessionLifecycleLog[]> {
    const { data, error } = await supabase.from("wa_session_lifecycle_logs").select("*").eq("session_id", id).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async logActivity(id: string, action: string, description?: string): Promise<string> {
    const { data, error } = await supabase.rpc("log_wa_session_activity", {
      p_session_id: id, p_action: action, p_description: description ?? null, p_metadata: {},
    } as never);
    if (error) throw error;
    return data;
  },

  async getStats(workspaceId: string): Promise<WaSessionStats> {
    const { data, error } = await supabase.from("wa_sessions").select("status").eq("workspace_id", workspaceId).is("deleted_at", null);
    if (error) throw error;
    const sessions = data ?? [];
    return {
      total: sessions.length,
      connected: sessions.filter((s) => s.status === "connected").length,
      disconnected: sessions.filter((s) => s.status === "disconnected" || s.status === "paused").length,
      expired: sessions.filter((s) => s.status === "expired" || s.status === "error").length,
    };
  },
};
