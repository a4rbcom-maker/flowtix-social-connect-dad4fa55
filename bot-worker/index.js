// Flowtix bot worker — single-file orchestrator.
// Polls /api/public/bot/next-job, executes via Puppeteer, reports back.
require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-extra");
const Stealth = require("puppeteer-extra-plugin-stealth");
puppeteer.use(Stealth());

const { runPostToGroups } = require("./actions/post-to-group");
const { runExtractPages } = require("./actions/extract-pages");
const { runExtractCommenters } = require("./actions/extract-commenters");
const { runExtractGroupMembers } = require("./actions/extract-group-members");
const { runExtractPageAudience } = require("./actions/extract-page-audience");
const { runListMyGroups } = require("./actions/list-my-groups");
const { runDeepProfileScrape } = require("./actions/deep-profile-scrape");
const { runSendMessengerDm } = require("./actions/send-messenger-dm");
const { runMessengerListPages } = require("./actions/messenger-list-pages");
const { runMessengerSyncCookies } = require("./actions/messenger-sync-cookies");
const { runMessengerSendCookies } = require("./actions/messenger-send-cookies");
const { runTestProxy } = require("./actions/test-proxy");
const { ensureLogin } = require("./actions/login");

const API = process.env.API_BASE_URL;
const SECRET = process.env.BOT_WORKER_SECRET;
const MIN_INT = Math.max(5, parseInt(process.env.POLL_INTERVAL_SEC || "15", 10)) * 1000;
const MAX_INT = Math.max(MIN_INT, parseInt(process.env.POLL_MAX_INTERVAL_SEC || "60", 10) * 1000);
const HEADLESS = process.env.HEADLESS !== "false";
const PROFILE_ROOT = process.env.BOT_PROFILE_DIR || path.join(__dirname, ".browser-profiles");
const WORKER_VERSION = "bot-worker-2026-07-19-proxy-tester-v1";
const WORKER_CAPABILITIES = [
  "post_to_groups",
  "extract_pages",
  "extract_pages_resilient",
  "extract_commenters",
  "extract_group_members",
  "extract_page_audience",
  "list_my_groups",
  "deep_profile_scrape",
  "send_messenger_dm",
  "messenger_list_pages",
  "messenger_sync_cookies",
  "messenger_send_cookies",
  "test_proxy",
].join(",");

if (!API || !SECRET) {
  console.error("Missing API_BASE_URL or BOT_WORKER_SECRET in .env");
  process.exit(1);
}

const http = axios.create({
  baseURL: API,
  headers: {
    Authorization: `Bearer ${SECRET}`,
    "Content-Type": "application/json",
    "X-Flowtix-Worker-Version": WORKER_VERSION,
    "X-Flowtix-Worker-Capabilities": WORKER_CAPABILITIES,
  },
  timeout: 30_000,
});

async function fetchNextJob() {
  const { data } = await http.post("/api/public/bot/next-job", {});
  return data.job; // null when nothing
}

class JobCancelledError extends Error {
  constructor(jobId) { super(`Job ${jobId} cancelled by user`); this.name = "JobCancelledError"; this.cancelled = true; }
}
class JobPausedError extends Error {
  constructor(jobId) { super(`Job ${jobId} paused by user`); this.name = "JobPausedError"; this.paused = true; }
}

async function reportUpdate(payload) {
  try {
    const { data } = await http.post("/api/public/bot/job-update", payload);
    // Server signals user-initiated cancellation — abort the running action immediately.
    if (data && data.cancelled) {
      console.log(`[job ${payload.jobId}] cancellation signal received — aborting`);
      throw new JobCancelledError(payload.jobId);
    }
    // Server signals user-initiated pause — abort and DO NOT mark failed.
    if (data && data.paused) {
      console.log(`[job ${payload.jobId}] pause signal received — stopping (will resume from same point)`);
      throw new JobPausedError(payload.jobId);
    }
    return data;
  } catch (e) {
    if (e instanceof JobCancelledError || e instanceof JobPausedError) throw e;
    console.error("[update fail]", e.message);
  }
}

function shortError(error) {
  const message = String(error?.message || error || "Unknown error");
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

function accountProfileDir(accountId) {
  const safeId = String(accountId || "anonymous").replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = path.join(PROFILE_ROOT, safeId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function parseProxy(proxyUrl) {
  if (!proxyUrl || typeof proxyUrl !== "string") return null;
  try {
    const u = new URL(proxyUrl);
    if (!/^https?:$|^socks5?:$/i.test(u.protocol)) return null;
    return {
      server: `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}`,
      username: decodeURIComponent(u.username || ""),
      password: decodeURIComponent(u.password || ""),
    };
  } catch {
    return null;
  }
}

function loginOptionsForJob(job) {
  // Verify the base facebook.com session only. We deliberately do NOT set a
  // verifyUrl pointing at business.facebook.com/latest/* for Messenger jobs:
  // Business Suite has its own shell/loading behaviour and a slow render was
  // getting misclassified as "SESSION_EXPIRED / cookies rejected" even for
  // freshly-exported cookies. Each Messenger action already reports a precise
  // reason (permissions / inbox not opened / etc.) if Business Suite fails.
  return { preferExistingSession: true };
}

async function emitExtractPagesWorkerLog(job, event, stage, data = {}) {
  if (job.type !== "extract_pages") return;
  await reportUpdate({
    jobId: job.id,
    result: {
      target: `extract-pages-worker:${Date.now()}:${event}`,
      status: "skipped",
      data: {
        kind: "log",
        job_type: "extract_pages",
        event,
        stage,
        at: new Date().toISOString(),
        workerVersion: WORKER_VERSION,
        ...data,
      },
    },
  });
}

async function timedExtractPagesWorkerStep(job, stage, fn, data = {}) {
  const startedAt = Date.now();
  await emitExtractPagesWorkerLog(job, "step_started", stage, data);
  try {
    const result = await fn();
    await emitExtractPagesWorkerLog(job, "step_finished", stage, {
      ...data,
      duration_ms: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    await emitExtractPagesWorkerLog(job, "step_failed", stage, {
      ...data,
      duration_ms: Date.now() - startedAt,
      error: shortError(error),
    });
    throw error;
  }
}

async function runJob(job) {
  console.log(`[job ${job.id}] starting (${job.type})`);
  let browser = null;
  try {
    await emitExtractPagesWorkerLog(job, "worker_claimed", "queue", { type: job.type });
    const proxy = parseProxy(job.account?.proxyUrl);
    const launchArgs = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--lang=en-US,en"];
    if (proxy?.server) launchArgs.push(`--proxy-server=${proxy.server}`);
    browser = await timedExtractPagesWorkerStep(job, "browser_launch", () => puppeteer.launch({
      headless: HEADLESS,
      userDataDir: job.account?.id ? accountProfileDir(job.account.id) : undefined,
      args: launchArgs,
    }), { persistentProfile: Boolean(job.account?.id), proxyEnabled: Boolean(proxy?.server) });
    const page = await timedExtractPagesWorkerStep(job, "browser_page", () => browser.newPage());
    if (proxy?.username) {
      await timedExtractPagesWorkerStep(job, "browser_proxy_auth", () => page.authenticate({ username: proxy.username, password: proxy.password || "" }));
    }
    await timedExtractPagesWorkerStep(job, "browser_viewport", () => page.setViewport({ width: 1366, height: 800 }));
    const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    // Reuse the exact User-Agent captured from the user's real browser at
    // account-link time. This keeps the browser fingerprint stable across
    // devices so Facebook is less likely to flag the session as compromised
    // and log the user out from their own browser session.
    const accountUA = (job.account && typeof job.account.userAgent === "string" && job.account.userAgent.trim().length > 10)
      ? job.account.userAgent.trim()
      : DEFAULT_UA;
    await timedExtractPagesWorkerStep(job, "browser_user_agent", () => page.setUserAgent(accountUA), {
      customUserAgent: accountUA !== DEFAULT_UA,
    });

    if (job.account) {
      // Signal to the UI immediately that the worker picked the job up.
      await reportUpdate({ jobId: job.id, status: "running", progress: 3 });
      let loginFailureReason = "SESSION_EXPIRED: انتهت صلاحية جلسة حساب فيسبوك — أعد ربط الحساب من صفحة حسابات البوت.";
      const loginOptions = loginOptionsForJob(job);
      const ok = await timedExtractPagesWorkerStep(job, "facebook_login", () => ensureLogin(page, job.account, async (status, error) => {
        if (error) loginFailureReason = /session|cookie|login|auth|c_user/i.test(error)
          ? `SESSION_EXPIRED: ${error}`
          : error;
        await reportUpdate({ jobId: job.id, accountStatus: { accountId: job.account.id, status, error } });
      }, loginOptions), { accountId: job.account.id, authMethod: job.account.authMethod, protectedSurface: Boolean(loginOptions.verifyUrl) });
      if (!ok) {
        await emitExtractPagesWorkerLog(job, "step_failed", "facebook_login", { error: loginFailureReason });
        await reportUpdate({ jobId: job.id, status: "failed", errorMessage: loginFailureReason });
        return;
      }
      // Session verified — jump progress so the UI stops looking stuck.
      await reportUpdate({ jobId: job.id, progress: 12 });
      await emitExtractPagesWorkerLog(job, "login_verified", "facebook_login", { accountId: job.account.id });
    }

    const ctx = {
      page,
      job,
      report: (data) => reportUpdate({ jobId: job.id, ...data }),
    };

    if (job.type === "post_to_groups") await runPostToGroups(ctx);
    else if (job.type === "extract_pages") await timedExtractPagesWorkerStep(job, "extract_pages_action", () => runExtractPages(ctx));
    else if (job.type === "extract_commenters") await runExtractCommenters(ctx);
    else if (job.type === "extract_group_members") await runExtractGroupMembers(ctx);
    else if (job.type === "extract_page_audience") await runExtractPageAudience(ctx);
    else if (job.type === "list_my_groups") await runListMyGroups(ctx);
    else if (job.type === "deep_profile_scrape") await runDeepProfileScrape(ctx);
    else if (job.type === "send_messenger_dm") await runSendMessengerDm(ctx);
    else if (job.type === "messenger_list_pages") await runMessengerListPages(ctx);
    else if (job.type === "messenger_sync_cookies") await runMessengerSyncCookies(ctx);
    else if (job.type === "messenger_send_cookies") await runMessengerSendCookies(ctx);
    else await reportUpdate({ jobId: job.id, status: "failed", errorMessage: `Unknown job type: ${job.type}` });

  } catch (err) {
    if (err && err.cancelled) {
      console.log(`[job ${job.id}] cancelled — closing browser and skipping failure report`);
    } else if (err && err.paused) {
      console.log(`[job ${job.id}] paused — closing browser; status stays 'paused' for resume`);
    } else {
      console.error(`[job ${job.id}] error`, err);
      await reportUpdate({ jobId: job.id, status: "failed", errorMessage: String(err.message || err) }).catch(() => {});
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function loop() {
  let interval = MIN_INT;
  console.log(`[worker] started — ${WORKER_VERSION} pid=${process.pid} cwd=${process.cwd()} polling ${API} every ${MIN_INT/1000}s (max ${MAX_INT/1000}s on idle)`);
  while (true) {
    try {
      const job = await fetchNextJob();
      if (job) {
        interval = MIN_INT;
        await runJob(job);
      } else {
        // Exponential backoff when idle, capped
        interval = Math.min(MAX_INT, Math.floor(interval * 1.5));
      }
    } catch (e) {
      console.error("[poll error]", e.message);
      interval = Math.min(MAX_INT, interval * 2);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

loop();
