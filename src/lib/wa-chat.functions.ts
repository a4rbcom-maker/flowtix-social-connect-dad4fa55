// WhatsApp chat & AI settings — TanStack server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { waBridge, BridgeError } from "./wa-bridge.server";
import { upsertConversationFromMessage } from "./wa-ai.server";

export interface ConversationRow {
  id: string;
  remote_jid: string;
  contact_name: string | null;
  contact_phone: string | null;
  last_message_text: string | null;
  last_message_at: string;
  last_direction: string;
  unread_count: number;
  ai_enabled: boolean;
}

export interface ChatMessageRow {
  id: string;
  remote_jid: string;
  direction: "in" | "out";
  text_body: string | null;
  msg_type: string;
  media_url: string | null;
  created_at: string;
  is_ai: boolean;
}

export const listConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConversationRow[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("wa_conversations")
      .select(
        "id, remote_jid, contact_name, contact_phone, last_message_text, last_message_at, last_direction, unread_count, ai_enabled",
      )
      .eq("user_id", userId)
      .eq("is_archived", false)
      .order("last_message_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as ConversationRow[];
  });

export const getConversationMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ remoteJid: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ context, data }): Promise<ChatMessageRow[]> => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("wa_messages")
      .select("id, remote_jid, direction, text_body, msg_type, media_url, created_at, raw")
      .eq("user_id", userId)
      .eq("remote_jid", data.remoteJid)
      .order("created_at", { ascending: true })
      .limit(300);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id,
      remote_jid: r.remote_jid,
      direction: r.direction as "in" | "out",
      text_body: r.text_body,
      msg_type: r.msg_type,
      media_url: r.media_url,
      created_at: r.created_at,
      is_ai: Boolean(r.raw && typeof r.raw === "object" && (r.raw as Record<string, unknown>).ai === true),
    }));
  });

export const markConversationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await supabase
      .from("wa_conversations")
      .update({ unread_count: 0 })
      .eq("id", data.id)
      .eq("user_id", userId);
    return { ok: true };
  });

export const toggleConversationAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("wa_conversations")
      .update({ ai_enabled: data.enabled })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        remoteJid: z.string().min(1).max(64),
        text: z.string().trim().min(1).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: sess } = await supabase
      .from("wa_sessions")
      .select("session_id, status")
      .eq("user_id", userId)
      .maybeSingle();
    if (!sess?.session_id) throw new Error("WhatsApp is not connected");
    if (sess.status !== "connected") throw new Error("WhatsApp is not connected");

    const phone = data.remoteJid.replace(/[^0-9]/g, "");
    try {
      await waBridge.sendText(sess.session_id, phone, data.text);
    } catch (err) {
      const msg =
        err instanceof BridgeError ? err.message : err instanceof Error ? err.message : "Bridge error";
      throw new Error(msg);
    }

    await supabase.from("wa_messages").insert({
      user_id: userId,
      session_id: sess.session_id,
      direction: "out",
      remote_jid: data.remoteJid,
      to_phone: phone,
      msg_type: "text",
      text_body: data.text,
    });

    await upsertConversationFromMessage({
      userId,
      sessionId: sess.session_id,
      remoteJid: data.remoteJid,
      contactName: null,
      contactPhone: phone,
      text: data.text,
      direction: "out",
    });

    return { ok: true };
  });

// ─── AI Settings ───────────────────────────────────────────────────────────

export interface WaAiSettings {
  ai_enabled: boolean;
  ai_model: string;
  ai_system_prompt: string;
  ai_welcome_message: string;
  ai_business_hours_only: boolean;
  ai_working_hours_start: string | null;
  ai_working_hours_end: string | null;
  ai_blacklist: string[];
  ai_knowledge_base: string;
  ai_max_context_messages: number;
  ai_reply_delay_seconds: number;
}

const DEFAULTS: WaAiSettings = {
  ai_enabled: false,
  ai_model: "google/gemini-2.5-flash",
  ai_system_prompt: "",
  ai_welcome_message: "",
  ai_business_hours_only: false,
  ai_working_hours_start: null,
  ai_working_hours_end: null,
  ai_blacklist: [],
  ai_knowledge_base: "",
  ai_max_context_messages: 10,
  ai_reply_delay_seconds: 2,
};

export const getAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WaAiSettings> => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("whatsapp_settings")
      .select(
        "ai_enabled, ai_model, ai_system_prompt, ai_welcome_message, ai_business_hours_only, ai_working_hours_start, ai_working_hours_end, ai_blacklist, ai_knowledge_base, ai_max_context_messages, ai_reply_delay_seconds",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return DEFAULTS;
    return {
      ai_enabled: data.ai_enabled ?? false,
      ai_model: data.ai_model ?? DEFAULTS.ai_model,
      ai_system_prompt: data.ai_system_prompt ?? "",
      ai_welcome_message: data.ai_welcome_message ?? "",
      ai_business_hours_only: data.ai_business_hours_only ?? false,
      ai_working_hours_start: data.ai_working_hours_start ?? null,
      ai_working_hours_end: data.ai_working_hours_end ?? null,
      ai_blacklist: data.ai_blacklist ?? [],
      ai_knowledge_base: data.ai_knowledge_base ?? "",
      ai_max_context_messages: data.ai_max_context_messages ?? 10,
      ai_reply_delay_seconds: data.ai_reply_delay_seconds ?? 2,
    };
  });

const aiSettingsSchema = z.object({
  ai_enabled: z.boolean(),
  ai_model: z.string().min(1).max(100),
  ai_system_prompt: z.string().max(8000),
  ai_welcome_message: z.string().max(2000),
  ai_business_hours_only: z.boolean(),
  ai_working_hours_start: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  ai_working_hours_end: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  ai_blacklist: z.array(z.string().max(32)).max(200),
  ai_knowledge_base: z.string().max(20000),
  ai_max_context_messages: z.number().int().min(2).max(30),
  ai_reply_delay_seconds: z.number().int().min(0).max(60),
});

export const saveAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => aiSettingsSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    // Ensure a row exists (whatsapp_settings has connection_type NOT NULL default)
    const { data: existing } = await supabase
      .from("whatsapp_settings")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from("whatsapp_settings")
        .update(data)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("whatsapp_settings")
        .insert({ ...data, user_id: userId, connection_type: "bridge" });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const listAiLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("wa_ai_logs")
      .select("id, remote_jid, model, prompt_excerpt, response_text, latency_ms, status, error_message, rating, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const rateAiLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), rating: z.number().int().min(-1).max(1) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    await supabase.from("wa_ai_logs").update({ rating: data.rating }).eq("id", data.id).eq("user_id", userId);
    return { ok: true };
  });
