// WhatsApp chat & AI settings — TanStack server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBridgeSendQueued, bridgeSendQueuedMessage, waBridge, sendTextWithReconnect, sendMediaWithReconnect } from "./wa-bridge.server";
import { deriveWebhookUrl, describeBridgeError } from "./wa-helpers.server";
import { upsertConversationFromMessage } from "./wa-ai.server";
import { isBridgeSessionMissingError, resetWaSessionAfterBridgeLoss } from "./wa-session-repair.server";
import { resolveOutgoingWhatsappTarget } from "./wa-recipient.server";
import {
  asRecord,
  cleanMessageText,
  digits,
  mediaTypeFromRaw,
  mediaUrlFromRaw,
  normalizeWhatsappPhone,
  phoneFromRaw,
  pickString,
  previewTextFromRaw,
  profilePicFromRaw,
} from "./wa-chat-helpers.server";

export interface ConversationRow {
  id: string;
  session_id?: string;
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
  delivery_state?: string | null;
  queued_id?: string | null;
  delivery_error?: string | null;
  is_stale_pending?: boolean;
}



export const listConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConversationRow[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("wa_conversations")
      .select(
        "id, session_id, remote_jid, contact_name, contact_phone, profile_pic_url, last_message_text, last_message_at, last_direction, unread_count, ai_enabled",
      )
      .eq("user_id", userId)
      .eq("is_archived", false)
      .order("last_message_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ConversationRow[];
    if (!rows.length) return [];

    // NOTE: We intentionally do NOT scan wa_messages.raw here anymore.
    // That JSONB blob is TOASTed and heavy; fetching it on every inbox open
    // saturated disk IO. Preview text, phone and profile pic are now stored
    // directly on wa_conversations by the webhook.
    return rows.map((row) => {
      const isGroup = row.remote_jid.endsWith("@g.us");
      return {
        ...row,
        contact_phone: isGroup ? null : row.contact_phone,
        profile_pic_url: row.profile_pic_url ?? null,
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
      .select("id, remote_jid, direction, status, text_body, msg_type, media_url, wa_timestamp, created_at, raw")
      .eq("user_id", userId)
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
        text: z.string().trim().max(4000).optional().default(""),
        mediaUrl: z.string().url().max(2048).optional(),
        mediaType: z.enum(["image", "video", "document", "audio"]).optional(),
        mimeType: z.string().max(120).optional(),
        fileName: z.string().max(200).optional(),
      })
      .refine((v) => (v.text && v.text.length > 0) || !!v.mediaUrl, {
        message: "Provide text or media",
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
      .order("updated_at", { ascending: false })
      .limit(1)
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
    const target = await resolveOutgoingWhatsappTarget({
      userId,
      sessionId: sess.session_id,
      remoteJid: data.remoteJid,
      fallbackPhoneOrJid: rawPhone || conv?.contact_phone || data.remoteJid,
    });
    const phoneDigits = target.phoneDigits || normalizeWhatsappPhone(data.remoteJid) || data.remoteJid.replace(/[^0-9]/g, "");
    const to = target.jid;
    const sentAt = new Date().toISOString();
    const hasMedia = !!data.mediaUrl;
    const mediaType = data.mediaType ?? "image";
    try {
      const webhookUrl = await deriveWebhookUrl().catch(() => null);
      const res = hasMedia
        ? await sendMediaWithReconnect(sess.session_id, to, data.mediaUrl!, {
            caption: data.text,
            mediaType,
            mimeType: data.mimeType,
            fileName: data.fileName,
            recipientPhone: phoneDigits,
          })
        : await sendTextWithReconnect(sess.session_id, to, data.text, {
            webhookUrl: webhookUrl ?? undefined,
            tenantId: userId,
            recipientPhone: phoneDigits,
          });
      const queuedId = bridgeSendQueuedMessage(res);
      let providerMessageId: string | null = null;
      let status = "sent";
      let delivery = "whatsapp_acknowledged";
      try {
        providerMessageId = assertBridgeSendQueued(res);
      } catch (err) {
        if (!queuedId) throw err;
        status = "pending";
        delivery = "bridge_queued_waiting_for_whatsapp_ack";
      }
      await supabase.from("wa_messages").insert({
        user_id: userId,
        session_id: sess.session_id,
        direction: "out",
        remote_jid: data.remoteJid,
        to_phone: phoneDigits || to,
        msg_type: hasMedia ? mediaType : "text",
        text_body: data.text || null,
        media_url: hasMedia ? data.mediaUrl : null,
        status,
        provider_message_id: providerMessageId,
        wa_timestamp: sentAt,
        raw: {
          bridgeMessageId: providerMessageId,
          queuedId,
          delivery,
          targetJid: to,
          usedLid: target.usedLid,
          ...(hasMedia
            ? { mediaData: { url: data.mediaUrl, mimeType: data.mimeType, fileName: data.fileName, caption: data.text } }
            : {}),
          bridgeResponse: res,
        } as never,
      });
    } catch (err) {
      if (isBridgeSessionMissingError(err)) {
        await resetWaSessionAfterBridgeLoss({
          userId,
          oldSessionId: sess.session_id,
          reason: "manual chat send failed",
        });
      }
      const msg = describeBridgeError(err);
      console.error("[wa-chat] sendText failed:", msg, "to=", to);
      throw new Error(msg);
    }

    await upsertConversationFromMessage({
      userId,
      sessionId: sess.session_id,
      remoteJid: data.remoteJid,
      contactName: null,
      contactPhone: phoneDigits || null,
      text: data.text || (hasMedia ? `[${mediaType}]` : ""),
      direction: "out",
      messageAt: sentAt,
    });


    return { ok: true };
  });


// ─── Test Message ──────────────────────────────────────────────────────────

export const sendTestMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        phone: z.string().trim().min(6).max(24),
        text: z.string().trim().min(1).max(1000).optional(),
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

    const phoneDigits = normalizeWhatsappPhone(data.phone);
    if (!phoneDigits || phoneDigits.length < 6) throw new Error("Invalid phone number");
    const to = `${phoneDigits}@s.whatsapp.net`;
    const text = data.text?.trim() || `✅ رسالة اختبار من Flowtix — ${new Date().toLocaleString("ar-EG")}`;
    const sentAt = new Date().toISOString();

    try {
      const webhookUrl = await deriveWebhookUrl().catch(() => null);
      const res = await sendTextWithReconnect(sess.session_id, to, text, {
        webhookUrl: webhookUrl ?? undefined,
        tenantId: userId,
        recipientPhone: phoneDigits,
      });
      const queuedId = bridgeSendQueuedMessage(res);
      let providerMessageId: string | null = null;
      let status = "sent";
      let delivery = "whatsapp_acknowledged";
      try {
        providerMessageId = assertBridgeSendQueued(res);
      } catch (err) {
        if (!queuedId) throw err;
        status = "pending";
        delivery = "bridge_queued_waiting_for_whatsapp_ack";
      }
      const { data: inserted, error: insErr } = await supabase
        .from("wa_messages")
        .insert({
          user_id: userId,
          session_id: sess.session_id,
          direction: "out",
          remote_jid: to,
          to_phone: phoneDigits,
          msg_type: "text",
          text_body: text,
          status,
          provider_message_id: providerMessageId,
          wa_timestamp: sentAt,
          raw: {
            test: true,
            bridgeMessageId: providerMessageId,
            queuedId,
            delivery,
            targetJid: to,
            bridgeResponse: res,
          } as never,
        })
        .select("id, status, wa_timestamp")
        .single();
      if (insErr) throw new Error(insErr.message);

      await upsertConversationFromMessage({
        userId,
        sessionId: sess.session_id,
        remoteJid: to,
        contactName: null,
        contactPhone: phoneDigits,
        text,
        direction: "out",
        messageAt: sentAt,
      });

      return {
        ok: true,
        status,
        delivery,
        phone: phoneDigits,
        remoteJid: to,
        messageId: inserted?.id ?? null,
        providerMessageId,
        queuedId,
        text,
        sentAt,
      };
    } catch (err) {
      if (isBridgeSessionMissingError(err)) {
        await resetWaSessionAfterBridgeLoss({
          userId,
          oldSessionId: sess.session_id,
          reason: "test send failed",
        });
      }
      const msg = describeBridgeError(err);
      throw new Error(msg);
    }
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
  ai_model: "gemini-2.5-flash",
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
    const payload = {
      ...data,
      ai_provider: "kie",
      ai_model: data.ai_model || DEFAULTS.ai_model,
      updated_at: new Date().toISOString(),
    };
    // Ensure a row exists (whatsapp_settings has connection_type NOT NULL default)
    const { data: existing } = await supabase
      .from("whatsapp_settings")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) {
      const { error } = await supabase
        .from("whatsapp_settings")
        .update(payload)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("whatsapp_settings")
        .insert({ ...payload, user_id: userId, connection_type: "qr_code" });
      if (error) throw new Error(error.message);
    }

    // When the global AI Agent is switched on, make that state effective for
    // existing customers too. Old conversations may carry ai_enabled=false from
    // a previous UI toggle, which made users think the package-level AI was on
    // while some customers were silently skipped.
    if (data.ai_enabled) {
      const { error: convErr } = await supabase
        .from("wa_conversations")
        .update({ ai_enabled: true })
        .eq("user_id", userId)
        .eq("ai_enabled", false);
      if (convErr) throw new Error(convErr.message);
    }

    const { data: saved, error: readErr } = await supabase
      .from("whatsapp_settings")
      .select("ai_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    return { ok: true, ai_enabled: saved?.ai_enabled === true };
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

// ─── Conversation summary (kie.ai) ─────────────────────────────────────────
export const summarizeConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        remoteJid: z.string().min(1).max(200),
        limit: z.number().int().min(5).max(200).optional().default(80),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<{ summary: string; model: string; provider: "kie"; messageCount: number }> => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("wa_messages")
      .select("direction, text_body, raw, created_at, msg_type")
      .eq("user_id", userId)
      .eq("remote_jid", data.remoteJid)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) throw new Error("No messages to summarize");

    const ordered = [...rows].reverse();
    const transcript = ordered
      .map((r) => {
        const who = r.direction === "out" ? "AGENT" : "CUSTOMER";
        const text = previewTextFromRaw(r.raw, r.text_body, r.msg_type) || `[${r.msg_type ?? "media"}]`;
        return `${who}: ${text}`;
      })
      .join("\n")
      .slice(0, 12000);

    const { data: settings } = await supabase
      .from("whatsapp_settings")
      .select("ai_model, ai_tier_smart")
      .eq("user_id", userId)
      .maybeSingle();
    const model = settings?.ai_tier_smart || settings?.ai_model || "gemini-2.5-flash";

    const { callKieChat } = await import("./ai-pool.server");
    const result = await callKieChat({
      userId,
      model,
      tier: "smart",
      temperature: 0.3,
      maxTokens: 600,
      messages: [
        {
          role: "system",
          content:
            "أنت مساعد يلخّص محادثات خدمة العملاء بالعربية. اكتب ملخصًا موجزًا واضحًا يشمل: (1) طلب العميل الأساسي، (2) أهم النقاط التي دارت، (3) الحالة الحالية، (4) الإجراء التالي المقترح. استخدم نقاطًا قصيرة، بدون مقدمات.",
        },
        { role: "user", content: `المحادثة:\n${transcript}` },
      ],
    });
    if (result.error || !result.text) {
      throw new Error(result.error || "AI provider returned empty summary");
    }
    return {
      summary: result.text.trim(),
      model: result.model,
      provider: "kie",
      messageCount: ordered.length,
    };
  });
