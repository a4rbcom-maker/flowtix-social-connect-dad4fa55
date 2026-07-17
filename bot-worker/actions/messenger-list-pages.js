// Lists Facebook Pages the logged-in user manages, using the cookies session.
// Emits one fb_job_results row per page (target=pageId, data={id,name,avatar_url}).
async function extractPagesFromDom(page) {
  return page.evaluate(() => {
    const seen = new Map();
    const cards = Array.from(document.querySelectorAll('a[href*="facebook.com/"], a[href^="/"]'));
    for (const a of cards) {
      const href = a.getAttribute("href") || "";
      // Match /<slug> or /?id=<id> or /profile.php?id=<id> style page links.
      const m1 = href.match(/facebook\.com\/(?:pages\/[^/]+\/(\d{5,})|profile\.php\?id=(\d{5,})|([A-Za-z0-9.\-_]{3,80}))(?:\/?$|\?)/);
      const m2 = !m1 ? href.match(/^\/(?:pages\/[^/]+\/(\d{5,})|profile\.php\?id=(\d{5,})|([A-Za-z0-9.\-_]{3,80}))(?:\/?$|\?)/) : null;
      const m = m1 || m2;
      if (!m) continue;
      const idOrSlug = m[1] || m[2] || m[3];
      if (!idOrSlug) continue;
      // Skip obvious non-page routes.
      if (/^(help|marketplace|watch|gaming|groups|events|pages|business|ads|settings|notifications|messages|friends|bookmarks|policies|privacy|terms|login|checkpoint|reg)$/i.test(idOrSlug)) continue;
      const name = (a.innerText || a.getAttribute("aria-label") || "").trim().split("\n")[0];
      if (!name || name.length < 2 || name.length > 200) continue;
      // Try to find an <img> inside the card container.
      const img = a.querySelector("img") || a.closest("[role='listitem'], li, div")?.querySelector("img");
      const avatar = img?.getAttribute("src") || null;
      const key = String(idOrSlug);
      if (!seen.has(key)) seen.set(key, { id: key, name, avatar_url: avatar });
    }
    return Array.from(seen.values());
  });
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
      const found = await extractPagesFromDom(page);
      if (found.length) all = all.concat(found);
      if (all.length >= 5) break;
    } catch (e) {
      console.warn("[messenger_list_pages] nav failed", url, e.message);
    }
  }
  // De-dup.
  const map = new Map();
  for (const p of all) if (p.id && !map.has(p.id)) map.set(p.id, p);
  const pages = Array.from(map.values());

  if (pages.length === 0) {
    await report({ status: "failed", errorMessage: "لم يتم العثور على أي صفحة مدارة بهذا الحساب. تأكد أنك مسؤول عن صفحة على فيسبوك." });
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
