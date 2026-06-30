// Extracts publicly visible audience of a Facebook page:
// - followers (from /{pageId}/followers if visible)
// - likers (from /{pageId}/likes if visible)
// - engagers (reactors to the most recent posts)

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// Slugs that are Facebook product/system pages, NOT real users.
const FB_SYSTEM_SLUGS = new Set([
  "pages","groups","events","watch","marketplace","profile.php","stories","reel","reels",
  "business","help","policies","terms","privacy","ads","adsmanager","careers","about",
  "settings","login","recover","gaming","creator","creators","fundraisers","jobs",
  "messages","notifications","saved","memories","friends","games","weather","crisisresponse",
  "lite","mobile","l.php","sharer","sharer.php","plugins","dialog","oauth","tr","tr.php",
  "support","legal","brand","brandresources","newsroom","community","ai","meta",
]);

function isLikelyPersonName(name) {
  if (!name) return false;
  const s = name.trim();
  if (s.length < 3 || s.length > 60) return false;
  // Reject anything that looks like a UI label, generic page name, or contains digits/symbols heavy
  if (/^(Like|Follow|Share|See more|See all|Message|متابعة|إعجاب|مشاركة|عرض الكل|رسالة)$/i.test(s)) return false;
  if (/[#@<>{}|]/.test(s)) return false;
  // Must contain at least one letter (Latin or Arabic)
  if (!/[A-Za-z\u0600-\u06FF]/.test(s)) return false;
  return true;
}

async function scrollAndCollect(page, cap) {
  const seen = new Map();
  let emptyScrolls = 0;
  for (let i = 0; i < 120 && seen.size < cap && emptyScrolls < 4; i++) {
    const batch = await page.evaluate(() => {
      const out = [];
      const links = Array.from(document.querySelectorAll(
        'a[href*="facebook.com/profile.php"], a[href^="/"][role="link"], a[href^="https://www.facebook.com/"][role="link"]'
      ));
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        const name = (a.textContent || "").trim();
        if (!name) continue;
        let id = null;
        let kind = null;
        const m1 = href.match(/profile\.php\?id=(\d+)/);
        if (m1) { id = m1[1]; kind = "numeric"; }
        else {
          const slug = href.match(/facebook\.com\/([A-Za-z0-9._-]+)(?:\/|$|\?)/) ||
                       href.match(/^\/([A-Za-z0-9._-]+)(?:\/|$|\?)/);
          if (slug) { id = slug[1]; kind = "slug"; }
        }
        if (!id) continue;
        const profile = href.startsWith("http") ? href.split("?")[0] : `https://www.facebook.com${href.split("?")[0]}`;
        out.push({ id, name, profile, kind });
      }
      return out;
    });
    let newCount = 0;
    for (const m of batch) {
      // Filter: drop system slugs, require person-like names
      if (m.kind === "slug" && FB_SYSTEM_SLUGS.has(m.id.toLowerCase())) continue;
      if (m.kind === "slug" && /^\d+$/.test(m.id) === false && m.id.length < 4) continue;
      if (!isLikelyPersonName(m.name)) continue;
      if (!seen.has(m.id)) { seen.set(m.id, { id: m.id, name: m.name, profile: m.profile }); newCount++; }
      if (seen.size >= cap) break;
    }
    if (newCount === 0) emptyScrolls++; else emptyScrolls = 0;
    await page.evaluate(() => window.scrollBy(0, 1800));
    await new Promise(r => setTimeout(r, rand(2000, 4000)));
  }
  return Array.from(seen.values());
}


async function runExtractPageAudience({ page, job, report }) {
  const { pageId, sources = ["followers", "likers"], maxItems = 1500 } = job.payload || {};
  if (!pageId) {
    await report({ status: "failed", errorMessage: "Missing pageId in payload" });
    return;
  }
  const cap = Math.min(Math.max(50, Number(maxItems) || 1500), 3000);
  const totalCollected = new Map();

  const tasks = [];
  if (sources.includes("followers")) tasks.push({ src: "page_followers", url: `https://www.facebook.com/${pageId}/followers` });
  if (sources.includes("likers"))    tasks.push({ src: "page_likers",    url: `https://www.facebook.com/${pageId}/likes` });

  for (const task of tasks) {
    if (totalCollected.size >= cap) break;
    try {
      await page.goto(task.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await new Promise(r => setTimeout(r, 4000));
      const remaining = cap - totalCollected.size;
      const found = await scrollAndCollect(page, remaining);
      for (const m of found) {
        if (totalCollected.has(m.id)) continue;
        totalCollected.set(m.id, m);
        await report({
          result: {
            target: m.id,
            status: "success",
            data: {
              fb_user_id: m.id,
              name: m.name,
              profile_url: m.profile,
              source: task.src,
              source_id: pageId,
            },
          },
        });
      }
      await report({
        progress: Math.min(99, Math.round((totalCollected.size / cap) * 100)),
        processedItems: totalCollected.size,
        totalItems: cap,
        status: "running",
      });
    } catch (err) {
      console.error(`[extract-page-audience] ${task.src} failed`, err.message);
    }
  }

  // Engagers — open the page wall and harvest reactors of the most recent posts
  if (sources.includes("engagers") && totalCollected.size < cap) {
    try {
      await page.goto(`https://www.facebook.com/${pageId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await new Promise(r => setTimeout(r, 4000));
      // Just scroll the wall and parse profile-like links — quick & robust fallback
      const remaining = cap - totalCollected.size;
      const found = await scrollAndCollect(page, remaining);
      for (const m of found) {
        if (totalCollected.has(m.id)) continue;
        totalCollected.set(m.id, m);
        await report({
          result: {
            target: m.id,
            status: "success",
            data: {
              fb_user_id: m.id,
              name: m.name,
              profile_url: m.profile,
              source: "page_engagers",
              source_id: pageId,
            },
          },
        });
      }
    } catch (err) {
      console.error("[extract-page-audience] engagers failed", err.message);
    }
  }

  await report({
    progress: 100,
    processedItems: totalCollected.size,
    totalItems: totalCollected.size,
    status: "completed",
  });
}

module.exports = { runExtractPageAudience };
