// Server-only: AI reply generation for WhatsApp using kie.ai (multi-key pool).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { waBridge } from "./wa-bridge.server";
import { callKieChat, type ChatMessage } from "./ai-pool.server";

interface AiSettings {
  ai_enabled: boolean;
  ai_model: string | null;
  ai_provider: string | null;
  ai_tier_simple: string | null;
  ai_tier_smart: string | null;
  ai_tier_negotiation: string | null;
  ai_default_tier: "simple" | "smart" | "negotiation" | null;
  ai_system_prompt: string | null;
  ai_welcome_message: string | null;
  ai_business_hours_only: boolean | null;
  ai_working_hours_start: string | null;
  ai_working_hours_end: string | null;
  ai_blacklist: string[] | null;
  ai_knowledge_base: string | null;
  ai_max_context_messages: number | null;
}


function isWithinWorkingHours(start?: string | null, end?: string | null): boolean {
  if (!start || !end) return true;
  const now = new Date();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  const s = sh * 60 + (sm || 0);
  const e = eh * 60 + (em || 0);
  return s <= e ? cur >= s && cur <= e : cur >= s || cur <= e;
}

/**
 * Handle an inbound message: maybe generate AI reply, send via bridge,
 * log to wa_ai_logs and persist as outbound wa_messages.
 * Best-effort — never throws.
 */
export async function handleAiAutoReply(opts: {
  userId: string;
  sessionId: string;
  conversationId: string | null;
  remoteJid: string;
  fromPhone: string | null;
  inboundText: string;
}): Promise<void> {
  const { userId, sessionId, conversationId, remoteJid, fromPhone, inboundText } = opts;

  if (!inboundText?.trim()) return;

  try {
    // Load global settings
    const { data: settings } = await supabaseAdmin
      .from("whatsapp_settings")
      .select(
        "ai_enabled, ai_model, ai_provider, ai_tier_simple, ai_tier_smart, ai_tier_negotiation, ai_default_tier, ai_system_prompt, ai_welcome_message, ai_business_hours_only, ai_working_hours_start, ai_working_hours_end, ai_blacklist, ai_knowledge_base, ai_max_context_messages",
      )
      .eq("user_id", userId)
      .maybeSingle<AiSettings>();

    if (!settings?.ai_enabled) return;

    // Per-conversation toggle
    if (conversationId) {
      const { data: conv } = await supabaseAdmin
        .from("wa_conversations")
        .select("ai_enabled")
        .eq("id", conversationId)
        .maybeSingle();
      if (conv && conv.ai_enabled === false) return;
    }

    // Blacklist
    const phone = fromPhone || remoteJid.replace(/[^0-9]/g, "");
    if (settings.ai_blacklist?.some((p) => phone.includes(p.replace(/[^0-9]/g, "")))) return;

    // Working hours
    if (settings.ai_business_hours_only) {
      if (!isWithinWorkingHours(settings.ai_working_hours_start, settings.ai_working_hours_end)) return;
    }

    // Build context: last N messages from this conversation
    const ctxLimit = Math.min(Math.max(settings.ai_max_context_messages || 10, 2), 30);
    const { data: history } = await supabaseAdmin
      .from("wa_messages")
      .select("direction, text_body, msg_type, wa_timestamp, created_at")
      .eq("user_id", userId)
      .eq("remote_jid", remoteJid)
      .order("wa_timestamp", { ascending: false })
      .limit(ctxLimit);


    const ordered = (history ?? []).reverse();
    const isFirstMessage = ordered.length <= 1;

    // Welcome message for first-ever inbound
    if (isFirstMessage && settings.ai_welcome_message?.trim()) {
      try {
        const welcomeRes = await waBridge.sendText(sessionId, phone, settings.ai_welcome_message);
        const providerMessageId = typeof welcomeRes?.id === "string" ? welcomeRes.id : null;
        const welcomeAt = new Date().toISOString();
        await supabaseAdmin.from("wa_messages").insert({
          user_id: userId,
          session_id: sessionId,
          direction: "out",
          remote_jid: remoteJid,
          to_phone: phone,
          msg_type: "text",
          text_body: settings.ai_welcome_message,
          status: "sent",
          provider_message_id: providerMessageId,
          wa_timestamp: welcomeAt,
          raw: { ai: true, kind: "welcome", providerMessageId } as never,
        });
        await upsertConversationFromMessage({
          userId,
          sessionId,
          remoteJid,
          contactName: null,
          contactPhone: fromPhone,
          text: settings.ai_welcome_message,
          direction: "out",
          messageAt: welcomeAt,
        });
      } catch (err) {
        console.error("[wa-ai] welcome send failed:", err);
      }
    }


    const systemPrompt =
      settings.ai_system_prompt?.trim() ||
      "You are a helpful customer support assistant replying via WhatsApp. Keep replies short, friendly, and in the same language as the user.";

    const kb = settings.ai_knowledge_base?.trim();
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: kb ? `${systemPrompt}\n\n# Knowledge base\n${kb}` : systemPrompt,
      },
    ];

    for (const m of ordered) {
      const txt = m.text_body || (m.msg_type !== "text" ? `[${m.msg_type}]` : "");
      if (!txt) continue;
      messages.push({
        role: m.direction === "in" ? "user" : "assistant",
        content: txt,
      });
    }

    // Pick model from tier configuration
    const tier = settings.ai_default_tier || "smart";
    const tierModel =
      tier === "simple"
        ? settings.ai_tier_simple
        : tier === "negotiation"
          ? settings.ai_tier_negotiation
          : settings.ai_tier_smart;
    const model = settings.ai_model || tierModel || "google/gemini-3-flash-preview";

    // Look up tier defaults for max_tokens/temperature
    const { data: tierRow } = await supabaseAdmin
      .from("ai_model_tiers")
      .select("max_tokens, temperature")
      .eq("tier", tier)
      .eq("model_name", model)
      .eq("enabled", true)
      .maybeSingle();

    const result = await callKieChat({
      model,
      messages,
      maxTokens: tierRow?.max_tokens ?? 1024,
      temperature: tierRow?.temperature ?? 0.7,
      userId,
      tier,
    });

    let aiText = result.text;
    let errMsg = result.error;

    if (aiText) {
      try {
        const sendRes = await waBridge.sendText(sessionId, phone, aiText);
        const providerMessageId = typeof sendRes?.id === "string" ? sendRes.id : null;
        const aiAt = new Date().toISOString();
        await supabaseAdmin.from("wa_messages").insert({
          user_id: userId,
          session_id: sessionId,
          direction: "out",
          remote_jid: remoteJid,
          to_phone: phone,
          msg_type: "text",
          text_body: aiText,
          status: "sent",
          provider_message_id: providerMessageId,
          wa_timestamp: aiAt,
          raw: { ai: true, tier, model: result.model || model, providerMessageId } as never,
        });
        await upsertConversationFromMessage({
          userId,
          sessionId,
          remoteJid,
          contactName: null,
          contactPhone: fromPhone,
          text: aiText,
          direction: "out",
          messageAt: aiAt,
        });
      } catch (err) {
        errMsg = err instanceof Error ? err.message : "Bridge send failed";
        aiText = "";
      }
    }


    await supabaseAdmin.from("wa_ai_logs").insert({
      user_id: userId,
      conversation_id: conversationId,
      remote_jid: remoteJid,
      model: result.model || model,
      prompt_excerpt: inboundText.slice(0, 500),
      response_text: aiText || null,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      latency_ms: result.latencyMs,
      status: aiText ? "success" : "error",
      error_message: errMsg,
    });
  } catch (err) {
    console.error("[wa-ai] handler crashed:", err);
  }
}


/**
 * Upsert conversation row from a message event. Returns conversation id.
 */
export async function upsertConversationFromMessage(opts: {
  userId: string;
  sessionId: string;
  remoteJid: string;
  contactName: string | null;
  contactPhone: string | null;
  text: string | null;
  direction: "in" | "out";
  messageAt?: string;
}): Promise<string | null> {
  const { userId, sessionId, remoteJid, contactName, contactPhone, text, direction } = opts;
  const messageAt = opts.messageAt ?? new Date().toISOString();

  // Try update first
  const { data: existing } = await supabaseAdmin
    .from("wa_conversations")
    .select("id, unread_count, contact_name, contact_phone, last_message_at")
    .eq("user_id", userId)
    .eq("remote_jid", remoteJid)
    .maybeSingle();

  if (existing) {
    // Only bump the summary if this message is newer than the existing one,
    // so historical/imported messages don't reorder the inbox.
    const existingAt = existing.last_message_at ? new Date(existing.last_message_at).getTime() : 0;
    const incomingAt = new Date(messageAt).getTime();
    const isNewer = incomingAt >= existingAt;
    await supabaseAdmin
      .from("wa_conversations")
      .update({
        session_id: sessionId,
        ...(isNewer
          ? {
              last_message_text: text ?? null,
              last_message_at: messageAt,
              last_direction: direction,
            }
          : {}),
        unread_count: direction === "in" ? (existing.unread_count || 0) + 1 : existing.unread_count,
        contact_name: existing.contact_name || contactName,
        contact_phone: contactPhone || existing.contact_phone,
      })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data: inserted } = await supabaseAdmin
    .from("wa_conversations")
    .insert({
      user_id: userId,
      session_id: sessionId,
      remote_jid: remoteJid,
      contact_name: contactName,
      contact_phone: contactPhone,
      last_message_text: text ?? null,
      last_message_at: messageAt,
      last_direction: direction,
      unread_count: direction === "in" ? 1 : 0,
    })
    .select("id")
    .maybeSingle();

  return inserted?.id ?? null;
}

