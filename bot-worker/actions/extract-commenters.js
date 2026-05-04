async function runExtractCommenters({ page, job, report }) {
  const { postUrl } = job.payload;
  await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(5000);

  // Click "View more comments" repeatedly + scroll
  for (let i = 0; i < 30; i++) {
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="button"]'));
      const target = btns.find((b) => /more comments|previous comments|عرض المزيد|التعليقات السابقة/i.test(b.textContent || ""));
      if (target) { target.click(); return true; }
      return false;
    });
    await page.waitForTimeout(2000);
    if (!clicked) {
      await page.evaluate(() => window.scrollBy(0, 1500));
      await page.waitForTimeout(1500);
    }
  }

  const commenters = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/user/"], a[href*="facebook.com/profile.php"], a[role="link"][href*="facebook.com/"]'));
    const out = new Map();
    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const name = a.textContent?.trim() || "";
      if (!name || name.length < 2 || name.length > 80) continue;
      let id = null;
      const idM = href.match(/(?:user\/|profile\.php\?id=)(\d+)/);
      if (idM) id = idM[1];
      else {
        const slugM = href.match(/facebook\.com\/([A-Za-z0-9._-]+)(?:\/|$|\?)/);
        if (slugM) id = slugM[1];
      }
      if (id && !out.has(id)) out.set(id, { id, name, profile: href.split("?")[0] });
    }
    return Array.from(out.values());
  });

  for (const c of commenters) {
    await report({ result: { target: c.id, status: "success", data: c } });
  }
  await report({
    progress: 100,
    processedItems: commenters.length,
    status: "completed",
  });
}

module.exports = { runExtractCommenters };
