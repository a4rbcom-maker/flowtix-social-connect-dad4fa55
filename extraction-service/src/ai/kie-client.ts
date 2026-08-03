import { logger } from "../logger.js";

const log = logger;

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }
export interface ChatResult {
  content: string; model: string;
  promptTokens?: number; completionTokens?: number; totalTokens?: number;
  latencyMs: number; success: boolean; error?: string;
}

export async function kieChat(input: {
  baseUrl: string; apiKey: string; model: string;
  messages: ChatMessage[]; temperature?: number; maxTokens?: number; timeoutMs?: number;
}): Promise<ChatResult> {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), input.timeoutMs ?? 30000);
    const res = await fetch(`${input.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: input.temperature ?? 0.5,
        max_tokens: input.maxTokens ?? 1024,
      }),
    });
    clearTimeout(to);
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      log.error("KieClient", `HTTP ${res.status}: ${txt.slice(0, 200)}`);
      return { content: "", model: input.model, latencyMs, success: false, error: `HTTP ${res.status}` };
    }
    const json: any = await res.json();
    const content = json.choices?.[0]?.message?.content ?? "";
    const usage = json.usage ?? {};
    return { content, model: json.model ?? input.model, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens, totalTokens: usage.total_tokens, latencyMs, success: true };
  } catch (e: any) {
    const latencyMs = Date.now() - started;
    log.error("KieClient", `error: ${String(e?.message ?? e)}`);
    return { content: "", model: input.model, latencyMs, success: false, error: String(e?.message ?? e) };
  }
}

export function estimateCost(model: string, totalTokens: number | undefined): number {
  if (!totalTokens) return 0;
  const per1k: Record<string, number> = { "glm-flash": 0.0001, "glm-5.2": 0.002, "deepseek-v4": 0.002, "claude-3-5-sonnet": 0.015, "gpt-4o": 0.005 };
  return Number(((totalTokens / 1000) * (per1k[model] ?? 0.001)).toFixed(6));
}
