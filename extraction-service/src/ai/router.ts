import { supabaseClient } from "../services/supabase.js";
import { waManager } from "../wa/wa-manager.js";
import { logger } from "../logger.js";
import { loadProviderConfig } from "./config.js";
import { kieChat, estimateCost, type ChatMessage } from "./kie-client.js";
import { classifyIntent, defaultLevelFor, type Intent } from "./classifier.js";
import type { IncomingWaMessage } from "../wa/types.js";

const log = logger;
const CONFIDENCE_THRESHOLD = 0.5;
const MEMORY_SUMMARY_EVERY = 8;

export interface Instructions {
  name: string;
  role: string;
  company: string;
  services: string;
  training: string;
  blocked: string;
}

// Parses the frontend-saved ai_instructions blob (Arabic labels, \n-separated).
// Mirrors the parse logic in src/pages/dashboard/whatsapp/WaAIAgentPage.tsx
// (same labels, same prefix stripping) so server and client agree on the shape.
export function parseInstructions(blob: string): Instructions {
  const out: Instructions = { name: "", role: "", company: "", services: "", training: "", blocked: "" };
  if (!blob) return out;
  const sections = blob.split(/\n(?=اسم الوكيل|وظيفة|الشركة|الخدمات|تعليمات التدريب|المواضيع المحظورة)/);
  for (const s of sections) {
    if (s.startsWith("اسم الوكيل:")) out.name = s.replace("اسم الوكيل:", "").trim();
    else if (s.startsWith("وظيفة:")) out.role = s.replace("وظيفة:", "").trim();
    else if (s.startsWith("الشركة:")) out.company = s.replace("الشركة:", "").trim();
    else if (s.startsWith("الخدمات:")) out.services = s.replace("الخدمات:", "").trim();
    else if (s.startsWith("تعليمات التدريب:")) out.training = s.replace("تعليمات التدريب:", "").trim();
    else if (s.startsWith("المواضيع المحظورة:")) out.blocked = s.replace("المواضيع المحظورة:", "").trim();
  }
  return out;
}

export const aiRouter = {
  async handleMessage(m: IncomingWaMessage, conversationId?: string): Promise<{ handled: boolean; level?: string }> {
    const cfg = await loadProviderConfig(m.workspaceId);
    if (!cfg) return { handled: false };

    const { data: costToday } = await supabaseClient.rpc("get_ai_cost_today", { p_workspace_id: m.workspaceId } as never);
    if (Number(costToday ?? 0) >= cfg.costCaps.daily_usd) {
      await this.escalate(m, conversationId, "daily_cost_cap");
      return { handled: true, level: "human" };
    }

    const { intent, confidence } = classifyIntent(m.text ?? "");
    let level = defaultLevelFor(intent);
    const { data: rules } = await supabaseClient.from("ai_router_rules").select("intent,level")
      .eq("workspace_id", m.workspaceId).eq("intent", intent).eq("is_active", true).limit(1);
    if (rules && rules.length) level = rules[0].level;
    if (confidence < CONFIDENCE_THRESHOLD) level = "human";

    if (level === "human") {
      await this.escalate(m, conversationId, `low_confidence (${confidence.toFixed(2)})`);
      return { handled: true, level: "human" };
    }

    const { data: contact } = await supabaseClient.from("wa_contacts").select("id, name, push_name")
      .eq("jid", m.remoteJid).eq("workspace_id", m.workspaceId).maybeSingle();
    if (!contact) return { handled: false };

    const { data: mem } = await supabaseClient.from("ai_conversation_memory").select("*")
      .eq("contact_id", contact.id).maybeSingle();

    const { data: kbRows } = await supabaseClient.from("ai_knowledge_base").select("title, content")
      .eq("workspace_id", m.workspaceId).eq("is_active", true).limit(3);
    const kbContext = (kbRows ?? []).map((k: any) => `### ${k.title}\n${k.content}`).join("\n\n");

    // Load the latest active saved agent instructions (never fails the message flow).
    const { data: instrRow } = await supabaseClient.from("ai_instructions")
      .select("instructions").eq("workspace_id", m.workspaceId)
      .eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const instructions = parseInstructions(instrRow?.instructions ?? "");

    const systemPrompt = this.buildSystemPrompt(intent, level, contact.name ?? contact.push_name ?? "", mem?.language ?? "ar", kbContext, instructions);
    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];
    if (mem?.last_context) {
      const hist = (mem.last_context as any[]).slice(-3);
      for (const h of hist) messages.push({ role: h.role, content: h.content });
    }
    messages.push({ role: "user", content: m.text ?? "" });

    const model = (cfg.models as any)[level] ?? "glm-flash";
    const temperature = (cfg.settings as any)[`${level}_temperature`] ?? 0.5;

    const result = await kieChat({
      baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model,
      messages, temperature, maxTokens: cfg.settings.max_tokens, timeoutMs: cfg.settings.timeout_ms,
    });
    const cost = estimateCost(model, result.totalTokens);

    await supabaseClient.from("ai_invocations").insert({
      workspace_id: m.workspaceId, conversation_id: conversationId ?? null, contact_id: contact.id,
      level, intent, model, provider: "kie",
      prompt_tokens: result.promptTokens, completion_tokens: result.completionTokens,
      total_tokens: result.totalTokens, cost_usd: cost, latency_ms: result.latencyMs,
      confidence, success: result.success, error: result.error ?? null, escalated_to_human: false,
    } as never);

    if (!result.success || !result.content) {
      await this.escalate(m, conversationId, `ai_error: ${result.error}`);
      return { handled: true, level: "human" };
    }

    await waManager.send(m.sessionId, m.remoteJid, { type: "text", text: result.content } as any);

    const ctx = (mem?.last_context as any[]) ?? [];
    ctx.push({ role: "user", content: m.text ?? "" });
    ctx.push({ role: "assistant", content: result.content });
    const rolling = ctx.slice(-10);
    const newCount = (mem?.message_count ?? 0) + 1;
    let summary = mem?.summary ?? "";
    if (newCount % MEMORY_SUMMARY_EVERY === 0) {
      summary = await this.summarize(cfg, rolling);
    }
    await supabaseClient.from("ai_conversation_memory").upsert({
      workspace_id: m.workspaceId, contact_id: contact.id,
      last_context: rolling as never, message_count: newCount, summary, language: mem?.language ?? "ar",
    } as never, { onConflict: "workspace_id,contact_id" });

    if (conversationId) {
      const { data: lastOut } = await supabaseClient.from("wa_messages").select("id")
        .eq("conversation_id", conversationId).eq("direction", "outbound").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (lastOut) {
        await supabaseClient.from("wa_messages").update({
          sent_by_ai: true, ai_model: model, ai_route_level: level, ai_confidence: confidence, ai_latency_ms: result.latencyMs,
        } as never).eq("id", lastOut.id);
      }
      await supabaseClient.from("wa_conversations").update({ ai_route_level: level, last_ai_reply_at: new Date().toISOString() } as never).eq("id", conversationId);
    }

    log.info("AIRouter", `replied (${model}/${level}) cost=$${cost} conf=${confidence.toFixed(2)}`);
    return { handled: true, level };
  },

  buildSystemPrompt(intent: Intent, level: string, name: string, lang: string, kbContext: string, instructions: Instructions = { name: "", role: "", company: "", services: "", training: "", blocked: "" }): string {
    const custom = instructions.name || instructions.role || instructions.company;
    // Custom instructions (if any) override the hardcoded level-based identity.
    const role = custom
      ? [instructions.role, instructions.name ? `اسمي ${instructions.name}` : "", instructions.company ? `شركتي: ${instructions.company}` : ""].filter(Boolean).join(". ")
      : level === "l1" ? "مساعد خدمة عملاء سريع وودود"
        : level === "l2" ? "خبير مبيعات محترف يشرح الخدمات والباقات"
          : "خبير دعم فني محترف يحل المشاكل المعقدة بحرص ودقة";
    return [
      `أنت ${role}. تتحدث ${lang === "ar" ? "بالعربية الفصحى المبسطة" : lang}.`,
      `العميل: ${name}. السياق: ${intent}.`,
      instructions.services ? `خدماتنا:\n${instructions.services}` : "",
      instructions.training ? `تعليمات التدريب:\n${instructions.training}` : "",
      instructions.blocked ? `ممنوع تماماً مناقشة: ${instructions.blocked}` : "",
      kbContext ? `معلومات قد تفيدك:\n${kbContext}` : "",
      "قواعد: ردود مختصرة ومفيدة. إن لم تعرف، اطلب التحويل لموظف. لا تختلق معلومات.",
    ].filter(Boolean).join("\n\n");
  },

  async summarize(cfg: any, window: any[]): Promise<string> {
    const res = await kieChat({
      baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.models.l1,
      messages: [
        { role: "system", content: "لخّص هذه المحادثة في جملتين بصيغة مختصرة بالعربية." },
        { role: "user", content: JSON.stringify(window) },
      ],
      temperature: 0.2, maxTokens: 200, timeoutMs: 15000,
    });
    return res.success ? res.content : "";
  },

  async escalate(m: IncomingWaMessage, conversationId: string | undefined, reason: string): Promise<void> {
    if (conversationId) {
      await supabaseClient.from("wa_conversations").update({ status: "waiting", ai_route_level: "human", assigned_to: null } as never).eq("id", conversationId);
    }
    log.info("AIRouter", `escalate to human: ${reason}`);
  },
};
