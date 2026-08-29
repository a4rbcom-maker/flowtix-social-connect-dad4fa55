/**
 * Pure pacing / anti-block helpers for the messenger broadcast engine.
 * No browser, no DB — fully unit-testable. The worker composes these with
 * live state (counters, page liveness) at runtime.
 */

/** UTC calendar-day key ("YYYY-MM-DD") — counters reset at midnight UTC, not
 *  on a rolling 24h window, so a burst at 23:50 cannot fund a burst at 00:05. */
export function dayKeyUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Randomized delay in [min*0.8, max*1.2] with ±20% jitter on top — a machine
 *  sends at metronomic intervals; humans don't. Milliseconds. */
export function nextDelayMs(minSec: number, maxSec: number): number {
  const lo = Math.min(minSec, maxSec);
  const hi = Math.max(minSec, maxSec);
  const base = (lo + Math.random() * (hi - lo)) * 1000;
  const jitter = base * 0.2;
  return Math.round(base - jitter + Math.random() * jitter * 2);
}

/** Resolve "{{name}}" placeholders and "{opt1|opt2}" spintax (one random pick
 *  per group per call, nested-free). Unknown placeholders resolve to "". */
export function renderTemplate(body: string, vars: Record<string, string> = {}): string {
  let out = body;
  out = out.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? "");
  // innermost-braces-first so nested-looking groups degrade gracefully
  for (let i = 0; i < 10 && /\{[^{}]*\|[^{}]*\}/.test(out); i++) {
    out = out.replace(/\{([^{}|]*)\|([^{}]*)\}/, (_m, a: string, rest: string) => {
      const opts = [a, ...rest.split("|")];
      return opts[Math.floor(Math.random() * opts.length)] ?? a;
    });
  }
  return out;
}

/** True when the template actually varies between recipients (spintax group
 *  or a {{placeholder}}). Used to warn before launching a "same text to
 *  everyone" blast — the #1 advertised restriction trigger. */
export function hasVariation(body: string): boolean {
  return /\{\{\w+\}\}/.test(body) || /\{[^{}]*\|[^{}]*\}/.test(body);
}

/** Cairo quiet hours 01:00–07:00 local (EET +2 / EEST +3, standard DST rules). */
export function isQuietHour(now: Date = new Date()): boolean {
  const cairo = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
  const hour = cairo.getHours();
  return hour >= 1 && hour < 7;
}

export interface SessionCandidate {
  sessionId: string;
  sentToday: number;
  dailyCap: number;
  sentLastHour: number;
  ratePerHour: number;
  cooldownUntil: Date | null;
  closed: boolean;
}

/** Pick the next session to send from: alive, under both caps, not cooling
 *  down — preferring the least-used today. Returns null when nothing qualifies
 *  (the worker then pauses instead of hammering a capped or restricted session). */
export function pickSession(candidates: SessionCandidate[]): SessionCandidate | null {
  const now = Date.now();
  const eligible = candidates.filter((c) => {
    if (c.closed) return false;
    if (c.cooldownUntil && c.cooldownUntil.getTime() > now) return false;
    if (c.sentToday >= c.dailyCap) return false;
    if (c.sentLastHour >= c.ratePerHour) return false;
    return true;
  });
  if (eligible.length === 0) return null;
  return eligible.reduce((best, c) => (c.sentToday < best.sentToday ? c : best));
}

export type BlockSignalKind = "rate_limited" | "send_rejected" | "session_dead";

/** Scan page text for Facebook restriction / logged-out markers. The copy
 *  list is anchored on probes + widely-reported restriction messages (ar+en). */
export function detectBlockSignal(pageText: string): BlockSignalKind | null {
  if (!pageText) return null;
  const t = pageText.toLowerCase();
  if (/log in to facebook|تسجيل الدخول إلى فيسبوك|login • instagram/.test(t)) return "session_dead";
  if (
    /message request limit|you can'?t (currently )?message|you'?ve reached the (message|daily) limit|can'?t send messages right now|رسائل هذا الشخص|لا يمكنك إرسال رسائل|تم تقييد رسائلك|وصلت إلى الحد الأقصى/.test(t)
  ) {
    return "rate_limited";
  }
  if (/message not sent|لم يتم إرسال|لم تُرسل الرسالة|couldn'?t send/.test(t)) return "send_rejected";
  return null;
}

/** "msg_74100576336" → "74100576336". Messenger contacts store ids with a
 *  msg_ prefix; other paths store numeric ids or usernames. Only numeric
 *  ids (5+ digits) can open a /messages/t/<id> thread — usernames cannot. */
export function normalizeThreadId(fbId: string | null | undefined): string | null {
  if (!fbId) return null;
  const stripped = fbId.startsWith("msg_") ? fbId.slice(4) : fbId;
  return /^\d{5,}$/.test(stripped) ? stripped : null;
}
