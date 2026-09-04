export type AiRouteLevel = "l1" | "l2" | "l3" | "human";

export interface AiProviderConfig {
  id: string; workspace_id: string; base_url: string; api_key_enc?: string | null;
  models: { l1: string; l2: string; l3: string }; settings: Record<string, any>; cost_caps: Record<string, any>;
  is_active: boolean; created_at: string; updated_at: string;
}
export interface AiInstructionItem {
  id: string; workspace_id: string; category: string;
  instructions: string; is_active: boolean; created_at: string; updated_at: string;
}
export interface AiInvocation {
  id: string; workspace_id: string; level: string; intent?: string | null; model: string;
  provider: string; prompt_tokens?: number | null; completion_tokens?: number | null;
  total_tokens?: number | null; cost_usd?: number | null; latency_ms?: number | null;
  confidence?: number | null; success: boolean; error?: string | null; escalated_to_human: boolean; created_at: string;
}

// ملاحظة: القائمة الفعلية تأتي من جدول ai_models (كتالوج kie.ai الرسمي، انظر src/lib/kie-chat-models-catalog.ts)
// وAI_MODELS الثابتة حُذفت — كانت تحتوي أسماء موديلات غير موجودة عند kie.ai (glm-*/deepseek/gpt-4o/claude-3-5-sonnet)

export interface AiLevelDef {
  id: "l1" | "l2" | "l3";
  label: { en: string; ar: string };
  desc: { en: string; ar: string };
  intents: string[];
  defaultModel: string;
  defaultTemp: number;
}

export const AI_LEVELS: AiLevelDef[] = [
  { id: "l1", label: { en: "Level 1 — Simple",   ar: "المستوى 1 — بسيط" },
    desc:   { en: "Ordinary replies, traditional questions", ar: "للردود العادية والأسئلة التقليدية (ترحيب، أسئلة شائعة)" },
    intents: ["greeting", "faq"], defaultModel: "gemini-3.5-flash", defaultTemp: 0.3 },
  { id: "l2", label: { en: "Level 2 — Medium",   ar: "المستوى 2 — متوسط" },
    desc:   { en: "Explaining services, sales negotiation", ar: "للشرح والتفاوض في المبيعات والعروض" },
    intents: ["sales"], defaultModel: "gemini-3.7-flash", defaultTemp: 0.5 },
  { id: "l3", label: { en: "Level 3 — Advanced", ar: "المستوى 3 — متقدم" },
    desc:   { en: "Price objections, complex negotiation, technical issues", ar: "للاعتراضات على السعر والتفاوض المعقد والمشاكل التقنية" },
    intents: ["complaint", "technical"], defaultModel: "claude-sonnet-5", defaultTemp: 0.7 },
];
