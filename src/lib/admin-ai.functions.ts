// Admin-only server functions for kie.ai pool, model tiers, and usage logs.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { encryptKey, keyHint, pingKieKey } from "./ai-pool.server";

function admin() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function assertAdmin(userId: string) {
  const db = admin();
  const { data } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("forbidden: admin role required");
}

// ============= Accounts =============

export const listAiAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const db = admin();
    const { data, error } = await db
      .from("ai_provider_accounts")
      .select("id,label,provider,key_hint,status,priority,requests_count,failed_count,last_used_at,last_error_at,last_error_message,cooldown_until,created_at")
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

export const createAiAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { label: string; apiKey: string; priority?: number }) =>
    z.object({
      label: z.string().trim().min(1).max(80),
      apiKey: z.string().trim().min(8).max(500),
      priority: z.number().int().min(1).max(9999).optional().default(100),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const db = admin();
    const { error } = await db.from("ai_provider_accounts").insert({
      label: data.label,
      provider: "kie",
      api_key_encrypted: encryptKey(data.apiKey),
      key_hint: keyHint(data.apiKey),
      priority: data.priority,
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateAiAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id: string;
    label?: string;
    priority?: number;
    status?: "active" | "exhausted" | "disabled" | "error";
    apiKey?: string;
  }) =>
    z.object({
      id: z.string().uuid(),
      label: z.string().trim().min(1).max(80).optional(),
      priority: z.number().int().min(1).max(9999).optional(),
      status: z.enum(["active", "exhausted", "disabled", "error"]).optional(),
      apiKey: z.string().trim().min(8).max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const db = admin();
    const updates: Record<string, unknown> = {};
    if (data.label) updates.label = data.label;
    if (data.priority !== undefined) updates.priority = data.priority;
    if (data.status) {
      updates.status = data.status;
      if (data.status === "active") updates.cooldown_until = null;
    }
    if (data.apiKey) {
      updates.api_key_encrypted = encryptKey(data.apiKey);
      updates.key_hint = keyHint(data.apiKey);
    }
    const { error } = await db.from("ai_provider_accounts").update(updates as never).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAiAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const db = admin();
    const { error } = await db.from("ai_provider_accounts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetAiAccountCounters = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const db = admin();
    const { error } = await db
      .from("ai_provider_accounts")
      .update({ requests_count: 0, failed_count: 0, last_error_at: null, last_error_message: null, status: "active", cooldown_until: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testAiAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id?: string; apiKey?: string }) =>
    z.object({ id: z.string().uuid().optional(), apiKey: z.string().trim().min(8).max(500).optional() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    let key = data.apiKey;
    if (!key && data.id) {
      const db = admin();
      const { data: row } = await db.from("ai_provider_accounts").select("api_key_encrypted").eq("id", data.id).maybeSingle();
      if (!row) throw new Error("account not found");
      const { decryptKey } = await import("./ai-pool.server");
      key = decryptKey(row.api_key_encrypted);
    }
    if (!key) throw new Error("api key required");
    const res = await pingKieKey(key);
    return res;
  });

// ============= Tiers / Models =============

export const listModelTiers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const db = admin();
    const { data, error } = await db
      .from("ai_model_tiers")
      .select("*")
      .order("tier")
      .order("sort_order");
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

export const upsertModelTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id?: string;
    tier: "simple" | "smart" | "negotiation";
    model_name: string;
    display_name_ar: string;
    display_name_en: string;
    description?: string;
    enabled?: boolean;
    max_tokens?: number;
    temperature?: number;
    sort_order?: number;
  }) =>
    z.object({
      id: z.string().uuid().optional(),
      tier: z.enum(["simple", "smart", "negotiation"]),
      model_name: z.string().trim().min(1).max(100),
      display_name_ar: z.string().trim().min(1).max(100),
      display_name_en: z.string().trim().min(1).max(100),
      description: z.string().max(500).optional(),
      enabled: z.boolean().optional().default(true),
      max_tokens: z.number().int().min(64).max(8192).optional().default(1024),
      temperature: z.number().min(0).max(2).optional().default(0.7),
      sort_order: z.number().int().min(0).max(999).optional().default(0),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const db = admin();
    if (data.id) {
      const { error } = await db
        .from("ai_model_tiers")
        .update({
          tier: data.tier,
          model_name: data.model_name,
          display_name_ar: data.display_name_ar,
          display_name_en: data.display_name_en,
          description: data.description ?? null,
          enabled: data.enabled,
          max_tokens: data.max_tokens,
          temperature: data.temperature,
          sort_order: data.sort_order,
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from("ai_model_tiers").insert({
        tier: data.tier,
        model_name: data.model_name,
        display_name_ar: data.display_name_ar,
        display_name_en: data.display_name_en,
        description: data.description ?? null,
        enabled: data.enabled,
        max_tokens: data.max_tokens,
        temperature: data.temperature,
        sort_order: data.sort_order,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteModelTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const db = admin();
    const { error } = await db.from("ai_model_tiers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============= Usage logs =============

export const listAiUsageLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number; tier?: string; status?: string }) =>
    z.object({
      limit: z.number().int().min(10).max(500).optional().default(100),
      tier: z.string().max(40).optional().default(""),
      status: z.string().max(40).optional().default(""),
    }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const db = admin();
    let q = db.from("ai_usage_logs").select("*").order("created_at", { ascending: false }).limit(data.limit);
    if (data.tier) q = q.eq("tier", data.tier as never);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

export const getAiPoolStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const db = admin();
    const [accounts, last24h, last7d] = await Promise.all([
      db.from("ai_provider_accounts").select("status"),
      db.from("ai_usage_logs").select("status,tokens_in,tokens_out").gte("created_at", new Date(Date.now() - 86400_000).toISOString()),
      db.from("ai_usage_logs").select("created_at,status").gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString()),
    ]);
    const counts = { active: 0, exhausted: 0, disabled: 0, error: 0, total: 0 };
    (accounts.data ?? []).forEach((a) => {
      counts.total += 1;
      counts[a.status as keyof typeof counts] = (counts[a.status as keyof typeof counts] || 0) + 1;
    });
    const today = (last24h.data ?? []).reduce(
      (acc, r) => {
        acc.requests += 1;
        if (r.status === "success") acc.success += 1;
        else acc.failed += 1;
        acc.tokens += (r.tokens_in || 0) + (r.tokens_out || 0);
        return acc;
      },
      { requests: 0, success: 0, failed: 0, tokens: 0 },
    );
    // Daily series last 7 days
    const days = new Map<string, { success: number; failed: number }>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
      days.set(d, { success: 0, failed: 0 });
    }
    (last7d.data ?? []).forEach((r) => {
      const d = r.created_at.slice(0, 10);
      const cur = days.get(d);
      if (cur) {
        if (r.status === "success") cur.success += 1;
        else cur.failed += 1;
      }
    });
    const series = Array.from(days.entries()).map(([day, v]) => ({ day, ...v }));
    return { counts, today, series };
  });
