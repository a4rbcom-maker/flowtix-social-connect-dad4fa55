// WhatsApp chat & AI settings — TanStack server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { waBridge, BridgeError, sendTextWithReconnect } from "./wa-bridge.server";
import { deriveWebhookUrl } from "./wa-helpers.server";
import { upsertConversationFromMessage } from "./wa-ai.server";
import {
  asRecord,
  cleanMessageText,
  digits,
  mediaTypeFromRaw,
  mediaUrlFromRaw,
  phoneFromRaw,
  pickString,
  previewTextFromRaw,
  profilePicFromRaw,
} from "./wa-chat-helpers.server";

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
  status: string;
  text_body: string | null;
  msg_type: string;
  media_url: string | null;
  created_at: string;
  is_ai: boolean;
  sender_name: string | null;
  sender_phone: string | null;
}



export const listConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConversationRow[]> => {
    const { supabase, userId } = context;
    const { data: sess } = await supabase
      .from("wa_sessions")
      .select("session_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!sess?.session_id) return [];

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
      .select("remote_jid, text_body, msg_type, raw, wa_timestamp, created_at")
      .eq("user_id", userId)
      .in("remote_jid", remoteJids)
      .not("raw", "is", null)
      .order("wa_timestamp", { ascending: false })
      .limit(1000);



    const metaByJid = new Map<string, { phone: string | null; profile: string | null; preview: string | null }>();
    for (const msg of rawMessages ?? []) {
      const jid = String(msg.remote_jid ?? "");
      if (!jid) continue;
      const current = metaByJid.get(jid) ?? { phone: null, profile: null, preview: null };
      const next = {
        phone: current.phone ?? phoneFromRaw(msg.raw),
        profile: current.profile ?? profilePicFromRaw(msg.raw),
        preview: current.preview ?? previewTextFromRaw(msg.raw, msg.text_body, msg.msg_type),
      };
      metaByJid.set(jid, next);
    }

    return rows.map((row) => {
      const meta = metaByJid.get(row.remote_jid);
      const isGroup = row.remote_jid.endsWith("@g.us");
      return {
        ...row,
        contact_phone: isGroup ? null : (meta?.phone ?? row.contact_phone),
        last_message_text: meta?.preview ?? row.last_message_text,
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
    const { data: sess } = await supabase
      .from("wa_sessions")
      .select("session_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!sess?.session_id) return [];

    const { data: rows, error } = await supabase
      .from("wa_messages")
      .select("id, remote_jid, direction, status, text_body, msg_type, media_url, wa_timestamp, created_at, raw")
      .eq("user_id", userId)
      .eq("session_id", sess.session_id)
      .eq("remote_jid", data.remoteJid)
      .order("wa_timestamp", { ascending: true })
      .limit(1000);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => {
      const raw = asRecord(r.raw);
      const msgType = mediaTypeFromRaw(raw, r.msg_type);
      const storedMediaUrl = typeof r.media_url === "string" && r.media_url.trim() ? r.media_url.trim() : null;
      const rawMediaUrl = mediaUrlFromRaw(raw, msgType);
      return {
        id: r.id,
        remote_jid: r.remote_jid,
        direction: r.direction as "in" | "out",
        status: r.status ?? (r.direction === "out" ? "sent" : "received"),
        text_body: cleanMessageText(r.text_body, raw, msgType),
        msg_type: msgType,
        media_url: preferChatMediaUrl(storedMediaUrl, rawMediaUrl),
        created_at: r.wa_timestamp ?? r.created_at,
        is_ai: raw.ai === true,
        sender_name: pickString(raw, "pushName", "senderName", "notifyName", "contactName"),
        sender_phone: digits(pickString(raw, "participantPn", "senderPn", "phoneNumber")),
      };
    });
  });


function isWaStorageUrl(url: string | null | undefined): boolean {
  const value = url?.trim() ?? "";
  return value.startsWith("wa-media:") || value.startsWith("storage://wa-media/");
}

function preferChatMediaUrl(storedUrl: string | null, rawUrl: string | null): string | null {
  if (isWaStorageUrl(storedUrl)) return storedUrl;
  if (rawUrl?.startsWith("data:") || isWaStorageUrl(rawUrl)) return rawUrl;
  if (storedUrl && /^(https?:)?\/\//i.test(storedUrl)) return storedUrl;
  return rawUrl ?? storedUrl;
}

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
    const sentAt = new Date().toISOString();
    try {
      const webhookUrl = await deriveWebhookUrl().catch(() => null);
      const res = await sendTextWithReconnect(sess.session_id, to, data.text, {
        webhookUrl: webhookUrl ?? undefined,
        tenantId: userId,
      });
      // Bridge may return 200 with ok:false / error message — surface it.
      if (res && (res.ok === false || res.error)) {
        throw new Error(res.error || res.message || "Bridge refused to deliver");
      }
      const providerMessageId = typeof res?.id === "string" ? res.id : null;
      await supabase.from("wa_messages").insert({
        user_id: userId,
        session_id: sess.session_id,
        direction: "out",
        remote_jid: data.remoteJid,
        to_phone: phoneDigits || to,
        msg_type: "text",
        text_body: data.text,
        status: "sent",
        provider_message_id: providerMessageId,
        wa_timestamp: sentAt,
        raw: providerMessageId ? ({ bridgeMessageId: providerMessageId } as never) : null,
      });
    } catch (err) {
      const msg =
        err instanceof BridgeError ? err.message : err instanceof Error ? err.message : "Bridge error";
      console.error("[wa-chat] sendText failed:", msg, "to=", to);
      throw new Error(msg);
    }

    await upsertConversationFromMessage({
      userId,
      sessionId: sess.session_id,
      remoteJid: data.remoteJid,
      contactName: null,
      contactPhone: phoneDigits || null,
      text: data.text,
      direction: "out",
      messageAt: sentAt,
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
        .insert({ ...data, user_id: userId, connection_type: "qr_code" });
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

export interface ExtractedContact {
  phone: string;
  name: string | null;
  remote_jid: string;
  message_count: number;
  first_at: string;
  last_at: string;
}

export const extractInboundContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        from: z.string().datetime(),
        to: z.string().datetime(),
        includeGroups: z.boolean().optional().default(false),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<ExtractedContact[]> => {
    const { supabase, userId } = context;
    let query = supabase
      .from("wa_messages")
      .select("remote_jid, from_phone, raw, created_at")
      .eq("user_id", userId)
      .eq("direction", "in")
      .gte("created_at", data.from)
      .lte("created_at", data.to)
      .order("created_at", { ascending: true })
      .limit(20000);
    if (!data.includeGroups) {
      query = query.not("remote_jid", "like", "%@g.us");
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    // Get names from conversations
    const { data: convos } = await supabase
      .from("wa_conversations")
      .select("remote_jid, contact_name, contact_phone")
      .eq("user_id", userId);
    const nameByJid = new Map<string, { name: string | null; phone: string | null }>();
    for (const c of convos ?? []) {
      nameByJid.set(c.remote_jid, { name: c.contact_name, phone: c.contact_phone });
    }

    const byPhone = new Map<string, ExtractedContact>();
    for (const row of rows ?? []) {
      const jid = String(row.remote_jid ?? "");
      const rawPhone = phoneFromRaw(row.raw);
      const fromPhone = digits(row.from_phone);
      const convoPhone = digits(nameByJid.get(jid)?.phone ?? null);
      const jidPhone = digits(jid.split("@")[0] ?? "");
      const phone = rawPhone ?? fromPhone ?? convoPhone ?? jidPhone;
      if (!phone) continue;
      const existing = byPhone.get(phone);
      const ts = String(row.created_at);
      if (existing) {
        existing.message_count += 1;
        if (ts > existing.last_at) existing.last_at = ts;
        if (ts < existing.first_at) existing.first_at = ts;
      } else {
        byPhone.set(phone, {
          phone,
          name: nameByJid.get(jid)?.name ?? null,
          remote_jid: jid,
          message_count: 1,
          first_at: ts,
          last_at: ts,
        });
      }
    }
    return Array.from(byPhone.values()).sort((a, b) => b.message_count - a.message_count);
  });
