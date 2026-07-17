const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runExtractPages({ page, report }) {
  const urls = [
    "https://www.facebook.com/pages/manage",
    "https://www.facebook.com/pages/?category=your_pages",
    "https://www.facebook.com/bookmarks/pages",
    "https://www.facebook.com/profile.php?sk=pages",
    "https://www.facebook.com/pages/",
  ];

  const collected = new Map();
  let openedAny = false;
  let lastUrl = "";

  await report({ progress: 15, processedItems: 0, totalItems: 0 });

  for (let urlIdx = 0; urlIdx < urls.length; urlIdx++) {
    const url = urls[urlIdx];
    lastUrl = url;
    // Advance a base progress per URL so the bar keeps moving even when no
    // page has been discovered yet on a given surface. Each surface adds ~8%.
    const surfaceBase = Math.min(70, 20 + urlIdx * 8);
    await report({ progress: surfaceBase, processedItems: collected.size, totalItems: collected.size });
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      openedAny = true;
    } catch (e) {
      continue;
    }

      await sleep(2500);
      if (/\/login(?:\/|\?|$)|checkpoint|two_factor|two_step_verification/i.test(page.url())) {
      await report({ status: "failed", errorMessage: "SESSION_EXPIRED: حساب فيسبوك حوّلك لتسجيل الدخول أو checkpoint. أعد ربط الكوكيز." });
      return;
    }

    let lastHeight = 0;
    let idle = 0;
    for (let i = 0; i < 18 && idle < 4; i++) {
      const batch = await page.evaluate(() => {
        const systemSlugs = new Set([
          "pages", "groups", "events", "watch", "marketplace", "friends", "messages", "notifications",
          "bookmarks", "gaming", "help", "privacy", "policies", "settings", "login", "recover", "me",
          "profile.php", "photo", "photo.php", "story.php", "permalink.php", "ads", "business",
        ]);
          const genericLabels = /^(Pages|Your Pages|Create|Manage|Home|About|Photos|Videos|Posts|Following|Followers|Like|Share|Comment|More|See more|View page|الصفحات|صفحاتك|إنشاء|إدارة|الرئيسية|حول|الصور|الفيديوهات|المنشورات|متابعة|المتابعون|إعجاب|مشاركة|تعليق|عرض المزيد|عرض الصفحة)$/i;
        const out = [];
        const anchors = Array.from(document.querySelectorAll('a[role="link"], a[href*="facebook.com"], a[href^="/"]'));
        for (const a of anchors) {
          const rawHref = a.getAttribute("href") || "";
          if (!rawHref || rawHref.startsWith("#")) continue;
          let href;
          try {
            href = new URL(rawHref, location.origin).toString();
          } catch {
            continue;
          }
          let parsed;
          try { parsed = new URL(href); } catch { continue; }
          if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) continue;
          if (/\/groups\/|\/events\/|\/posts\/|\/videos\/|\/reel\/|\/stories\/|\/photo\.php|\/permalink\.php|\/story\.php|\/login\//i.test(parsed.pathname)) continue;

          const profileId = parsed.pathname === "/profile.php" ? parsed.searchParams.get("id") : null;
          const numericId =
            profileId ||
            parsed.pathname.match(/\/(\d{6,})(?:\/|$)/)?.[1] ||
            parsed.pathname.match(/-(\d{6,})(?:\/|$)/)?.[1];

          const firstSlug = parsed.pathname.split("/").filter(Boolean)[0] || "";
          const slug = firstSlug && !systemSlugs.has(firstSlug.toLowerCase()) && /^[A-Za-z0-9._-]{3,}$/.test(firstSlug)
            ? firstSlug
            : "";
          const id = numericId || slug;
          if (!id) continue;

          const imgAlt = a.querySelector("img[alt]")?.getAttribute("alt") || "";
          const aria = a.getAttribute("aria-label") || "";
          const lines = (a.textContent || "")
            .split(/\n|\s{2,}/)
            .map((s) => s.trim())
            .filter(Boolean);
          const name = [imgAlt, aria, ...lines]
            .map((s) => s.replace(/^(Open|Visit|Go to|عرض|فتح)\s+/i, "").trim())
            .find((s) => s.length >= 2 && s.length <= 120 && /[A-Za-z\u0600-\u06FF]/.test(s) && !genericLabels.test(s));

          if (!name) continue;
          const avatar = a.querySelector("img[src]")?.getAttribute("src") || null;
          out.push({ id, name, link: href.split("?")[0], avatar_url: avatar });
        }
        return out;
      });

      let added = 0;
      for (const p of batch) {
        if (collected.has(p.id)) continue;
        collected.set(p.id, p);
        added += 1;
        await report({
          result: { target: p.id, status: "success", data: p },
          processedItems: collected.size,
          totalItems: collected.size,
          progress: Math.min(95, 5 + collected.size * 8),
        });
      }

      const height = await page.evaluate(() => document.body.scrollHeight).catch(() => lastHeight);
      idle = added === 0 && height === lastHeight ? idle + 1 : 0;
      lastHeight = height;
      await page.evaluate(() => window.scrollBy(0, Math.max(1200, window.innerHeight * 1.2))).catch(() => {});
      await sleep(1600);
    }

    // Do not stop at the first URL: Facebook often shows only a partial list
    // in one surface and the remaining managed pages in another.
  }

  if (!openedAny) {
    await report({ status: "failed", errorMessage: "تعذر فتح صفحات فيسبوك من المتصفح." });
    return;
  }

  if (collected.size === 0) {
    await report({
      status: "failed",
      errorMessage: `لم يعثر البوت على صفحات داخل حساب فيسبوك. آخر مسار تم فحصه: ${lastUrl}`,
      processedItems: 0,
      totalItems: 0,
      progress: 100,
    });
    return;
  }

  await report({
    progress: 100,
    processedItems: collected.size,
    totalItems: collected.size,
    status: "completed",
  });
}

module.exports = { runExtractPages };
