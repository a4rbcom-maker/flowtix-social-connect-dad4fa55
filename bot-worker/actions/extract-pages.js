async function runExtractPages({ page, report }) {
  await page.goto("https://www.facebook.com/pages/?category=your_pages", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await new Promise(r => setTimeout(r, 4000));

  // Scroll to load all
  let lastH = 0;
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollBy(0, 1500));
    await new Promise(r => setTimeout(r, 1500));
    const h = await page.evaluate(() => document.body.scrollHeight);
    if (h === lastH) break;
    lastH = h;
  }

  const pages = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('a[href*="/pages/"], a[href*="facebook.com/"][role="link"]'));
    const map = new Map();
    for (const a of items) {
      const href = a.getAttribute("href") || "";
      const m = href.match(/\/(\d{6,})\/?/);
      if (m) {
        const id = m[1];
        const name = a.textContent?.trim() || "";
        if (!map.has(id) && name) map.set(id, { id, name, link: href });
      }
    }
    return Array.from(map.values());
  });

  for (const p of pages) {
    await report({ result: { target: p.id, status: "success", data: p } });
  }
  await report({
    progress: 100,
    processedItems: pages.length,
    status: "completed",
  });
}

module.exports = { runExtractPages };
