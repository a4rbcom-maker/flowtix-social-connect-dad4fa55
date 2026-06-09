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
  profile_pic_url: string | null;
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
  sender_name: string | null;
  sender_phone: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function digits(value: string | null): string | null {
  const cleaned = value?.replace(/[^0-9]/g, "") ?? "";
  return cleaned || null;
}

function phoneFromRaw(raw: unknown): string | null {
  const obj = asRecord(raw);
  return digits(pickString(obj, "normalizedContactPhone", "senderPn", "participantPn", "phoneNumber", "phone"));
}

function profilePicFromRaw(raw: unknown): string | null {
  const obj = asRecord(raw);
  return pickString(obj, "profilePicUrl", "groupProfilePicUrl", "avatarUrl", "picture", "photoUrl");
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
    const rows = (data ?? []) as Omit<ConversationRow, "profile_pic_url">[];
    if (!rows.length) return [];

    const remoteJids = rows.map((row) => row.remote_jid);
    const { data: rawMessages } = await supabase
      .from("wa_messages")
      .select("remote_jid, raw, created_at")
      .eq("user_id", userId)
      .in("remote_jid", remoteJids)
      .not("raw", "is", null)
      .order("created_at", { ascending: false })
      .limit(1000);

    const metaByJid = new Map<string, { phone: string | null; profile: string | null }>();
    for (const msg of rawMessages ?? []) {
      const jid = String(msg.remote_jid ?? "");
      if (!jid) continue;
      const current = metaByJid.get(jid) ?? { phone: null, profile: null };
      const next = {
        phone: current.phone ?? phoneFromRaw(msg.raw),
        profile: current.profile ?? profilePicFromRaw(msg.raw),
      };
      metaByJid.set(jid, next);
    }

    return rows.map((row) => {
      const meta = metaByJid.get(row.remote_jid);
      const isGroup = row.remote_jid.endsWith("@g.us");
      return {
        ...row,
        contact_phone: isGroup ? null : (meta?.phone ?? row.contact_phone),
        profile_pic_url: meta?.profile ?? null,
      };
    });
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
    return (rows ?? []).map((r) => {
      const raw = asRecord(r.raw);
      return {
        id: r.id,
        remote_jid: r.remote_jid,
        direction: r.direction as "in" | "out",
        text_body: r.text_body,
        msg_type: r.msg_type,
        media_url: r.media_url,
        created_at: r.created_at,
        is_ai: raw.ai === true,
        sender_name: pickString(raw, "pushName", "senderName", "notifyName", "contactName"),
        sender_phone: digits(pickString(raw, "participantPn", "senderPn", "phoneNumber")),
      };
    });
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

    const { data: conv } = await supabase
      .from("wa_conversations")
      .select("contact_phone")
      .eq("user_id", userId)
      .eq("remote_jid", data.remoteJid)
      .maybeSingle();
    const { data: recentRaw } = await supabase
      .from("wa_messages")
      .select("raw")
      .eq("user_id", userId)
      .eq("remote_jid", data.remoteJid)
      .not("raw", "is", null)
      .order("created_at", { ascending: false })
      .limit(20);
    const rawPhone = (recentRaw ?? []).map((msg) => phoneFromRaw(msg.raw)).find(Boolean) ?? null;
    const phoneDigits = (rawPhone || conv?.contact_phone || data.remoteJid.replace(/[^0-9]/g, "")).replace(/[^0-9]/g, "");
    const to = data.remoteJid.endsWith("@g.us")
      ? data.remoteJid
      : data.remoteJid.includes("@")
        ? data.remoteJid
        : phoneDigits
          ? `${phoneDigits}@s.whatsapp.net`
          : data.remoteJid;
    try {
      await waBridge.sendText(sess.session_id, to, data.text);
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
      to_phone: phoneDigits || to,
      msg_type: "text",
      text_body: data.text,
    });

    await upsertConversationFromMessage({
      userId,
      sessionId: sess.session_id,
      remoteJid: data.remoteJid,
      contactName: null,
      contactPhone: phoneDigits || null,
      text: data.text,
      direction: "out",
    });

    return { ok: true };
  });

// ─── AI Settings ───────────────────────────────────────────────────────────

export interface WaAiSettings {
  ai_enabled: boolean;
  ai_model: string;
  ai_tier_simple: string | null;
  ai_tier_smart: string | null;
  ai_tier_negotiation: string | null;
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
  ai_tier_simple: null,
  ai_tier_smart: null,
  ai_tier_negotiation: null,
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

export const listAvailableModelTiers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("ai_model_tiers")
      .select("tier, model_name, display_name_ar, display_name_en, sort_order")
      .eq("enabled", true)
      .order("tier")
      .order("sort_order");
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

export const getAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WaAiSettings> => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("whatsapp_settings")
      .select(
        "ai_enabled, ai_model, ai_tier_simple, ai_tier_smart, ai_tier_negotiation, ai_system_prompt, ai_welcome_message, ai_business_hours_only, ai_working_hours_start, ai_working_hours_end, ai_blacklist, ai_knowledge_base, ai_max_context_messages, ai_reply_delay_seconds",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (!data) return DEFAULTS;
    return {
      ai_enabled: data.ai_enabled ?? false,
      ai_model: data.ai_model ?? DEFAULTS.ai_model,
      ai_tier_simple: data.ai_tier_simple ?? null,
      ai_tier_smart: data.ai_tier_smart ?? null,
      ai_tier_negotiation: data.ai_tier_negotiation ?? null,
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
  ai_tier_simple: z.string().min(1).max(100).nullable(),
  ai_tier_smart: z.string().min(1).max(100).nullable(),
  ai_tier_negotiation: z.string().min(1).max(100).nullable(),
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
