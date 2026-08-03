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

export const AI_MODELS = [
  { id: "glm-flash",          desc: { en: "Fast & economical", ar: "سريع واقتصادي" } },
  { id: "glm-5.2",            desc: { en: "Balanced",          ar: "متوازن" } },
  { id: "deepseek-v4",        desc: { en: "Balanced",          ar: "متوازن" } },
  { id: "gpt-4o",             desc: { en: "Strong reasoning",  ar: "استدلال قوي" } },
  { id: "claude-3-5-sonnet",  desc: { en: "Most capable",      ar: "الأقوى" } },
] as const;

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
    intents: ["greeting", "faq"], defaultModel: "glm-flash", defaultTemp: 0.3 },
  { id: "l2", label: { en: "Level 2 — Medium",   ar: "المستوى 2 — متوسط" },
    desc:   { en: "Explaining services, sales negotiation", ar: "للشرح والتفاوض في المبيعات والعروض" },
    intents: ["sales"], defaultModel: "glm-5.2", defaultTemp: 0.5 },
  { id: "l3", label: { en: "Level 3 — Advanced", ar: "المستوى 3 — متقدم" },
    desc:   { en: "Price objections, complex negotiation, technical issues", ar: "للاعتراضات على السعر والتفاوض المعقد والمشاكل التقنية" },
    intents: ["complaint", "technical"], defaultModel: "claude-3-5-sonnet", defaultTemp: 0.7 },
];
