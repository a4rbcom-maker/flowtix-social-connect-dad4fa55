const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE_SURFACES = [
  "https://www.facebook.com/pages/manage",
  "https://www.facebook.com/pages/?category=your_pages",
  "https://www.facebook.com/bookmarks/pages",
  "https://www.facebook.com/profile.php?sk=pages",
  "https://business.facebook.com/latest/home",
  "https://business.facebook.com/latest/pages",
  "https://www.facebook.com/pages/",
];

async function autoScroll(page, steps = 10) {
  let lastHeight = 0;
  let idle = 0;
  for (let i = 0; i < steps && idle < 4; i++) {
    const height = await page.evaluate(() => document.body?.scrollHeight || 0).catch(() => lastHeight);
    idle = height === lastHeight ? idle + 1 : 0;
    lastHeight = height;
    await page.evaluate(() => window.scrollBy(0, Math.max(1200, window.innerHeight * 1.2))).catch(() => {});
    await sleep(1400);
  }
}

function dedupePageCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const id = String(candidate.id || candidate.page_id || candidate.pageId || "").trim();
  const name = String(candidate.name || candidate.page_name || candidate.pageName || "").trim();
  if (!id || !name) return null;
  if (id.length < 3 || id.length > 120 || name.length < 2 || name.length > 200) return null;
  if (!/[A-Za-z\u0600-\u06FF]/.test(name)) return null;
  return {
    id,
    name,
    link: candidate.link || candidate.url || `https://www.facebook.com/${id}`,
    avatar_url: candidate.avatar_url || candidate.avatarUrl || null,
  };
}

async function collectFromRenderedPage(page) {
  return page.evaluate(() => {
    const systemSlugs = new Set([
      "pages", "groups", "events", "watch", "marketplace", "friends", "messages", "notifications",
      "bookmarks", "gaming", "help", "privacy", "policies", "settings", "login", "recover", "me",
      "profile.php", "photo", "photo.php", "story.php", "permalink.php", "ads", "business", "latest",
      "home", "notifications", "inbox", "content", "planner", "monetization", "settings", "billing",
    ]);
    const genericLabels = /^(Pages|Your Pages|Create|Manage|Home|About|Photos|Videos|Posts|Following|Followers|Like|Share|Comment|More|See more|View page|Switch|Meta Business Suite|Business Suite|Notifications|Inbox|الصفحات|صفحاتك|إنشاء|إدارة|الرئيسية|حول|الصور|الفيديوهات|المنشورات|متابعة|المتابعون|إعجاب|مشاركة|تعليق|عرض المزيد|عرض الصفحة|تبديل|الإشعارات|صندوق الوارد)$/i;
    const out = [];

    const cleanText = (value) => String(value || "")
      .replace(/\s+/g, " ")
      .replace(/^(Open|Visit|Go to|Switch into|Switch to|عرض|فتح|انتقال إلى|تبديل إلى)\s+/i, "")
      .trim();
    const validName = (value) => {
      const s = cleanText(value);
      return s.length >= 2 && s.length <= 120 && /[A-Za-z\u0600-\u06FF]/.test(s) && !genericLabels.test(s) ? s : "";
    };
    const parseHref = (rawHref) => {
      if (!rawHref || rawHref.startsWith("#") || /^javascript:/i.test(rawHref)) return null;
      let parsed;
      try { parsed = new URL(rawHref, location.origin); } catch { return null; }
      if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) return null;
      const assetId = parsed.searchParams.get("asset_id") || parsed.searchParams.get("page_id") || parsed.searchParams.get("id");
      if (assetId && /^\d{5,}$/.test(assetId)) return { id: assetId, href: parsed.toString().split("#")[0] };
      if (/\/groups\/|\/events\/|\/posts\/|\/videos\/|\/reel\/|\/stories\/|\/photo\.php|\/permalink\.php|\/story\.php|\/login\//i.test(parsed.pathname)) return null;
      const profileId = parsed.pathname === "/profile.php" ? parsed.searchParams.get("id") : null;
      const numericId = profileId || parsed.pathname.match(/\/(\d{6,})(?:\/|$)/)?.[1] || parsed.pathname.match(/-(\d{6,})(?:\/|$)/)?.[1];
      const firstSlug = parsed.pathname.split("/").filter(Boolean)[0] || "";
      const slug = firstSlug && !systemSlugs.has(firstSlug.toLowerCase()) && /^[A-Za-z0-9._-]{3,}$/.test(firstSlug) ? firstSlug : "";
      const id = numericId || slug;
      return id ? { id, href: parsed.toString().split("?")[0].split("#")[0] } : null;
    };

    const anchors = Array.from(document.querySelectorAll('a[role="link"], a[href*="facebook.com"], a[href^="/"], a[href*="asset_id="]'));
    for (const a of anchors) {
      const parsed = parseHref(a.getAttribute("href") || "");
      if (!parsed) continue;
      const container = a.closest('[role="listitem"], [role="article"], [data-pagelet], div[aria-label], div') || a;
      const imgAlt = a.querySelector("img[alt]")?.getAttribute("alt") || container.querySelector?.("img[alt]")?.getAttribute("alt") || "";
      const aria = a.getAttribute("aria-label") || "";
      const title = a.getAttribute("title") || "";
      const lines = [a.textContent, container.textContent]
        .flatMap((text) => String(text || "").split(/\n|\s{2,}/))
        .map(validName)
        .filter(Boolean);
      const name = [imgAlt, aria, title, ...lines].map(validName).find(Boolean);
      if (!name) continue;
      const avatar = a.querySelector("img[src]")?.getAttribute("src") || container.querySelector?.("img[src]")?.getAttribute("src") || null;
      out.push({ id: parsed.id, name, link: parsed.href, avatar_url: avatar });
    }
    return out;
  });
}

async function collectFromBootData(page) {
  return page.evaluate(() => {
    const out = [];
    const seen = new Set();
    const validName = (name) => {
      const s = String(name || "").replace(/\\u0025/g, "%").replace(/\s+/g, " ").trim();
      if (s.length < 2 || s.length > 160) return "";
      if (!/[A-Za-z\u0600-\u06FF]/.test(s)) return "";
      if (/^(Pages|Create|Manage|Home|Meta Business Suite|Business Suite|الصفحات|إنشاء|إدارة|الرئيسية)$/i.test(s)) return "";
      return s;
    };
    const push = (id, name, url, avatar) => {
      id = String(id || "").trim();
      name = validName(name);
      if (!id || !name || seen.has(id)) return;
      if (!/^\d{5,}$/.test(id) && !/^[A-Za-z0-9._-]{3,}$/.test(id)) return;
      seen.add(id);
      out.push({ id, name, link: url || `https://www.facebook.com/${id}`, avatar_url: avatar || null });
    };
    const safeJsonParse = (text) => {
      try { return JSON.parse(text); } catch { return null; }
    };
    const walk = (value, depth = 0) => {
      if (!value || depth > 12) return;
      if (Array.isArray(value)) {
        for (const item of value) walk(item, depth + 1);
        return;
      }
      if (typeof value !== "object") return;
      const obj = value;
      const type = String(obj.__typename || obj.__isNode || obj.type || "");
      const id = obj.id || obj.page_id || obj.pageID || obj.pageId || obj.asset_id || obj.assetID;
      const name = obj.name || obj.page_name || obj.title || obj.display_name || obj.profile_name;
      const url = obj.url || obj.uri || obj.profile_url || obj.page_url || obj.link;
      const picture = obj.profile_picture || obj.profilePicture || obj.image || obj.photo || obj.thumbnail;
      const avatar = typeof picture === "string" ? picture : (picture && (picture.uri || picture.url || picture.src));
      const looksLikePage = /Page/i.test(type) || obj.page_id || obj.pageID || obj.pageId || /\/pages\/manager|asset_id=|business\.facebook\.com\/latest/i.test(String(url || ""));
      if (looksLikePage && id && name) push(id, name, url, avatar);
      for (const key of Object.keys(obj)) {
        const child = obj[key];
        if (child && (typeof child === "object" || Array.isArray(child))) walk(child, depth + 1);
      }
    };

    for (const script of Array.from(document.querySelectorAll('script[type="application/json"], script:not([src])'))) {
      const text = script.textContent || "";
      if (!text || !/(page_id|pageID|__typename|asset_id|profile_picture|profilePicture|Pages|الصفحات)/i.test(text)) continue;
      const parsed = safeJsonParse(text);
      if (parsed) walk(parsed);

      const re = /(?:"page_id"|"pageID"|"id"|"asset_id")\s*:\s*"?(\d{5,})"?[\s\S]{0,900}?(?:"name"|"page_name"|"title")\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
      let m;
      while ((m = re.exec(text))) {
        let name = m[2];
        try { name = JSON.parse(`"${name}"`); } catch {}
        push(m[1], name, null, null);
      }

      const reverseRe = /(?:"name"|"page_name"|"title")\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"[\s\S]{0,900}?(?:"page_id"|"pageID"|"id"|"asset_id")\s*:\s*"?(\d{5,})"?/g;
      while ((m = reverseRe.exec(text))) {
        let name = m[1];
        try { name = JSON.parse(`"${name}"`); } catch {}
        push(m[2], name, null, null);
      }
    }
    return out;
  });
}

async function runExtractPages({ page, report }) {
  const collected = new Map();
  let openedAny = false;
  let lastUrl = "";
  let lastVisibleText = "";

  const emitCandidate = async (candidate) => {
    const clean = dedupePageCandidate(candidate);
    if (!clean || collected.has(clean.id)) return false;
    collected.set(clean.id, clean);
    await report({
      result: { target: clean.id, status: "success", data: clean },
      processedItems: collected.size,
      totalItems: collected.size,
      progress: Math.min(95, 20 + collected.size * 6),
    });
    return true;
  };

  await report({ progress: 15, processedItems: 0, totalItems: 0 });

  for (let urlIdx = 0; urlIdx < PAGE_SURFACES.length; urlIdx++) {
    const url = PAGE_SURFACES[urlIdx];
    lastUrl = url;
    await report({ progress: Math.min(82, 20 + urlIdx * 8), processedItems: collected.size, totalItems: collected.size });
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 75_000 });
      openedAny = true;
    } catch (e) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        openedAny = true;
      } catch (_) {
        continue;
      }
    }

    await sleep(3500);
    if (/\/login(?:\/|\?|$)|checkpoint|two_factor|two_step_verification/i.test(page.url())) {
      await report({ status: "failed", errorMessage: "SESSION_EXPIRED: حساب فيسبوك حوّلك لتسجيل الدخول أو checkpoint. أعد ربط الكوكيز." });
      return;
    }

    await autoScroll(page, 12);

    const [rendered, boot] = await Promise.all([
      collectFromRenderedPage(page).catch(() => []),
      collectFromBootData(page).catch(() => []),
    ]);
    for (const candidate of [...rendered, ...boot]) await emitCandidate(candidate);

    lastVisibleText = await page.evaluate(() => (document.body?.innerText || "").slice(0, 1000)).catch(() => lastVisibleText);
  }

  if (!openedAny) {
    await report({ status: "failed", errorMessage: "تعذر فتح صفحات فيسبوك من المتصفح." });
    return;
  }

  if (collected.size === 0) {
    const hasPermissionHint = /no pages|not have any pages|create.*page|ليس لديك.*صفحات|لا توجد.*صفحات|إنشاء صفحة/i.test(lastVisibleText);
    await report({
      status: "failed",
      errorMessage: hasPermissionHint
        ? `فتح البوت صفحة إدارة الصفحات بنجاح لكن فيسبوك عرض أن الحساب لا يدير صفحات. آخر مسار: ${lastUrl}`
        : `فشل اكتشاف الصفحات من واجهة فيسبوك رغم فتحها. آخر مسار: ${lastUrl}`,
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