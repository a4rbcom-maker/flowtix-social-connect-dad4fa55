import { supabaseService, supabaseClient } from "./supabase.js";
import { contextManager } from "./context-manager.js";
import { logger } from "../logger.js";
import type { Page } from "playwright";

const log = logger;
const workers = new Map<string, boolean>();
const sb = supabaseClient;

export function startPublishWorker(jobId: string, sessionId: string) {
  if (workers.has(jobId)) return;
  workers.set(jobId, true);
  runPublishWorker(jobId, sessionId).catch(err => {
    log.error("PublishWorker", `worker error for ${jobId}: ${String(err)}`);
  }).finally(() => workers.delete(jobId));
}

export function stopPublishWorker(jobId: string) {
  workers.set(jobId, false);
  workers.delete(jobId);
}

async function runPublishWorker(jobId: string, sessionId: string) {
  const { data: rows } = await sb.from("publish_jobs").select("*").eq("id", jobId);
  if (!rows?.length) { log.error("PublishWorker", `job ${jobId} not found`); return; }
  const job = rows[0];
  const cfg = job.config;
  const groups: string[] = cfg.group_ids || [];
  const startIdx = job.progress?.current_idx || 0;
  const BATCH_SIZE = cfg.batch_size || 5;
  const BATCH_PAUSE = cfg.batch_pause || 600;

  log.info("PublishWorker", `starting ${jobId}: ${groups.length} groups, batch=${BATCH_SIZE}, pause=${BATCH_PAUSE}s, from idx ${startIdx}`);

  const { cookies, proxy, userAgent } = await supabaseService.getSessionAndCookies(sessionId);
  const { page, contextId } = await contextManager.createContext(sessionId, cookies, proxy, userAgent);

  try {
    await sb.from("publish_jobs").update({ status: "running", started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", jobId);

    let published = job.progress?.published || 0;
    let failed = job.progress?.failed || 0;
    let skipped = job.progress?.skipped || 0;
    let currentBatch = Math.floor(startIdx / BATCH_SIZE) + 1;
    const results: any[] = job.results || [];
    let consecutiveErrors = 0;

    for (let i = startIdx; i < groups.length; i++) {
      if (!workers.get(jobId)) { await saveCheckpoint(jobId, i, published, failed, skipped, results, currentBatch); break; }

      const gid = groups[i];
      const groupUrl = `https://www.facebook.com/groups/${gid}`;

      try {
        const delay = (cfg.delay_min || 60) + Math.floor(Math.random() * ((cfg.delay_max || 180) - (cfg.delay_min || 60)));
        log.info("PublishWorker", `[batch ${currentBatch}] [${i+1}/${groups.length}] group ${gid}, delay ${delay}s`);
        await sleep(delay * 1000);

        await page.goto(groupUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(3000);
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1500);

        const postResult = await attemptPost(page, cfg.message as string, cfg.skip_restricted as boolean);
        if (postResult === "posted") {
          published++; consecutiveErrors = 0;
          results.push({ group_id: gid, status: "ok", at: new Date().toISOString(), batch: currentBatch });
        } else if (postResult === "restricted") {
          skipped++; consecutiveErrors = 0;
          results.push({ group_id: gid, status: "skip", at: new Date().toISOString(), reason: "restricted", batch: currentBatch });
        } else {
          let retried = false;
          for (let r = 0; r < (cfg.max_retries || 1); r++) {
            await sleep(5000);
            if ((await attemptPost(page, cfg.message as string, false)) === "posted") {
              published++; consecutiveErrors = 0;
              results.push({ group_id: gid, status: "ok", at: new Date().toISOString(), retries: r + 1, batch: currentBatch });
              retried = true; break;
            }
          }
          if (!retried) { failed++; consecutiveErrors++; results.push({ group_id: gid, status: "fail", at: new Date().toISOString(), batch: currentBatch }); }
        }
      } catch (err) {
        failed++; consecutiveErrors++;
        results.push({ group_id: gid, status: "fail", at: new Date().toISOString(), reason: String(err), batch: currentBatch });
      }

      await updateProgress(jobId, published, failed, skipped, results, currentBatch);
      if (consecutiveErrors >= (cfg.max_errors || 10)) { await saveCheckpoint(jobId, i + 1, published, failed, skipped, results, currentBatch); break; }

      if ((i + 1) % BATCH_SIZE === 0 && i < groups.length - 1) {
        currentBatch++;
        const batchNum = Math.floor((i + 1) / BATCH_SIZE);
        log.info("PublishWorker", `batch ${batchNum} done (${BATCH_SIZE} groups), pausing ${BATCH_PAUSE}s...`);
        await saveCheckpoint(jobId, i + 1, published, failed, skipped, results, currentBatch);
        if (!workers.get(jobId)) break;
        await sleep(BATCH_PAUSE * 1000);
        log.info("PublishWorker", `resuming batch ${currentBatch}...`);
      }

      if (i % 5 === 0) await saveCheckpoint(jobId, i + 1, published, failed, skipped, results, currentBatch);
    }

    if (published + failed + skipped >= groups.length) {
      await sb.from("publish_jobs").update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", jobId);
      log.info("PublishWorker", `job ${jobId} done: ${published} ok, ${failed} fail, ${skipped} skip`);
    }
  } finally {
    await contextManager.releaseContext(contextId);
  }
}

async function attemptPost(page: Page, message: string, skipRestricted: boolean): Promise<"posted" | "restricted" | "failed"> {
  try {
    const result = await page.evaluate((msg) => {
      const box = document.querySelector<HTMLElement>('[role="textbox"], [contenteditable="true"], textarea');
      if (!box) {
        const createBtn = document.querySelector<HTMLElement>('[aria-label*="منشور" i], [aria-label*="post" i], [aria-label*="write" i], [aria-label*="create" i]');
        if (createBtn) { createBtn.click(); return "clicked"; }
        return "no_box";
      }
      const el = box as HTMLElement;
      if (el.getAttribute("contenteditable") === "true" || el.tagName === "DIV") {
        el.focus(); el.innerText = msg;
      } else if (el.tagName === "TEXTAREA") {
        (el as HTMLTextAreaElement).value = msg;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return "typed";
    }, message);

    if (result === "no_box") return skipRestricted ? "restricted" : "failed";
    if (result === "clicked") { await page.waitForTimeout(3000); return "posted"; }

    // Wait for Post button to activate, then click it via Playwright
    await page.waitForTimeout(1500);
    const postClicked = await page.evaluate(() => {
      const all = document.querySelectorAll<HTMLElement>('[role="button"], button, [aria-label]');
      for (const el of all) {
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const text = (el.innerText || '').trim().toLowerCase();
        if (aria.includes('post') || aria.includes('نشر') || aria.includes('submit') || aria.includes('share') ||
            text === 'post' || text === 'نشر' || text === 'share' || text === 'publish') {
          el.click();
          return true;
        }
      }
      return false;
    });
    if (postClicked) {
      await page.waitForTimeout(3000);
      log.info("PublishWorker", `post button clicked`);
    }
    return "posted";
  } catch { return "failed"; }
}

async function saveCheckpoint(jobId: string, idx: number, published: number, failed: number, skipped: number, results: any[], currentBatch?: number) {
  const prog: any = { current_idx: idx, published, failed, skipped };
  if (currentBatch) prog.current_batch = currentBatch;
  await sb.from("publish_jobs").update({ progress: prog, results, updated_at: new Date().toISOString() }).eq("id", jobId);
}

async function updateProgress(jobId: string, published: number, failed: number, skipped: number, results: any[], currentBatch?: number) {
  const prog: any = { published, failed, skipped };
  if (currentBatch) prog.current_batch = currentBatch;
  await sb.from("publish_jobs").update({ progress: prog, results: results.slice(-50), updated_at: new Date().toISOString() }).eq("id", jobId);
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
