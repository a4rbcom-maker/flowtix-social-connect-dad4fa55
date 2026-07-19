// Lists Facebook Pages the logged-in user manages.
// API-first: extract the Business/Graph token from the authenticated session,
// then trust /me/accounts only. We deliberately do NOT scrape page cards from
// Facebook DOM because that produced fake rows such as "Facebook" / ad targets.

const {
  extractGraphTokenFromSession,
  listManagedPagesFromGraph,
  emitPipelineLog,
  shortError,
} = require("./messenger-stable-pipeline");

function cleanPageName(name) {
  return String(name || "")
    .replace(/\s*\(\+?\d+\)\s*$/u, "") // strip trailing "(+20)" count badges
    .replace(/^\s*صورة\s+ملف\s+/u, "")
    .replace(/\s+الشخصية?$/u, "")
    .replace(/^\s*Profile\s+picture\s+of\s+/iu, "")
    .replace(/'s\s+profile\s+picture$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Ad/boost/CTA UI labels Facebook renders next to real pages when the
// cookies session has ads_management scope. These are NEVER page names.
const AD_LABEL_RE = /^(ترويج|روّج|روج|إعلان|اعلان|الإعلانات?|الاعلانات?|اختيار\s+هدف|اختر\s+هدف|اختر\s+جمهور[كا]?|حدد\s+الجمهور|جمهور\s+مخصص|اختيار\s+الجمهور|إنشاء\s+إعلان|انشاء\s+اعلان|جلب\s+العملاء|promote|boost|ad|ads|advertise|sponsor(ed)?|create ad|choose (an )?audience|select (an )?audience|choose (a )?goal|select (a )?goal|pick (an )?audience|target audience)$/i;

function isAdLabel(name) {
  const bare = String(name || "").replace(/\s*\(\+?\d+\)\s*$/u, "").trim();
  return AD_LABEL_RE.test(bare);
}

// Anchors pointing at these paths are ad-manager CTAs, not page links.
const AD_HREF_RE = /\/(ads|adsmanager|ad_center|business\/(ads|adsmanager|creativehub)|latest\/ads|ad_campaign)/i;

function isReservedFacebookPath(value) {
  return /^(help|marketplace|watch|gaming|groups|events|pages|business|ads|settings|notifications|messages|friends|bookmarks|policies|privacy|terms|login|checkpoint|reg|profile\.php)$/i.test(value);
}

async function extractPageCandidatesFromDom(page) {
  return page.evaluate(() => {
    const AD_HREF = /\/(ads|adsmanager|ad_center|business\/(ads|adsmanager|creativehub)|latest\/ads|ad_campaign)/i;
    const seen = new Map();
    const cards = Array.from(document.querySelectorAll('a[href*="facebook.com/"], a[href^="/"]'));
    for (const a of cards) {
      const href = a.getAttribute("href") || "";
      const hover = a.getAttribute("data-hovercard") || a.getAttribute("data-hovercard-prefer-more-content-show") || "";
      const html = a.outerHTML || "";
      const isAdHref = AD_HREF.test(href);
      const directId =
        href.match(/[?&](?:id|page_id|profile_id)=(\d{5,})/)?.[1] ||
        hover.match(/[?&](?:id|page_id|profile_id)=(\d{5,})/)?.[1] ||
        html.match(/\/(?:pages\/[^/]+\/|profile\.php\?id=)(\d{5,})/)?.[1] ||
        html.match(/"(?:pageID|page_id|profile_id)"\s*:\s*"?(\d{5,})"?/)?.[1] ||
        "";

      let slug = "";
      if (!directId && !isAdHref) {
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
      const entry = { idOrSlug: key, href, name, avatar_url: avatar, isAdHref };
      // Prefer non-ad-href entries when we've seen this ID before.
      const prev = seen.get(key);
      if (!prev || (prev.isAdHref && !isAdHref)) seen.set(key, entry);
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

  // For numeric IDs, always resolve via facebook.com/{id} — never follow the
  // candidate.href because that may point at ads-manager / boost CTAs which
  // render "Choose target audience" instead of the real page name.
  const isNumeric = /^\d{5,}$/.test(idOrSlug);
  const target = isNumeric
    ? `https://www.facebook.com/${idOrSlug}`
    : candidate.href
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
  await report({ status: "running", progress: 10 });
  let token;
  try {
    const extracted = await extractGraphTokenFromSession(page, report);
    token = extracted.token;
  } catch (error) {
    await emitPipelineLog(report, "token_extract", "failed", "فشل استخراج توكن الجلسة", { error: shortError(error) });
  }

  if (!token) {
    await report({
      status: "failed",
      errorMessage: "لم نستطع قراءة صفحاتك من فيسبوك. الجلسة لا توفر صلاحية Graph حالياً؛ أعد ربط الحساب ثم جرّب مرة أخرى.",
      progress: 100,
    });
    return;
  }

  let pages;
  try {
    await report({ progress: 35 });
    pages = await listManagedPagesFromGraph(token, report);
  } catch (error) {
    await report({
      status: "failed",
      errorMessage: `فشل جلب الصفحات من فيسبوك: ${shortError(error)}`,
      progress: 100,
    });
    return;
  }

  let done = 0;
  for (const p of pages) {
    await report({
      result: {
        target: p.id,
        status: "success",
        data: {
          id: p.id,
          name: p.name,
          avatar_url: p.avatar_url,
          category: p.category,
          tasks: p.tasks,
          source: "graph_api",
        },
      },
      processedItems: ++done,
      totalItems: pages.length,
      progress: Math.min(99, Math.round((done / pages.length) * 100)),
    });
  }
  await report({ status: "completed", processedItems: done, totalItems: pages.length, progress: 100 });
}

module.exports = { runMessengerListPages };
