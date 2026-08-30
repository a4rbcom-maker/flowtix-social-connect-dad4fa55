import { supabaseService, supabaseClient } from "./supabase.js";
import { contextManager } from "./context-manager.js";
import { logger } from "../logger.js";
import { postedGroupIds, computeFinalStatus, type PublishResultRow } from "./publish-logic.js";
import type { Page } from "playwright";

const log = logger;
const sb = supabaseClient;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

/** Jobs this process should keep running (pause/stop flag). */
const runningJobs = new Set<string>();
/** Jobs currently owned by this process — guards duplicate start/resume. */
const localJobs = new Set<string>();

export function isJobRunningHere(jobId: string): boolean {
  return localJobs.has(jobId);
}

export function startPublishWorker(jobId: string, sessionId: string) {
  if (localJobs.has(jobId)) {
    log.warn("PublishWorker", `job ${jobId} already running in this process — ignoring duplicate start`);
    return;
  }
  localJobs.add(jobId);
  runningJobs.add(jobId);
  runPublishWorker(jobId, sessionId).catch(err => {
    log.error("PublishWorker", `worker error for ${jobId}: ${String(err)}`);
    // Crash before/during the run loop (session load, browser context) would
    // otherwise leave the job stuck in "running" forever, blocking new jobs.
    void (async () => {
      try {
        await sb.from("publish_jobs").update({ status: "failed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", jobId).neq("status", "canceled");
        log.info("PublishWorker", `job ${jobId} marked failed after crash`);
      } catch (e) {
        log.error("PublishWorker", `could not mark ${jobId} failed: ${String(e)}`);
      }
    })();
  }).finally(() => {
    runningJobs.delete(jobId);
    localJobs.delete(jobId);
  });
}

export function stopPublishWorker(jobId: string) {
  runningJobs.delete(jobId);
  localJobs.delete(jobId);
}

async function runPublishWorker(jobId: string, sessionId: string) {
  const { data: rows } = await sb.from("publish_jobs").select("*").eq("id", jobId);
  if (!rows?.length) { log.error("PublishWorker", `job ${jobId} not found`); return; }
  const job = rows[0];
  const cfg = (job.config || {}) as Record<string, any>;
  const groups: string[] = cfg.group_ids || [];
  // skip_restricted also covers composer-not-found groups (join approval, muted, no rights)
  const skipOnMissingComposer = cfg.skip_restricted !== false;
  const BATCH_SIZE = cfg.batch_size || 5;
  const BATCH_PAUSE = cfg.batch_pause || 600;

  const { cookies, proxy, userAgent, storageState } = await supabaseService.getSessionAndCookies(sessionId);
  const { page, contextId } = await contextManager.createContext(sessionId, cookies, proxy, userAgent, storageState);

  try {
    // v2: keyboard-typed composer + per-post feed verification (messenger-
    // broadcast pattern). The old innerText-injection path reported false
    // "posted" for posts that never appeared.
    log.info("PublishWorker", `[v2] starting ${jobId}: ${groups.length} groups, batch=${BATCH_SIZE}, pause=${BATCH_PAUSE}s`);

    let published = job.progress?.published || 0;
    let failed = job.progress?.failed || 0;
    let skipped = job.progress?.skipped || 0;
    const results: PublishResultRow[] = Array.isArray(job.results) ? job.results : [];
    const alreadyPosted = postedGroupIds(results);
    let consecutiveErrors = 0;

    // paused=true covers every early-exit path (user pause, stop, max-errors,
    // stop-during-sleep). Only a loop that reaches the end of the list leaves
    // it false. The single exit writes the final status — no running leaks.
    let paused = true;
    for (let i = 0; i < groups.length; i++) {
      if (!runningJobs.has(jobId)) {
        await saveCheckpoint(jobId, i, published, failed, skipped, results, currentBatchOf(i, BATCH_SIZE));
        log.info("PublishWorker", `job ${jobId}: interrupted at index ${i}`);
        break;
      }

      const gid = groups[i];
      // Idempotency: never post twice into the same group within one job.
      if (alreadyPosted.has(gid)) continue;

      try {
        const delay = randInt(cfg.delay_min || 60, cfg.delay_max || 180);
        log.info("PublishWorker", `[${i + 1}/${groups.length}] group ${gid}, delay ${delay}s`);
        await sleep(delay * 1000);
        if (!runningJobs.has(jobId)) {
          await saveCheckpoint(jobId, i, published, failed, skipped, results, currentBatchOf(i, BATCH_SIZE));
          log.info("PublishWorker", `job ${jobId}: interrupted during delay at index ${i}`);
          break;
        }

        await page.goto(`https://www.facebook.com/groups/${gid}`, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(3000);
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1500);

        const postResult = await attemptPost(page, cfg.message as string, skipOnMissingComposer);
        if (postResult === "posted") {
          published++; consecutiveErrors = 0;
          alreadyPosted.add(gid);
          results.push({ group_id: gid, status: "posted", at: new Date().toISOString(), batch: currentBatchOf(i, BATCH_SIZE) });
        } else if (postResult === "composer_not_found") {
          skipped++; consecutiveErrors = 0;
          results.push({ group_id: gid, status: "skip", reason: "composer_not_found", at: new Date().toISOString(), batch: currentBatchOf(i, BATCH_SIZE) });
        } else {
          let retried = false;
          for (let r = 0; r < (cfg.max_retries || 1); r++) {
            await sleep(5000);
            if ((await attemptPost(page, cfg.message as string, false)) === "posted") {
              published++; consecutiveErrors = 0;
              alreadyPosted.add(gid);
              results.push({ group_id: gid, status: "posted", at: new Date().toISOString(), retries: r + 1, batch: currentBatchOf(i, BATCH_SIZE) });
              retried = true; break;
            }
          }
          if (!retried) { failed++; consecutiveErrors++; results.push({ group_id: gid, status: "fail", reason: postResult, at: new Date().toISOString(), batch: currentBatchOf(i, BATCH_SIZE) }); }
        }
      } catch (err) {
        failed++; consecutiveErrors++;
        results.push({ group_id: gid, status: "fail", reason: String(err), at: new Date().toISOString(), batch: currentBatchOf(i, BATCH_SIZE) });
      }

      await updateProgress(jobId, published, failed, skipped, results);
      if (consecutiveErrors >= (cfg.max_errors || 10)) {
        log.warn("PublishWorker", `job ${jobId}: ${consecutiveErrors} consecutive errors — stopping for safety`);
        await saveCheckpoint(jobId, i + 1, published, failed, skipped, results, currentBatchOf(i, BATCH_SIZE));
        break;
      }

      if ((i + 1) % BATCH_SIZE === 0 && i < groups.length - 1) {
        await saveCheckpoint(jobId, i + 1, published, failed, skipped, results, currentBatchOf(i, BATCH_SIZE) + 1);
        if (!runningJobs.has(jobId)) {
          log.info("PublishWorker", `job ${jobId}: interrupted at batch boundary`);
          break;
        }
        log.info("PublishWorker", `batch done (${BATCH_SIZE} groups), pausing ${BATCH_PAUSE}s...`);
        await sleep(BATCH_PAUSE * 1000);
        log.info("PublishWorker", `resuming batch ${currentBatchOf(i, BATCH_SIZE) + 1}...`);
      }

      if (i % 5 === 0) await saveCheckpoint(jobId, i + 1, published, failed, skipped, results, currentBatchOf(i, BATCH_SIZE));
    }
    if (!runningJobs.has(jobId)) paused = true; else paused = false;

    // Single exit: "completed" only when the loop reached the end of the list
    // (failed/skipped groups count as processed). Any interruption → "paused",
    // resumable; resume() skips already-posted groups (idempotency).
    const finalStatus = computeFinalStatus(paused);
    await sb.from("publish_jobs").update({
      status: finalStatus,
      ...(finalStatus === "completed" ? { completed_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    }).eq("id", jobId).neq("status", "canceled");
    log.info("PublishWorker", `job ${jobId} -> ${finalStatus}: ${published} posted, ${failed} fail, ${skipped} skip`);
  } finally {
    await contextManager.releaseContext(contextId);
  }
}

function currentBatchOf(idx: number, batchSize: number): number {
  return Math.floor(idx / batchSize) + 1;
}

/**
 * Try to publish `message` into the group page currently open on `page`.
 * Returns the concrete failure reason on non-success so results stay debuggable.
 */
export type PostAttempt =
  | "posted"
  | "composer_not_found"
  | "submit_disabled"
  | "typing_failed"
  | "no_confirmation";

const COMPOSER_SEL = 'div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-lexical-editor], textarea[name="message"]';
const SUBMIT_SEL = 'div[role="button"][aria-label*="نشر"], div[role="button"][aria-label*="Post"]';

export async function attemptPost(page: Page, message: string, _skipOnMissingComposer: boolean): Promise<PostAttempt> {
  // Modern group pages render a trigger button ("اكتب شيئًا..." / "Write
  // something...") that opens the real composer dialog — open it first.
  await openComposerTrigger(page);
  // Composer is lazy-mounted after the trigger click — poll for it.
  for (let w = 0; w < 4; w++) {
    if (w > 0) await page.waitForTimeout(2000);
    if (await hasComposer(page)) return await typeAndSubmit(page, message);
  }
  log.info("PublishWorker", `composer not found after polling`);
  return "composer_not_found";
}

async function openComposerTrigger(page: Page): Promise<boolean> {
  return Boolean(await page.evaluate(
    `(() => {
      const words = ["اكتب شيئا", "اكتب شيئًا", "كتابة منشور", "إنشاء منشور", "write something", "create post", "write a post"];
      const els = document.querySelectorAll('div[role="button"], button, [tabindex="0"]');
      for (const el of els) {
        const t = ((el.getAttribute("aria-label") || "") + " " + (el.innerText || "")).trim().toLowerCase();
        if (!t || t.length > 60) continue;
        if (words.some(w => t.includes(w))) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { el.click(); return true; }
        }
      }
      return false;
    })()`,
  ).catch(() => false));
}

async function hasComposer(page: Page): Promise<boolean> {
  return Boolean(await page.evaluate(`(() => !!document.querySelector(${JSON.stringify(COMPOSER_SEL)}))()`).catch(() => false));
}

async function typeAndSubmit(page: Page, message: string): Promise<PostAttempt> {
  try {
    // Messenger-proven pattern: focus + real keystrokes. Never click the
    // composer (PIN/E2E overlays intercept pointer events), never set
    // innerText (Lexical ignores synthetic value changes).
    await page.focus(COMPOSER_SEL);
    // Clear any leftover text from a failed prior attempt before typing —
    // otherwise retries append and the post duplicates its own content.
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await page.keyboard.press("Delete");
    await page.keyboard.type(message, { delay: randInt(20, 45) });

    // The Post button enables only when the editor state actually holds the
    // text — if it never enables, the text did not register. No fake success.
    const enabled = await page
      .waitForFunction(
        `(sel) => {
          for (const el of document.querySelectorAll(sel)) {
            const d = el.getAttribute("aria-disabled");
            if (d !== "true") {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) return true;
            }
          }
          return false;
        }`,
        SUBMIT_SEL,
        { timeout: 8000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!enabled) return "submit_disabled";

    await page.evaluate(
      `(sel) => {
        for (const el of document.querySelectorAll(sel)) {
          if (el.getAttribute("aria-disabled") !== "true") { el.click(); return true; }
        }
        return false;
      }`,
      SUBMIT_SEL,
    );

    // VERIFICATION: only count the post when it actually lands in the feed.
    const confirmed = await waitForPublishConfirmation(page, message);
    if (!confirmed) return "no_confirmation";
    log.info("PublishWorker", `post verified in group feed`);
    return "posted";
  } catch (err) {
    log.warn("PublishWorker", `attemptPost error: ${String(err)}`);
    return "typing_failed";
  }
}

/** Wait for visible signs the post actually landed in the group feed. */
async function waitForPublishConfirmation(page: Page, message: string): Promise<boolean> {
  const needle = message.trim().slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const seen = await page.evaluate(
      `(needle) => {
        let re;
        try { re = new RegExp(needle, "i"); } catch { return false; }
        const feed = document.querySelector('div[role="feed"]');
        if (feed && re.test(feed.innerText || "")) return true;
        const bodyText = document.body ? document.body.innerText : "";
        if (/تم نشر (المنشور|منشورك)|Your post (is now|has been) (live|published|shared)|Post shared/i.test(bodyText)) return true;
        const composerGone = !document.querySelector('div[contenteditable="true"][role="textbox"]');
        if (composerGone && re.test(bodyText)) return true;
        return false;
      }`,
      needle,
    ).catch(() => false);
    if (seen) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function saveCheckpoint(jobId: string, idx: number, published: number, failed: number, skipped: number, results: any[], currentBatch?: number) {
  const prog: any = { current_idx: idx, published, failed, skipped };
  if (currentBatch) prog.current_batch = currentBatch;
  // A transient DB/network failure must not kill the worker mid-job
  // (an unhandled throw here leaves the job stuck in "running" forever).
  try {
    await sb.from("publish_jobs").update({ progress: prog, results, updated_at: new Date().toISOString() }).eq("id", jobId);
  } catch (err) {
    log.warn("PublishWorker", `checkpoint write failed (will retry next checkpoint): ${String(err).slice(0, 120)}`);
  }
}

async function updateProgress(jobId: string, published: number, failed: number, skipped: number, results: any[]) {
  const prog: any = { published, failed, skipped };
  try {
    // FULL results, never sliced: postedGroupIds() on resume/crash-recovery
    // must see every already-posted group or they get posted twice. The
    // frontend log only renders the last 20 anyway.
    await sb.from("publish_jobs").update({ progress: prog, results, updated_at: new Date().toISOString() }).eq("id", jobId);
  } catch (err) {
    log.warn("PublishWorker", `progress write failed (will retry next group): ${String(err).slice(0, 120)}`);
  }
}
