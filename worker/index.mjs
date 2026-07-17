// Flowtix Facebook Worker
// ------------------------------------------------------------
// Polls the Lovable backend for pending jobs and executes them in a real
// Chromium browser using stored Facebook cookies. Facebook blocks
// datacenter IPs, so this script MUST run on a residential/home IP
// (your PC or a residential-proxy VPS).
//
// Required env vars (see .env.example):
//   BASE_URL           e.g. https://flowtix-social-connect.lovable.app
//   BOT_WORKER_SECRET  same value as the secret stored in Lovable Cloud
//   POLL_INTERVAL_MS   optional, defaults to 5000
//   HEADLESS           optional, "true" or "false" (default true)
// ------------------------------------------------------------

import { chromium } from "playwright";
import { fetch } from "undici";

const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");
const SECRET = process.env.BOT_WORKER_SECRET || "";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const HEADLESS = String(process.env.HEADLESS ?? "true") !== "false";

if (!BASE_URL || !SECRET) {
  console.error("[fatal] BASE_URL and BOT_WORKER_SECRET are required.");
  process.exit(1);
}

const api = async (path, body) => {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} ${res.status}: ${text}`);
  }
  return res.json();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

// ---------- Browser session ----------
async function openContext(credentials) {
  const browser = await chromium.launch({ headless: HEADLESS, args: ["--disable-blink-features=AutomationControlled"] });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
  });

  // cookies: array of {name,value,domain,path,...}
  const cookies = Array.isArray(credentials) ? credentials : credentials?.cookies;
  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new Error("Account has no cookies; only cookie-based accounts are supported.");
  }
  const normalized = cookies
    .filter((c) => c && c.name && c.value)
    .map((c) => ({
      name: c.name,
      value: String(c.value),
      domain: c.domain || ".facebook.com",
      path: c.path || "/",
      httpOnly: !!c.httpOnly,
      secure: c.secure !== false,
      sameSite: ["Lax", "None", "Strict"].includes(c.sameSite) ? c.sameSite : "Lax",
      expires: typeof c.expirationDate === "number" ? c.expirationDate : -1,
    }));
  await context.addCookies(normalized);
  return { browser, context, page: await context.newPage() };
}

// ---------- Job handlers ----------
async function verifyLogin(page) {
  await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(2000);
  const url = page.url();
  if (url.includes("/login") || url.includes("/checkpoint")) {
    return { ok: false, reason: url.includes("checkpoint") ? "checkpoint" : "invalid" };
  }
  return { ok: true };
}

async function postToGroup(page, groupId, content, mediaUrls) {
  await page.goto(`https://www.facebook.com/groups/${groupId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(rand(2000, 4000));

  // Click composer
  const composer = page.locator('div[role="button"]:has-text("Write something"), div[role="button"]:has-text("اكتب شيئًا")').first();
  await composer.waitFor({ timeout: 20_000 });
  await composer.click();
  await sleep(rand(1200, 2200));

  if (content) {
    const editor = page.locator('div[role="dialog"] div[contenteditable="true"]').first();
    await editor.waitFor({ timeout: 15_000 });
    await editor.type(content, { delay: rand(30, 80) });
    await sleep(rand(800, 1600));
  }

  // Media upload via downloading URLs to disk would go here; skipped for v1.
  // Most Lovable Cloud media URLs are public; FB accepts share-by-link well.
  if (mediaUrls?.length) {
    for (const url of mediaUrls) {
      const editor = page.locator('div[role="dialog"] div[contenteditable="true"]').first();
      await editor.type("\n" + url, { delay: 30 });
      await sleep(rand(1500, 2500));
    }
  }

  const postBtn = page.locator('div[role="dialog"] div[role="button"]:has-text("Post"), div[role="dialog"] div[role="button"]:has-text("نشر")').last();
  await postBtn.waitFor({ timeout: 15_000 });
  await postBtn.click();
  await sleep(rand(4000, 7000));
}

async function fetchGroups(page) {
  await page.goto("https://www.facebook.com/groups/feed/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(3000);
  // Scrape group links from "Your groups" rail
  const groups = await page.evaluate(() => {
    const out = new Map();
    document.querySelectorAll('a[href*="/groups/"]').forEach((a) => {
      const m = a.getAttribute("href")?.match(/\/groups\/(\d+|[a-z0-9.\-_]+)\//i);
      if (!m) return;
      const id = m[1];
      const name = (a.textContent || "").trim();
      if (id && name && !out.has(id)) out.set(id, { id, name });
    });
    return [...out.values()];
  });
  return groups;
}

// ---------- Job loop ----------
async function runOne() {
  const { job } = await api("/api/public/bot/next-job");
  if (!job) return false;

  console.log(`[job ${job.id}] type=${job.type}`);
  let browser;
  try {
    if (!job.account?.credentials) throw new Error("Job has no account credentials");
    const session = await openContext(job.account.credentials);
    browser = session.browser;
    const { page } = session;

    const login = await verifyLogin(page);
    if (!login.ok) {
      await api("/api/public/bot/job-update", {
        jobId: job.id,
        status: "failed",
        errorMessage: `Account ${login.reason}`,
        accountStatus: { accountId: job.account.id, status: login.reason, error: `Login check: ${login.reason}` },
      });
      return true;
    }
    // Cookies are valid → mark account active
    await api("/api/public/bot/job-update", {
      jobId: job.id,
      progress: 5,
      accountStatus: { accountId: job.account.id, status: "active" },
    });

    if (job.type === "post_to_groups") {
      const p = job.payload || {};
      const targets = p.groupIds || [];
      const min = (p.delayMinSeconds ?? 60) * 1000;
      const max = (p.delayMaxSeconds ?? 120) * 1000;
      let done = 0;
      for (const gid of targets) {
        try {
          await postToGroup(page, gid, p.content || "", p.mediaUrls || []);
          await api("/api/public/bot/job-update", {
            jobId: job.id,
            progress: Math.round(((done + 1) / targets.length) * 100),
            processedItems: done + 1,
            result: { target: gid, status: "success" },
          });
        } catch (e) {
          await api("/api/public/bot/job-update", {
            jobId: job.id,
            result: { target: gid, status: "failed", error: String(e?.message || e) },
          });
        }
        done++;
        if (done < targets.length) await sleep(rand(min, max));
      }
      await api("/api/public/bot/job-update", { jobId: job.id, status: "completed", processedItems: done });
    } else if (job.type === "fetch_groups") {
      const groups = await fetchGroups(page);
      await api("/api/public/bot/job-update", {
        jobId: job.id,
        status: "completed",
        processedItems: groups.length,
        result: { target: "groups", status: "success", data: { groups } },
      });
    } else {
      await api("/api/public/bot/job-update", {
        jobId: job.id,
        status: "failed",
        errorMessage: `Unsupported job type: ${job.type}`,
      });
    }
  } catch (e) {
    console.error(`[job ${job.id}] error:`, e);
    await api("/api/public/bot/job-update", {
      jobId: job.id,
      status: "failed",
      errorMessage: String(e?.message || e),
    }).catch(() => {});
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return true;
}

console.log(`[worker] up · base=${BASE_URL} · headless=${HEADLESS} · poll=${POLL_INTERVAL_MS}ms`);
let consecutiveErrors = 0;
while (true) {
  try {
    const had = await runOne();
    consecutiveErrors = 0;
    if (!had) await sleep(POLL_INTERVAL_MS);
  } catch (e) {
    consecutiveErrors++;
    console.error("[poll] error:", e?.message || e);
    await sleep(Math.min(60_000, POLL_INTERVAL_MS * Math.pow(2, consecutiveErrors)));
  }
}
