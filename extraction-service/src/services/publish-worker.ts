import { supabaseService, supabaseClient } from "./supabase.js";
import { contextManager } from "./context-manager.js";
import { logger } from "../logger.js";
import { postedGroupIds, computeFinalStatus, summarizeResults, buildGroupPostUrl, type PublishResultRow } from "./publish-logic.js";
import type { Page } from "playwright";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import path from "node:path";

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

/**
 * Boot recovery: publish jobs left "running" by a crash/restart have no worker
 * left — pause them so the user can resume (idempotency skips posted groups).
 * Never mark failed: partial progress + results stay intact.
 */
export async function resumePublishJobs(): Promise<void> {
  try {
    const { data, error } = await sb.from("publish_jobs").update({ status: "paused", updated_at: new Date().toISOString() }).eq("status", "running").select("id");
    if (error) { log.error("PublishWorker", `resumePublishJobs failed: ${error.message}`); return; }
    for (const row of data ?? []) log.info("PublishWorker", `orphaned publish job ${row.id} paused for resume`);
  } catch (err) {
    log.error("PublishWorker", `resumePublishJobs failed: ${String(err)}`);
  }
}

export function stopPublishWorker(jobId: string) {
  runningJobs.delete(jobId);
  localJobs.delete(jobId);
}

/** Facebook's own ceilings for a composer attachment. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"]);

/** Media directory for one job, under the OS temp dir so it never pollutes the repo. */
function jobMediaDir(jobId: string): string {
  return path.join(tmpdir(), "flowtix-publish", jobId);
}

/**
 * Download every media URL for a job to local disk.
 *
 * Playwright's setInputFiles needs a real filesystem path, so the bytes have to
 * live somewhere the worker can reach. Downloads are validated (kind, size)
 * before any group is attempted; a bad file fails the whole job rather than
 * silently publishing text-only posts.
 */
async function downloadPublishMedia(
  jobId: string,
  urls: string[],
): Promise<{ ok: true; files: PublishMedia[] } | { ok: false; reason: string }> {
  const dir = jobMediaDir(jobId);
  await mkdir(dir, { recursive: true });
  const files: PublishMedia[] = [];
  let totalBytes = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: `رابط غير صالح: ${url.slice(0, 60)}` };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, reason: "الروابط يجب أن تبدأ بـ http أو https" };
    }

    let ext = path.extname(parsed.pathname).toLowerCase();
    // Signed storage URLs often carry no extension — fall back to the path tail.
    if (!ext || (!IMAGE_EXT.has(ext) && !VIDEO_EXT.has(ext))) {
      const guess = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".mov", ".webm"].find((e) =>
        parsed.pathname.toLowerCase().includes(e),
      );
      ext = guess ?? ".jpg";
    }
    const kind: "image" | "video" = VIDEO_EXT.has(ext) ? "video" : "image";
    const dest = path.join(dir, `m${i}${ext}`);

    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120000) });
      if (!res.ok || !res.body) {
        return { ok: false, reason: `تعذّر تحميل الملف (HTTP ${res.status})` };
      }
      const declared = Number(res.headers.get("content-length") ?? 0);
      const limit = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (declared > limit) {
        return {
          ok: false,
          reason: kind === "video" ? "حجم الفيديو أكبر من 200 ميجابايت" : "حجم الصورة أكبر من 10 ميجابايت",
        };
      }

      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
      const size = (await stat(dest)).size;
      if (size === 0) return { ok: false, reason: "الملف المحمَّل فارغ" };
      if (size > limit) {
        await rm(dest, { force: true });
        return {
          ok: false,
          reason: kind === "video" ? "حجم الفيديو أكبر من 200 ميجابايت" : "حجم الصورة أكبر من 10 ميجابايت",
        };
      }
      totalBytes += size;
      files.push({ path: dest, kind });
    } catch (err) {
      return { ok: false, reason: `فشل تحميل المرفق: ${String(err).slice(0, 120)}` };
    }
  }

  // Facebook rejects posts with more than 10 attachments.
  if (files.length > 10) {
    return { ok: false, reason: "الحد الأقصى 10 مرفقات في المنشور الواحد" };
  }
  if (new Set(files.map((f) => f.kind)).size > 1) {
    return { ok: false, reason: "لا يمكن خلط صور وفيديو في نفس المنشور — اختر نوعاً واحداً" };
  }
  log.info("PublishWorker", `media cached for ${jobId}: ${files.length} file(s), ${(totalBytes / 1024 / 1024).toFixed(1)}MB`);
  return { ok: true, files };
}

/** Remove a job's cached media once it reaches a terminal state. */
async function cleanupPublishMedia(jobId: string): Promise<void> {
  await rm(jobMediaDir(jobId), { recursive: true, force: true }).catch(() => {});
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

  // Media is downloaded ONCE per job and reused for every group. A failed
  // download aborts before any group is touched — posting text-only when the
  // user asked for an image would be a silent downgrade.
  let media: PublishMedia[] = [];
  const mediaUrls: string[] = Array.isArray(cfg.media_urls) ? cfg.media_urls : [];
  if (mediaUrls.length > 0) {
    const dl = await downloadPublishMedia(jobId, mediaUrls);
    if (!dl.ok) {
      log.error("PublishWorker", `job ${jobId}: media download failed — ${dl.reason}`);
      await sb.from("publish_jobs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        progress: { ...(job.progress || {}), failed: 0, skipped: 0, published: 0 },
        results: [{ group_id: null, status: "fail", reason: `media_download_failed: ${dl.reason}`, at: new Date().toISOString() }],
      }).eq("id", jobId);
      runningJobs.delete(jobId);
      localJobs.delete(jobId);
      return;
    }
    media = dl.files;
    log.info("PublishWorker", `job ${jobId}: ${media.length} media file(s) ready`);
  }

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
    // Navigation failures (proxy/tunnel dead, FB unreachable) are an infra
    // problem, not a group problem — two in a row means every remaining group
    // will burn 25s+delay for nothing. Track them separately.
    let consecutiveNavErrors = 0;
    // Last progress object written by updateProgress — the final status update
    // must keep the LIVE counters + abort_reason, not the stale load-time row.
    let liveProgress: Record<string, any> | null = null;
    // Set when the loop breaks early for a broken pipe (network/proxy) — the
    // job is paused + resumable, NOT completed.
    let forcedPause = false;

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
      // Idempotency: never post twice into the same group within one job —
      // "review" (pending admin approval) also counts: the post was submitted.
      if (alreadyPosted.has(gid)) continue;

      try {
        const delay = randInt(cfg.delay_min || 60, cfg.delay_max || 180);
        log.info("PublishWorker", `[${i + 1}/${groups.length}] group ${gid}, delay ${delay}s`);
        // Live marker: the UI shows "جاري النشر على …" from the moment the
        // group is ATTEMPTED, not only after it finishes.
        await updateProgress(jobId, i, published, failed, skipped, results, gid);
        await sleep(delay * 1000);
        if (!runningJobs.has(jobId)) {
          await saveCheckpoint(jobId, i, published, failed, skipped, results, currentBatchOf(i, BATCH_SIZE));
          log.info("PublishWorker", `job ${jobId}: interrupted during delay at index ${i}`);
          break;
        }

        // goto with ONE retry: through a tunnel the first attempt can lose the
        // race with a just-reconnected tunnel. A clean error string beats a
        // raw Playwright dump in the results.
        let navError: string | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await page.goto(`https://www.facebook.com/groups/${gid}`, { waitUntil: "domcontentloaded", timeout: 25000 });
            navError = null;
            break;
          } catch (err) {
            navError = String(err);
            if (attempt === 0) await sleep(4000);
          }
        }
        if (navError) {
          consecutiveNavErrors++;
          failed++;
          consecutiveErrors++;
          results.push({ group_id: gid, status: "fail", reason: `navigation_error: ${summarizeNavError(navError, gid)}`, at: new Date().toISOString(), batch: currentBatchOf(i, BATCH_SIZE) });
          await updateProgress(jobId, i + 1, published, failed, skipped, results);
          // Two nav failures in a row = the pipe is dead (proxy/tunnel down).
          // Continuing would burn delay+25s per remaining group for nothing —
          // pause the job with a clear reason so it is resumable.
          if (consecutiveNavErrors >= 2) {
            forcedPause = true;
            log.warn("PublishWorker", `job ${jobId}: ${consecutiveNavErrors} consecutive navigation errors — network/proxy dead, pausing job as resumable`);
            await saveAbort(jobId, i + 1, published, failed, skipped, results, "network_down");
            break;
          }
          continue;
        }
        consecutiveNavErrors = 0;
        await page.waitForTimeout(3000);
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1500);

        const postResult = await attemptPost(page, cfg.message as string, skipOnMissingComposer, media);
        if (typeof postResult === "object" && postResult.kind === "posted") {
          published++; consecutiveErrors = 0;
          alreadyPosted.add(gid);
          results.push({
            group_id: gid, status: "posted",
            ...(postResult.postUrl ? { post_url: postResult.postUrl } : {}),
            at: new Date().toISOString(), batch: currentBatchOf(i, BATCH_SIZE),
          });
        } else if (typeof postResult === "object" && postResult.kind === "review") {
          // Submitted, but Facebook held it for group-admin approval. Not a
          // failure and NOT retried — retrying would duplicate the post once
          // the first submission is approved.
          skipped++; consecutiveErrors = 0;
          alreadyPosted.add(gid);
          results.push({
            group_id: gid, status: "review", reason: postResult.reason,
            ...(postResult.postUrl ? { post_url: postResult.postUrl } : {}),
            at: new Date().toISOString(), batch: currentBatchOf(i, BATCH_SIZE),
          });
        } else if (postResult === "composer_not_found") {
          skipped++; consecutiveErrors = 0;
          results.push({ group_id: gid, status: "skip", reason: "composer_not_found", at: new Date().toISOString(), batch: currentBatchOf(i, BATCH_SIZE) });
        } else {
          let retried = false;
          for (let r = 0; r < (cfg.max_retries || 1); r++) {
            await sleep(5000);
            const retry = await attemptPost(page, cfg.message as string, false, media);
            if (typeof retry === "object" && retry.kind === "posted") {
              published++; consecutiveErrors = 0;
              alreadyPosted.add(gid);
              results.push({
                group_id: gid, status: "posted",
                ...(retry.postUrl ? { post_url: retry.postUrl } : {}),
                at: new Date().toISOString(), retries: r + 1, batch: currentBatchOf(i, BATCH_SIZE),
              });
              retried = true; break;
            }
            if (typeof retry === "object" && retry.kind === "review") {
              skipped++; consecutiveErrors = 0;
              alreadyPosted.add(gid);
              results.push({
                group_id: gid, status: "review", reason: retry.reason,
                ...(retry.postUrl ? { post_url: retry.postUrl } : {}),
                at: new Date().toISOString(), retries: r + 1, batch: currentBatchOf(i, BATCH_SIZE),
              });
              retried = true; break;
            }
          }
          if (!retried) { failed++; consecutiveErrors++; results.push({ group_id: gid, status: "fail", reason: postResult, at: new Date().toISOString(), batch: currentBatchOf(i, BATCH_SIZE) }); }
        }
      } catch (err) {
        failed++; consecutiveErrors++;
        results.push({ group_id: gid, status: "fail", reason: String(err), at: new Date().toISOString(), batch: currentBatchOf(i, BATCH_SIZE) });
      }

      await updateProgress(jobId, i + 1, published, failed, skipped, results);
      // Keep the newest progress object for the final status write (it must
      // not regress the live counters back to the load-time snapshot).
      liveProgress = { current_idx: i + 1, published, failed, skipped };
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
    if (!runningJobs.has(jobId)) paused = true; else if (forcedPause) paused = true; else paused = false;

    // Single exit: "completed" only when the loop reached the end of the list
    // (failed/skipped groups count as processed). Any interruption → "paused",
    // resumable; resume() skips already-posted groups (idempotency).
    const finalStatus = computeFinalStatus(paused);
    // Clear the live "current group" marker — nothing is being posted anymore.
    await sb.from("publish_jobs").update({
      status: finalStatus,
      ...(finalStatus === "completed" ? { completed_at: new Date().toISOString() } : {}),
      progress: { ...(liveProgress ?? job.progress ?? {}), current_group: null },
      updated_at: new Date().toISOString(),
    }).eq("id", jobId).neq("status", "canceled");
    const summary = summarizeResults(results);
    log.info("PublishWorker", `job ${jobId} -> ${finalStatus}: ${summary.posted} posted, ${summary.review} review, ${summary.failed} fail, ${summary.skipped} skip`);
  } finally {
    await contextManager.releaseContext(contextId);
    // Cached attachments are per-job scratch data — drop them even when the job
    // ended in failure, so a long-lived worker never accumulates junk.
    await cleanupPublishMedia(jobId);
  }
}

function currentBatchOf(idx: number, batchSize: number): number {
  return Math.floor(idx / batchSize) + 1;
}

/** Human-readable cause for a page.goto failure — the raw Playwright dump
 *  (25 lines of call log) is useless in a per-group result row. */
function summarizeNavError(raw: string, gid: string): string {
  const first = raw.split("\n")[0] || "unknown";
  if (/Timeout.*exceeded/i.test(first)) return `تعذر فتح صفحة الجروب (${gid}) خلال 25 ثانية — الشبكة/البروكسي لا يستجيب`;
  if (/net::ERR_(PROXY|TUNNEL|SOCKS)/i.test(raw)) return "فشل الاتصال بالبروكسي — تحقق من البروكسي أو نفق الخروج";
  if (/net::ERR_NAME_NOT_RESOLVED/i.test(raw)) return "فشل تحليل اسم النطاق facebook.com — مشكلة شبكة";
  if (/net::ERR_CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT)/i.test(raw)) return "تم رفض/انقطع الاتصال بفيسبوك — مشكلة شبكة";
  if (/Target closed|Browser has been closed/i.test(raw)) return "أُغلق المتصفح أثناء التحميل";
  return first.slice(0, 120);
}

/** Persist an aborted-by-infra state: the job is PAUSED and resumable, with
 *  an abort_reason the UI can render. Must never leave the job "running". */
async function saveAbort(jobId: string, idx: number, published: number, failed: number, skipped: number, results: any[], abortReason: string) {
  const prog: any = { current_idx: idx, published, failed, skipped, abort_reason: abortReason };
  try {
    await sb.from("publish_jobs").update({ progress: prog, results, updated_at: new Date().toISOString() }).eq("id", jobId);
  } catch (err) {
    log.warn("PublishWorker", `abort checkpoint write failed: ${String(err).slice(0, 120)}`);
  }
}

/** Which group the worker is on right now — "current_group" in progress jsonb
 *  keeps the UI showing a live "جاري النشر على: …" line between checkpoints. */
function currentGroupOf(groups: string[], idx: number): string | null {
  return groups[idx] ?? null;
}

/**
 * Try to publish `message` into the group page currently open on `page`.
 * Returns the concrete failure reason on non-success so results stay debuggable.
 * A submitted-but-pending-approval post returns { kind: "review" } with the
 * permalink extracted from the success dialog/feed when available.
 */
export type PostAttempt =
  | { kind: "posted"; postUrl?: string }
  | { kind: "review"; reason: string; postUrl?: string }
  | "composer_not_found"
  | "submit_disabled"
  | "typing_failed"
  | "media_failed"
  | "no_confirmation";

const COMPOSER_SEL = 'div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-lexical-editor], textarea[name="message"]';
const SUBMIT_SEL = 'div[role="button"][aria-label*="نشر"], div[role="button"][aria-label*="Post"]';

/** Photo/video trigger inside the group composer dialog. */
const MEDIA_TRIGGER_SEL =
  'div[role="button"][aria-label*="صورة"], div[role="button"][aria-label*="فيديو"], div[role="button"][aria-label*="Photo"], div[role="button"][aria-label*="Video"], div[role="button"][aria-label*="Media"]';

export interface PublishMedia {
  /** Absolute path on disk (already downloaded/cached by the caller). */
  path: string;
  /** image | video — decides which composer tab we expect. */
  kind: "image" | "video";
}

export async function attemptPost(
  page: Page,
  message: string,
  _skipOnMissingComposer: boolean,
  media: PublishMedia[] = [],
): Promise<PostAttempt> {
  // Modern group pages render a trigger button ("اكتب شيئًا..." / "Write
  // something...") that opens the real composer dialog — open it first.
  await openComposerTrigger(page);
  // Composer is lazy-mounted after the trigger click — poll for it.
  for (let w = 0; w < 4; w++) {
    if (w > 0) await page.waitForTimeout(2000);
    if (await hasComposer(page)) return await typeAndSubmit(page, message, media);
  }
  log.info("PublishWorker", `composer not found after polling`);
  return "composer_not_found";
}

/**
 * Attach files to the open composer by handing them to Facebook's own hidden
 * file input.
 *
 * Playwright's setInputFiles writes into the page's file chooser the same way a
 * real OS dialog would, so Facebook sees a normal upload — no synthetic File
 * objects, no bypassed validation. We never click the visible "Photo/Video"
 * button (it pops a native OS dialog Playwright cannot drive); we target the
 * `input[type=file]` Facebook mounts alongside it.
 *
 * Media is uploaded BEFORE the text is typed: Facebook re-renders the composer
 * once the upload starts, and text typed during that re-render gets dropped.
 */
async function attachMedia(page: Page, media: PublishMedia[]): Promise<{ ok: boolean; attached: number }> {
  if (media.length === 0) return { ok: true, attached: 0 };

  // Facebook keeps several file inputs mounted (photo, video, cover…). Pick the
  // one that accepts the kinds we are actually sending.
  const wantVideo = media.some((m) => m.kind === "video");
  const wantImage = media.some((m) => m.kind === "image");
  const acceptHint = wantVideo && !wantImage ? "video" : wantImage && !wantVideo ? "image" : "";

  const input = page.locator('input[type="file"]').filter({ hasNot: page.locator("[disabled]") });
  const count = await input.count();
  if (count === 0) {
    log.warn("PublishWorker", "no file input found in composer — media not attached");
    return { ok: false, attached: 0 };
  }

  let chosen = input.first();
  if (acceptHint) {
    for (let i = 0; i < count; i++) {
      const accept = ((await input.nth(i).getAttribute("accept")) ?? "").toLowerCase();
      if (accept.includes(acceptHint)) { chosen = input.nth(i); break; }
    }
  }

  try {
    await chosen.setInputFiles(media.map((m) => m.path), { timeout: 30000 });
  } catch (err) {
    log.warn("PublishWorker", `setInputFiles failed: ${String(err)}`);
    return { ok: false, attached: 0 };
  }

  // Facebook shows an upload preview/throbber while the file is processed.
  // Submitting before it finishes posts the text WITHOUT the media, so wait
  // for the upload to settle before continuing.
  const settled = await page
    .waitForFunction(
      `() => {
        const busy = document.querySelector('div[role="progressbar"], [aria-label*="جارٍ التحميل"], [aria-label*="Uploading"]');
        if (busy) return false;
        // A preview thumbnail (blob: or scontent) means the upload landed.
        return !!document.querySelector('img[src^="blob:"], img[src*="scontent"], video[src^="blob:"], video[src*="scontent"]');
      }`,
      undefined,
      { timeout: 90000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!settled) {
    log.warn("PublishWorker", "media upload did not settle within 90s");
    return { ok: false, attached: 0 };
  }

  await page.waitForTimeout(randInt(1200, 2600));
  log.info("PublishWorker", `${media.length} media file(s) attached and previewed`);
  return { ok: true, attached: media.length };
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

async function typeAndSubmit(page: Page, message: string, media: PublishMedia[] = []): Promise<PostAttempt> {
  try {
    // Attach media FIRST. Facebook re-renders the composer while the upload is
    // in flight, and any text typed during that re-render is silently dropped —
    // so the upload must be settled before a single keystroke goes in.
    if (media.length > 0) {
      const upload = await attachMedia(page, media);
      if (!upload.ok) return "media_failed";
    }

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
    // typeAndSubmit is typed keystroke-by-keystroke; for ARABIC text
    // keyboard.type() has been observed to deliver the events but leave the
    // Lexical editor state EMPTY (submit stays disabled) on some group
    // composers — insertText delivers the exact text through the IME path.
    try {
      await page.evaluate(
        `(text) => {
          const el = document.querySelector(${JSON.stringify(COMPOSER_SEL)});
          if (!el) return false;
          document.execCommand("insertText", false, text);
          return true;
        }`,
        message,
      );
    } catch {
      // execCommand unsupported (very old headless builds) — keystrokes below.
    }
    // Verify the text ACTUALLY landed in the editor state; keystroke-typing as
    // fallback only when it did not. No fake success either way.
    const textLanded = await editorHasText(page, message);
    if (!textLanded) {
      await page.keyboard.type(message, { delay: randInt(20, 45) });
    }
    if (!(await editorHasText(page, message))) {
      log.warn("PublishWorker", "text did not register in composer — typing_failed");
      return "typing_failed";
    }

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
    if (confirmed === false) return "no_confirmation";
    const postUrl = await extractPermalinkFromPage(page, message);
    if (confirmed === "pending_approval") {
      log.info("PublishWorker", `post held for admin approval${postUrl ? ` — ${postUrl}` : ""}`);
      return { kind: "review", reason: "pending_admin_approval", ...(postUrl ? { postUrl } : {}) };
    }
    log.info("PublishWorker", `post verified in group feed${postUrl ? ` — ${postUrl}` : ""}`);
    return { kind: "posted", ...(postUrl ? { postUrl } : {}) };
  } catch (err) {
    log.warn("PublishWorker", `attemptPost error: ${String(err)}`);
    return "typing_failed";
  }
}

/** Does the composer's editable region actually contain the message text?
 *  Checks textContent (Lexical renders text nodes into the DOM) — the only
 *  trustworthy signal that the editor state holds the post. */
async function editorHasText(page: Page, message: string): Promise<boolean> {
  const needle = message.trim().slice(0, 30);
  if (!needle) return false;
  return Boolean(await page.evaluate(
    `(needle) => {
      const els = document.querySelectorAll(${JSON.stringify(COMPOSER_SEL)});
      for (const el of els) {
        const t = (el.textContent || "");
        if (t.includes(needle)) return true;
      }
      return false;
    }`,
    needle,
  ).catch(() => false));
}

/** Wait for visible signs the post actually landed in the group feed.
 *  "pending_approval" = Facebook accepted the submission but held it for a
 *  group-admin review — a real outcome, not a failure, and never retried. */
async function waitForPublishConfirmation(page: Page, message: string): Promise<boolean | "pending_approval"> {
  const needle = message.trim().slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const seen = (await page.evaluate(
      `(needle) => {
        let re;
        try { re = new RegExp(needle, "i"); } catch { return false; }
        const bodyText = document.body ? document.body.innerText : "";
        // Admin-approval confirmations: the post is accepted but NOT in the feed yet.
        if (/في انتظار الموافقة|في انتظار موافقة|بانتظار الموافقة|بانتظار مراجعة|قيد المراجعة|سيتم نشره بعد مراجعة|pending (admin )?(approval|review)|awaiting (admin )?approval|will be (visible|reviewed) once/i.test(bodyText)) return "pending_approval";
        const feed = document.querySelector('div[role="feed"]');
        if (feed && re.test(feed.innerText || "")) return true;
        if (/تم نشر (المنشور|منشورك)|Your post (is now|has been) (live|published|shared)|Post shared/i.test(bodyText)) return true;
        const composerGone = !document.querySelector('div[contenteditable="true"][role="textbox"]');
        if (composerGone && re.test(bodyText)) return true;
        return false;
      }`,
      needle,
    ).catch(() => false)) as boolean | "pending_approval";
    if (seen) return seen;
    await page.waitForTimeout(1000);
  }
  return false;
}

/** Best-effort permalink for the post just submitted (from feed anchors or success dialog).
 *  Only anchors INSIDE the fresh dialog or matching OUR message context count —
 *  the group feed contains everyone else's /posts/ links too. */
async function extractPermalinkFromPage(page: Page, message: string): Promise<string | undefined> {
  try {
    const needle = message.trim().slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const url = await page.evaluate(
      `((needleSrc) => {
        let re;
        try { re = new RegExp(needleSrc, "i"); } catch { re = null; }
        // 1) Success dialog (still open) — its /posts/ or /permalink/ link is ours.
        const dialog = document.querySelector('div[role="dialog"]');
        if (dialog) {
          for (const a of dialog.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]')) {
            const href = a.getAttribute("href") || "";
            if (href) return href.startsWith("http") ? href : "https://www.facebook.com" + href;
          }
        }
        // 2) Feed: the article containing our text is OUR post — take its link.
        if (re) {
          for (const art of document.querySelectorAll('div[role="feed"] > div, div[role="article"]')) {
            const t = art.textContent || "";
            if (re.test(t)) {
              for (const a of art.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]')) {
                const href = a.getAttribute("href") || "";
                if (href && /\\/posts\\/|\\/permalink\\//.test(href)) {
                  return href.startsWith("http") ? href : "https://www.facebook.com" + href;
                }
              }
            }
          }
        }
        return null;
      })()`,
      needle,
    );
    return typeof url === "string" && (url.includes("/posts/") || url.includes("/permalink/")) ? url : undefined;
  } catch {
    return undefined;
  }
}

async function saveCheckpoint(jobId: string, idx: number, published: number, failed: number, skipped: number, results: any[], currentBatch?: number, currentGroup?: string | null) {
  const prog: any = { current_idx: idx, published, failed, skipped };
  if (currentBatch) prog.current_batch = currentBatch;
  if (currentGroup) prog.current_group = currentGroup;
  // A transient DB/network failure must not kill the worker mid-job
  // (an unhandled throw here leaves the job stuck in "running" forever).
  try {
    await sb.from("publish_jobs").update({ progress: prog, results, updated_at: new Date().toISOString() }).eq("id", jobId);
  } catch (err) {
    log.warn("PublishWorker", `checkpoint write failed (will retry next checkpoint): ${String(err).slice(0, 120)}`);
  }
}

async function updateProgress(jobId: string, currentIdx: number, published: number, failed: number, skipped: number, results: any[], currentGroup?: string) {
  const prog: any = { published, failed, skipped, current_idx: currentIdx };
  if (currentGroup !== undefined) prog.current_group = currentGroup;
  try {
    // FULL results, never sliced: postedGroupIds() on resume/crash-recovery
    // must see every already-posted group or they get posted twice. The
    // frontend log only renders the last 20 anyway.
    await sb.from("publish_jobs").update({ progress: prog, results, updated_at: new Date().toISOString() }).eq("id", jobId);
  } catch (err) {
    log.warn("PublishWorker", `progress write failed (will retry next group): ${String(err).slice(0, 120)}`);
  }
}
