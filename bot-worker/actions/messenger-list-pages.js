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

async function resolveNumericPageId(page, candidate) {
  const idOrSlug = String(candidate.idOrSlug || "").trim();
  if (/^\d{5,}$/.test(idOrSlug)) return idOrSlug;
  if (!idOrSlug || isReservedFacebookPath(idOrSlug)) return null;

  const urls = [];
  if (candidate.href) {
    try {
      urls.push(new URL(candidate.href, "https://www.facebook.com").href);
    } catch (_) {
      // ignore malformed href
    }
  }
  urls.push(
    `https://www.facebook.com/${encodeURIComponent(idOrSlug)}`,
    `https://www.facebook.com/${encodeURIComponent(idOrSlug)}/about_profile_transparency`,
    `https://www.facebook.com/${encodeURIComponent(idOrSlug)}/about`,
  );

  const uniqueUrls = Array.from(new Set(urls));
  for (const url of uniqueUrls) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await new Promise((r) => setTimeout(r, 2000));
      if (/\/login|checkpoint/i.test(page.url())) continue;

      const found = await page.evaluate(() => {
        const html = document.documentElement.innerHTML || "";
        const patterns = [
          /"pageID"\s*:\s*"?(\d{5,})"?/,
          /"page_id"\s*:\s*"?(\d{5,})"?/,
          /"profile_id"\s*:\s*"?(\d{5,})"?/,
          /"entity_id"\s*:\s*"?(\d{5,})"?/,
          /"delegate_page_id"\s*:\s*"?(\d{5,})"?/,
          /"associated_page_id"\s*:\s*"?(\d{5,})"?/,
          /fb:\/\/page\/\?id=(\d{5,})/,
          /[?&](?:page_id|profile_id|id)=(\d{5,})/,
        ];
        for (const re of patterns) {
          const m = html.match(re);
          if (m?.[1]) return m[1];
        }
        const metas = Array.from(document.querySelectorAll("meta[content]")).map((m) => m.getAttribute("content") || "");
        for (const content of metas) {
          const m = content.match(/(?:fb:\/\/page\/\?id=|[?&](?:page_id|profile_id|id)=)(\d{5,})/);
          if (m?.[1]) return m[1];
        }
        return null;
      });
      if (found && /^\d{5,}$/.test(found)) return found;
    } catch (_) {
      // try next URL
    }
  }
  return null;
}

async function runMessengerListPages({ page, job, report }) {
  const urls = [
    "https://www.facebook.com/pages/?category=your_pages",
    "https://www.facebook.com/bookmarks/pages",
    "https://www.facebook.com/me/allactivity?category_key=pagesadmin",
  ];
  let all = [];
  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await new Promise((r) => setTimeout(r, 4000));
      // Scroll to force lazy list to render.
      for (let i = 0; i < 4; i += 1) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await new Promise((r) => setTimeout(r, 1500));
      }
      const found = await extractPageCandidatesFromDom(page);
      if (found.length) all = all.concat(found);
      if (all.length >= 5) break;
    } catch (e) {
      console.warn("[messenger_list_pages] nav failed", url, e.message);
    }
  }
  // De-dup candidates, then resolve slugs to numeric Page IDs.
  const candidatesMap = new Map();
  for (const p of all) {
    const key = String(p.idOrSlug || "").trim();
    if (key && !candidatesMap.has(key)) candidatesMap.set(key, p);
  }

  const pagesMap = new Map();
  const candidates = Array.from(candidatesMap.values()).slice(0, 40);
  let checked = 0;
  for (const candidate of candidates) {
    checked += 1;
    const numericId = await resolveNumericPageId(page, candidate);
    await report({ progress: Math.min(90, Math.round((checked / Math.max(candidates.length, 1)) * 90)) });
    if (!numericId) continue;
    const name = cleanPageName(candidate.name);
    if (!name || name.length < 2) continue;
    if (!pagesMap.has(numericId)) {
      pagesMap.set(numericId, { id: numericId, name, avatar_url: candidate.avatar_url || null });
    }
  }
  const pages = Array.from(pagesMap.values());

  if (pages.length === 0) {
    await report({ status: "failed", errorMessage: "لم يتم العثور على صفحات مدارة بمعرّف رقمي صالح. تأكد أن الحساب مسؤول عن الصفحة وأن صفحة Facebook نفسها تفتح بدون Checkpoint." });
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
