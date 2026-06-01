// Server-only: Central AI provider pool for kie.ai.
// Manages multiple API keys with automatic rotation on failure.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import crypto from "crypto";

const KIE_BASE_URL = "https://api.kie.ai";
const KIE_CREDIT_URL = `${KIE_BASE_URL}/api/v1/chat/credit`;

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
  const accounts = await pickAvailableAccounts();

  if (accounts.length === 0) {
    const result: KieResult = {
      text: "",
      model: opts.model,
      accountId: null,
      tokensIn: null,
      tokensOut: null,
      latencyMs: 0,
      error: "no active kie.ai accounts in pool",
    };
    await logUsage({ ...opts, result });
    return result;
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
      const res = await fetch(`${KIE_BASE_URL}/chat/completions`, {
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

  const result: KieResult = {
    text: "",
    model: opts.model,
    accountId: null,
    tokensIn: null,
    tokensOut: null,
    latencyMs: Date.now() - started,
    error: lastError,
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

// ============= Admin-only test ping =============

export async function pingKieKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${KIE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
      }),
    });
    if (res.ok) return { ok: true, message: "OK" };
    return { ok: false, message: `${res.status}: ${(await res.text()).slice(0, 150)}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "network error" };
  }
}
