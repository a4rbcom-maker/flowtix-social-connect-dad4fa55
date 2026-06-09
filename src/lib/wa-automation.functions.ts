// Server functions for WhatsApp keyword rules and quick reply snippets.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─── Types ─────────────────────────────────────────────────────────────────
export interface KeywordRule {
  id: string;
  label: string;
  keywords: string[];
  match_mode: "exact" | "contains";
  reply_text: string;
  enabled: boolean;
  priority: number;
  hit_count: number;
  last_hit_at: string | null;
  created_at: string;
}

export interface QuickReply {
  id: string;
  shortcut: string;
  body: string;
  sort_order: number;
  created_at: string;
}

const ruleInput = z.object({
  label: z.string().trim().min(1).max(80),
  keywords: z.array(z.string().trim().min(1).max(120)).min(1).max(20),
  match_mode: z.enum(["exact", "contains"]),
  reply_text: z.string().trim().min(1).max(2000),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).default(0),
});

const snippetInput = z.object({
  shortcut: z.string().trim().min(1).max(40),
  body: z.string().trim().min(1).max(2000),
  sort_order: z.number().int().min(0).max(10000).default(0),
});

// ─── Keyword Rules ─────────────────────────────────────────────────────────
export const listKeywordRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<KeywordRule[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("wa_keyword_rules")
      .select("id, label, keywords, match_mode, reply_text, enabled, priority, hit_count, last_hit_at, created_at")
      .eq("user_id", userId)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as KeywordRule[];
  });

export const createKeywordRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => ruleInput.parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("wa_keyword_rules")
      .insert({ user_id: userId, ...data });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateKeywordRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    ruleInput.extend({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { id, ...patch } = data;
    const { error } = await supabase
      .from("wa_keyword_rules")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleKeywordRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("wa_keyword_rules")
      .update({ enabled: data.enabled })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteKeywordRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("wa_keyword_rules")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ─── Quick Replies ─────────────────────────────────────────────────────────
export const listQuickReplies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<QuickReply[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("wa_quick_replies")
      .select("id, shortcut, body, sort_order, created_at")
      .eq("user_id", userId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as QuickReply[];
  });

export const createQuickReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => snippetInput.parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("wa_quick_replies")
      .insert({ user_id: userId, ...data });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateQuickReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    snippetInput.extend({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { id, ...patch } = data;
    const { error } = await supabase
      .from("wa_quick_replies")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteQuickReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("wa_quick_replies")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
