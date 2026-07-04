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
import { callKieChat, type ChatMessage, type ChatContentPart } from "./ai-pool.server";
import { isBridgeSessionMissingError, resetWaSessionAfterBridgeLoss } from "./wa-session-repair.server";
import { resolveOutgoingWhatsappTarget } from "./wa-recipient.server";
import { normalizeWhatsappPhone } from "./wa-chat-helpers.server";

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

const CONFIRMED_DELIVERY_STATUSES = new Set(["delivered", "read"]);

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
  const row = (data ?? []).find((item) => item.provider_message_id && CONFIRMED_DELIVERY_STATUSES.has(item.status ?? ""));
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

  const row = (data ?? []).find((item) => item.provider_message_id && CONFIRMED_DELIVERY_STATUSES.has(item.status ?? ""));
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
          const phoneDigits = String(contactPhone ?? "").replace(/[^0-9]/g, "");
          const phoneJid = phoneDigits ? `${phoneDigits}@s.whatsapp.net` : null;
          if (phone.endsWith("@lid") && phoneJid && phoneJid !== phone) {
            const fallbackRes = await sendAiTextOnce(sessionId, userId, phoneJid, text, phoneDigits);
            responses.push({ fallbackToPhoneJid: true, response: fallbackRes });
            const fallbackQueuedId = bridgeSendQueuedMessage(fallbackRes);
            try {
              providerMessageId = assertBridgeSendQueued(fallbackRes);
              if (messageRowId) {
                await supabaseAdmin
                  .from("wa_messages")
                  .update({
                    status: "sent",
                    provider_message_id: providerMessageId,
                    raw: {
                      ai: true,
                      kind,
                      tier,
                      model,
                      targetJid: phoneJid,
                      contactPhone: phoneDigits,
                      usedLid: false,
                      delivery: "whatsapp_sent_phone_fallback",
                      attempts,
                      bridgeResponses: responses,
                    } as never,
                  })
                  .eq("id", messageRowId);
              }
              return { providerMessageId, status: "sent", attempts, lastError: null, responses };
            } catch (fallbackErr) {
              if (fallbackQueuedId) {
                const fallbackConfirmed = await waitForConfirmedOutbound({
                  userId,
                  sessionId,
                  remoteJid,
                  text,
                  sinceIso: sentAt,
                  excludeMessageId: messageRowId,
                });
                if (fallbackConfirmed) {
                  providerMessageId = fallbackConfirmed.providerMessageId;
                  if (messageRowId) {
                    await supabaseAdmin
                      .from("wa_messages")
                      .update({ status: "sent", provider_message_id: providerMessageId })
                      .eq("id", messageRowId);
                  }
                  return { providerMessageId, status: "sent", attempts, lastError: null, responses };
                }
              } else {
                throw fallbackErr;
              }
            }
          }
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
      if (messageRowId && providerMessageId) {
        await supabaseAdmin
          .from("wa_messages")
          .update({
            status: "sent",
            provider_message_id: providerMessageId,
            raw: {
              ai: true,
              kind,
              tier,
              model,
              providerMessageId,
              targetJid: phone,
              contactPhone,
              usedLid: phone.endsWith("@lid"),
              queuedId,
              delivery: "whatsapp_sent",
              attempts,
              bridgeResponses: responses,
            } as never,
          })
          .eq("id", messageRowId);
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
        delivery: "whatsapp_sent",
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
export interface InboundMediaInfo {
  msgType: string;              // image | audio | video | document | sticker | text
  mediaUrl: string | null;      // wa-media:<path> or https://...
  mimeType?: string | null;     // e.g. image/jpeg, audio/ogg
  fileName?: string | null;
}

export async function handleAiAutoReply(opts: {
  userId: string;
  sessionId: string;
  conversationId: string | null;
  remoteJid: string;
  fromPhone: string | null;
  inboundText: string;
  inboundMedia?: InboundMediaInfo | null;
}): Promise<void> {
  const { userId, sessionId, conversationId, remoteJid, fromPhone, inboundText, inboundMedia } = opts;

  const hasMedia = Boolean(inboundMedia?.mediaUrl);
  if (!inboundText?.trim() && !hasMedia) return;

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

    // Per-conversation toggle + live presence pause.
    // If the user is currently viewing/typing in this conversation the inbox
    // UI pushes an agent_active_until timestamp in the future — while that
    // window is active the AI stays silent so it doesn't step on the human.
    if (conversationId) {
      const { data: conv } = await supabaseAdmin
        .from("wa_conversations")
        .select("ai_enabled, agent_active_until")
        .eq("id", conversationId)
        .maybeSingle<{ ai_enabled: boolean | null; agent_active_until: string | null }>();
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
      const activeUntil = conv?.agent_active_until ? Date.parse(conv.agent_active_until) : 0;
      if (activeUntil && activeUntil > Date.now()) {
        await logAiSkip({
          userId,
          conversationId,
          remoteJid,
          inboundText,
          model: settings.ai_model,
          reason: "user_viewing_conversation: المستخدم يفتح المحادثة أو يكتب حالياً، تم إيقاف الوكيل مؤقتاً.",
        });
        return;
      }
    }


    // Human takeover: if the business owner (or a teammate) replied manually
    // to this conversation in the last 30 minutes, pause the AI so it does not
    // interrupt the human conversation. The AI resumes automatically after 30
    // minutes of no human replies. AI-sent messages are marked with raw.ai=true
    // and are ignored by this check.
    const HUMAN_TAKEOVER_MINUTES = 30;
    {
      const since = new Date(Date.now() - HUMAN_TAKEOVER_MINUTES * 60_000).toISOString();
      const { data: humanOut } = await supabaseAdmin
        .from("wa_messages")
        .select("id, created_at, raw")
        .eq("user_id", userId)
        .eq("session_id", sessionId)
        .eq("remote_jid", remoteJid)
        .eq("direction", "out")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10);
      const lastHuman = (humanOut ?? []).find((m) => {
        const raw = (m as { raw?: { ai?: unknown } }).raw;
        return !(raw && raw.ai === true);
      });
      if (lastHuman) {
        await logAiSkip({
          userId,
          conversationId,
          remoteJid,
          inboundText,
          model: settings.ai_model,
          reason: `human_takeover: تم إيقاف الوكيل مؤقتاً لأن رداً بشرياً أُرسل خلال آخر ${HUMAN_TAKEOVER_MINUTES} دقيقة. سيعود الوكيل تلقائياً بعد ${HUMAN_TAKEOVER_MINUTES} دقيقة من الصمت.`,
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

    // History (excluding the very last inbound if it's the media we're about to attach as multimodal).
    const lastIdx = ordered.length - 1;
    for (let i = 0; i < ordered.length; i++) {
      const m = ordered[i];
      const isLast = i === lastIdx;
      // Skip last inbound if we'll re-add it as multimodal user turn below.
      if (isLast && m.direction === "in" && hasMedia) continue;
      const txt = m.text_body || (m.msg_type !== "text" ? `[${m.msg_type}]` : "");
      if (!txt) continue;
      messages.push({
        role: m.direction === "in" ? "user" : "assistant",
        content: txt,
      });
    }

    // Multimodal turn for the current inbound (image / audio / video / document)
    if (hasMedia && inboundMedia) {
      const parts = await buildMultimodalParts(inboundMedia, inboundText);
      if (parts.length > 0) {
        messages.push({ role: "user", content: parts });
      } else if (inboundText?.trim()) {
        messages.push({ role: "user", content: inboundText });
      } else {
        messages.push({
          role: "user",
          content: `أرسل العميل ملف [${inboundMedia.msgType}] لم يمكن قراءته. اطلب توضيحاً باختصار.`,
        });
      }
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
  profilePicUrl?: string | null;
}): Promise<string | null> {
  const { userId, sessionId, remoteJid, contactName, contactPhone, text, direction, historical, profilePicUrl } = opts;
  const messageAt = opts.messageAt ?? new Date().toISOString();
  const readableText = text?.trim() || null;
  const hasReadableActivity = Boolean(readableText);
  const safeContactName = direction === "in" || remoteJid.endsWith("@g.us") ? contactName : null;
  const localPart = remoteJid.split("@")[0] ?? "";
  const looksLikeLidAlias = /^\d{14,}$/.test(localPart);
  const normalizedContactPhone = normalizeWhatsappPhone(contactPhone);
  const safeContactPhone = looksLikeLidAlias && normalizedContactPhone === localPart ? null : normalizedContactPhone;
  const aliasJids = Array.from(
    new Set([
      remoteJid,
      ...(looksLikeLidAlias && remoteJid.endsWith("@lid") ? [`${localPart}@s.whatsapp.net`] : []),
      ...(looksLikeLidAlias && remoteJid.endsWith("@s.whatsapp.net") ? [`${localPart}@lid`] : []),
      ...(safeContactPhone ? [`${safeContactPhone}@s.whatsapp.net`] : []),
    ]),
  );

  const { data: jidRows } = await supabaseAdmin
    .from("wa_conversations")
    .select("id, session_id, unread_count, contact_name, contact_phone, profile_pic_url, last_message_at, remote_jid")
    .eq("user_id", userId)
    .in("remote_jid", aliasJids)
    .limit(aliasJids.length * 3);
  const { data: phoneRows } = safeContactPhone
    ? await supabaseAdmin
        .from("wa_conversations")
        .select("id, session_id, unread_count, contact_name, contact_phone, profile_pic_url, last_message_at, remote_jid")
        .eq("user_id", userId)
        .eq("contact_phone", safeContactPhone)
        .limit(10)
    : { data: [] };
  const byId = new Map<string, NonNullable<typeof jidRows>[number]>();
  for (const row of [...(jidRows ?? []), ...(phoneRows ?? [])]) {
    const rowRemotePhone = row.remote_jid.endsWith("@s.whatsapp.net") ? normalizeWhatsappPhone(row.remote_jid.split("@")[0]) : null;
    const rowContactPhone = normalizeWhatsappPhone(row.contact_phone);
    const isDirectJidMatch = aliasJids.includes(row.remote_jid);
    const conflictsWithPhone = Boolean(
      safeContactPhone &&
        !isDirectJidMatch &&
        ((rowRemotePhone && rowRemotePhone !== safeContactPhone) ||
          (rowContactPhone && rowContactPhone !== safeContactPhone)),
    );
    if (!conflictsWithPhone) byId.set(row.id, row);
  }
  const existingRows = Array.from(byId.values()).sort((a, b) => {
    const aTime = new Date(a.last_message_at ?? 0).getTime() || 0;
    const bTime = new Date(b.last_message_at ?? 0).getTime() || 0;
    return bTime - aTime;
  });
  const candidateRows = existingRows ?? [];
  const existing =
    candidateRows.find((row) => String(row.remote_jid ?? "").endsWith("@lid")) ??
    candidateRows.find((row) => row.remote_jid === remoteJid) ??
    candidateRows.find((row) => row.id);

  if (existing) {
    const existingAt = existing.last_message_at ? new Date(existing.last_message_at).getTime() : 0;
    const incomingAt = new Date(messageAt).getTime();
    const isNewer = hasReadableActivity && incomingAt >= existingAt;
    const preferIncomingLid = remoteJid.endsWith("@lid") && !String(existing.remote_jid ?? "").endsWith("@lid");
    const patch = {
      ...(preferIncomingLid ? { remote_jid: remoteJid } : {}),
      session_id: sessionId,
      ...(isNewer
        ? {
            last_message_text: readableText,
            last_message_at: messageAt,
            last_direction: direction,
          }
        : {}),
      unread_count:
        hasReadableActivity && !historical && direction === "in"
          ? (existing.unread_count || 0) + 1
          : existing.unread_count,
      contact_name: existing.contact_name || safeContactName,
      contact_phone: safeContactPhone || existing.contact_phone,
      profile_pic_url: profilePicUrl || (existing as { profile_pic_url?: string | null }).profile_pic_url || null,
    };
    const { error } = await supabaseAdmin
      .from("wa_conversations")
      .update(patch)
      .eq("id", existing.id);
    if (error && preferIncomingLid && (error as { code?: string }).code === "23505") {
      await supabaseAdmin
        .from("wa_conversations")
        .update({ ...patch, remote_jid: existing.remote_jid })
        .eq("id", existing.id);
    } else if (error) {
      console.error("[wa-ai] conversation alias update failed:", error.message);
    }
    return existing.id;
  }

  if (!hasReadableActivity) return null;

  const { data: inserted } = await supabaseAdmin
    .from("wa_conversations")
    .insert({
      user_id: userId,
      session_id: sessionId,
      remote_jid: remoteJid,
      contact_name: safeContactName,
      contact_phone: safeContactPhone,
      profile_pic_url: profilePicUrl ?? null,
      last_message_text: readableText,
      last_message_at: messageAt,
      last_direction: direction,
      unread_count: !historical && direction === "in" ? 1 : 0,
    })
    .select("id")
    .maybeSingle();

  return inserted?.id ?? null;
}



