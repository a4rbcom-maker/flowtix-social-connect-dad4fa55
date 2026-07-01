// Server-only: AI reply generation for WhatsApp using kie.ai (multi-key pool).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  assertBridgeSendQueued,
  bridgeSendQueuedMessage,
  BridgeError,
  sendTextWithReconnect,
  type BridgeSendResponse,
} from "./wa-bridge.server";
import { deriveWebhookUrl } from "./wa-helpers.server";
import { callKieChat, type ChatMessage } from "./ai-pool.server";
import { isBridgeSessionMissingError, resetWaSessionAfterBridgeLoss } from "./wa-session-repair.server";
import { resolveOutgoingWhatsappTarget } from "./wa-recipient.server";

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

interface AiDeliveryResult {
  providerMessageId: string | null;
  status: "sent" | "queued" | "pending" | "failed";
  attempts: number;
  lastError: string | null;
  responses: unknown[];
}

const AI_DELIVERY_ATTEMPTS = 3;
const AI_QUEUE_SETTLE_MS = 20_000;


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

function retryDelayMs(attempt: number) {
  return Math.min(900 * Math.pow(2, attempt - 1), 4_000);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Bridge send failed";
}

function shouldRetryAiSend(err: unknown): boolean {
  if (!(err instanceof BridgeError)) return true;
  if (err.status === 401 || err.status === 403 || err.status === 404) return false;
  return true;
}

async function sendAiTextOnce(
  sessionId: string,
  userId: string,
  phone: string,
  text: string,
  recipientPhone?: string | null,
): Promise<BridgeSendResponse> {
  const webhookUrl = await deriveWebhookUrl();
  const res = await sendTextWithReconnect(sessionId, phone, text, {
    webhookUrl: webhookUrl ?? undefined,
    tenantId: userId,
    recipientPhone: recipientPhone || phone,
  });
  // Log full bridge response so we can diagnose silent delivery failures.
  console.log("[wa-ai] bridge sendText response:", JSON.stringify(res));
  return res;
}

async function findConfirmedOutbound(params: {
  userId: string;
  sessionId: string;
  remoteJid: string;
  text: string;
  sinceIso: string;
  excludeMessageId: string | null;
}): Promise<{ id: string; providerMessageId: string; status: string } | null> {
  const { data } = await supabaseAdmin
    .from("wa_messages")
    .select("id, provider_message_id, status")
    .eq("user_id", params.userId)
    .eq("session_id", params.sessionId)
    .eq("remote_jid", params.remoteJid)
    .eq("direction", "out")
    .eq("text_body", params.text)
    .not("provider_message_id", "is", null)
    .gte("created_at", params.sinceIso)
    .order("created_at", { ascending: false })
    .limit(5);

  // The webhook confirmation intentionally updates the pre-created pending AI
  // row in-place. Do not exclude that row; it only appears here after it has a
  // real provider_message_id, so matching it is the exact delivery confirmation.
  const row = (data ?? []).find((item) => item.provider_message_id);
  if (!row?.provider_message_id) return null;
  return { id: row.id, providerMessageId: row.provider_message_id, status: row.status ?? "sent" };
}

async function findConfirmedOutboundLoose(params: {
  userId: string;
  sessionId: string;
  text: string;
  sinceIso: string;
  excludeMessageId: string | null;
}): Promise<{ id: string; providerMessageId: string; status: string } | null> {
  const { data } = await supabaseAdmin
    .from("wa_messages")
    .select("id, provider_message_id, status")
    .eq("user_id", params.userId)
    .eq("session_id", params.sessionId)
    .eq("direction", "out")
    .eq("text_body", params.text)
    .not("provider_message_id", "is", null)
    .gte("created_at", params.sinceIso)
    .order("created_at", { ascending: false })
    .limit(5);

  const row = (data ?? []).find((item) => item.provider_message_id);
  if (!row?.provider_message_id) return null;
  return { id: row.id, providerMessageId: row.provider_message_id, status: row.status ?? "sent" };
}

async function waitForConfirmedOutbound(params: {
  userId: string;
  sessionId: string;
  remoteJid: string;
  text: string;
  sinceIso: string;
  excludeMessageId: string | null;
}): Promise<{ providerMessageId: string; status: string } | null> {
  const deadline = Date.now() + AI_QUEUE_SETTLE_MS;
  while (Date.now() < deadline) {
    const confirmed =
      (await findConfirmedOutbound(params)) ||
      (await findConfirmedOutboundLoose({
        userId: params.userId,
        sessionId: params.sessionId,
        text: params.text,
        sinceIso: params.sinceIso,
        excludeMessageId: params.excludeMessageId,
      }));
    if (confirmed) return confirmed;
    await wait(1_500);
  }
  return null;
}

async function deliverAiTextWithRetry(opts: {
  sessionId: string;
  userId: string;
  remoteJid: string;
  phone: string;
  contactPhone?: string | null;
  text: string;
  tier?: string | null;
  model?: string | null;
  kind?: "ai" | "welcome";
}): Promise<AiDeliveryResult> {
  const { sessionId, userId, remoteJid, phone, contactPhone, text, tier, model, kind = "ai" } = opts;
  const sentAt = new Date().toISOString();
  const insertRes = await supabaseAdmin
    .from("wa_messages")
    .insert({
      user_id: userId,
      session_id: sessionId,
      direction: "out",
      remote_jid: remoteJid,
      to_phone: contactPhone || phone,
      msg_type: "text",
      text_body: text,
      status: "pending",
      provider_message_id: null,
      wa_timestamp: sentAt,
      raw: { ai: true, kind, tier, model, delivery: "pending", attempts: [] } as never,
    })
    .select("id")
    .maybeSingle();
  if (insertRes.error) {
    console.error("[wa-ai] failed to store pending delivery attempt:", insertRes.error.message);
  }
  const messageRowId = insertRes.data?.id ?? null;
  await upsertConversationFromMessage({
    userId,
    sessionId,
    remoteJid,
    contactName: null,
    contactPhone: contactPhone || phone.replace(/[^0-9]/g, "") || phone,
    text,
    direction: "out",
    messageAt: sentAt,
  });

  let providerMessageId: string | null = null;
  let lastError: string | null = null;
  const responses: unknown[] = [];
  let attempts = 0;

  for (let attempt = 1; attempt <= AI_DELIVERY_ATTEMPTS; attempt++) {
    attempts = attempt;
    try {
      const res = await sendAiTextOnce(sessionId, userId, phone, text, contactPhone);
      responses.push(res);
      const queuedId = bridgeSendQueuedMessage(res);
      try {
        providerMessageId = assertBridgeSendQueued(res);
      } catch (err) {
        if (!queuedId) throw err;
        if (messageRowId) {
          await supabaseAdmin
            .from("wa_messages")
            .update({
              status: "pending",
              raw: {
                ai: true,
                kind,
                tier,
                model,
                targetJid: phone,
                contactPhone,
                usedLid: phone.endsWith("@lid"),
                queuedId,
                delivery: "bridge_queued_waiting_for_whatsapp_ack",
                attempts,
                bridgeResponses: responses,
              } as never,
            })
            .eq("id", messageRowId);
        }
        const confirmed = await waitForConfirmedOutbound({
          userId,
          sessionId,
          remoteJid,
          text,
          sinceIso: sentAt,
          excludeMessageId: messageRowId,
        });
        if (!confirmed) {
          lastError = `bridge_queued_pending_whatsapp_ack:${queuedId}`;
          responses.push({ queuedId, status: "queued_pending_whatsapp_ack", attempt });
          if (messageRowId) {
            await supabaseAdmin
              .from("wa_messages")
              .update({
                status: "pending",
                raw: {
                  ai: true,
                  kind,
                  tier,
                  model,
                  targetJid: phone,
                  contactPhone,
                  usedLid: phone.endsWith("@lid"),
                  queuedId,
                  delivery: "bridge_queued_pending_whatsapp_ack",
                  attempts,
                  error: lastError,
                  bridgeResponses: responses,
                } as never,
              })
              .eq("id", messageRowId);
          }
          return { providerMessageId: null, status: "pending", attempts, lastError, responses };
        }
        providerMessageId = confirmed.providerMessageId;
      }
      const raw = {
        ai: true,
        kind,
        tier,
        model,
        providerMessageId,
        targetJid: phone,
        contactPhone,
        usedLid: phone.endsWith("@lid"),
        delivery: "whatsapp_acknowledged",
        attempts,
        bridgeResponses: responses,
      } as never;
      if (messageRowId) {
        await supabaseAdmin
          .from("wa_messages")
          .update({ status: "sent", provider_message_id: providerMessageId, raw })
          .eq("id", messageRowId);
      }
      return { providerMessageId, status: "sent", attempts, lastError: null, responses };
    } catch (err) {
      lastError = errorText(err);
      responses.push({ error: lastError, status: err instanceof BridgeError ? err.status : null });
      console.warn(`[wa-ai] delivery attempt ${attempt}/${AI_DELIVERY_ATTEMPTS} failed:`, lastError);
      if (messageRowId) {
        await supabaseAdmin
          .from("wa_messages")
          .update({
            status: attempt === AI_DELIVERY_ATTEMPTS || !shouldRetryAiSend(err) ? "failed" : "pending",
            raw: {
              ai: true,
              kind,
              tier,
              model,
              providerMessageId,
              targetJid: phone,
              contactPhone,
              usedLid: phone.endsWith("@lid"),
              delivery: attempt === AI_DELIVERY_ATTEMPTS || !shouldRetryAiSend(err) ? "failed" : "retrying",
              attempts: attempt,
              error: lastError,
              bridgeResponses: responses,
            } as never,
          })
          .eq("id", messageRowId);
      }
      await markSessionNeedsReconnect(userId, sessionId, err);
      if (!shouldRetryAiSend(err) || attempt === AI_DELIVERY_ATTEMPTS) break;
      await wait(retryDelayMs(attempt));
    }
  }

  const raw = {
    ai: true,
    kind,
    tier,
    model,
    providerMessageId,
    targetJid: phone,
    contactPhone,
    usedLid: phone.endsWith("@lid"),
    delivery: "failed",
    attempts,
    error: lastError,
    bridgeResponses: responses,
  } as never;
  if (messageRowId) {
    await supabaseAdmin
      .from("wa_messages")
      .update({ status: "failed", provider_message_id: providerMessageId, raw })
      .eq("id", messageRowId);
  }
  await upsertConversationFromMessage({
    userId,
    sessionId,
    remoteJid,
    contactName: null,
    contactPhone: contactPhone || phone.replace(/[^0-9]/g, "") || phone,
    text: `${text}\n\n⚠️ لم يتم تأكيد تسليم الرد للعميل. آخر خطأ: ${lastError ?? "unknown"}`,
    direction: "out",
    messageAt: sentAt,
  });
  return { providerMessageId, status: "failed", attempts, lastError, responses };
}

async function markSessionNeedsReconnect(userId: string, sessionId: string, err: unknown) {
  if (!isBridgeSessionMissingError(err)) return;
  await resetWaSessionAfterBridgeLoss({
    userId,
    oldSessionId: sessionId,
    reason: "AI reply send failed",
  });
}

async function logAiSkip(opts: {
  userId: string;
  conversationId: string | null;
  remoteJid: string;
  inboundText: string;
  model?: string | null;
  reason: string;
}) {
  await supabaseAdmin.from("wa_ai_logs").insert({
    user_id: opts.userId,
    conversation_id: opts.conversationId,
    remote_jid: opts.remoteJid,
    model: opts.model || "not-run",
    prompt_excerpt: opts.inboundText.slice(0, 500),
    response_text: null,
    tokens_in: null,
    tokens_out: null,
    latency_ms: 0,
    status: "skipped",
    error_message: opts.reason,
  });
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

    if (!settings?.ai_enabled) {
      await logAiSkip({
        userId,
        conversationId,
        remoteJid,
        inboundText,
        model: settings?.ai_model,
        reason: settings
          ? "ai_disabled: وكيل AI غير مفعّل في إعدادات هذا الحساب. فعّله من صفحة وكيل AI ثم احفظ."
          : "missing_settings: لا توجد إعدادات وكيل AI لهذا الحساب.",
      });
      return;
    }

    // Per-conversation toggle
    if (conversationId) {
      const { data: conv } = await supabaseAdmin
        .from("wa_conversations")
        .select("ai_enabled")
        .eq("id", conversationId)
        .maybeSingle();
      if (conv && conv.ai_enabled === false) {
        await logAiSkip({
          userId,
          conversationId,
          remoteJid,
          inboundText,
          model: settings.ai_model,
          reason: "conversation_ai_disabled: وكيل AI متوقف لهذه المحادثة تحديداً.",
        });
        return;
      }
    }

    // Blacklist
    // Critical delivery fix: modern WhatsApp/Baileys often identifies the real
    // chat by @lid while senderPn only contains the public phone number. Sending
    // to senderPn can make Bot-Xtra return queuedId without actual delivery.
    const target = await resolveOutgoingWhatsappTarget({
      userId,
      sessionId,
      remoteJid,
      fallbackPhoneOrJid: fromPhone || remoteJid,
    });
    const phone = target.phoneDigits || fromPhone || remoteJid.replace(/[^0-9]/g, "");
    if (settings.ai_blacklist?.some((p) => phone.includes(p.replace(/[^0-9]/g, "")))) {
      await logAiSkip({
        userId,
        conversationId,
        remoteJid,
        inboundText,
        model: settings.ai_model,
        reason: "blacklisted_phone: رقم العميل موجود في القائمة السوداء للوكيل.",
      });
      return;
    }

    // Working hours
    if (settings.ai_business_hours_only) {
      if (!isWithinWorkingHours(settings.ai_working_hours_start, settings.ai_working_hours_end)) {
        await logAiSkip({
          userId,
          conversationId,
          remoteJid,
          inboundText,
          model: settings.ai_model,
          reason: "outside_working_hours: الرسالة خارج ساعات عمل وكيل AI المحددة.",
        });
        return;
      }
    }

    // Build context: last N messages from this conversation
    const ctxLimit = Math.min(Math.max(settings.ai_max_context_messages || 10, 2), 30);
    const { data: history } = await supabaseAdmin
      .from("wa_messages")
      .select("direction, text_body, msg_type, wa_timestamp, created_at")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .eq("remote_jid", remoteJid)
      .order("wa_timestamp", { ascending: false })
      .limit(ctxLimit);


    const ordered = (history ?? []).reverse();
    const isFirstMessage = ordered.length <= 1;

    // Welcome message for first-ever inbound
    if (isFirstMessage && settings.ai_welcome_message?.trim()) {
      await deliverAiTextWithRetry({
        sessionId,
        userId,
        remoteJid,
        phone: target.jid,
        contactPhone: phone,
        text: settings.ai_welcome_message,
        kind: "welcome",
      });
    }


    // Fetch the authoritative business phone (the linked WhatsApp number)
    // so we can inject it into the system prompt and block hallucinated numbers.
    const { data: sessionRow } = await supabaseAdmin
      .from("wa_sessions")
      .select("phone_number")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .maybeSingle();
    const businessPhone = (sessionRow?.phone_number || "").toString().replace(/[^0-9+]/g, "");


    const baseSystem =
      settings.ai_system_prompt?.trim() ||
      "You are a helpful customer support assistant replying via WhatsApp. Keep replies short, friendly, and in the same language as the user.";

    // Strict anti-hallucination guardrails — the model must NEVER invent phone
    // numbers, emails, prices, links, or addresses. It may only cite values
    // that appear verbatim in the knowledge base or the injected business info.
    const guardrails = [
      "# قواعد صارمة (Guardrails)",
      "- ممنوع منعاً باتاً اختراع أي رقم هاتف أو بريد إلكتروني أو رابط أو عنوان أو سعر لم يُذكر حرفياً في «معلومات النشاط» أو «قاعدة المعرفة» أدناه.",
      "- إذا سأل العميل عن رقم/إيميل/رابط/سعر وغير موجود في المعلومات المتاحة، قل بوضوح: «سأحوّلك لأحد الزملاء ليزوّدك بهذه المعلومة» ولا تخمّن.",
      "- لا تذكر أي رقم واتساب/موبايل غير الرقم الرسمي المُدرج في «معلومات النشاط».",
      "- لا تكرر رقم العميل نفسه ولا تعطيه رقماً مختلفاً عن الرقم الرسمي.",
      "- ردودك قصيرة، بنفس لغة العميل، وبدون توقيعات أو روابط مخترعة.",
    ].join("\n");

    const businessInfo = [
      "# معلومات النشاط (المصدر الرسمي الوحيد للرقم)",
      businessPhone ? `- رقم الواتساب الرسمي: ${businessPhone}` : null,
      businessPhone
        ? `- رقم الواتساب الرسمي: ${businessPhone} (هذا هو الرقم الوحيد المسموح ذكره)`
        : "- رقم الواتساب الرسمي: غير متوفر — لا تذكر أي رقم إطلاقاً.",
    ]
      .filter(Boolean)
      .join("\n");

    const kb = settings.ai_knowledge_base?.trim();
    const systemContent = [baseSystem, guardrails, businessInfo, kb ? `# قاعدة المعرفة\n${kb}` : null]
      .filter(Boolean)
      .join("\n\n");

    const messages: ChatMessage[] = [
      { role: "system", content: systemContent },
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
    const model = settings.ai_model || tierModel || "gemini-2.5-flash";

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
    const generatedText = aiText;
    let errMsg = result.error;
    let deliveredOk = false;

    if (aiText) {
      const delivery = await deliverAiTextWithRetry({
        sessionId,
        userId,
        remoteJid,
        phone: target.jid,
        contactPhone: phone,
        text: aiText,
        tier,
        model: result.model || model,
      });
      if (delivery.status !== "sent") {
        if (delivery.status === "queued" || delivery.status === "pending") {
          errMsg = `delivery_queued_waiting_for_whatsapp_ack: ${delivery.lastError ?? "queued"}`;
        } else {
          errMsg = `delivery_failed_after_${delivery.attempts}_attempts: ${delivery.lastError ?? "unknown"}`;
          aiText = "";
        }
      } else {
        deliveredOk = true;
      }
    }


    await supabaseAdmin.from("wa_ai_logs").insert({
      user_id: userId,
      conversation_id: conversationId,
      remote_jid: remoteJid,
      model: result.model || model,
      prompt_excerpt: inboundText.slice(0, 500),
      response_text: generatedText || null,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      latency_ms: result.latencyMs,
      status: deliveredOk ? "success" : errMsg?.startsWith("delivery_queued") ? "pending" : "error",
      error_message: errMsg,
    });
  } catch (err) {
    console.error("[wa-ai] handler crashed:", err);
    await supabaseAdmin.from("wa_ai_logs").insert({
      user_id: opts.userId,
      conversation_id: opts.conversationId,
      remote_jid: opts.remoteJid,
      model: "not-run",
      prompt_excerpt: opts.inboundText.slice(0, 500),
      response_text: null,
      tokens_in: null,
      tokens_out: null,
      latency_ms: 0,
      status: "error",
      error_message: `handler_crashed: ${err instanceof Error ? err.message : "unknown error"}`,
    });
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
  historical?: boolean;
}): Promise<string | null> {
  const { userId, sessionId, remoteJid, contactName, contactPhone, text, direction, historical } = opts;
  const messageAt = opts.messageAt ?? new Date().toISOString();
  const safeContactName = direction === "in" || remoteJid.endsWith("@g.us") ? contactName : null;
  const localPart = remoteJid.split("@")[0] ?? "";
  const looksLikeLidAlias = /^\d{14,}$/.test(localPart);
  const safeContactPhone = looksLikeLidAlias && contactPhone?.replace(/[^0-9]/g, "") === localPart ? null : contactPhone;
  const aliasJids = Array.from(
    new Set([
      remoteJid,
      ...(looksLikeLidAlias && remoteJid.endsWith("@lid") ? [`${localPart}@s.whatsapp.net`] : []),
      ...(looksLikeLidAlias && remoteJid.endsWith("@s.whatsapp.net") ? [`${localPart}@lid`] : []),
      ...(safeContactPhone ? [`${safeContactPhone}@s.whatsapp.net`] : []),
    ]),
  );

  // Try update first. WhatsApp may send the same direct chat as both a LID
  // (123...@lid) and a phone-looking alias (123...@s.whatsapp.net). Treat
  // those as one conversation when the sibling row already exists.
  const { data: existingRows } = await supabaseAdmin
    .from("wa_conversations")
    .select("id, unread_count, contact_name, contact_phone, last_message_at, remote_jid")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .in("remote_jid", aliasJids)
    .limit(aliasJids.length);
  const existing =
    (existingRows ?? []).find((row) => String(row.remote_jid ?? "").endsWith("@lid")) ??
    (existingRows ?? []).find((row) => row.remote_jid === remoteJid) ??
    (existingRows ?? []).find((row) => row.id);

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
        // Never increment unread for historical (back-fill) inbound messages.
        unread_count:
          !historical && direction === "in"
            ? (existing.unread_count || 0) + 1
            : existing.unread_count,
        contact_name: existing.contact_name || safeContactName,
        contact_phone: safeContactPhone || existing.contact_phone,
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
      contact_name: safeContactName,
      contact_phone: safeContactPhone,
      last_message_text: text ?? null,
      last_message_at: messageAt,
      last_direction: direction,
      unread_count: !historical && direction === "in" ? 1 : 0,
    })
    .select("id")
    .maybeSingle();

  return inserted?.id ?? null;
}


