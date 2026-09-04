/**
 * Instagram action worker — runs mention (comment-batch) and DM jobs reusing
 * the SAME tables as the Messenger broadcast (message_jobs / recipients /
 * send_counters) but reading from ig_sessions and driving ig-contexts.
 *
 * Lifecycle mirrors message-worker.ts: queued → running → completed | paused
 * (cap/quiet/errors/session-blocked) | canceled | failed. The brand-new piece
 * of logic is mention mode: ONE comment touches a BATCH of up to
 * IG_MENTION_CEILING usernames, so a "send" unit is a batch, not a recipient.
 * The counter (rate-limit unit) is incremented once per comment, not per name.
 *
 * Boot recovery: resumeIgActionJobs() reclaims running IG jobs after a restart
 * without touching other platforms (cleanupOrphanedJobs stays forbidden).
 */
import { igSupabaseService } from "./ig-supabase.js";
import { igContextManager } from "./ig-context-manager.js";
import { supabaseClient } from "./supabase.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import {
  postComment,
  type SendOutcome as CommentOutcome,
} from "./ig-comment-sender.js";
import { sendIgDm, type SendOutcome as DmOutcome } from "./ig-dm-sender.js";
import { detectIgActionBlock } from "./ig-action-pacing.js";
import {
  dayKeyUtc,
  nextDelayMs,
  isQuietHour,
  pickSession,
  chunkMentions,
  buildMentionComment,
  normalizeIgHandle,
  IG_MENTION_DEFAULTS,
  IG_MENTION_TWO_SESSIONS,
  IG_DM_DEFAULTS,
  type SessionCandidate,
} from "./ig-action-pacing.js";

const log = logger;
const sb = supabaseClient;
const workers = new Map<string, boolean>();

export function startIgActionWorker(jobId: string): void {
  if (workers.has(jobId)) return;
  workers.set(jobId, true);
  runIgActionWorker(jobId)
    .catch((e: unknown) => log.error("IgAction", `worker error ${jobId}: ${String(e)}`))
    .finally(() => workers.delete(jobId));
}

export function stopIgActionWorker(jobId: string): void {
  workers.set(jobId, false);
  workers.delete(jobId);
}

export async function resumeIgActionJobs(): Promise<void> {
  try {
    const { data } = await sb
      .from("message_jobs")
      .select("id")
      .eq("platform", "instagram")
      .in("status", ["running", "paused"]);
    for (const row of data ?? []) {
      log.info("IgAction", `resuming orphaned IG action job ${row.id}`);
      startIgActionWorker(row.id);
    }
  } catch (err) {
    log.error("IgAction", `resumeIgActionJobs failed: ${String(err)}`);
  }
}

interface PacingConfig {
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function updateProgress(jobId: string, progress: Record<string, unknown>): Promise<void> {
  await sb.from("message_jobs").update({ progress, updated_at: new Date().toISOString() }).eq("id", jobId);
}

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
  log.warn("IgAction", `session ${sessionId.slice(0, 8)} cooling down until ${until.toISOString()}`);
}

export interface IgWorkerHooks {
  sendCommentFn?: typeof postComment;
  sendDmFn?: typeof sendIgDm;
  delayFn?: (ms: number) => Promise<void>;
}

interface CtxHandle {
  sessionId: string;
  page: import("playwright").Page;
}

/**
 * Pull the next batch of pending recipients and run the worker loop over them.
 * Shared by the real path and the unit test (which injects send/delay hooks).
 */
export async function runIgActionWorker(jobId: string, hooks: IgWorkerHooks = {}): Promise<void> {
  const sendComment = hooks.sendCommentFn ?? postComment;
  const sendDm = hooks.sendDmFn ?? sendIgDm;
  const delay = hooks.delayFn ?? sleep;

  const { data: jobRows } = await sb.from("message_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!jobRows) {
    log.error("IgAction", `job ${jobId} not found`);
    return;
  }
  const job = jobRows as {
    id: string;
    user_id: string;
    name: string | null;
    session_ids: string[];
    content: { body?: string; post_shortcode?: string };
    mode: "dm" | "mention";
    config: PacingConfig;
    progress: Record<string, unknown>;
  };

  const isMention = job.mode === "mention";

  const sessionIds = job.session_ids ?? [];
  const body = job.content?.body ?? "";
  const shortcode = job.content?.post_shortcode ?? "";

  const { data: sessionRows } = await sb.from("ig_sessions").select("id, status").in("id", sessionIds);
  const connectedIds = (sessionRows ?? []).filter((s) => s.status === "connected").map((s) => s.id);

  if (connectedIds.length === 0) {
    await sb.from("message_jobs").update({
      status: "failed",
      error: "لا توجد جلسات إنستجرام متصلة. أعد توصيل جلسة واحدة على الأقل ثم استأنف المهمة.",
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);
    return;
  }

  // Use two-session optimized config for mention mode when exactly 2 sessions available
  const useTwoSessionConfig = isMention && connectedIds.length === 2;
  const cfg: PacingConfig = {
    mentions_per_comment: job.config?.mentions_per_comment ?? (useTwoSessionConfig ? IG_MENTION_TWO_SESSIONS.mentions_per_comment : IG_MENTION_DEFAULTS.mentions_per_comment),
    comments_per_hour: job.config?.comments_per_hour ?? (useTwoSessionConfig ? IG_MENTION_TWO_SESSIONS.comments_per_hour : IG_MENTION_DEFAULTS.comments_per_hour),
    daily_cap: job.config?.daily_cap ?? (isMention ? (useTwoSessionConfig ? IG_MENTION_TWO_SESSIONS.daily_cap : IG_MENTION_DEFAULTS.daily_cap) : IG_DM_DEFAULTS.daily_cap),
    rate_per_hour: job.config?.rate_per_hour ?? (isMention ? (useTwoSessionConfig ? IG_MENTION_TWO_SESSIONS.rate_per_hour : IG_MENTION_DEFAULTS.rate_per_hour) : IG_DM_DEFAULTS.rate_per_hour),
    delay_min: job.config?.delay_min ?? (isMention ? (useTwoSessionConfig ? IG_MENTION_TWO_SESSIONS.delay_min : IG_MENTION_DEFAULTS.delay_min) : IG_DM_DEFAULTS.delay_min),
    delay_max: job.config?.delay_max ?? (isMention ? (useTwoSessionConfig ? IG_MENTION_TWO_SESSIONS.delay_max : IG_MENTION_DEFAULTS.delay_max) : IG_DM_DEFAULTS.delay_max),
    batch_size: job.config?.batch_size ?? (isMention ? (useTwoSessionConfig ? IG_MENTION_TWO_SESSIONS.batch_size : IG_MENTION_DEFAULTS.batch_size) : IG_DM_DEFAULTS.batch_size),
    batch_pause: job.config?.batch_pause ?? (isMention ? (useTwoSessionConfig ? IG_MENTION_TWO_SESSIONS.batch_pause : IG_MENTION_DEFAULTS.batch_pause) : IG_DM_DEFAULTS.batch_pause),
    respect_quiet_hours: job.config?.respect_quiet_hours ?? true,
    max_errors: job.config?.max_errors ?? (useTwoSessionConfig ? IG_MENTION_TWO_SESSIONS.max_errors : IG_MENTION_DEFAULTS.max_errors),
    retry_max: job.config?.retry_max ?? (useTwoSessionConfig ? IG_MENTION_TWO_SESSIONS.retry_max : IG_MENTION_DEFAULTS.retry_max),
  };

  const contexts: CtxHandle[] = [];
  for (const sid of connectedIds) {
    try {
      const { cookies, proxy, userAgent } = await igSupabaseService.getIgSessionAndCookies(sid);
      const created = await igContextManager.createContext(sid, cookies, proxy, userAgent);
      contexts.push({ sessionId: sid, page: created.page });
    } catch (err) {
      const code = err instanceof ExtractionError ? err.code : null;
      log.warn("IgAction", `job ${jobId}: skipping session ${sid.slice(0, 8)} (${code}): ${String(err).slice(0, 120)}`);
    }
  }
  if (contexts.length === 0) {
    await sb.from("message_jobs").update({
      status: "failed",
      error: "تعذر فتح سياق المتصفح لأي جلسة إنستجرام (مقفلة أو مستخدمة في مهمة أخرى). جرّب لاحقاً.",
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
  
  // Checkpoint system for recovery
  const CHECKPOINT_INTERVAL = 50; // Save checkpoint every 50 mentions
  let lastCheckpointIdx = (job.progress?.checkpoint_idx as number) || 0;
  
  async function saveCheckpoint(): Promise<void> {
    if (progress.current_idx - lastCheckpointIdx >= CHECKPOINT_INTERVAL) {
      await sb.from("message_jobs").update({ 
        progress: { 
          ...progress, 
          checkpoint_idx: progress.current_idx,
          checkpoint_time: new Date().toISOString()
        } 
      }).eq("id", jobId);
      lastCheckpointIdx = progress.current_idx;
      log.info("IgAction", `job ${jobId}: checkpoint saved at ${progress.current_idx} mentions`);
    }
  }
  
  function generateProgressReport(): string {
    const totalUsers = progress.sent + progress.failed + progress.skipped;
    const successRate = totalUsers > 0 ? Math.round((progress.sent / totalUsers) * 100) : 0;
    const estimatedRemaining = progress.sent > 0 ? 
      Math.round((progress.current_idx - progress.sent) * 480 / 60) : 0; // Estimate in minutes
    
    return `Progress Report for Job ${jobId}:
- Total Mentions: ${progress.current_idx}
- Successfully Sent: ${progress.sent}
- Failed: ${progress.failed}
- Skipped: ${progress.skipped}
- Success Rate: ${successRate}%
- Estimated Time Remaining: ${estimatedRemaining} minutes
- Checkpoint: ${lastCheckpointIdx}/${progress.current_idx}
- Sessions Active: ${contexts.length}`;
  }
  
  async function preventDuplicates(usernames: string[]): Promise<boolean> {
    const existing = await sb
      .from("message_recipients")
      .select("thread_id")
      .in("thread_id", usernames)
      .eq("message_job_id", jobId)
      .eq("status", "sent");

    return (existing.data ?? []).length === 0;
  }

  try {
    while (!stopRequested && workers.get(jobId) !== false) {
      const { data: recipients } = await sb
        .from("message_recipients")
        .select("id, fb_id, thread_id, name, attempts, batch_index")
        .eq("message_job_id", jobId)
        .in("status", ["pending", "failed"])
        .lt("attempts", cfg.retry_max)
        .order("created_at", { ascending: true })
        .limit(1);

      if (isMention) {
        // Mention mode: collect the next batch-index worth of pending recipients
        // and post ONE comment covering them all.
        const nextBatch = await nextMentionBatch(jobId, cfg.batch_size);
        if (!nextBatch || nextBatch.length === 0) {
          progress.stop_reason = progress.stop_reason ?? "all_recipients_done";
          break;
        }
        if (cfg.respect_quiet_hours && isQuietHour()) {
          progress.stop_reason = "quiet_hours";
          await updateProgress(jobId, progress);
          log.info("IgAction", `job ${jobId}: quiet hours — pausing until 07:00 Cairo`);
          break;
        }
        const chosen = await chooseSession(contexts, cfg, progress);
        if (!chosen) {
          progress.stop_reason = contexts.every((c) => false) && progress.sent >= 0 ? progress.stop_reason ?? pickStopReason(contexts, cfg, progress) : pickStopReason(contexts, cfg, progress);
          await updateProgress(jobId, progress);
          await sb.from("message_jobs").update({ status: "paused" }).eq("id", jobId);
          break;
        }
        const handles = nextBatch.map((r) => normalizeIgHandle(r.thread_id) ?? normalizeIgHandle(r.fb_id)).filter(Boolean) as string[];
        
        // Prevent duplicates before processing
        const hasDuplicates = await preventDuplicates(handles);
        if (!hasDuplicates) {
          log.warn("IgAction", `job ${jobId}: skipping batch due to duplicate mentions`);
          await markBatchSkipped(jobId, nextBatch.map((r) => r.id), "duplicate mentions detected");
          progress.skipped += nextBatch.length;
          progress.current_idx += nextBatch.length;
          continue;
        }
        
        const commentText = buildMentionComment(body, handles);
        let outcome: CommentOutcome;
        try {
          outcome = await sendComment(chosen.page, shortcode, commentText);
        } catch (err) {
          outcome = { ok: false, kind: "send_failed", detail: String(err).slice(0, 200) };
        }
        if (outcome.ok) {
          await markBatchSent(jobId, nextBatch.map((r) => r.id), chosen.sessionId);
          await bumpCounter(chosen.sessionId);
          progress.sent += nextBatch.length;
          progress.current_idx += nextBatch.length;
          sentInBatch += 1;
          consecutiveErrors = 0;
          
          // Save checkpoint and log progress
          await saveCheckpoint();
          if (progress.sent % 100 === 0) {
            log.info("IgAction", `job ${jobId}: progress milestone - ${progress.sent}/${progress.current_idx} mentions sent`);
            log.info("IgAction", generateProgressReport());
          }
          
          log.info("IgAction", `job ${jobId}: mention comment sent (${handles.length} handles) via ${chosen.sessionId.slice(0, 8)} — ${progress.sent} total`);
        } else if (outcome.kind === "rate_limited" || outcome.kind === "session_dead") {
          await setCooldown(chosen.sessionId, outcome.kind === "session_dead" ? 72 : 24);
          consecutiveErrors += 1;
          log.warn("IgAction", `job ${jobId}: session ${chosen.sessionId.slice(0, 8)} ${outcome.kind} — ${outcome.detail}`);
        } else if (outcome.kind === "thread_unavailable") {
          await markBatchSkipped(jobId, nextBatch.map((r) => r.id), outcome.detail);
          progress.skipped += nextBatch.length;
          progress.current_idx += nextBatch.length;
        } else {
          await markBatchFailed(jobId, nextBatch.map((r) => r.id), cfg.retry_max, outcome.detail);
          progress.failed += nextBatch.length;
          progress.current_idx += nextBatch.length;
          consecutiveErrors += 1;
        }
      } else {
        // DM mode: one recipient per cycle.
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
          log.info("IgAction", `job ${jobId}: quiet hours — pausing until 07:00 Cairo`);
          break;
        }
        const chosen = await chooseSession(contexts, cfg, progress);
        if (!chosen) {
          progress.stop_reason = pickStopReason(contexts, cfg, progress);
          await updateProgress(jobId, progress);
          await sb.from("message_jobs").update({ status: "paused" }).eq("id", jobId);
          break;
        }
        const handle = normalizeIgHandle(recipient.thread_id) ?? normalizeIgHandle(recipient.fb_id);
        if (!handle) {
          await markRecipientSkipped(jobId, recipient.id, "invalid username");
          progress.skipped += 1;
          progress.current_idx += 1;
          continue;
        }
        let outcome: DmOutcome;
        try {
          outcome = await sendDm(chosen.page, handle, body);
        } catch (err) {
          outcome = { ok: false, kind: "send_failed", detail: String(err).slice(0, 200) };
        }
        if (outcome.ok) {
          await markRecipientSent(jobId, recipient.id, chosen.sessionId);
          await bumpCounter(chosen.sessionId);
          progress.sent += 1;
          progress.current_idx += 1;
          sentInBatch += 1;
          consecutiveErrors = 0;
        } else if (outcome.kind === "rate_limited" || outcome.kind === "session_dead") {
          await setCooldown(chosen.sessionId, outcome.kind === "session_dead" ? 72 : 24);
          consecutiveErrors += 1;
        } else if (outcome.kind === "thread_unavailable") {
          await markRecipientSkipped(jobId, recipient.id, outcome.detail);
          progress.skipped += 1;
          progress.current_idx += 1;
        } else {
          const attempts = recipient.attempts + 1;
          const failed = attempts >= cfg.retry_max;
          await markRecipientFailed(jobId, recipient.id, attempts, failed, outcome.detail);
          if (failed) progress.failed += 1;
          progress.current_idx += 1;
          consecutiveErrors += 1;
        }
      }

      await updateProgress(jobId, progress);

      if (consecutiveErrors >= cfg.max_errors) {
        progress.stop_reason = "too_many_errors";
        await updateProgress(jobId, progress);
        await sb.from("message_jobs").update({ status: "paused" }).eq("id", jobId);
        log.warn("IgAction", `job ${jobId}: ${consecutiveErrors} consecutive errors — paused`);
        break;
      }

      if (sentInBatch >= cfg.batch_size) {
        sentInBatch = 0;
        log.info("IgAction", `job ${jobId}: batch done — resting ${cfg.batch_pause}s`);
        await delay(cfg.batch_pause * 1000);
        if (workers.get(jobId) === false) break;
      }

      await delay(nextDelayMs(cfg.delay_min, cfg.delay_max));
    }

    if (progress.stop_reason === "all_recipients_done" || (progress.stop_reason === null && !stopRequested)) {
      progress.stop_reason = progress.stop_reason ?? "all_recipients_done";
      await updateProgress(jobId, progress);
      await sb.from("message_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", jobId);
      log.info("IgAction", `job ${jobId} completed: ${progress.sent} sent, ${progress.failed} failed, ${progress.skipped} skipped`);
    }
  } finally {
    for (const c of contexts) {
      await igContextManager.releaseContext(c.sessionId).catch(() => {});
    }
  }
}

// ─── recipient batching helpers ─────────────────────────────────────────────

async function nextMentionBatch(jobId: string, batchSize: number): Promise<Array<{ id: string; fb_id: string; thread_id: string }> | null> {
  const { data } = await sb
    .from("message_recipients")
    .select("id, fb_id, thread_id, batch_index")
    .eq("message_job_id", jobId)
    .is("batch_index", null)
    .in("status", ["pending", "failed"])
    .lt("attempts", 3)
    .order("created_at", { ascending: true })
    .limit(batchSize);
  const rows = (data ?? []) as Array<{ id: string; fb_id: string; thread_id: string; batch_index: number | null }>;
  // Assign the batch_index up front so a resume doesn't re-pick the same rows.
  if (rows.length === 0) return null;
  const idx = Date.now();
  const ids = rows.map((r) => r.id);
  await sb.from("message_recipients").update({ batch_index: idx }).in("id", ids);
  void chunkMentions; // kept imported for reuse at the sender layer
  return rows.map((r) => ({ id: r.id, fb_id: r.fb_id, thread_id: r.thread_id }));
}

function pickStopReason(_contexts: CtxHandle[], cfg: PacingConfig, progress: { sent: number }): string {
  void cfg;
  void progress;
  return "all_sessions_cooling";
}

async function chooseSession(
  contexts: CtxHandle[],
  cfg: PacingConfig,
  _progress: { sent: number },
): Promise<CtxHandle | null> {
  const counters = await loadCounters(contexts.map((c) => c.sessionId));
  
  // Special handling for exactly 2 sessions with smart distribution
  if (contexts.length === 2) {
    const [session1, session2] = contexts;
    const ctr1 = counters.get(session1.sessionId)!;
    const ctr2 = counters.get(session2.sessionId)!;
    
    // Prefer the session with lower usage for load balancing
    const session1Usage = ctr1.sentToday / cfg.daily_cap;
    const session2Usage = ctr2.sentToday / cfg.daily_cap;
    
    // Add randomization to prevent pattern detection
    const randomFactor = Math.random() * 0.1; // 10% randomization
    
    if (session1Usage < session2Usage + randomFactor) {
      return session1;
    } else {
      return session2;
    }
  }
  
  // Default behavior for other session counts
  const candidates: SessionCandidate[] = contexts.map((c) => {
    const ctr = counters.get(c.sessionId)!;
    return {
      sessionId: c.sessionId,
      sentToday: ctr.sentToday,
      dailyCap: cfg.daily_cap,
      sentLastHour: 0,
      ratePerHour: cfg.rate_per_hour,
      cooldownUntil: ctr.cooldownUntil,
      closed: c.page.isClosed(),
    };
  });
  const chosen = pickSession(candidates);
  if (!chosen) return null;
  return contexts.find((c) => c.sessionId === chosen.sessionId) ?? null;
}

async function markRecipientSent(jobId: string, id: string, sessionId: string): Promise<void> {
  await sb.from("message_recipients").update({
    status: "sent",
    sent_at: new Date().toISOString(),
    sent_via_session_id: sessionId,
    error: null,
  }).eq("id", id).eq("message_job_id", jobId);
}

async function markRecipientSkipped(jobId: string, id: string, reason: string): Promise<void> {
  await sb.from("message_recipients").update({ status: "skipped", error: reason }).eq("id", id).eq("message_job_id", jobId);
}

async function markRecipientFailed(jobId: string, id: string, attempts: number, failed: boolean, detail: string): Promise<void> {
  await sb.from("message_recipients").update({
    status: failed ? "failed" : "pending",
    attempts,
    error: detail,
  }).eq("id", id).eq("message_job_id", jobId);
}

async function markBatchSent(jobId: string, ids: string[], sessionId: string): Promise<void> {
  await sb.from("message_recipients").update({
    status: "sent",
    sent_at: new Date().toISOString(),
    sent_via_session_id: sessionId,
    error: null,
  }).in("id", ids).eq("message_job_id", jobId);
}

async function markBatchSkipped(jobId: string, ids: string[], reason: string): Promise<void> {
  await sb.from("message_recipients").update({ status: "skipped", error: reason }).in("id", ids).eq("message_job_id", jobId);
}

async function markBatchFailed(jobId: string, ids: string[], retryMax: number, detail: string): Promise<void> {
  // On mention failure the whole batch retries together (attempts +1).
  const { data } = await sb.from("message_recipients").select("id, attempts").in("id", ids).eq("message_job_id", jobId);
  for (const r of data ?? []) {
    const attempts = (r.attempts ?? 0) + 1;
    await sb.from("message_recipients").update({
      status: attempts >= retryMax ? "failed" : "pending",
      attempts,
      error: detail,
    }).eq("id", r.id).eq("message_job_id", jobId);
  }
}
