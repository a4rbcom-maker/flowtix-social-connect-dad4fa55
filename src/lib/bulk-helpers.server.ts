// Helpers for the bulk-jobs worker: spintax, jitter, throttling config,
// circuit breaker and global rate-limit checks.
// Server-only — never import from client bundles.

export type BulkGlobalConfig = {
  global_msgs_per_second: number;
  circuit_breaker_failure_pct: number;
  circuit_breaker_window_min: number;
  circuit_breaker_pause_min: number;
  small_job_threshold: number;
};

export const DEFAULT_BULK_GLOBAL_CONFIG: BulkGlobalConfig = {
  global_msgs_per_second: 6,
  circuit_breaker_failure_pct: 20,
  circuit_breaker_window_min: 5,
  circuit_breaker_pause_min: 15,
  small_job_threshold: 20,
};

export type UserBulkSettings = {
  daily_message_cap: number;
  messages_per_batch: number;
  batch_rest_seconds: number;
  jitter_min_seconds: number;
  jitter_max_seconds: number;
  enable_spintax: boolean;
  prioritize_existing_contacts: boolean;
  skip_after_failures: number;
  max_concurrent_campaigns: number;
};

export const DEFAULT_USER_SETTINGS: UserBulkSettings = {
  daily_message_cap: 500,
  messages_per_batch: 10,
  batch_rest_seconds: 300,
  jitter_min_seconds: 8,
  jitter_max_seconds: 25,
  enable_spintax: true,
  prioritize_existing_contacts: true,
  skip_after_failures: 2,
  max_concurrent_campaigns: 1,
};

/**
 * Spintax parser: "مرحبا {أهلاً|السلام عليكم} {{name}}"
 * Picks a random option for each {a|b|c} group. Nested groups supported.
 */
export function applySpintax(text: string): string {
  if (!text || !text.includes("{")) return text;
  // Repeatedly resolve innermost {a|b|c} groups until none remain.
  // Avoids matching {{name}} / {{phone}} tags (double braces).
  const pattern = /\{([^{}|]+(?:\|[^{}|]+)+)\}/;
  let out = text;
  let safety = 100;
  while (safety-- > 0) {
    const m = out.match(pattern);
    if (!m) break;
    const options = m[1].split("|");
    const pick = options[Math.floor(Math.random() * options.length)];
    out = out.slice(0, m.index) + pick + out.slice((m.index ?? 0) + m[0].length);
  }
  return out;
}

/**
 * Random jitter in ms between [min, max] seconds (inclusive).
 */
export function jitterMs(minSec: number, maxSec: number): number {
  const lo = Math.max(1, Math.min(minSec, maxSec));
  const hi = Math.max(lo, maxSec);
  const seconds = lo + Math.random() * (hi - lo);
  return Math.round(seconds * 1000);
}

/**
 * Renders name/phone tags plus optional spintax.
 */
export function renderMessage(
  tpl: string,
  ctx: { name?: string | null; phone?: string | null },
  opts: { spintax: boolean } = { spintax: true },
): string {
  if (!tpl) return "";
  let out = tpl
    .replace(/\{\{?\s*name\s*\}?\}/gi, ctx.name?.trim() || "")
    .replace(/\{\{?\s*phone\s*\}?\}/gi, ctx.phone?.trim() || "");
  if (opts.spintax) out = applySpintax(out);
  return out;
}

/**
 * Reason patterns that mean "not on WhatsApp" / invalid target.
 * Recipients that fail with these are added to wa_invalid_phones.
 */
export function isNotOnWhatsappError(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const s = reason.toLowerCase();
  return (
    /not.*(on|registered).*whats?app/.test(s) ||
    /no.*whats?app.*account/.test(s) ||
    /invalid.*(number|recipient|jid)/.test(s) ||
    /غير.*مسج.*واتس/.test(reason) ||
    /رقم.*غير.*صالح/.test(reason)
  );
}
