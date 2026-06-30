// Lists the Facebook groups the logged-in account has joined.
// Strategy: open /groups/joins (joined groups tab), progressively scroll,
// parse group links of shape /groups/{id_or_slug}/.

async function runListMyGroups({ page, job, report }) {
  const cap = Math.min(Math.max(20, Number(job.payload?.max) || 500), 2000);

  const urls = [
    "https://www.facebook.com/groups/joins/",
    "https://www.facebook.com/groups/feed/",
  ];

  let lastErr = null;
  let opened = false;
  for (const u of urls) {
    try {
      await page.goto(u, { waitUntil: "domcontentloaded", timeout: 60_000 });
      opened = true;
      break;
    } catch (e) { lastErr = e; }
  }
  if (!opened) {
    await report({ status: "failed", errorMessage: `Failed to open groups page: ${lastErr?.message || lastErr}` });
    return;
  }
  await new Promise(r => setTimeout(r, 5000));

  // Quick sanity: detect login redirect.
  const curUrl = page.url();
  if (/\/login\/|checkpoint/i.test(curUrl)) {
    await report({ status: "failed", errorMessage: "Session not logged in (redirected to login/checkpoint)" });
    return;
  }

  const seen = new Map(); // id -> { id, name, url }
  let emptyScrolls = 0;
  const maxScrolls = 80;

  await report({ progress: 5, processedItems: 0 });

  for (let i = 0; i < maxScrolls && seen.size < cap && emptyScrolls < 5; i++) {
    const batch = await page.evaluate(() => {
      const out = [];
      const anchors = Array.from(document.querySelectorAll('a[href*="/groups/"]'));
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        const m = href.match(/\/groups\/([A-Za-z0-9._-]+)\/?(?:$|\?|#)/);
        if (!m) continue;
        const id = m[1];
        if (["joins", "feed", "discover", "create", "category"].includes(id)) continue;
        const name = (a.textContent || "").trim();
        if (!name || name.length < 2 || name.length > 120) continue;
        out.push({ id, name, url: `https://www.facebook.com/groups/${id}` });
      }
      return out;
    });

    let added = 0;
    for (const g of batch) {
      if (seen.has(g.id)) continue;
      seen.set(g.id, g);
      added++;
      if (seen.size >= cap) break;
      await report({
        result: { target: g.id, status: "success", data: { name: g.name, url: g.url } },
        processedItems: seen.size,
        progress: Math.min(95, 5 + Math.round((seen.size / cap) * 90)),
      });
    }
    emptyScrolls = added === 0 ? emptyScrolls + 1 : 0;

    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
    await new Promise(r => setTimeout(r, 1500 + Math.floor(Math.random() * 1500)));
  }

  await report({
    status: "completed",
    processedItems: seen.size,
    totalItems: seen.size,
    progress: 100,
  });
}

module.exports = { runListMyGroups };
