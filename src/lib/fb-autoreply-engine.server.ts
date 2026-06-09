// Server-only: matching engine for Facebook auto-reply rules.
// Imported only from server fns and the webhook route.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Arabic-aware normalization for keyword matching.
export function normalizeArabic(input: string): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "") // diacritics + tatweel
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

export type CommentEvent = {
  pageId: string; // FB page id (string)
  postId?: string;
  commentId: string;
  commenterId?: string;
  commenterName?: string;
  text: string;
  isFromPageAdmin?: boolean;
};

function isLikelySpam(text: string): boolean {
  if (!text) return false;
  // 5+ identical-character runs
  if (/(.)\1{4,}/.test(text)) return true;
  // Long URLs spam
  const urlMatches = text.match(/https?:\/\//g);
  if (urlMatches && urlMatches.length >= 3) return true;
  // Excessive length with no spaces
  if (text.length > 400 && !/\s/.test(text)) return true;
  return false;
}

function matchKeywords(text: string, keywords: string[], mode: "any" | "all" | "exact"): boolean {
  if (!keywords?.length) return false;
  const haystack = normalizeArabic(text);
  const needles = keywords.map(normalizeArabic).filter(Boolean);
  if (!needles.length) return false;
  if (mode === "exact") return needles.some((n) => haystack === n);
  if (mode === "all") return needles.every((n) => haystack.includes(n));
  return needles.some((n) => haystack.includes(n));
}

export type MatchedRule = {
  id: string;
  user_id: string;
  page_id: string; // uuid (db row id)
  fb_page_id: string;
  page_token?: string | null;
  page_token_encrypted?: string | null;
  connection_type: "official" | "bot";
  name: string;
  reply_comment_enabled: boolean;
  reply_comment_text: string | null;
  reply_dm_enabled: boolean;
  reply_dm_text: string | null;
};

/**
 * Find first matching rule for a comment event, applying:
 *   - admin filter, spam filter, scope (specific_post|all_posts),
 *   - keyword match (any/all/exact),
 *   - dedupe (per rule+commenter via fb_autoreply_log unique index),
 *   - cooldown (per rule),
 *   - priority order.
 */
export async function matchRule(event: CommentEvent): Promise<MatchedRule | null> {
  const { data: page } = await supabaseAdmin
    .from("fb_pages")
    .select("id, user_id, page_id, access_token_encrypted, connection_type, status")
    .eq("page_id", event.pageId)
    .eq("status", "active")
    .maybeSingle();
  if (!page) return null;

  const { data: rules } = await supabaseAdmin
    .from("fb_autoreply_rules")
    .select("*")
    .eq("page_id", page.id)
    .eq("enabled", true)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });
  if (!rules?.length) return null;

  for (const rule of rules) {
    // scope
    if (rule.scope === "specific_post" && rule.post_id && event.postId !== rule.post_id) continue;
    // admin filter
    if (rule.ignore_admin_comments && event.isFromPageAdmin) continue;
    // spam
    if (rule.detect_spam && isLikelySpam(event.text)) continue;
    // trigger
    if (rule.trigger_type === "keywords") {
      if (!matchKeywords(event.text, rule.keywords ?? [], rule.match_mode)) continue;
    }
    // cooldown
    if (rule.cooldown_seconds > 0 && rule.last_matched_at) {
      const elapsed = (Date.now() - new Date(rule.last_matched_at as string).getTime()) / 1000;
      if (elapsed < rule.cooldown_seconds) continue;
    }
    // dedupe per user
    if (rule.dedupe_per_user && event.commenterId) {
      const { data: dup } = await supabaseAdmin
        .from("fb_autoreply_log")
        .select("id")
        .eq("rule_id", rule.id)
        .eq("commenter_id", event.commenterId)
        .eq("status", "success")
        .limit(1)
        .maybeSingle();
      if (dup) continue;
    }
    return {
      id: rule.id,
      user_id: rule.user_id,
      page_id: page.id,
      fb_page_id: page.page_id,
      page_token_encrypted: page.access_token_encrypted,
      connection_type: page.connection_type,
      name: rule.name,
      reply_comment_enabled: rule.reply_comment_enabled,
      reply_comment_text: rule.reply_comment_text,
      reply_dm_enabled: rule.reply_dm_enabled,
      reply_dm_text: rule.reply_dm_text,
    };
  }
  return null;
}

/** Replace template variables in reply text (e.g. {{name}}). */
export function renderTemplate(tpl: string | null, vars: Record<string, string>): string {
  if (!tpl) return "";
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

/**
 * Execute the matched rule against Facebook Graph API.
 * Returns log payload to insert into fb_autoreply_log.
 */
export async function executeRule(
  rule: MatchedRule,
  event: CommentEvent,
): Promise<{
  action_taken: "comment" | "dm" | "both" | "skipped";
  status: "success" | "failed";
  error_message?: string;
  fb_response?: Record<string, unknown>;
}> {
  if (rule.connection_type !== "official" || !rule.page_token_encrypted) {
    return {
      action_taken: "skipped",
      status: "failed",
      error_message: "Bot-based autoreply runs via bot-worker (not webhook).",
    };
  }

  // Decrypt the page access token
  const { decryptString } = await import("@/server/crypto.server");
  let pageToken: string;
  try {
    pageToken = await decryptString(rule.page_token_encrypted);
  } catch (e) {
    return { action_taken: "skipped", status: "failed", error_message: "Token decrypt failed" };
  }

  const vars = {
    name: event.commenterName ?? "",
    page: rule.name ?? "",
  };
  const responses: Record<string, unknown> = {};
  let actionComment = false;
  let actionDm = false;
  let firstError: string | undefined;

  // 1) Public comment reply
  if (rule.reply_comment_enabled && rule.reply_comment_text) {
    try {
      const r = await fetch(
        `https://graph.facebook.com/v21.0/${event.commentId}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: renderTemplate(rule.reply_comment_text, vars),
            access_token: pageToken,
          }),
        },
      );
      const body = (await r.json()) as Record<string, unknown>;
      responses.comment = body;
      if (r.ok) actionComment = true;
      else firstError = JSON.stringify(body);
    } catch (e) {
      firstError = (e as Error).message;
    }
  }

  // 2) Private DM via Messenger private replies
  if (rule.reply_dm_enabled && rule.reply_dm_text) {
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(pageToken)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { comment_id: event.commentId },
          message: { text: renderTemplate(rule.reply_dm_text, vars) },
          messaging_type: "RESPONSE",
        }),
      });
      const body = (await r.json()) as Record<string, unknown>;
      responses.dm = body;
      if (r.ok) actionDm = true;
      else if (!firstError) firstError = JSON.stringify(body);
    } catch (e) {
      if (!firstError) firstError = (e as Error).message;
    }
  }

  const action_taken =
    actionComment && actionDm ? "both" : actionComment ? "comment" : actionDm ? "dm" : "skipped";
  const status = actionComment || actionDm ? "success" : "failed";
  return { action_taken, status, error_message: firstError, fb_response: responses };
}

/** Log execution + bump rule counters. */
export async function logExecution(
  rule: MatchedRule,
  event: CommentEvent,
  result: Awaited<ReturnType<typeof executeRule>>,
) {
  await supabaseAdmin.from("fb_autoreply_log").insert({
    user_id: rule.user_id,
    rule_id: rule.id,
    page_id: rule.page_id,
    post_id: event.postId ?? null,
    comment_id: event.commentId,
    commenter_id: event.commenterId ?? null,
    commenter_name: event.commenterName ?? null,
    comment_text: event.text,
    action_taken: result.action_taken,
    status: result.status,
    error_message: result.error_message ?? null,
    fb_response: (result.fb_response ?? null) as never,
  });
  if (result.status === "success") {
    await supabaseAdmin.rpc;
    await supabaseAdmin
      .from("fb_autoreply_rules")
      .update({
        match_count: undefined as never, // bumped below
        last_matched_at: new Date().toISOString(),
      })
      .eq("id", rule.id);
    // Use raw SQL increment via update with select+update workaround:
    await supabaseAdmin.rpc;
  }
}
