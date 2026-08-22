import { supabase } from "@/lib/supabase";
import type {
  FbSessionStatus,
  FbSession,
  FbSessionUpdate,
  FbSessionStatusHistory,
  FbSessionEvent,
  FbSessionActivity,
  SessionWithStats,
  SessionStats,
  SessionLifecycleLog,
  TransitionResult,
} from "@/types/fb-sessions.types";
import { isValidTransition } from "@/types/fb-sessions.types";
import { createSessionSchema, renameSessionSchema } from "@/lib/validations/fb-session";
import { ZodError } from "zod";

export type {
  FbSessionStatus,
  FbSession,
  FbSessionUpdate,
  FbSessionStatusHistory,
  FbSessionEvent,
  FbSessionActivity,
  SessionWithStats,
  SessionStats,
  SessionLifecycleLog,
  TransitionResult,
};

export class SessionValidationError extends Error {
  code: string;
  constructor(message: string, code = "VALIDATION_ERROR") {
    super(message);
    this.name = "SessionValidationError";
    this.code = code;
  }
}

export class SessionTransitionError extends Error {
  fromStatus: FbSessionStatus;
  toStatus: FbSessionStatus;
  constructor(from: FbSessionStatus, to: FbSessionStatus) {
    super(`Invalid transition from "${from}" to "${to}"`);
    this.name = "SessionTransitionError";
    this.fromStatus = from;
    this.toStatus = to;
  }
}

function formatZodError(err: ZodError): string {
  return err.issues.map((e) => e.message).join(", ");
}

export const sessionsRepository = {
  async list(userId: string, filters?: { status?: FbSessionStatus }): Promise<FbSession[]> {
    let query = supabase
      .from("fb_sessions")
      .select("*")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("last_activity", { ascending: false, nullsFirst: false });

    if (filters?.status) {
      query = query.eq("status", filters.status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  },

  async getById(id: string): Promise<SessionWithStats | null> {
    const { data, error } = await supabase
      .from("fb_sessions")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    const [eventsRes, activitiesRes] = await Promise.all([
      supabase.from("fb_session_events").select("id", { count: "exact", head: true }).eq("session_id", id),
      supabase.from("fb_session_activity").select("id", { count: "exact", head: true }).eq("session_id", id),
    ]);

    return {
      ...data,
      events_count: eventsRes.count ?? 0,
      activities_count: activitiesRes.count ?? 0,
    };
  },

  async create(input: {
    userId: string;
    name: string;
    browser?: string | null;
    connectionMethod?: string | null;
    fbName?: string | null;
    fbUserId?: string | null;
    fbAvatarUrl?: string | null;
    proxyUrl?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<FbSession> {
    const parsed = createSessionSchema.safeParse({
      name: input.name,
      browser: input.browser ?? null,
      connectionMethod: input.connectionMethod ?? "browser",
      fbName: input.fbName ?? null,
      fbUserId: input.fbUserId ?? null,
      fbAvatarUrl: input.fbAvatarUrl ?? null,
      proxyUrl: input.proxyUrl ?? "",
    });

    if (!parsed.success) {
      throw new SessionValidationError(formatZodError(parsed.error), "INVALID_INPUT");
    }

    if (!input.userId) {
      throw new SessionValidationError("Missing owner", "MISSING_OWNER");
    }

    const { data: existing } = await supabase
      .from("fb_sessions")
      .select("id")
      .eq("user_id", input.userId)
      .eq("name", parsed.data.name.trim())
      .is("deleted_at", null)
      .maybeSingle();

    if (existing) {
      throw new SessionValidationError("A session with this name already exists in your workspace", "DUPLICATE_NAME");
    }

    const { data, error } = await supabase
      .from("fb_sessions")
      .insert({
        user_id: input.userId,
        name: parsed.data.name,
        browser: parsed.data.browser ?? null,
        connection_method: parsed.data.connectionMethod ?? "browser",
        fb_name: parsed.data.fbName ?? null,
        fb_user_id: parsed.data.fbUserId ?? null,
        fb_avatar_url: parsed.data.fbAvatarUrl ?? null,
        status: "disconnected",
        proxy_url: parsed.data.proxyUrl || null,
        metadata: (input.metadata ?? {}) as never,
      })
      .select()
      .single();

    if (error) {
      // Migration 2026082214 pending — create without the proxy column
      // instead of failing the whole import.
      if (String(error.message).includes("proxy_url")) {
        const retry = await supabase
          .from("fb_sessions")
          .insert({
            user_id: input.userId,
            name: parsed.data.name,
            browser: parsed.data.browser ?? null,
            connection_method: parsed.data.connectionMethod ?? "browser",
            fb_name: parsed.data.fbName ?? null,
            fb_user_id: parsed.data.fbUserId ?? null,
            fb_avatar_url: parsed.data.fbAvatarUrl ?? null,
            status: "disconnected",
            metadata: (input.metadata ?? {}) as never,
          })
          .select()
          .single();
        if (retry.error) throw retry.error;
        return retry.data;
      }
      throw error;
    }
    return data;
  },

  async update(id: string, updates: Partial<FbSessionUpdate>): Promise<FbSession> {
    if (updates.name !== undefined) {
      const parsed = renameSessionSchema.safeParse({ name: updates.name });
      if (!parsed.success) {
        throw new SessionValidationError(formatZodError(parsed.error), "INVALID_NAME");
      }
    }

    const { data, error } = await supabase
      .from("fb_sessions")
      .update(updates as never)
      .eq("id", id)
      .is("deleted_at", null)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async rename(id: string, newName: string): Promise<FbSession> {
    const parsed = renameSessionSchema.safeParse({ name: newName });
    if (!parsed.success) {
      throw new SessionValidationError(formatZodError(parsed.error), "INVALID_NAME");
    }

    const { data: session } = await supabase
      .from("fb_sessions")
      .select("user_id")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (!session) throw new SessionValidationError("Session not found", "NOT_FOUND");

    const { data: existing } = await supabase
      .from("fb_sessions")
      .select("id")
      .eq("user_id", session.user_id)
      .eq("name", parsed.data.name)
      .neq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (existing) {
      throw new SessionValidationError("A session with this name already exists", "DUPLICATE_NAME");
    }

    const { data, error } = await supabase
      .from("fb_sessions")
      .update({ name: parsed.data.name })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    await supabase.rpc("log_session_activity", {
      p_session_id: id,
      p_action: "renamed",
      p_description: `Session renamed to "${parsed.data.name}"`,
      p_metadata: {},
    } as never);

    return data;
  },

  async softDelete(id: string): Promise<void> {
    const { data: session } = await supabase
      .from("fb_sessions")
      .select("status")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (!session) throw new SessionValidationError("Session not found", "NOT_FOUND");

    const { error } = await (supabase as any).rpc("soft_delete_fb_session", {
      p_session_id: id,
    });

    if (error) throw error;

    try {
      await supabase.rpc("log_session_activity", {
        p_session_id: id,
        p_action: "deleted",
        p_description: "Session soft-deleted",
        p_metadata: {},
      } as never);
    } catch (logErr) {
      console.warn("[softDelete] log_session_activity failed (delete still succeeded):", logErr);
    }
  },

  async transitionStatus(
    id: string,
    newStatus: FbSessionStatus,
    reason?: string,
  ): Promise<TransitionResult> {
    const { data: session } = await supabase
      .from("fb_sessions")
      .select("status")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (!session) {
      return { success: false, error: "SESSION_NOT_FOUND", message: "Session not found", old_status: null, new_status: null };
    }

    if (!isValidTransition(session.status, newStatus)) {
      throw new SessionTransitionError(session.status, newStatus);
    }

    const { data, error } = await supabase.rpc("transition_fb_session_status", {
      p_session_id: id,
      p_new_status: newStatus,
      p_reason: reason ?? null,
      p_metadata: {},
    } as never);

    if (error) throw error;
    return data as unknown as TransitionResult;
  },

  async duplicate(id: string): Promise<FbSession> {
    const { data: original, error } = await supabase
      .from("fb_sessions")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (error) throw error;

    let newName = `${original.name} (copy)`;
    let counter = 1;
    let isUnique = false;
    while (!isUnique) {
        const { data: existing } = await supabase
        .from("fb_sessions")
        .select("id")
        .eq("user_id", original.user_id)
        .eq("name", newName)
        .is("deleted_at", null)
        .maybeSingle();
      if (!existing) {
        isUnique = true;
      } else {
        newName = `${original.name} (copy ${++counter})`;
      }
    }

    const { data, error: createError } = await supabase
      .from("fb_sessions")
      .insert({
        user_id: original.user_id,
        name: newName,
        browser: original.browser,
        connection_method: original.connection_method,
        fb_name: original.fb_name,
        fb_user_id: original.fb_user_id,
        fb_avatar_url: original.fb_avatar_url,
        status: "disconnected",
        metadata: original.metadata,
      })
      .select()
      .single();

    if (createError) throw createError;

    await supabase.rpc("log_session_activity", {
      p_session_id: id,
      p_action: "duplicated",
      p_description: `Session duplicated as "${newName}"`,
      p_metadata: {},
    } as never);

    return data;
  },

  async getStatusHistory(id: string): Promise<FbSessionStatusHistory[]> {
    const { data, error } = await supabase
      .from("fb_session_status_history")
      .select("*")
      .eq("session_id", id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data ?? [];
  },

  async getEvents(id: string): Promise<FbSessionEvent[]> {
    const { data, error } = await supabase
      .from("fb_session_events")
      .select("*")
      .eq("session_id", id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data ?? [];
  },

  async getActivity(id: string): Promise<FbSessionActivity[]> {
    const { data, error } = await supabase
      .from("fb_session_activity")
      .select("*")
      .eq("session_id", id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data ?? [];
  },

  async getLifecycleLogs(id: string): Promise<SessionLifecycleLog[]> {
    const { data, error } = await supabase
      .from("session_lifecycle_logs")
      .select("*")
      .eq("session_id", id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data ?? [];
  },

  async logActivity(
    id: string,
    action: string,
    description?: string,
  ): Promise<string> {
    const { data, error } = await supabase.rpc("log_session_activity", {
      p_session_id: id,
      p_action: action,
      p_description: description ?? null,
      p_metadata: {},
    } as never);

    if (error) throw error;
    return data;
  },

  async getStats(userId: string): Promise<SessionStats> {
    const { data, error } = await supabase
      .from("fb_sessions")
      .select("status")
      .eq("user_id", userId)
      .is("deleted_at", null);

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
