import { supabaseService, supabaseClient } from "./supabase.js";
import { contextManager } from "./context-manager.js";
import { logger } from "../logger.js";
import { postedGroupIds, computeFinalStatus, type PublishResultRow } from "./publish-logic.js";
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

        const postResult = await attemptPost(page, cfg.message as string, skipOnMissingComposer, media);
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
            if ((await attemptPost(page, cfg.message as string, false, media)) === "posted") {
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
    // Cached attachments are per-job scratch data — drop them even when the job
    // ended in failure, so a long-lived worker never accumulates junk.
    await cleanupPublishMedia(jobId);
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
