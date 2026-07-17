// Extracts the *reachable* audience of a Facebook Page.
//
// Facebook does NOT expose the full followers/likes list publicly — the
// /{pageId}/followers and /{pageId}/likes pages usually show only a small
// "mutual" preview (10-100 profiles). To reach the real, marketing-relevant
// audience we open the Page's recent posts and harvest:
//
//   - reactors    (people who reacted to the post — reactions dialog)
//   - commenters  (people who commented — comment thread)
//
// This yields hundreds to thousands per page depending on activity, and the
// people surfaced are demonstrably engaged (better targets than a silent
// follower list).
//
// The legacy followers/likers pass is kept as a cheap warm-up when requested.

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FB_SYSTEM_SLUGS = new Set([
  "pages","groups","events","watch","marketplace","profile.php","stories","reel","reels",
  "business","help","policies","terms","privacy","ads","adsmanager","careers","about",
  "settings","login","recover","gaming","creator","creators","fundraisers","jobs",
  "messages","notifications","saved","memories","friends","games","weather","crisisresponse",
  "lite","mobile","l.php","sharer","sharer.php","plugins","dialog","oauth","tr","tr.php",
  "support","legal","brand","brandresources","newsroom","community","ai","meta",
  "ad_choices","adchoices","privacy_policy","cookies","cookie","branded_content",
  "communitystandards","data_policy","instagram","whatsapp","oculus","portal","workplace",
  "developers","developer","platform","safety","prighting","accessibility",
  "photo","photo.php","permalink.php","story.php","posts","videos","live","events",
]);

const GENERIC_LABELS = [
  /^ad\s*choices$/i, /^الإعلانات$/, /^إعلانات$/, /^الشروط$/, /^شروط$/,
  /^الخصوصية$/, /^خصوصية$/, /^سياسة(\s+\S+)?$/, /^ملفات\s*تعريف.*$/,
  /^المتابعون(\s+[\u0660-\u0669\d٠-٩]+)?$/, /^متابعون(\s+[\u0660-\u0669\d٠-٩]+)?$/,
  /^Followers(\s+\d+)?$/i, /^Likes(\s+\d+)?$/i, /^المعجبون(\s+[\u0660-\u0669\d٠-٩]+)?$/,
  /^Ad\s*Choices$/i, /^Terms$/i, /^Privacy$/i, /^Cookies$/i, /^Help$/i, /^About$/i,
  /^المساعدة$/, /^عن(\s+\S+)?$/, /^Meta$/i, /^ميتا$/,
  /^Like$/i, /^Reply$/i, /^Share$/i, /^Comment$/i, /^See more$/i, /^See all$/i,
  /^إعجاب$/, /^رد$/, /^مشاركة$/, /^تعليق$/, /^عرض المزيد$/, /^عرض الكل$/,
];

function isLikelyPersonName(name) {
  if (!name) return false;
  const s = name.trim();
  if (s.length < 2 || s.length > 60) return false;
  if (!/[A-Za-z\u0600-\u06FF]/.test(s)) return false;
  for (const re of GENERIC_LABELS) if (re.test(s)) return false;
  return true;
}

function parseProfileHref(href) {
  if (!href) return null;
  const numeric = href.match(/profile\.php\?id=(\d+)/);
  if (numeric) return { id: numeric[1], kind: "numeric" };
  const userPath = href.match(/facebook\.com\/user\/(\d+)/);
  if (userPath) return { id: userPath[1], kind: "numeric" };
  const slug = href.match(/facebook\.com\/([A-Za-z0-9._-]+)(?:\/|$|\?)/) ||
               href.match(/^\/([A-Za-z0-9._-]+)(?:\/|$|\?)/);
  if (slug) {
    const id = slug[1];
    if (FB_SYSTEM_SLUGS.has(id.toLowerCase())) return null;
    if (id.length < 4) return null;
    return { id, kind: "slug" };
  }
  return null;
}

// ---------- generic scroller that harvests profile links inside a scope ----------
async function harvestFromScope(page, scopeSelector, cap, opts = {}) {
  const { maxScrolls = 60, idleLimit = 4 } = opts;
  const found = new Map();
  let idle = 0;
  for (let i = 0; i < maxScrolls && found.size < cap && idle < idleLimit; i++) {
    const batch = await page.evaluate((sel) => {
      const root = sel ? document.querySelector(sel) : document;
      if (!root) return [];
      const out = [];
      const links = Array.from(root.querySelectorAll('a[role="link"], a[href*="profile.php"], a[href*="/user/"]'));
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        const name = (a.textContent || "").trim();
        if (!name) continue;
        const hasAvatar = !!a.querySelector('image, img, svg image');
        out.push({ href, name, hasAvatar });
      }
      return out;
    }, scopeSelector);

    let added = 0;
    for (const item of batch) {
      const parsed = parseProfileHref(item.href);
      if (!parsed) continue;
      // slug links without an avatar are usually chrome/menu entries
      if (parsed.kind === "slug" && !item.hasAvatar) continue;
      if (!isLikelyPersonName(item.name)) continue;
      if (found.has(parsed.id)) continue;
      const profile = item.href.startsWith("http")
        ? item.href.split("?")[0]
        : `https://www.facebook.com${item.href.split("?")[0]}`;
      found.set(parsed.id, { id: parsed.id, name: item.name, profile });
      added++;
      if (found.size >= cap) break;
    }
    idle = added === 0 ? idle + 1 : 0;

    // scroll inside the scope if it exists, else scroll the page
    await page.evaluate((sel) => {
      const el = sel ? document.querySelector(sel) : null;
      if (el) el.scrollTop = el.scrollHeight;
      else window.scrollBy(0, 1800);
    }, scopeSelector);
    await sleep(rand(1500, 2800));
  }
  return Array.from(found.values());
}

// ---------- collect recent post permalinks from the page timeline ----------
async function collectRecentPostUrls(page, pageId, wantPosts) {
  const urls = new Set();
  for (let i = 0; i < 25 && urls.size < wantPosts; i++) {
    const batch = await page.evaluate(() => {
      const out = [];
      const links = Array.from(document.querySelectorAll('a[href*="/posts/"], a[href*="/videos/"], a[href*="permalink"], a[href*="story_fbid"]'));
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        if (!href) continue;
        // must look like a permalink, not a hashtag or ad
        if (/\/(posts|videos|permalink\.php|story\.php)/.test(href)) out.push(href);
      }
      return out;
    });
    for (const h of batch) {
      const full = h.startsWith("http") ? h.split("?")[0] : `https://www.facebook.com${h.split("?")[0]}`;
      // filter same-page id references + drop translation/like href variants
      if (!full.includes(pageId) && !full.includes("permalink") && !full.includes("story_fbid")) continue;
      urls.add(full);
      if (urls.size >= wantPosts) break;
    }
    await page.evaluate(() => window.scrollBy(0, 2400));
    await sleep(rand(1800, 3000));
  }
  return Array.from(urls).slice(0, wantPosts);
}

// ---------- reactors dialog ----------
async function harvestReactors(page, cap) {
  // Try to open the reactions dialog by clicking a reaction summary bar.
  const opened = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('[role="button"], a[role="link"]'));
    // labels vary a lot; match on aria-label first
    const byAria = candidates.find((el) => {
      const a = (el.getAttribute("aria-label") || "").toLowerCase();
      return /reactions|people who reacted|تفاعل|من تفاعل|إعجاب|إعجابات/.test(a);
    });
    const target = byAria || candidates.find((el) => /^\d[\d,.]*$/.test((el.textContent || "").trim()));
    if (target) { target.click(); return true; }
    return false;
  }).catch(() => false);
  if (!opened) return [];
  await sleep(2500);
  // dialog element
  const scope = 'div[role="dialog"]';
  const exists = await page.$(scope);
  if (!exists) return [];
  const people = await harvestFromScope(page, scope, cap, { maxScrolls: 40, idleLimit: 5 });
  // close dialog
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(800);
  return people;
}

// ---------- commenters (expand all comments then scrape article) ----------
async function harvestCommenters(page, cap) {
  // expand nested & "view more comments" repeatedly
  for (let i = 0; i < 40; i++) {
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="button"], span'));
      const target = btns.find((b) => /view more comments|view previous comments|view \d+ replies|more replies|عرض المزيد من التعليقات|عرض تعليقات سابقة|عرض \d+ رد|عرض ردود أخرى/i.test(b.textContent || ""));
      if (target) { target.click(); return true; }
      return false;
    });
    if (!clicked) {
      await page.evaluate(() => window.scrollBy(0, 1400));
    }
    await sleep(rand(1200, 2200));
    // early-exit when we've likely exhausted
    if (!clicked && i > 8) break;
  }
  // scrape whole document — commenter links live inside article blocks
  return harvestFromScope(page, null, cap, { maxScrolls: 3, idleLimit: 2 });
}

async function runExtractPageAudience({ page, job, report }) {
  const {
    pageId,
    sources = ["engagers"],
    maxItems = 1500,
    maxPosts = 20,
    resumeFromIndex = 0,
    alreadyCollectedIds = [],
  } = job.payload || {};
  if (!pageId) {
    await report({ status: "failed", errorMessage: "Missing pageId in payload" });
    return;
  }
  // No hard cap — bot keeps going until posts/audience are exhausted or the user-supplied maxItems is reached.
  const cap = Math.max(50, Number(maxItems) || 1500);
  const collected = new Map();
  // Pre-seed dedupe set from results persisted in a previous (paused) run so
  // we don't re-emit the same profiles and the cap logic stays accurate.
  for (const id of Array.isArray(alreadyCollectedIds) ? alreadyCollectedIds : []) {
    if (id) collected.set(String(id), { id: String(id), name: "", profile: "" });
  }
  const skipUntilIndex = Math.max(0, Number(resumeFromIndex) || 0);

  const emit = async (person, src) => {
    if (collected.has(person.id)) return;
    collected.set(person.id, person);
    await report({
      result: {
        target: person.id,
        status: "success",
        data: {
          fb_user_id: person.id,
          name: person.name,
          profile_url: person.profile,
          source: src,
          source_id: pageId,
        },
      },
    });
  };

  // Log rows are stored as `status: skipped` with `data.kind = "log"` so the
  // history UI can render them as a live activity feed without polluting
  // the people/CSV exports.
  const emitLog = async (payload) => {
    console.log(`[extract-page-audience] ${payload.event}`, payload);
    try {
      await report({
        result: {
          target: null,
          status: "skipped",
          data: { kind: "log", ts: Date.now(), ...payload },
        },
      });
    } catch (_) { /* non-fatal */ }
  };

  let stopReason = null;

  // --- Optional cheap passes: public followers/likes preview (usually tiny) ---
  const previewTasks = [];
  if (sources.includes("followers")) previewTasks.push({ src: "page_followers", url: `https://www.facebook.com/${pageId}/followers` });
  if (sources.includes("likers"))    previewTasks.push({ src: "page_likers",    url: `https://www.facebook.com/${pageId}/likes` });
  for (const t of previewTasks) {
    if (collected.size >= cap) break;
    const beforeCount = collected.size;
    try {
      await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await sleep(4000);
      const people = await harvestFromScope(page, null, cap - collected.size, { maxScrolls: 30, idleLimit: 4 });
      for (const p of people) await emit(p, t.src);
      await emitLog({
        event: "preview_pass",
        source: t.src,
        added: collected.size - beforeCount,
        total: collected.size,
      });
      await report({
        progress: Math.min(30, Math.round((collected.size / cap) * 30)),
        processedItems: collected.size,
        totalItems: cap,
        status: "running",
      });
    } catch (err) {
      await emitLog({ event: "preview_pass_failed", source: t.src, error: String(err.message || err) });
    }
  }

  // --- Main pass: reactors + commenters on recent posts ---
  const doEngagers = sources.includes("engagers") || sources.length === 0 || collected.size < cap;
  if (doEngagers && collected.size < cap) {
    try {
      await page.goto(`https://www.facebook.com/${pageId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await sleep(4000);

      const wantPosts = Math.min(Math.max(5, Number(maxPosts) || 20), 40);
      const postUrls = await collectRecentPostUrls(page, pageId, wantPosts);
      await emitLog({ event: "posts_discovered", requested: wantPosts, found: postUrls.length });

      if (postUrls.length === 0) {
        stopReason = { code: "no_posts_visible", detail: "لم يعثر البوت على منشورات ظاهرة في هذه الصفحة (خصوصية / لغة / تخطيط جديد)." };
      }

      for (let i = 0; i < postUrls.length; i++) {
        if (collected.size >= cap) { stopReason = { code: "cap_reached", detail: `تم بلوغ الحد الأقصى (${cap} حساب).` }; break; }
        const url = postUrls[i];
        const beforeCount = collected.size;
        let reactorsAdded = 0;
        let commentersAdded = 0;
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
          await sleep(3500);

          if (collected.size < cap) {
            const reactors = await harvestReactors(page, cap - collected.size);
            const beforeR = collected.size;
            for (const p of reactors) await emit(p, "post_reactors");
            reactorsAdded = collected.size - beforeR;
          }

          if (collected.size < cap) {
            const commenters = await harvestCommenters(page, cap - collected.size);
            const beforeC = collected.size;
            for (const p of commenters) await emit(p, "post_commenters");
            commentersAdded = collected.size - beforeC;
          }

          await emitLog({
            event: "post_scraped",
            index: i + 1,
            of: postUrls.length,
            url,
            reactors: reactorsAdded,
            commenters: commentersAdded,
            added: collected.size - beforeCount,
            total: collected.size,
          });
        } catch (err) {
          await emitLog({
            event: "post_failed",
            index: i + 1,
            of: postUrls.length,
            url,
            error: String(err.message || err),
          });
        }

        await report({
          progress: Math.min(99, 30 + Math.round(((i + 1) / postUrls.length) * 65)),
          processedItems: collected.size,
          totalItems: cap,
          status: "running",
        });
      }

      if (!stopReason) {
        stopReason = { code: "posts_exhausted", detail: `تم فحص كل المنشورات المتاحة (${postUrls.length}).` };
      }
    } catch (err) {
      stopReason = { code: "engagers_error", detail: String(err.message || err) };
      await emitLog({ event: "engagers_failed", error: String(err.message || err) });
    }
  }

  if (!stopReason) {
    stopReason = { code: "sources_done", detail: "انتهت كل المصادر المطلوبة." };
  }
  await emitLog({ event: "stop_reason", ...stopReason, total: collected.size });

  await report({
    progress: 100,
    processedItems: collected.size,
    totalItems: collected.size,
    status: "completed",
  });
}


module.exports = { runExtractPageAudience };
