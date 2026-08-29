/**
 * Messenger broadcast worker — mirrors the proven publish-worker.ts pattern
 * (worker map, per-recipient checkpoint, graceful stop) with anti-block
 * pacing from message-pacing.ts and the DOM layer from message-sender.ts.
 *
 * Lifecycle: queued → running → completed | paused (cap/quiet/errors) | canceled | failed
 * The DB trigger enforces one active job per user; this worker never fights it.
 */
import { supabaseClient } from "./supabase.js";
import { contextManager } from "./context-manager.js";
import { supabaseService } from "./supabase.js";
import { logger } from "../logger.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { sendOne, type SendOutcome } from "./message-sender.js";
import {
  dayKeyUtc,
  nextDelayMs,
  renderTemplate,
  isQuietHour,
  pickSession,
  type SessionCandidate,
} from "./message-pacing.js";

const log = logger;
const sb = supabaseClient;
const workers = new Map<string, boolean>();

export function startMessageWorker(jobId: string): void {
  if (workers.has(jobId)) return;
  workers.set(jobId, true);
  runMessageWorker(jobId)
    .catch((e: unknown) => log.error("MsgWorker", `worker error ${jobId}: ${String(e)}`))
    .finally(() => workers.delete(jobId));
}

export function stopMessageWorker(jobId: string): void {
  workers.set(jobId, false);
  workers.delete(jobId);
}

/** Boot recovery: reclaim running jobs orphaned by a restart. Deliberately
 *  does NOT touch other statuses (cleanupOrphanedJobs is forbidden). */
export async function resumeMessageJobs(): Promise<void> {
  try {
    const { data } = await sb.from("message_jobs").select("id").eq("status", "running");
    for (const row of data ?? []) {
      log.info("MsgWorker", `resuming orphaned message job ${row.id}`);
      startMessageWorker(row.id);
    }
  } catch (err) {
    log.error("MsgWorker", `resumeMessageJobs failed: ${String(err)}`);
  }
}

interface PacingConfig {
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function updateProgress(jobId: string, progress: Record<string, unknown>): Promise<void> {
  await sb.from("message_jobs").update({ progress, updated_at: new Date().toISOString() }).eq("id", jobId);
}

/** Counters from message_send_counters for the given sessions today. */
async function loadCounters(sessionIds: string[]): Promise<Map<string, { sentToday: number; cooldownUntil: Date | null }>> {
  const map = new Map<string, { sentToday: number; cooldownUntil: Date | null }>();
  for (const id of sessionIds) map.set(id, { sentToday: 0, cooldownUntil: null });
  const { data } = await sb
    .from("message_send_counters")
    .select("session_id, sent_count, cooldown_until")
    .eq("day_key", dayKeyUtc())
    .in("session_id", sessionIds);
  for (const row of data ?? []) {
    map.set(row.session_id, {
      sentToday: row.sent_count ?? 0,
      cooldownUntil: row.cooldown_until ? new Date(row.cooldown_until) : null,
    });
  }
  return map;
}

async function bumpCounter(sessionId: string): Promise<void> {
  const day = dayKeyUtc();
  const { data: existing } = await sb
    .from("message_send_counters")
    .select("sent_count")
    .eq("session_id", sessionId)
    .eq("day_key", day)
    .maybeSingle();
  if (existing) {
    await sb
      .from("message_send_counters")
      .update({ sent_count: existing.sent_count + 1, updated_at: new Date().toISOString() })
      .eq("session_id", sessionId)
      .eq("day_key", day);
  } else {
    await sb.from("message_send_counters").upsert({
      session_id: sessionId,
      day_key: day,
      sent_count: 1,
      updated_at: new Date().toISOString(),
    });
  }
}

async function setCooldown(sessionId: string, hours = 24): Promise<void> {
  const until = new Date(Date.now() + hours * 3600_000);
  const day = dayKeyUtc();
  await sb.from("message_send_counters").upsert({
    session_id: sessionId,
    day_key: day,
    sent_count: 0,
    cooldown_until: until.toISOString(),
    updated_at: new Date().toISOString(),
  });
  log.warn("MsgWorker", `session ${sessionId.slice(0, 8)} cooling down until ${until.toISOString()}`);
}

interface WorkerHooks {
  /** injectable for tests */
  sendOneFn?: typeof sendOne;
  delayFn?: (ms: number) => Promise<void>;
}

export async function runMessageWorker(jobId: string, hooks: WorkerHooks = {}): Promise<void> {
  const send = hooks.sendOneFn ?? sendOne;
  const delay = hooks.delayFn ?? sleep;

  const { data: jobRows } = await sb.from("message_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!jobRows) {
    log.error("MsgWorker", `job ${jobId} not found`);
    return;
  }
  const job = jobRows as {
    id: string;
    user_id: string;
    name: string | null;
    session_ids: string[];
    content: { body?: string };
    config: PacingConfig;
    progress: Record<string, unknown>;
  };

  const cfg: PacingConfig = {
    daily_cap: job.config?.daily_cap ?? 40,
    rate_per_hour: job.config?.rate_per_hour ?? 12,
    delay_min: job.config?.delay_min ?? 45,
    delay_max: job.config?.delay_max ?? 150,
    batch_size: job.config?.batch_size ?? 8,
    batch_pause: job.config?.batch_pause ?? 900,
    respect_quiet_hours: job.config?.respect_quiet_hours ?? true,
    max_errors: job.config?.max_errors ?? 5,
    retry_max: job.config?.retry_max ?? 2,
  };
  const body = job.content?.body ?? "";
  const sessionIds = job.session_ids ?? [];

  const { data: sessionRows } = await sb.from("fb_sessions").select("id, status").in("id", sessionIds);
  const connectedIds = (sessionRows ?? []).filter((s) => s.status === "connected").map((s) => s.id);
  if (connectedIds.length === 0) {
    await sb.from("message_jobs").update({
      status: "failed",
      error: "لا توجد جلسات فيسبوك متصلة. أعد توصيل جلسة واحدة على الأقل ثم استأنف المهمة.",
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);
    return;
  }

  // One browser context per session, held for the whole job (no per-message churn).
  const contexts: Array<{ sessionId: string; contextId: string; page: import("playwright").Page }> = [];
  for (const sid of connectedIds) {
    try {
      const { cookies, proxy, userAgent, storageState } = await supabaseService.getSessionAndCookies(sid);
      const created = await contextManager.createContext(sid, cookies, proxy, userAgent, storageState);
      contexts.push({ sessionId: sid, contextId: created.contextId, page: created.page });
    } catch (err) {
      const code = err instanceof ExtractionError ? err.code : null;
      log.warn("MsgWorker", `job ${jobId}: skipping session ${sid.slice(0, 8)} (${code}): ${String(err).slice(0, 120)}`);
    }
  }
  if (contexts.length === 0) {
    await sb.from("message_jobs").update({
      status: "failed",
      error: "تعذر فتح سياق المتصفح لأي جلسة (مقفلة أو مستخدمة في مهمة أخرى). جرّب لاحقاً.",
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);
    return;
  }

  await sb.from("message_jobs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", jobId);

  const progress = {
    sent: (job.progress?.sent as number) || 0,
    failed: (job.progress?.failed as number) || 0,
    skipped: (job.progress?.skipped as number) || 0,
    current_idx: (job.progress?.current_idx as number) || 0,
    stop_reason: null as string | null,
  };
  let consecutiveErrors = 0;
  let sentInBatch = 0;
  let stopRequested = false;

  try {
    while (!stopRequested && workers.get(jobId) !== false) {
      // Pull one pending/failed recipient (oldest first) — campaign-worker pattern.
      const { data: recipients } = await sb
        .from("message_recipients")
        .select("id, fb_id, thread_id, name, attempts")
        .eq("message_job_id", jobId)
        .in("status", ["pending", "failed"])
        .lt("attempts", cfg.retry_max)
        .order("created_at", { ascending: true })
        .limit(1);

      const recipient = (recipients ?? [])[0] as
        | { id: string; fb_id: string; thread_id: string; name: string | null; attempts: number }
        | undefined;
      if (!recipient) {
        progress.stop_reason = progress.stop_reason ?? "all_recipients_done";
        break;
      }

      if (cfg.respect_quiet_hours && isQuietHour()) {
        progress.stop_reason = "quiet_hours";
        await updateProgress(jobId, progress);
        log.info("MsgWorker", `job ${jobId}: quiet hours — pausing until 07:00 Cairo`);
        break;
      }

      // Live counters + session selection
      const counters = await loadCounters(contexts.map((c) => c.sessionId));
      const sentWindowBase = Date.now() - 3600_000;
      const candidates: SessionCandidate[] = contexts.map((c) => ({
        sessionId: c.sessionId,
        sentToday: counters.get(c.sessionId)?.sentToday ?? 0,
        dailyCap: cfg.daily_cap,
        sentLastHour: (job.progress?.[`sent_${c.sessionId}`] as number) || 0,
        ratePerHour: cfg.rate_per_hour,
        cooldownUntil: counters.get(c.sessionId)?.cooldownUntil ?? null,
        closed: c.page.isClosed(),
      }));
      const chosen = pickSession(candidates);
      if (!chosen) {
        const anyCap = candidates.every((c) => c.sentToday >= c.dailyCap);
        progress.stop_reason = anyCap ? "daily_cap_reached" : "all_sessions_cooling";
        await updateProgress(jobId, progress);
        await sb.from("message_jobs").update({ status: "paused" }).eq("id", jobId);
        log.info("MsgWorker", `job ${jobId}: no eligible session (${progress.stop_reason}) — paused`);
        break;
      }
      const ctx = contexts.find((c) => c.sessionId === chosen.sessionId)!;

      const text = renderTemplate(body, { name: recipient.name ?? "" });
      let outcome: SendOutcome;
      try {
        outcome = await send(ctx.page, recipient.thread_id, text);
      } catch (err) {
        outcome = { ok: false, kind: "send_failed", detail: String(err).slice(0, 200) };
      }

      if (outcome.ok) {
        await sb.from("message_recipients").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          sent_via_session_id: chosen.sessionId,
          error: null,
        }).eq("id", recipient.id);
        await bumpCounter(chosen.sessionId);
        progress.sent += 1;
        progress.current_idx += 1;
        sentInBatch += 1;
        consecutiveErrors = 0;
        log.info("MsgWorker", `job ${jobId}: sent to ${recipient.thread_id} via ${chosen.sessionId.slice(0, 8)} (${progress.sent})`);
      } else if (outcome.kind === "rate_limited" || outcome.kind === "session_dead") {
        // Session problem, not recipient problem — cooldown + try other session,
        // attempts NOT incremented.
        await setCooldown(chosen.sessionId, outcome.kind === "session_dead" ? 72 : 24);
        consecutiveErrors += 1;
        log.warn("MsgWorker", `job ${jobId}: session ${chosen.sessionId.slice(0, 8)} ${outcome.kind} — ${outcome.detail}`);
      } else if (outcome.kind === "thread_unavailable") {
        await sb.from("message_recipients").update({
          status: "skipped",
          error: outcome.detail,
        }).eq("id", recipient.id);
        progress.skipped += 1;
        progress.current_idx += 1;
        log.info("MsgWorker", `job ${jobId}: skipped ${recipient.thread_id} (${outcome.detail})`);
      } else {
        const attempts = recipient.attempts + 1;
        const failed = attempts >= cfg.retry_max;
        await sb.from("message_recipients").update({
          status: failed ? "failed" : "pending",
          attempts,
          error: outcome.detail,
        }).eq("id", recipient.id);
        if (failed) {
          progress.failed += 1;
          progress.current_idx += 1;
        }
        consecutiveErrors += 1;
        log.warn("MsgWorker", `job ${jobId}: send failed ${recipient.thread_id} attempt ${attempts}/${cfg.retry_max} — ${outcome.detail}`);
      }

      await updateProgress(jobId, progress);

      if (consecutiveErrors >= cfg.max_errors) {
        progress.stop_reason = "too_many_errors";
        await updateProgress(jobId, progress);
        await sb.from("message_jobs").update({ status: "paused" }).eq("id", jobId);
        log.warn("MsgWorker", `job ${jobId}: ${consecutiveErrors} consecutive errors — paused`);
        break;
      }

      // Batch pause
      if (sentInBatch >= cfg.batch_size) {
        sentInBatch = 0;
        log.info("MsgWorker", `job ${jobId}: batch done — resting ${cfg.batch_pause}s`);
        await delay(cfg.batch_pause * 1000);
        if (workers.get(jobId) === false) { stopRequested = true; break; }
      }

      await delay(nextDelayMs(cfg.delay_min, cfg.delay_max));
    }

    // Terminal states
    if (progress.stop_reason === "all_recipients_done" || (progress.stop_reason === null && !stopRequested)) {
      progress.stop_reason = progress.stop_reason ?? "all_recipients_done";
      await updateProgress(jobId, progress);
      await sb.from("message_jobs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
      }).eq("id", jobId);
      log.info("MsgWorker", `job ${jobId} completed: ${progress.sent} sent, ${progress.failed} failed, ${progress.skipped} skipped`);
    }
  } finally {
    for (const c of contexts) {
      await contextManager.releaseContext(c.contextId).catch(() => {});
    }
  }
}
