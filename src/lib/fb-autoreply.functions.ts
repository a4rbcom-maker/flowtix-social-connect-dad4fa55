// Server functions for FB Auto-Reply: page management + rules CRUD + log queries.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Pages ----------

const addPageSchema = z.object({
  page_id: z.string().trim().min(1).max(50),
  page_name: z.string().trim().min(1).max(200),
  avatar_url: z.string().url().max(500).optional().nullable(),
  connection_type: z.enum(["official", "bot"]),
  access_token: z.string().trim().min(10).max(2000).optional().nullable(),
  bot_account_id: z.string().uuid().optional().nullable(),
});

export const listPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("fb_pages")
      .select("id, page_id, page_name, avatar_url, connection_type, status, webhook_subscribed, last_error, created_at, bot_account_id")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const addPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => addPageSchema.parse(d))
  .handler(async ({ data, context }) => {
    let encrypted: string | null = null;
    if (data.connection_type === "official") {
      if (!data.access_token) throw new Error("access_token مطلوب للربط الرسمي");
      const { encryptJson } = await import("@/server/crypto.server");
      encrypted = encryptJson(data.access_token);
    } else {
      if (!data.bot_account_id) throw new Error("اختر حساب بوت");
    }
    const { data: row, error } = await context.supabase
      .from("fb_pages")
      .insert({
        user_id: context.userId,
        page_id: data.page_id,
        page_name: data.page_name,
        avatar_url: data.avatar_url ?? null,
        connection_type: data.connection_type,
        access_token_encrypted: encrypted,
        bot_account_id: data.bot_account_id ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return row;
  });

export const deletePage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("fb_pages").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Rules ----------

const ruleSchema = z.object({
  id: z.string().uuid().optional(),
  page_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  scope: z.enum(["specific_post", "all_posts"]).default("all_posts"),
  post_id: z.string().trim().max(80).optional().nullable(),
  trigger_type: z.enum(["keywords", "any_comment"]).default("keywords"),
  keywords: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  match_mode: z.enum(["any", "all", "exact"]).default("any"),
  reply_comment_enabled: z.boolean().default(true),
  reply_comment_text: z.string().trim().max(1000).optional().nullable(),
  reply_dm_enabled: z.boolean().default(false),
  reply_dm_text: z.string().trim().max(2000).optional().nullable(),
  ignore_admin_comments: z.boolean().default(true),
  dedupe_per_user: z.boolean().default(true),
  detect_spam: z.boolean().default(true),
  priority: z.number().int().min(0).max(100).default(0),
  cooldown_seconds: z.number().int().min(0).max(86400).default(0),
}).refine(
  (v) =>
    (v.reply_comment_enabled && (v.reply_comment_text ?? "").trim().length > 0) ||
    (v.reply_dm_enabled && (v.reply_dm_text ?? "").trim().length > 0),
  { message: "يجب تفعيل تعليق أو رسالة خاصة على الأقل مع نص" },
);

export const listRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("fb_autoreply_rules")
      .select("*, page:fb_pages(id, page_name, page_id)")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const upsertRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ruleSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Ensure page belongs to user
    const { data: page } = await context.supabase
      .from("fb_pages")
      .select("id")
      .eq("id", data.page_id)
      .maybeSingle();
    if (!page) throw new Error("الصفحة غير موجودة");

    const payload = {
      user_id: context.userId,
      page_id: data.page_id,
      name: data.name,
      enabled: data.enabled,
      scope: data.scope,
      post_id: data.scope === "specific_post" ? (data.post_id ?? null) : null,
      trigger_type: data.trigger_type,
      keywords: data.trigger_type === "keywords" ? data.keywords : [],
      match_mode: data.match_mode,
      reply_comment_enabled: data.reply_comment_enabled,
      reply_comment_text: data.reply_comment_text ?? null,
      reply_dm_enabled: data.reply_dm_enabled,
      reply_dm_text: data.reply_dm_text ?? null,
      ignore_admin_comments: data.ignore_admin_comments,
      dedupe_per_user: data.dedupe_per_user,
      detect_spam: data.detect_spam,
      priority: data.priority,
      cooldown_seconds: data.cooldown_seconds,
    };

    if (data.id) {
      const { error } = await context.supabase
        .from("fb_autoreply_rules")
        .update(payload)
        .eq("id", data.id);
      if (error) throw error;
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("fb_autoreply_rules")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw error;
    return row;
  });

export const toggleRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("fb_autoreply_rules")
      .update({ enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const deleteRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("fb_autoreply_rules").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Log ----------

export const listLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        rule_id: z.string().uuid().optional(),
        page_id: z.string().uuid().optional(),
        status: z.enum(["success", "failed", "skipped"]).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("fb_autoreply_log")
      .select("*, rule:fb_autoreply_rules(name), page:fb_pages(page_name)")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.rule_id) q = q.eq("rule_id", data.rule_id);
    if (data.page_id) q = q.eq("page_id", data.page_id);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

// ---------- Test rule (dry-run match) ----------

export const testRuleMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ text: z.string().min(1).max(2000), rule_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rule, error } = await context.supabase
      .from("fb_autoreply_rules")
      .select("keywords, match_mode, trigger_type")
      .eq("id", data.rule_id)
      .maybeSingle();
    if (error) throw error;
    if (!rule) throw new Error("القاعدة غير موجودة");
    const { normalizeArabic } = await import("@/lib/fb-autoreply-engine.server");
    const hay = normalizeArabic(data.text);
    const needles = (rule.keywords ?? []).map(normalizeArabic);
    let match = false;
    if (rule.trigger_type === "any_comment") match = true;
    else if (rule.match_mode === "exact") match = needles.some((n) => hay === n);
    else if (rule.match_mode === "all") match = needles.every((n) => hay.includes(n));
    else match = needles.some((n) => hay.includes(n));
    return { match, normalized: hay, needles };
  });
