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

/** deep_profile_scrape — visit each profile URL and scrape public Bio / intro / city / work */
async function handleDeepProfileScrape(job) {
  const profiles = Array.isArray(job.payload?.profiles) ? job.payload.profiles : [];
  if (profiles.length === 0) throw new Error("payload.profiles is empty");

  const context = await openContext(job.account?.id, job.account?.credentials);
  const page = await context.newPage();
  let processed = 0;
  let extracted = 0;

  const toUrl = (p) => {
    const s = String(p).trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (/^\d{6,}$/.test(s)) return `https://www.facebook.com/profile.php?id=${s}`;
    return `https://www.facebook.com/${s.replace(/^\//, "")}`;
  };

  try {
    for (const ref of profiles) {
      const url = toUrl(ref);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(1500 + Math.floor(Math.random() * 1500));

        // Detect login wall once
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

        // Try to click "See more" on intro/about
        try {
          const more = page.locator(
            'div[role="button"]:has-text("See more"), div[role="button"]:has-text("عرض المزيد")'
          );
          const n = await more.count().catch(() => 0);
          for (let i = 0; i < Math.min(n, 3); i++) {
            try { await more.nth(i).click({ timeout: 800 }); } catch (_) {}
          }
        } catch (_) {}

        const data = await page.evaluate(() => {
          const out = { name: null, bio: null, intro_lines: [], city: null, hometown: null, work: null, education: null, relationship: null, phone: null, profile_url: location.href };
          const h1 = document.querySelector("h1");
          if (h1) out.name = (h1.textContent || "").trim().slice(0, 120) || null;

          // Intro card lines (Lives in, From, Works at, Studied at, etc.)
          const ALL = Array.from(document.querySelectorAll("div, span, li"));
          const texts = new Set();
          for (const el of ALL) {
            const t = (el.textContent || "").trim();
            if (!t || t.length > 220) continue;
            if (/^(Lives in|From|Works at|Worked at|Studied at|Studies at|Went to|Single|Married|In a relationship|يعيش في|من|يعمل في|درس في|درست في|أعزب|متزوج|في علاقة)/i.test(t)) {
              texts.add(t);
            }
          }
          out.intro_lines = Array.from(texts).slice(0, 12);

          for (const line of out.intro_lines) {
            const m1 = line.match(/^(?:Lives in|يعيش في)\s+(.+)$/i);
            if (m1 && !out.city) out.city = m1[1].trim();
            const m2 = line.match(/^(?:From|من)\s+(.+)$/i);
            if (m2 && !out.hometown) out.hometown = m2[1].trim();
            const m3 = line.match(/^(?:Works at|Worked at|يعمل في)\s+(.+)$/i);
            if (m3 && !out.work) out.work = m3[1].trim();
            const m4 = line.match(/^(?:Studied at|Studies at|Went to|درس في|درست في)\s+(.+)$/i);
            if (m4 && !out.education) out.education = m4[1].trim();
            if (/^(Single|Married|In a relationship|أعزب|متزوج|في علاقة)/i.test(line) && !out.relationship) {
              out.relationship = line.trim();
            }
          }

          // Bio text under name
          const bioEl = document.querySelector('div[data-pagelet="ProfileTilesFeed_0"] span, div[role="main"] h1 ~ div span');
          if (bioEl) {
            const b = (bioEl.textContent || "").trim();
            if (b && b.length < 300) out.bio = b;
          }

          // Hunt for phone-like patterns in visible text (Egypt-style)
          const body = (document.body?.innerText || "").slice(0, 20000);
          const phoneM = body.match(/(?:\+?20|0)?1[0125]\d{8}/);
          if (phoneM) out.phone = phoneM[0];

          return out;
        });

        const fbId = (() => {
          const m1 = url.match(/profile\.php\?id=(\d+)/);
          if (m1) return m1[1];
          const m2 = url.match(/facebook\.com\/([^/?]+)/);
          return m2 ? m2[1] : ref;
        })();

        await postUpdate({
          jobId: job.id,
          result: {
            target: fbId,
            status: "success",
            data: { ...data, source: "deep_profile" },
          },
        });
        extracted++;
      } catch (e) {
        await postUpdate({
          jobId: job.id,
          result: { target: String(ref).slice(0, 200), status: "failed", error: String(e.message || e).slice(0, 300) },
        });
      }

      processed++;
      await postUpdate({
        jobId: job.id,
        progress: Math.min(99, Math.round((processed / profiles.length) * 100)),
        processedItems: extracted,
        status: "running",
      });

      // Gentle pacing to reduce ban risk
      await page.waitForTimeout(2500 + Math.floor(Math.random() * 3500));
    }
    return { extracted };
  } finally {
    await context.close().catch(() => {});
  }
}

/** extract_group_members — scrape visible members from a group members page */
async function handleExtractGroupMembers(job) {
  const payload = job.payload || {};
  const groupRef = payload.groupUrl || payload.groupId;
  if (!groupRef) throw new Error("payload.groupId or payload.groupUrl is required");

  const maxMembers = Math.min(Math.max(50, Number(payload.maxMembers) || 1500), 5000);
  const keywords = (Array.isArray(payload.filterKeywords) ? payload.filterKeywords : [])
    .map((k) => String(k).trim().toLowerCase())
    .filter(Boolean);

  const groupId = (() => {
    const raw = String(groupRef).trim();
    const urlMatch = raw.match(/facebook\.com\/groups\/([^/?#]+)/i);
    if (urlMatch) return urlMatch[1];
    return raw.replace(/^groups\//i, "").replace(/^\//, "").replace(/\/$/, "");
  })();

  const membersUrl = `https://www.facebook.com/groups/${groupId}/members`;
  const context = await openContext(job.account?.id, job.account?.credentials);
  const page = await context.newPage();
  const seen = new Set();
  let extracted = 0;
  let emptyScrolls = 0;

  const emit = async (member) => {
    if (!member?.fbId || seen.has(member.fbId)) return;
    if (keywords.length > 0) {
      const blob = `${member.name || ""} ${member.bio || ""}`.toLowerCase();
      if (!keywords.some((k) => blob.includes(k))) return;
    }

    seen.add(member.fbId);
    extracted++;
    await postUpdate({
      jobId: job.id,
      result: {
        target: member.fbId,
        status: "success",
        data: {
          fb_user_id: member.fbId,
          name: member.name,
          profile_url: member.profile_url,
          bio_snippet: member.bio || "",
          source: "group_member",
          source_id: groupId,
        },
      },
    });
  };

  try {
    await page.goto(membersUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);

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

    // If Facebook shows a generic unavailable page, the account is not a member or cannot access the group.
    const pageText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    if (/content isn't available|this content isn't available|هذا المحتوى غير متوفر|لا يتوفر هذا المحتوى/i.test(pageText)) {
      throw new Error("Group members page is not accessible. Make sure the Facebook account is a member of this group.");
    }

    for (let i = 0; i < 220 && extracted < maxMembers && emptyScrolls < 6; i++) {
      const batch = await page.$$eval(
        'a[role="link"][href*="/groups/"][href*="/user/"], a[role="link"][href*="facebook.com/profile.php"], a[role="link"][href*="facebook.com/people/"], a[role="link"][href^="/"]',
        (anchors) => {
          const out = [];
          const localSeen = new Set();

          for (const a of anchors) {
            const href = a.href || a.getAttribute("href") || "";
            const name = (a.innerText || a.textContent || "").trim().replace(/\s+/g, " ");
            if (!name || name.length < 2 || name.length > 90) continue;
            if (/^(Home|Groups|Facebook|الصفحة الرئيسية|المجموعات|إشعارات|Notifications)$/i.test(name)) continue;

            let fbId = null;
            const userMatch = href.match(/\/groups\/[^/]+\/user\/(\d+)/i);
            const profileMatch = href.match(/profile\.php\?id=(\d+)/i);
            const peopleMatch = href.match(/\/people\/[^/]+\/(\d+)/i);
            const slugMatch = href.match(/facebook\.com\/([A-Za-z0-9._-]+)(?:[/?#]|$)/i);

            if (userMatch) fbId = userMatch[1];
            else if (profileMatch) fbId = profileMatch[1];
            else if (peopleMatch) fbId = peopleMatch[1];
            else if (slugMatch && !["groups", "pages", "events", "watch", "marketplace", "profile.php", "login"].includes(slugMatch[1])) fbId = slugMatch[1];
            if (!fbId || localSeen.has(fbId)) continue;

            const card = a.closest('[role="listitem"], [data-visualcompletion], li, div');
            const cardText = (card?.textContent || "").trim().replace(/\s+/g, " ");
            const bio = cardText.startsWith(name) ? cardText.slice(name.length).trim().slice(0, 180) : cardText.slice(0, 180);
            const profileUrl = href.startsWith("http") ? href.split("?")[0] : `https://www.facebook.com${href.split("?")[0]}`;

            localSeen.add(fbId);
            out.push({ fbId, name, profile_url: profileUrl, bio });
          }
          return out;
        }
      );

      const before = extracted;
      for (const member of batch) {
        if (extracted >= maxMembers) break;
        await emit(member);
      }

      emptyScrolls = extracted === before ? emptyScrolls + 1 : 0;

      await postUpdate({
        jobId: job.id,
        progress: Math.min(99, Math.round((extracted / maxMembers) * 100)),
        processedItems: extracted,
        totalItems: maxMembers,
        status: "running",
      });

      await page.evaluate(() => window.scrollBy(0, Math.max(1200, window.innerHeight * 1.6)));
      await page.waitForTimeout(1600 + Math.floor(Math.random() * 2200));
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

/**
 * extract_page_audience — Scrape public audience signals from a Facebook Page:
 *   - users who reacted to recent posts (likers/engagers)
 *   - users who commented on recent posts
 * Payload: { pageId | pageUrl, maxPosts?: number, maxAudience?: number, audienceType?: "reactors"|"commenters"|"all" }
 */
async function handleExtractPageAudience(job) {
  const payload = job.payload || {};
  const pageRef = payload.pageUrl || payload.pageId;
  if (!pageRef) throw new Error("payload.pageId or payload.pageUrl is required");

  const maxPosts = Math.min(Math.max(1, Number(payload.maxPosts) || 8), 25);
  const maxAudience = Math.min(Math.max(50, Number(payload.maxAudience) || 1000), 5000);
  const audienceType = String(payload.audienceType || "all").toLowerCase();
  const wantReactors = audienceType === "all" || audienceType === "reactors";
  const wantCommenters = audienceType === "all" || audienceType === "commenters";

  const pageUrl = /^https?:\/\//i.test(pageRef)
    ? pageRef.replace(/\/$/, "")
    : `https://www.facebook.com/${String(pageRef).replace(/^\//, "").replace(/\/$/, "")}`;

  const context = await openContext(job.account?.id, job.account?.credentials);
  const page = await context.newPage();
  const seen = new Set();
  let extracted = 0;

  const emit = async (entry, sourceTag, postUrl) => {
    if (!entry || !entry.fbId || seen.has(entry.fbId)) return;
    seen.add(entry.fbId);
    await postUpdate({
      jobId: job.id,
      result: {
        target: entry.fbId,
        status: "success",
        data: {
          fb_user_id: entry.fbId,
          name: entry.name,
          profile_url: entry.profile_url,
          source: sourceTag,
          source_id: pageRef,
          source_post: postUrl || null,
        },
      },
    });
    extracted++;
  };

  const harvestProfileLinks = async () =>
    page.$$eval(
      'a[role="link"][href*="facebook.com"], a[role="link"][href^="/"]',
      (anchors) => {
        const out = [];
        const seenLocal = new Set();
        for (const a of anchors) {
          const href = a.href || "";
          if (!href.match(/facebook\.com\/(profile\.php\?id=\d+|[a-zA-Z0-9.\-_]+)/)) continue;
          if (/\/(groups|pages|events|watch|marketplace|photo|posts|videos|reel|stories|help|policies|privacy|login|reg|gaming)/.test(href)) continue;
          const name = (a.innerText || a.textContent || "").trim();
          if (!name || name.length < 2 || name.length > 80) continue;
          const idMatch = href.match(/profile\.php\?id=(\d+)/);
          const slugMatch = href.match(/facebook\.com\/([a-zA-Z0-9.\-_]+)/);
          const fbId = idMatch ? idMatch[1] : slugMatch ? slugMatch[1] : null;
          if (!fbId || seenLocal.has(fbId)) continue;
          if (["profile.php", "people", "public", "directory"].includes(fbId)) continue;
          seenLocal.add(fbId);
          out.push({ fbId, name, profile_url: href.split("?")[0] });
        }
        return out;
      }
    );

  try {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);

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

    for (let i = 0; i < 8 && extracted < maxAudience; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(1500);
    }

    const postUrls = await page.$$eval(
      'a[href*="/posts/"], a[href*="/videos/"], a[href*="story_fbid="], a[href*="/permalink/"]',
      (anchors) => {
        const out = [];
        const seenLocal = new Set();
        for (const a of anchors) {
          const href = a.href || "";
          if (!/\/(posts|videos|permalink)\/|story_fbid=/.test(href)) continue;
          const clean = href.split("?")[0];
          if (seenLocal.has(clean)) continue;
          seenLocal.add(clean);
          out.push(clean);
        }
        return out;
      }
    );

    const targetPosts = postUrls.slice(0, maxPosts);
    await postUpdate({
      jobId: job.id,
      progress: 5,
      processedItems: extracted,
      totalItems: maxAudience,
      status: "running",
    });

    for (let i = 0; i < targetPosts.length && extracted < maxAudience; i++) {
      const postUrl = targetPosts[i];
      try {
        await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(2500);

        if (wantReactors) {
          try {
            const reactBtn = page.locator(
              'div[role="button"][aria-label*="reaction" i], div[role="button"][aria-label*="تفاعل"], span:has-text("All reactions"), span:has-text("كل التفاعلات")'
            );
            const rc = await reactBtn.count().catch(() => 0);
            if (rc > 0) {
              try { await reactBtn.first().click({ timeout: 2000 }); } catch (_) {}
              await page.waitForTimeout(2000);

              const dialog = page.locator('div[role="dialog"]');
              for (let s = 0; s < 12 && extracted < maxAudience; s++) {
                try {
                  await dialog.first().evaluate((el) => el.scrollBy(0, 600));
                } catch (_) {
                  await page.evaluate(() => window.scrollBy(0, 600));
                }
                await page.waitForTimeout(900);
                const batch = await harvestProfileLinks();
                for (const b of batch) {
                  if (extracted >= maxAudience) break;
                  await emit(b, "page_reactor", postUrl);
                }
              }
              try { await page.keyboard.press("Escape"); } catch (_) {}
              await page.waitForTimeout(500);
            }
          } catch (_) {}
        }

        if (wantCommenters && extracted < maxAudience) {
          try {
            const chooser = page.getByRole("button", { name: /most relevant|الأكثر صلة|الأكثر تفاعلًا/i });
            if (await chooser.first().isVisible({ timeout: 1500 })) {
              await chooser.first().click();
              const allOpt = page.getByRole("menuitem", { name: /all comments|كل التعليقات/i });
              if (await allOpt.first().isVisible({ timeout: 1500 })) await allOpt.first().click();
              await page.waitForTimeout(1200);
            }
          } catch (_) {}

          for (let s = 0; s < 6 && extracted < maxAudience; s++) {
            const more = page.locator(
              'div[role="button"]:has-text("more comment"), div[role="button"]:has-text("previous comment"), div[role="button"]:has-text("المزيد من التعليقات"), div[role="button"]:has-text("التعليقات السابقة")'
            );
            const mc = await more.count().catch(() => 0);
            for (let b = 0; b < Math.min(mc, 3); b++) {
              try { await more.nth(b).click({ timeout: 1200 }); } catch (_) {}
            }
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await page.waitForTimeout(1200);

            const batch = await harvestProfileLinks();
            for (const b of batch) {
              if (extracted >= maxAudience) break;
              await emit(b, "page_commenter", postUrl);
            }
          }
        }

        await postUpdate({
          jobId: job.id,
          progress: Math.min(99, Math.round(((i + 1) / targetPosts.length) * 95) + 4),
          processedItems: extracted,
          totalItems: maxAudience,
          status: "running",
        });
      } catch (e) {
        console.warn("post audience error:", postUrl, e.message);
      }

      await page.waitForTimeout(1500 + Math.floor(Math.random() * 2000));
    }

    return { extracted };
  } finally {
    await context.close().catch(() => {});
  }
}

const HANDLERS = {
  extract_commenters: handleExtractCommenters,
  deep_profile_scrape: handleDeepProfileScrape,
  extract_group_members: handleExtractGroupMembers,
  extract_page_audience: handleExtractPageAudience,
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
