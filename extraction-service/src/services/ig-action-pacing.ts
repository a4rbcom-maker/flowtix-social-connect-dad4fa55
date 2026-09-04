/**
 * Pure pacing / anti-block helpers for Instagram mention + DM actions.
 *
 * No browser, no DB — fully unit-testable. Composes with the SAME primitives
 * already proven in message-pacing.ts (nextDelayMs, isQuietHour, pickSession,
 * renderTemplate) so there is a single source of truth for delay math.
 *
 * Instagram limits are the binding constraint — sourced from live-audited
 * public data (2026-08-29):
 *  - @mentions per comment: hard ceiling of 5 (more is treated as spam)
 *  - comment rate: 12–14 per hour, 350–400s gap (over = action_blocked)
 *  - DM to non-followers (cold outreach): 10–20 per day for new accounts
 * Defaults here are kept ~30% UNDER the documented ceiling on purpose.
 */

import {
  nextDelayMs,
  isQuietHour,
  renderTemplate,
  pickSession,
  dayKeyUtc,
  type SessionCandidate,
} from "./message-pacing.js";

/** Hard platform ceiling — never chunk more than this per comment. */
export const IG_MENTION_CEILING = 5;

export interface IgActionConfig {
  mentions_per_comment: number;
  comments_per_hour: number;
  daily_cap: number;
  rate_per_hour: number;
  delay_min: number;
  delay_max: number;
  batch_size: number;
  batch_pause: number;
  respect_quiet_hours: boolean;
  max_errors: number;
  retry_max: number;
}

export const IG_MENTION_DEFAULTS: IgActionConfig = {
  mentions_per_comment: 4,
  comments_per_hour: 8,
  daily_cap: 60,
  rate_per_hour: 8,
  delay_min: 380,
  delay_max: 520,
  batch_size: 6,
  batch_pause: 1800,
  respect_quiet_hours: true,
  max_errors: 5,
  retry_max: 2,
};

export const IG_MENTION_TWO_SESSIONS: IgActionConfig = {
  mentions_per_comment: 5, // Maximum allowed by Instagram
  comments_per_hour: 6, // 6 per session = 12 total
  daily_cap: 120, // 60 per session
  rate_per_hour: 6,
  delay_min: 480, // 8 minutes between comments
  delay_max: 600, // 10 minutes between comments
  batch_size: 5, // 5 comments per batch per session
  batch_pause: 600, // 10 minutes between batches
  respect_quiet_hours: true,
  max_errors: 3,
  retry_max: 2,
};

export const IG_DM_DEFAULTS: IgActionConfig = {
  mentions_per_comment: 1,
  comments_per_hour: 5,
  daily_cap: 15,
  rate_per_hour: 5,
  delay_min: 90,
  delay_max: 240,
  batch_size: 5,
  batch_pause: 1800,
  respect_quiet_hours: true,
  max_errors: 5,
  retry_max: 2,
};

/** Clamp a requested per-comment count into the [1, IG_MENTION_CEILING] window. */
export function clampMentionsPerComment(n: number): number {
  if (!Number.isFinite(n)) return 4;
  return Math.min(Math.max(Math.floor(n), 1), IG_MENTION_CEILING);
}

/**
 * Split a username list into comment-sized batches. Each batch carries at most
 * `perComment` handles (clamped to the platform ceiling). The last chunk may be
 * shorter. This is the ONLY unit of rate-limit pressure on Instagram — one
 * comment touches up to `perComment` targeted accounts at once.
 */
export function chunkMentions(usernames: string[], perComment: number): string[][] {
  const pc = clampMentionsPerComment(perComment);
  const out: string[][] = [];
  for (let i = 0; i < usernames.length; i += pc) {
    out.push(usernames.slice(i, i + pc));
  }
  return out;
}

/**
 * Build a comment body that mentions each username exactly once, then the
 * templated copy. Spintax/variation reuse is shared with Messenger via
 * renderTemplate — no duplicated logic. A leading "@" the caller passed in is
 * stripped first so we never emit "@@ali".
 */
export function buildMentionComment(template: string, usernames: string[]): string {
  const handles = usernames
    .map((u) => u.replace(/^@/, "").replace(/\/+$/, "").trim())
    .filter(Boolean)
    .map((u) => `@${u}`)
    .join(" ");
  const body = renderTemplate(template ?? "", {});
  const trimmed = body.replace(/\s+/g, " ").trim();
  return [trimmed, handles].filter(Boolean).join(" ");
}

/** Normalize a raw username extracted from extraction_results into a handle. */
export function normalizeIgHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const h = raw.replace(/^@/, "").replace(/\/+$/, "").trim();
  return /^[a-zA-Z0-9._]{1,30}$/.test(h) ? h : null;
}

/**
 * Scan page text for Instagram restriction / logged-out markers. Mirrors the
 * signals in ig-base.ts (action_blocked, feedback_required, challenge_required,
 * /accounts/login) with Arabic co-labels. Returns the action kind, or null.
 */
export function detectIgActionBlock(pageText: string): "rate_limited" | "send_rejected" | "session_dead" | null {
  if (!pageText) return null;
  const t = pageText.toLowerCase();
  if (/log in to instagram|تسجيل الدخول إلى إنستجرام|accounts\/login/.test(t)) return "session_dead";
  if (
    /action blocked|action_blocked|try again later|حاول مرة أخرى لاحقاً|feedback_required|تم تقييد|وصلت إلى الحد|رسائل هذا الشخص|لا يمكنك إرسال رسائل/.test(
      t,
    )
  ) {
    return "rate_limited";
  }
  if (/comment not sent|لم يتم إرسال|لم تُرسل|couldn'?t send/.test(t)) return "send_rejected";
  return null;
}

export { nextDelayMs, isQuietHour, pickSession, dayKeyUtc, type SessionCandidate };
