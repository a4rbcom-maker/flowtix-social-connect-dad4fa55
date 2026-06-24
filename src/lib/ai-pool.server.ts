// Server-only: Central AI provider pool for kie.ai.
// Manages multiple API keys with automatic rotation on failure.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import crypto from "crypto";

const KIE_BASE_URL = "https://api.kie.ai";
const KIE_CREDIT_URL = `${KIE_BASE_URL}/api/v1/chat/credit`;
const DEFAULT_KIE_MODEL = "gemini-2.5-flash";

const KIE_MODEL_ALIASES: Record<string, string> = {
  "gpt-4o": "gemini-2.5-flash",
  "gpt-4o-mini": "gemini-2.5-flash",
  "gemini-2.0-flash": "gemini-2.5-flash",
  "gemini-2.5-flash-preview": "gemini-2.5-flash",
  "claude-3-5-sonnet": "gemini-2.5-pro",
  "google/gemini-2.5-flash": "gemini-2.5-flash",
  "google/gemini-2.5-pro": "gemini-2.5-pro",
  "google/gemini-3-flash-preview": "gemini-3-flash",
  "google/gemini-3-flash": "gemini-3-flash",
  "google/gemini-3.1-pro-preview": "gemini-3-1-pro",
  "openai/gpt-5.2": "gpt-5-2",
  "openai/gpt-5.2": "gpt-5-2",
  "openai/gpt-5": "gpt-5-2",
  "openai/gpt-5-mini": "gpt-5-2",
  "gpt-5": "gpt-5-2",
  "gpt-5.2": "gpt-5-2",
};

const KIE_MODEL_FALLBACKS = [DEFAULT_KIE_MODEL, "gemini-2.5-pro", "gpt-5-2"];

// kie.ai uses model-scoped chat endpoints, e.g. `/gemini-2.5-flash/v1/chat/completions`.
// Normalize a model id to its URL slug (drop provider prefix, keep documented punctuation).
function modelToSlug(model: string): string {
  const normalized = normalizeKieModel(model);
  const tail = normalized.includes("/") ? normalized.split("/").pop()! : normalized;
  return tail.toLowerCase();
}

function normalizeKieModel(model: string): string {
  const trimmed = model.trim();
  return KIE_MODEL_ALIASES[trimmed] ?? trimmed.replace(/^kie\//, "");
}

function modelCandidates(requested: string): string[] {
  return [...new Set([normalizeKieModel(requested || DEFAULT_KIE_MODEL), ...KIE_MODEL_FALLBACKS])];
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
    .eq("provider", "kie")
    .eq("status", "active")
    .order("priority", { ascending: true })
    .order("last_used_at", { ascending: true, nullsFirst: true });

  return (data ?? []).filter(
    (a) => !a.cooldown_until || a.cooldown_until <= nowIso,
  ) as PoolAccount[];
}

async function markSuccess(accountId: string) {
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

type KieResponse = {
  code?: number;
  msg?: string;
  message?: string;
  output_text?: string;
  response?: string;
  text?: string;
  data?: unknown;
  choices?: Array<{
    text?: string;
    message?: { content?: string | Array<{ text?: string; content?: string }> };
    delta?: { content?: string };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

function firstText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const obj = value as KieResponse;
  const direct = obj.output_text || obj.response || obj.text || obj.message;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const choice = obj.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const joined = content.map((part) => part.text || part.content || "").join(" ").trim();
    if (joined) return joined;
  }
  const choiceText = choice?.text || choice?.delta?.content;
  if (typeof choiceText === "string" && choiceText.trim()) return choiceText.trim();

  return firstText(obj.data);
}

function usageFrom(value: unknown): { prompt_tokens?: number; completion_tokens?: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as KieResponse;
  return obj.usage ?? usageFrom(obj.data);
}

function isModelLevelFailure(statusOrCode: number, message: string): boolean {
  return [404, 410, 422].includes(statusOrCode) || /model.*(not supported|unavailable|not found)|unsupported model/i.test(message);
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
  const requestedModel = normalizeKieModel(opts.model || DEFAULT_KIE_MODEL);
  const candidates = modelCandidates(requestedModel);

  const accounts = await pickAvailableAccounts();

  if (accounts.length === 0) {
    const result: KieResult = {
      text: "",
      model: requestedModel,
      accountId: null,
      tokensIn: null,
      tokensOut: null,
      latencyMs: Date.now() - started,
      error: "no active kie.ai accounts in pool",
    };
    await logUsage({ ...opts, result });
    return result;
  }

  let lastError = "unknown";
  let lastStatus = 0;
  let lastModel = requestedModel;

  for (const model of candidates) {
    lastModel = model;
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
        const res = await fetch(chatUrlFor(model), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: opts.messages,
            max_tokens: opts.maxTokens ?? 1024,
            temperature: opts.temperature ?? 0.7,
            stream: false,
          }),
        });

        const rawBody = await res.text();
        if (!res.ok) {
          lastStatus = res.status;
          lastError = `kie ${res.status}: ${rawBody.slice(0, 200)}`;
          if (isModelLevelFailure(res.status, rawBody)) break;
          await markFailure(account.id, res.status, lastError);
          continue;
        }

        let j: KieResponse = {};
        try {
          j = rawBody ? (JSON.parse(rawBody) as KieResponse) : {};
        } catch {
          j = { text: rawBody };
        }

        // kie.ai sometimes returns provider/application errors as HTTP 200
        // with { code, msg, data:null }. Treat those as real failures instead
        // of logging a vague "empty response".
        if (typeof j.code === "number" && j.code !== 200) {
          lastStatus = j.code;
          lastError = `kie ${j.code}: ${j.msg || "provider rejected request"}`;

          if (isModelLevelFailure(j.code, j.msg || "")) break;
          if ([401, 402, 403, 429].includes(j.code) || j.code >= 500) {
            await markFailure(account.id, j.code, lastError);
            continue;
          }
          continue;
        }

        const text = firstText(j);
        if (!text) {
          lastError = `empty response from ${model}`;
          continue;
        }

        await markSuccess(account.id);
        const usage = usageFrom(j);

        const result: KieResult = {
          text,
          model,
          accountId: account.id,
          tokensIn: usage?.prompt_tokens ?? null,
          tokensOut: usage?.completion_tokens ?? null,
          latencyMs: Date.now() - started,
          error: null,
        };
        await logUsage({ ...opts, result });
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err.message : "network failure";
        await markFailure(account.id, 0, lastError);
      }
    }
  }

  const result: KieResult = {
    text: "",
    model: lastModel,
    accountId: null,
    tokensIn: null,
    tokensOut: null,
    latencyMs: Date.now() - started,
    error: lastError || (lastStatus ? `kie ${lastStatus}` : "kie request failed"),
  };
  await logUsage({ ...opts, result });
  return result;
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

