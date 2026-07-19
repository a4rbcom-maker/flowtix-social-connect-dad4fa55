// Lists Facebook Pages the logged-in user manages, using the cookies session.
// Emits one fb_job_results row per page (target=NUMERIC pageId, data={id,name,avatar_url}).
// Facebook often renders page links as slugs and “profile picture of …” anchors;
// those are not safe for Messenger inbox routing. We therefore resolve every
// candidate to the real numeric Page ID before returning it to the app.

function cleanPageName(name) {
  return String(name || "")
    .replace(/^\s*صورة\s+ملف\s+/u, "")
    .replace(/\s+الشخصية?$/u, "")
    .replace(/^\s*Profile\s+picture\s+of\s+/iu, "")
    .replace(/'s\s+profile\s+picture$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Ad/boost UI labels that Facebook renders next to real pages when the
// cookies session has ads_management scope. These are NOT page names.
const AD_LABEL_RE = /^(ترويج|روّج|روج|إعلان|اعلان|الإعلانات?|الاعلانات?|promote|boost|ad|ads|advertise|sponsor(ed)?|create ad)$/i;

function isAdLabel(name) {
  return AD_LABEL_RE.test(String(name || "").trim());
}

function isReservedFacebookPath(value) {
  return /^(help|marketplace|watch|gaming|groups|events|pages|business|ads|settings|notifications|messages|friends|bookmarks|policies|privacy|terms|login|checkpoint|reg|profile\.php)$/i.test(value);
}

async function extractPageCandidatesFromDom(page) {
  return page.evaluate(() => {
    const seen = new Map();
    const cards = Array.from(document.querySelectorAll('a[href*="facebook.com/"], a[href^="/"]'));
    for (const a of cards) {
      const href = a.getAttribute("href") || "";
      const hover = a.getAttribute("data-hovercard") || a.getAttribute("data-hovercard-prefer-more-content-show") || "";
      const html = a.outerHTML || "";
      const directId =
        href.match(/[?&](?:id|page_id|profile_id)=(\d{5,})/)?.[1] ||
        hover.match(/[?&](?:id|page_id|profile_id)=(\d{5,})/)?.[1] ||
        html.match(/\/(?:pages\/[^/]+\/|profile\.php\?id=)(\d{5,})/)?.[1] ||
        html.match(/"(?:pageID|page_id|profile_id)"\s*:\s*"?(\d{5,})"?/)?.[1] ||
        "";

      let slug = "";
      if (!directId) {
        const m1 = href.match(/facebook\.com\/([A-Za-z0-9.\-_]{3,80})(?:[/?#]|$)/);
        const m2 = !m1 ? href.match(/^\/([A-Za-z0-9.\-_]{3,80})(?:[/?#]|$)/) : null;
        slug = (m1 || m2)?.[1] || "";
      }

      const idOrSlug = directId || slug;
      if (!idOrSlug) continue;
      if (/^(help|marketplace|watch|gaming|groups|events|pages|business|ads|settings|notifications|messages|friends|bookmarks|policies|privacy|terms|login|checkpoint|reg|profile\.php)$/i.test(idOrSlug)) continue;
      const name = (a.innerText || a.getAttribute("aria-label") || "").trim().split("\n")[0];
      if (!name || name.length < 2 || name.length > 200) continue;
      // Try to find an <img> inside the card container.
      const img = a.querySelector("img") || a.closest("[role='listitem'], li, div")?.querySelector("img");
      const avatar = img?.getAttribute("src") || null;
      const key = String(idOrSlug);
      if (!seen.has(key)) seen.set(key, { idOrSlug: key, href, name, avatar_url: avatar });
    }
    return Array.from(seen.values());
  });
}

// Visits the candidate's page URL and returns { id, name, avatar } from
// og:title / document.title / og:image so we get the REAL page name instead
// of whatever ad-button / "profile picture of …" text the sidebar rendered.
async function resolvePageMeta(page, candidate) {
  const idOrSlug = String(candidate.idOrSlug || "").trim();
  if (!idOrSlug || isReservedFacebookPath(idOrSlug)) return null;

  const target = candidate.href
    ? (() => {
        try { return new URL(candidate.href, "https://www.facebook.com").href; }
        catch (_) { return `https://www.facebook.com/${encodeURIComponent(idOrSlug)}`; }
      })()
    : `https://www.facebook.com/${encodeURIComponent(idOrSlug)}`;

  try {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 20_000 });
    if (/\/login|checkpoint/i.test(page.url())) return null;
    const meta = await page.evaluate(() => {
      const html = document.documentElement.innerHTML || "";
      const idPatterns = [
        /"pageID"\s*:\s*"?(\d{5,})"?/,
        /"page_id"\s*:\s*"?(\d{5,})"?/,
        /"profile_id"\s*:\s*"?(\d{5,})"?/,
        /"entity_id"\s*:\s*"?(\d{5,})"?/,
        /fb:\/\/page\/\?id=(\d{5,})/,
        /[?&](?:page_id|profile_id|id)=(\d{5,})/,
      ];
      let id = null;
      for (const re of idPatterns) {
        const m = html.match(re);
        if (m?.[1]) { id = m[1]; break; }
      }
      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
      const docTitle = (document.title || "").replace(/\s*[|\-–]\s*Facebook.*$/i, "").trim();
      const name = (ogTitle || docTitle || "").trim();
      const ogImg = document.querySelector('meta[property="og:image"]')?.getAttribute("content") || null;
      return { id, name, avatar: ogImg };
    });
    const numericId = /^\d{5,}$/.test(idOrSlug) ? idOrSlug : meta?.id;
    if (!numericId) return null;
    return { id: numericId, name: cleanPageName(meta?.name || ""), avatar: meta?.avatar || null };
  } catch (_) {
    return null;
  }
}

// A name is "trustworthy" only if it isn't an ad button label and isn't the
// generic "profile picture of …" placeholder Facebook renders on avatars.
function isTrustedName(name) {
  const n = String(name || "").trim();
  if (!n || n.length < 2) return false;
  if (isAdLabel(n)) return false;
  if (/profile\s+picture/i.test(n)) return false;
  if (/^\s*صورة\s+ملف/u.test(n)) return false;
  return true;
}

async function runMessengerListPages({ page, job, report }) {
  // Only hit the primary "Your Pages" URL first. Fall back to the other URLs
  // ONLY if the first one returned nothing. Previously we always visited all
  // three URLs even when the first one already had every page.
  const urls = [
    "https://www.facebook.com/pages/?category=your_pages",
    "https://www.facebook.com/bookmarks/pages",
  ];
  let all = [];
  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await new Promise((r) => setTimeout(r, 2500));
      for (let i = 0; i < 2; i += 1) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await new Promise((r) => setTimeout(r, 900));
      }
      const found = await extractPageCandidatesFromDom(page);
      if (found.length) all = all.concat(found);
      if (all.length >= 3) break; // enough — stop hitting more URLs
    } catch (e) {
      console.warn("[messenger_list_pages] nav failed", url, e.message);
    }
  }

  // Split candidates: direct numeric IDs are trusted immediately (no extra
  // navigation). Slug-only candidates need resolution and are capped tightly.
  const directs = [];
  const slugs = [];
  const seenKeys = new Set();
  for (const p of all) {
    const key = String(p.idOrSlug || "").trim();
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    if (/^\d{5,}$/.test(key)) directs.push(p);
    else if (!isReservedFacebookPath(key)) slugs.push(p);
  }

  const pagesMap = new Map();
  const needsResolve = [];
  for (const c of directs) {
    const name = cleanPageName(c.name);
    if (isTrustedName(name)) {
      pagesMap.set(c.idOrSlug, { id: c.idOrSlug, name, avatar_url: c.avatar_url || null });
    } else {
      // Direct numeric ID but the DOM name is an ad button / "profile picture
      // of …" placeholder — visit the page URL to grab the real og:title.
      needsResolve.push(c);
    }
  }
  await report({ progress: 30 });

  // Cap navigation-based resolution so the job stays under a minute.
  const resolveCap = 20;
  const candidates = needsResolve.concat(slugs).slice(0, resolveCap);
  let checked = 0;
  for (const candidate of candidates) {
    checked += 1;
    const meta = await resolvePageMeta(page, candidate);
    await report({ progress: Math.min(90, 30 + Math.round((checked / Math.max(candidates.length, 1)) * 60)) });
    if (!meta?.id || !isTrustedName(meta.name)) continue;
    if (!pagesMap.has(meta.id)) {
      pagesMap.set(meta.id, { id: meta.id, name: meta.name, avatar_url: meta.avatar || candidate.avatar_url || null });
    }
  }
  const pages = Array.from(pagesMap.values());


  if (pages.length === 0) {
    await report({ status: "failed", errorMessage: "لم يتم العثور على صفحات مدارة باسم صالح. تأكد أن الحساب مسؤول عن الصفحة وأن صفحة Facebook تفتح بدون Checkpoint." });
    return;
  }
  let done = 0;
  for (const p of pages) {
    await report({
      result: { target: p.id, status: "success", data: p },
      processedItems: ++done,
      totalItems: pages.length,
      progress: Math.min(99, Math.round((done / pages.length) * 100)),
    });
  }
  await report({ status: "completed", processedItems: done, totalItems: pages.length, progress: 100 });
}

module.exports = { runMessengerListPages };
