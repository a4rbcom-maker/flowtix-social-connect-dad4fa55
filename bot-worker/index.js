// Flowtix bot worker — single-file orchestrator.
// Polls /api/public/bot/next-job, executes via Puppeteer, reports back.
require("dotenv").config();
const axios = require("axios");
const puppeteer = require("puppeteer-extra");
const Stealth = require("puppeteer-extra-plugin-stealth");
puppeteer.use(Stealth());

const { runPostToGroups } = require("./actions/post-to-group");
const { runExtractPages } = require("./actions/extract-pages");
const { runExtractCommenters } = require("./actions/extract-commenters");
const { runExtractGroupMembers } = require("./actions/extract-group-members");
const { runExtractPageAudience } = require("./actions/extract-page-audience");
const { ensureLogin } = require("./actions/login");

const API = process.env.API_BASE_URL;
const SECRET = process.env.BOT_WORKER_SECRET;
const MIN_INT = Math.max(5, parseInt(process.env.POLL_INTERVAL_SEC || "15", 10)) * 1000;
const MAX_INT = Math.max(MIN_INT, parseInt(process.env.POLL_MAX_INTERVAL_SEC || "60", 10) * 1000);
const HEADLESS = process.env.HEADLESS !== "false";

if (!API || !SECRET) {
  console.error("Missing API_BASE_URL or BOT_WORKER_SECRET in .env");
  process.exit(1);
}

const http = axios.create({
  baseURL: API,
  headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
  timeout: 30_000,
});

async function fetchNextJob() {
  const { data } = await http.post("/api/public/bot/next-job", {});
  return data.job; // null when nothing
}

async function reportUpdate(payload) {
  try { await http.post("/api/public/bot/job-update", payload); }
  catch (e) { console.error("[update fail]", e.message); }
}

async function runJob(job) {
  console.log(`[job ${job.id}] starting (${job.type})`);
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: HEADLESS,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--lang=en-US,en"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 800 });
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    if (job.account) {
      const ok = await ensureLogin(page, job.account, async (status, error) => {
        await reportUpdate({ jobId: job.id, accountStatus: { accountId: job.account.id, status, error } });
      });
      if (!ok) {
        await reportUpdate({ jobId: job.id, status: "failed", errorMessage: "Login failed (check credentials/cookies)" });
        return;
      }
    }

    const ctx = {
      page,
      job,
      report: (data) => reportUpdate({ jobId: job.id, ...data }),
    };

    if (job.type === "post_to_groups") await runPostToGroups(ctx);
    else if (job.type === "extract_pages") await runExtractPages(ctx);
    else if (job.type === "extract_commenters") await runExtractCommenters(ctx);
    else if (job.type === "extract_group_members") await runExtractGroupMembers(ctx);
    else if (job.type === "extract_page_audience") await runExtractPageAudience(ctx);
    else await reportUpdate({ jobId: job.id, status: "failed", errorMessage: `Unknown job type: ${job.type}` });

  } catch (err) {
    console.error(`[job ${job.id}] error`, err);
    await reportUpdate({ jobId: job.id, status: "failed", errorMessage: String(err.message || err) });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function loop() {
  let interval = MIN_INT;
  console.log(`[worker] started — polling ${API} every ${MIN_INT/1000}s (max ${MAX_INT/1000}s on idle)`);
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
