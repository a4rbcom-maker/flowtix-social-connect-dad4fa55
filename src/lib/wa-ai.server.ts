// Server-only: AI reply generation for WhatsApp using Lovable AI Gateway.
// Called from the webhook when an inbound message arrives and AI is enabled.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { waBridge } from "./wa-bridge.server";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

interface AiSettings {
  ai_enabled: boolean;
  ai_model: string | null;
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
        "ai_enabled, ai_model, ai_system_prompt, ai_welcome_message, ai_business_hours_only, ai_working_hours_start, ai_working_hours_end, ai_blacklist, ai_knowledge_base, ai_max_context_messages",
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

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      console.error("[wa-ai] LOVABLE_API_KEY missing");
      return;
    }

    // Build context: last N messages from this conversation
    const ctxLimit = Math.min(Math.max(settings.ai_max_context_messages || 10, 2), 30);
    const { data: history } = await supabaseAdmin
      .from("wa_messages")
      .select("direction, text_body, msg_type, created_at")
      .eq("user_id", userId)
      .eq("remote_jid", remoteJid)
      .order("created_at", { ascending: false })
      .limit(ctxLimit);

    const ordered = (history ?? []).reverse();
    const isFirstMessage = ordered.length <= 1;

    // Welcome message for first-ever inbound
    if (isFirstMessage && settings.ai_welcome_message?.trim()) {
      try {
        await waBridge.sendText(sessionId, phone, settings.ai_welcome_message);
        await supabaseAdmin.from("wa_messages").insert({
          user_id: userId,
          session_id: sessionId,
          direction: "out",
          remote_jid: remoteJid,
          to_phone: phone,
          msg_type: "text",
          text_body: settings.ai_welcome_message,
        });
      } catch (err) {
        console.error("[wa-ai] welcome send failed:", err);
      }
    }

    const systemPrompt =
      settings.ai_system_prompt?.trim() ||
      "You are a helpful customer support assistant replying via WhatsApp. Keep replies short, friendly, and in the same language as the user.";

    const kb = settings.ai_knowledge_base?.trim();
    const messages: Array<{ role: string; content: string }> = [
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

    const model = settings.ai_model || "google/gemini-2.5-flash";
    const started = Date.now();

    let aiText = "";
    let tokensIn: number | null = null;
    let tokensOut: number | null = null;
    let errMsg: string | null = null;

    try {
      const res = await fetch(LOVABLE_AI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages }),
      });
      if (!res.ok) {
        errMsg = `AI ${res.status}: ${(await res.text()).slice(0, 200)}`;
      } else {
        const j = await res.json();
        aiText = j.choices?.[0]?.message?.content?.trim() ?? "";
        tokensIn = j.usage?.prompt_tokens ?? null;
        tokensOut = j.usage?.completion_tokens ?? null;
      }
    } catch (err) {
      errMsg = err instanceof Error ? err.message : "AI request failed";
    }

    const latency = Date.now() - started;

    if (aiText) {
      try {
        await waBridge.sendText(sessionId, phone, aiText);
        await supabaseAdmin.from("wa_messages").insert({
          user_id: userId,
          session_id: sessionId,
          direction: "out",
          remote_jid: remoteJid,
          to_phone: phone,
          msg_type: "text",
          text_body: aiText,
          raw: { ai: true } as never,
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
      model,
      prompt_excerpt: inboundText.slice(0, 500),
      response_text: aiText || null,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      latency_ms: latency,
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
}): Promise<string | null> {
  const { userId, sessionId, remoteJid, contactName, contactPhone, text, direction } = opts;
  const now = new Date().toISOString();

  // Try update first
  const { data: existing } = await supabaseAdmin
    .from("wa_conversations")
    .select("id, unread_count, contact_name")
    .eq("user_id", userId)
    .eq("remote_jid", remoteJid)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from("wa_conversations")
      .update({
        last_message_text: text ?? null,
        last_message_at: now,
        last_direction: direction,
        unread_count: direction === "in" ? (existing.unread_count || 0) + 1 : existing.unread_count,
        contact_name: existing.contact_name || contactName,
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
      last_message_at: now,
      last_direction: direction,
      unread_count: direction === "in" ? 1 : 0,
    })
    .select("id")
    .maybeSingle();

  return inserted?.id ?? null;
}
