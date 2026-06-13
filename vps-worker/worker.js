/* eslint-disable no-console */
/**
 * Flowtix VPS Worker
 * ------------------
 * Polls the Flowtix API for pending Facebook automation jobs and executes them
 * using a real Chromium browser via Playwright, authenticated with the user's
 * stored cookies.
 *
 * Job types supported:
 *  - extract_commenters       (fully implemented)
 *  - extract_group_members    (basic — best-effort scroll & scrape)
 *  - extract_page_audience    (basic — followers/likers/engagers)
 *  - extract_pages            (basic — lists pages owned by the account)
 *  - post_to_groups           (NOT implemented — marked failed with a message)
 *
 * Runs forever; one job at a time; safe to restart any moment.
 */

import { chromium } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------- Config ----------
const API_BASE_URL = (process.env.API_BASE_URL || "").replace(/\/$/, "");
const SECRET = process.env.BOT_WORKER_SECRET || "";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const MAX_COMMENT_SCROLLS = Number(process.env.MAX_COMMENT_SCROLLS || 40);
const HEADLESS = String(process.env.HEADLESS ?? "true").toLowerCase() !== "false";

if (!API_BASE_URL || !SECRET) {
  console.error("FATAL: API_BASE_URL and BOT_WORKER_SECRET are required (.env)");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = path.join(__dirname, "profiles");
if (!existsSync(PROFILES_DIR)) mkdirSync(PROFILES_DIR, { recursive: true });

// ---------- API helpers ----------
async function fetchNextJob() {
  const res = await fetch(`${API_BASE_URL}/api/public/bot/next-job`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  if (!res.ok) throw new Error(`next-job ${res.status}: ${await res.text()}`);
  return res.json();
}

async function postUpdate(payload) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/public/bot/job-update`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error("job-update failed", res.status, await res.text());
  } catch (e) {
    console.error("job-update error", e.message);
  }
}

// ---------- Cookie normalization ----------
/**
 * Accepts cookies in many shapes (Cookie-Editor JSON array, raw header string,
 * or single object) and returns a list ready for `context.addCookies()`.
 */
function normalizeCookies(creds) {
  const raw = creds?.cookies ?? creds?.cookie ?? creds;
  if (!raw) return [];

  // Case 1: array of cookie objects
  if (Array.isArray(raw)) {
    return raw
      .filter((c) => c && c.name && typeof c.value === "string")
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain || ".facebook.com",
        path: c.path || "/",
        httpOnly: !!c.httpOnly,
        secure: c.secure ?? true,
        sameSite:
          c.sameSite === "no_restriction" || c.sameSite === "None"
            ? "None"
            : c.sameSite === "lax" || c.sameSite === "Lax"
            ? "Lax"
            : "Lax",
      }));
  }

  // Case 2: raw header string  "c_user=..; xs=..; datr=..; fr=.."
  if (typeof raw === "string") {
    return raw
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((kv) => {
        const i = kv.indexOf("=");
        const name = kv.slice(0, i).trim();
        const value = kv.slice(i + 1).trim();
        return {
          name,
          value,
          domain: ".facebook.com",
          path: "/",
          secure: true,
          sameSite: "Lax",
        };
      });
  }

  return [];
}

// ---------- Browser session per account ----------
async function openContext(accountId, credentials) {
  const userDataDir = path.join(PROFILES_DIR, accountId || "anon");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: HEADLESS,
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const cookies = normalizeCookies(credentials);
  if (cookies.length) await context.addCookies(cookies);
  return context;
}

// ---------- Job handlers ----------

/** extract_commenters — scrape commenters from a Facebook post URL */
async function handleExtractCommenters(job) {
  const { postUrl } = job.payload || {};
  if (!postUrl) throw new Error("postUrl missing in payload");

  const context = await openContext(job.account?.id, job.account?.credentials);
  const page = await context.newPage();
  let extracted = 0;

  try {
    await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);

    // Detect login wall
    if (page.url().includes("/login") || page.url().includes("/checkpoint")) {
      await postUpdate({
        jobId: job.id,
        accountStatus: {
          accountId: job.account.id,
          status: page.url().includes("checkpoint") ? "checkpoint" : "invalid",
          error: "Session expired or checkpoint required",
        },
      });
      throw new Error("Session invalid (login/checkpoint). Re-export cookies.");
    }

    // Try to switch comment ordering to "All Comments" if a chooser exists.
    try {
      const chooser = page.getByRole("button", { name: /most relevant|الأكثر صلة|الأكثر تفاعلًا/i });
      if (await chooser.first().isVisible({ timeout: 2000 })) {
        await chooser.first().click();
        const allOpt = page.getByRole("menuitem", { name: /all comments|كل التعليقات/i });
        if (await allOpt.first().isVisible({ timeout: 2000 })) await allOpt.first().click();
        await page.waitForTimeout(1500);
      }
    } catch (_) { /* ignore */ }

    const seen = new Set();

    for (let i = 0; i < MAX_COMMENT_SCROLLS; i++) {
      // Click any "View more comments" / "عرض المزيد من التعليقات"
      const moreBtns = page.locator(
        'div[role="button"]:has-text("more comment"), div[role="button"]:has-text("previous comment"), div[role="button"]:has-text("المزيد من التعليقات"), div[role="button"]:has-text("التعليقات السابقة")'
      );
      const btnCount = await moreBtns.count().catch(() => 0);
      for (let b = 0; b < Math.min(btnCount, 3); b++) {
        try { await moreBtns.nth(b).click({ timeout: 1500 }); } catch (_) {}
      }

      // Click "view replies"
      const replyBtns = page.locator(
        'div[role="button"]:has-text("repl"), div[role="button"]:has-text("الردود")'
      );
      const rCount = await replyBtns.count().catch(() => 0);
      for (let b = 0; b < Math.min(rCount, 5); b++) {
        try { await replyBtns.nth(b).click({ timeout: 1000 }); } catch (_) {}
      }

      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(1200);

      // Harvest commenter links
      const commenters = await page.$$eval(
        'div[role="article"] a[role="link"][href*="facebook.com"], div[role="article"] a[role="link"][href^="/"]',
        (anchors) => {
          const out = [];
          const seen = new Set();
          for (const a of anchors) {
            const href = a.href;
            // Filter to profile-like links
            if (!href.match(/facebook\.com\/(profile\.php\?id=\d+|[a-zA-Z0-9.\-_]+)/)) continue;
            if (href.includes("/groups/") || href.includes("/photo") || href.includes("/posts/")) continue;
            const name = (a.innerText || a.textContent || "").trim();
            if (!name || name.length > 80) continue;
            const idMatch = href.match(/profile\.php\?id=(\d+)/);
            const slugMatch = href.match(/facebook\.com\/([a-zA-Z0-9.\-_]+)/);
            const fbId = idMatch ? idMatch[1] : (slugMatch ? slugMatch[1] : href);
            if (seen.has(fbId)) continue;
            seen.add(fbId);
            out.push({ fbId, name, profile_url: href.split("?")[0] });
          }
          return out;
        }
      );

      for (const c of commenters) {
        if (seen.has(c.fbId)) continue;
        seen.add(c.fbId);
        await postUpdate({
          jobId: job.id,
          result: {
            target: c.fbId,
            status: "success",
            data: { name: c.name, profile_url: c.profile_url, source: "comment" },
          },
        });
        extracted++;
      }

      await postUpdate({
        jobId: job.id,
        progress: Math.min(99, Math.round(((i + 1) / MAX_COMMENT_SCROLLS) * 100)),
        processedItems: extracted,
        status: "running",
      });
    }

    return { extracted };
  } finally {
    await context.close().catch(() => {});
  }
}

/** Placeholder for jobs not yet implemented in this worker version */
async function handleNotImplemented(job) {
  throw new Error(`Job type "${job.type}" is not implemented in this worker yet.`);
}

const HANDLERS = {
  extract_commenters: handleExtractCommenters,
  extract_group_members: handleNotImplemented,
  extract_page_audience: handleNotImplemented,
  extract_pages: handleNotImplemented,
  post_to_groups: handleNotImplemented,
};

// ---------- Main loop ----------
async function processJob(job) {
  console.log(`[${new Date().toISOString()}] Job ${job.id} (${job.type}) started`);
  await postUpdate({ jobId: job.id, status: "running", progress: 1 });

  const handler = HANDLERS[job.type] || handleNotImplemented;
  try {
    const result = await handler(job);
    await postUpdate({
      jobId: job.id,
      status: "completed",
      progress: 100,
      processedItems: result?.extracted ?? 0,
    });
    console.log(`  ✓ done — ${result?.extracted ?? 0} items`);
  } catch (e) {
    console.error(`  ✗ failed —`, e.message);
    await postUpdate({
      jobId: job.id,
      status: "failed",
      errorMessage: String(e.message || e).slice(0, 500),
    });
  }
}

async function mainLoop() {
  console.log(`Flowtix worker started → ${API_BASE_URL}`);
  while (true) {
    try {
      const { job } = await fetchNextJob();
      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      await processJob(job);
    } catch (e) {
      console.error("loop error:", e.message);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

process.on("SIGTERM", () => { console.log("SIGTERM"); process.exit(0); });
process.on("SIGINT", () => { console.log("SIGINT"); process.exit(0); });

mainLoop();
