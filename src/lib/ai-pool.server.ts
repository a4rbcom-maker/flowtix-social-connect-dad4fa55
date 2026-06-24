// Server-only: Central AI provider pool for kie.ai.
// Manages multiple API keys with automatic rotation on failure.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateText, type ModelMessage } from "ai";
import crypto from "crypto";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const KIE_BASE_URL = "https://api.kie.ai";
const KIE_CREDIT_URL = `${KIE_BASE_URL}/api/v1/chat/credit`;
const LOVABLE_FALLBACK_MODEL = "google/gemini-3-flash-preview";

function isLovableGatewayModel(model: string): boolean {
  return /^(google|openai)\//.test(model);
}

function toModelMessages(messages: ChatMessage[]): { system?: string; messages: ModelMessage[] } {
  const system = messages.find((m) => m.role === "system")?.content;
  return {
    system,
    messages: messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }) as ModelMessage),
  };
}

// kie.ai uses model-scoped chat endpoints, e.g. `/gpt-5-2/v1/chat/completions`.
// Normalize a model id to its URL slug (drop provider prefix, replace dots).
function modelToSlug(model: string): string {
  const tail = model.includes("/") ? model.split("/").pop()! : model;
  return tail.replace(/\./g, "-").toLowerCase();
}
function chatUrlFor(model: string): string {
  return `${KIE_BASE_URL}/${modelToSlug(model)}/v1/chat/completions`;
}

// ============= Encryption (AES-256-GCM) =============

function getKey(): Buffer {
  const raw = process.env.BOT_ENCRYPTION_KEY;
  if (!raw) throw new Error("BOT_ENCRYPTION_KEY missing");
  // Accept hex or base64 or raw 32-byte
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  const b = Buffer.from(raw, "base64");
  if (b.length === 32) return b;
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptKey(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptKey(payload: string): string {
  const [ivB64, tagB64, encB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("invalid encrypted payload");
  const key = getKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

export function keyHint(plaintext: string): string {
  const tail = plaintext.slice(-4);
  return `••••${tail}`;
}

// ============= Pool selection =============

interface PoolAccount {
  id: string;
  api_key_encrypted: string;
  priority: number;
}

async function pickAvailableAccounts(): Promise<PoolAccount[]> {
  const nowIso = new Date().toISOString();
  const { data } = await supabaseAdmin
    .from("ai_provider_accounts")
    .select("id, api_key_encrypted, priority, status, cooldown_until")
    .eq("status", "active")
    .order("priority", { ascending: true })
    .order("last_used_at", { ascending: true, nullsFirst: true });

  return (data ?? []).filter(
    (a) => !a.cooldown_until || a.cooldown_until <= nowIso,
  ) as PoolAccount[];
}

async function markSuccess(accountId: string) {
  await supabaseAdmin.rpc as never; // noop placeholder
  await supabaseAdmin
    .from("ai_provider_accounts")
    .update({
      last_used_at: new Date().toISOString(),
      requests_count: (await currentCount(accountId, "requests_count")) + 1,
    })
    .eq("id", accountId);
}

async function currentCount(id: string, col: "requests_count" | "failed_count"): Promise<number> {
  const { data } = await supabaseAdmin
    .from("ai_provider_accounts")
    .select(col)
    .eq("id", id)
    .maybeSingle<Record<string, number>>();
  return Number(data?.[col] ?? 0);
}

async function markFailure(accountId: string, statusCode: number, message: string) {
  const failed = (await currentCount(accountId, "failed_count")) + 1;
  const base = {
    last_error_at: new Date().toISOString(),
    last_error_message: message.slice(0, 500),
    failed_count: failed,
  };

  if (statusCode === 401 || statusCode === 403) {
    await supabaseAdmin.from("ai_provider_accounts").update({ ...base, status: "error" as const }).eq("id", accountId);
  } else if (statusCode === 402) {
    await supabaseAdmin.from("ai_provider_accounts").update({ ...base, status: "exhausted" as const }).eq("id", accountId);
  } else if (statusCode === 429) {
    await supabaseAdmin.from("ai_provider_accounts").update({ ...base, cooldown_until: new Date(Date.now() + 5 * 60_000).toISOString() }).eq("id", accountId);
  } else {
    await supabaseAdmin.from("ai_provider_accounts").update(base).eq("id", accountId);
  }
}


// ============= Public API =============

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface KieResult {
  text: string;
  model: string;
  accountId: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
  error: string | null;
}

export async function callKieChat(opts: {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  userId: string;
  tier?: "simple" | "smart" | "negotiation";
}): Promise<KieResult> {
  const started = Date.now();

  if (isLovableGatewayModel(opts.model)) {
    return callLovableChat(opts, started);
  }

  const accounts = await pickAvailableAccounts();

  if (accounts.length === 0) {
    return callLovableChat(opts, started, "no active kie.ai accounts in pool");
  }

  let lastError = "unknown";
  let lastStatus = 0;

  for (const account of accounts.slice(0, 3)) {
    let apiKey: string;
    try {
      apiKey = decryptKey(account.api_key_encrypted);
    } catch (err) {
      lastError = `decrypt failed: ${err instanceof Error ? err.message : "?"}`;
      await markFailure(account.id, 0, lastError);
      continue;
    }

    try {
      const res = await fetch(chatUrlFor(opts.model), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages,
          max_tokens: opts.maxTokens ?? 1024,
          temperature: opts.temperature ?? 0.7,
        }),
      });

      if (!res.ok) {
        lastStatus = res.status;
        lastError = `kie ${res.status}: ${(await res.text()).slice(0, 200)}`;
        await markFailure(account.id, res.status, lastError);
        // 401/402/429/5xx → try next account
        continue;
      }


      const j = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const text = j.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) {
        lastError = "empty response";
        await markFailure(account.id, 0, lastError);
        continue;
      }

      await markSuccess(account.id);

      const result: KieResult = {
        text,
        model: opts.model,
        accountId: account.id,
        tokensIn: j.usage?.prompt_tokens ?? null,
        tokensOut: j.usage?.completion_tokens ?? null,
        latencyMs: Date.now() - started,
        error: text ? null : "empty response",
      };
      await logUsage({ ...opts, result });
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "network failure";
      await markFailure(account.id, 0, lastError);
    }
  }

  return callLovableChat(opts, started, lastError || (lastStatus ? `kie ${lastStatus}` : undefined));
}

async function callLovableChat(
  opts: {
    model: string;
    messages: ChatMessage[];
    maxTokens?: number;
    temperature?: number;
    userId: string;
    tier?: "simple" | "smart" | "negotiation";
  },
  started = Date.now(),
  previousError?: string,
): Promise<KieResult> {
  const model = isLovableGatewayModel(opts.model) ? opts.model : LOVABLE_FALLBACK_MODEL;
  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    const result: KieResult = {
      text: "",
      model,
      accountId: null,
      tokensIn: null,
      tokensOut: null,
      latencyMs: Date.now() - started,
      error: previousError ? `${previousError}; LOVABLE_API_KEY missing` : "LOVABLE_API_KEY missing",
    };
    await logUsage({ ...opts, result });
    return result;
  }

  try {
    const gateway = createLovableAiGatewayProvider(key);
    const prompt = toModelMessages(opts.messages);
    const response = await generateText({
      model: gateway(model),
      ...prompt,
      maxOutputTokens: Math.min(Math.max(opts.maxTokens ?? 1024, 64), 2048),
      temperature: opts.temperature ?? 0.7,
      maxRetries: 1,
      timeout: { totalMs: 25_000 },
    });
    const text = response.text.trim();
    const result: KieResult = {
      text,
      model,
      accountId: null,
      tokensIn: response.usage.inputTokens ?? null,
      tokensOut: response.usage.outputTokens ?? null,
      latencyMs: Date.now() - started,
      error: text ? null : previousError ? `${previousError}; lovable empty response` : "lovable empty response",
    };
    await logUsage({ ...opts, result });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lovable AI request failed";
    const result: KieResult = {
      text: "",
      model,
      accountId: null,
      tokensIn: null,
      tokensOut: null,
      latencyMs: Date.now() - started,
      error: previousError ? `${previousError}; ${message}` : message,
    };
    await logUsage({ ...opts, result });
    return result;
  }
}

async function logUsage(opts: {
  userId: string;
  tier?: "simple" | "smart" | "negotiation";
  result: KieResult;
}) {
  try {
    await supabaseAdmin.from("ai_usage_logs").insert({
      account_id: opts.result.accountId,
      user_id: opts.userId,
      tier: opts.tier ?? null,
      model: opts.result.model,
      tokens_in: opts.result.tokensIn,
      tokens_out: opts.result.tokensOut,
      latency_ms: opts.result.latencyMs,
      status: opts.result.text ? "success" : "error",
      error_message: opts.result.error,
    });
  } catch (err) {
    console.error("[ai-pool] log insert failed:", err);
  }
}

// ============= Credit balance =============

export async function fetchKieCredit(apiKey: string): Promise<{ ok: boolean; balance: number | null; message: string }> {
  try {
    const res = await fetch(KIE_CREDIT_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, balance: null, message: `${res.status}: ${text.slice(0, 150)}` };
    let parsed: { code?: number; msg?: string; data?: number } = {};
    try { parsed = JSON.parse(text); } catch { /* ignore */ }
    if (parsed.code === 200 && typeof parsed.data === "number") {
      return { ok: true, balance: parsed.data, message: parsed.msg ?? "OK" };
    }
    return { ok: false, balance: null, message: parsed.msg ?? text.slice(0, 150) };
  } catch (err) {
    return { ok: false, balance: null, message: err instanceof Error ? err.message : "network error" };
  }
}

// Admin-only test ping — uses the credit endpoint (no credits consumed).
export async function pingKieKey(apiKey: string): Promise<{ ok: boolean; message: string; balance: number | null }> {
  const r = await fetchKieCredit(apiKey);
  return { ok: r.ok, message: r.ok ? `OK · ${r.balance} credits` : r.message, balance: r.balance };
}

// Refresh stored credit balance for an account by id. Marks exhausted if 0.
export async function refreshAccountCredit(accountId: string): Promise<{ ok: boolean; balance: number | null; message: string }> {
  const { data: row } = await supabaseAdmin
    .from("ai_provider_accounts")
    .select("api_key_encrypted")
    .eq("id", accountId)
    .maybeSingle();
  if (!row) return { ok: false, balance: null, message: "account not found" };
  let apiKey: string;
  try { apiKey = decryptKey(row.api_key_encrypted); }
  catch (err) { return { ok: false, balance: null, message: err instanceof Error ? err.message : "decrypt failed" }; }
  const r = await fetchKieCredit(apiKey);
  const update: Record<string, unknown> = {
    credit_balance: r.balance,
    credit_checked_at: new Date().toISOString(),
    credit_error: r.ok ? null : r.message,
  };
  if (r.ok && (r.balance ?? 0) <= 0) update.status = "exhausted";
  await supabaseAdmin.from("ai_provider_accounts").update(update as never).eq("id", accountId);
  return r;
}

