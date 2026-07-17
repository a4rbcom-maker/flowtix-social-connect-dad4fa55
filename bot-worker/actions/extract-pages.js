const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE_SURFACES = [
  // Start with the light/mobile surfaces because they expose page links in
  // simpler markup and are less dependent on Comet's frequently changing CSS.
  "https://mbasic.facebook.com/pages/?category=your_pages",
  "https://mbasic.facebook.com/bookmarks/pages",
  "https://m.facebook.com/pages/manage",
  "https://m.facebook.com/pages/?category=your_pages",
  "https://m.facebook.com/bookmarks/pages",
  "https://www.facebook.com/pages/manage",
  "https://www.facebook.com/pages/?category=your_pages",
  "https://www.facebook.com/bookmarks/pages",
  "https://www.facebook.com/profile.php?sk=pages",
  "https://business.facebook.com/latest/home",
  "https://business.facebook.com/latest/pages",
  "https://business.facebook.com/latest/settings/pages",
  "https://www.facebook.com/pages/",
];

const DIAGNOSTIC_TARGET = "__extract_pages_diagnostic__";

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
  let name = String(candidate.name || candidate.page_name || candidate.pageName || "").trim();
  if (!id) return null;
  if (id.length < 3 || id.length > 160) return null;
  // Fallback name: if missing, derive a placeholder from the id/slug so we
  // don't silently drop otherwise valid page links.
  if (!name) name = `Page ${id}`;
  if (name.length > 240) name = name.slice(0, 240);
  // Accept any name with at least one printable char (Arabic/Latin/Digits/Emoji).
  if (!/\S/.test(name)) return null;
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
      "pages_manager", "people", "account", "accounts", "overview", "alltools", "tools",
    ]);
    const genericLabels = /^(Pages|Your Pages|Create|Manage|Home|About|Photos|Videos|Posts|Following|Followers|Like|Share|Comment|More|See more|View page|Switch|Meta Business Suite|Business Suite|Notifications|Inbox|الصفحات|صفحاتك|إنشاء|إدارة|الرئيسية|حول|الصور|الفيديوهات|المنشورات|متابعة|المتابعون|إعجاب|مشاركة|تعليق|عرض المزيد|عرض الصفحة|تبديل|الإشعارات|صندوق الوارد)$/i;
    const out = [];

    const cleanText = (value) => String(value || "")
      .replace(/\s+/g, " ")
      .replace(/^(Open|Visit|Go to|Switch into|Switch to|عرض|فتح|انتقال إلى|تبديل إلى)\s+/i, "")
      .replace(/^(Profile picture of|Profile photo of|صورة الملف الشخصي لـ|صورة الملف الشخصي الخاصة بـ)\s+/i, "")
      .trim();
    const validName = (value) => {
      const s = cleanText(value);
      // Loosened: accept 1-200 chars with any printable char (Arabic/Latin/digits/emoji).
      // Only reject exact generic-label matches; anything else passes.
      return s.length >= 1 && s.length <= 200 && /\S/.test(s) && !genericLabels.test(s) ? s : "";
    };
    const parseHref = (rawHref) => {
      if (!rawHref || rawHref.startsWith("#") || /^javascript:/i.test(rawHref)) return null;
      let parsed;
      try { parsed = new URL(rawHref, location.origin); } catch { return null; }
      if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) return null;
      const assetId = parsed.searchParams.get("asset_id") || parsed.searchParams.get("page_id") || parsed.searchParams.get("id") || parsed.searchParams.get("profile_id");
      if (assetId && /^\d{5,}$/.test(assetId)) return { id: assetId, href: parsed.toString().split("#")[0] };
      const hoverPageId = parsed.pathname.includes("/ajax/hovercard/page.php") ? parsed.searchParams.get("id") : null;
      if (hoverPageId && /^\d{5,}$/.test(hoverPageId)) return { id: hoverPageId, href: `https://www.facebook.com/${hoverPageId}` };
      if (/\/groups\/|\/events\/|\/posts\/|\/videos\/|\/reel\/|\/stories\/|\/photo\.php|\/permalink\.php|\/story\.php|\/login\//i.test(parsed.pathname)) return null;
      const profileId = parsed.pathname === "/profile.php" ? parsed.searchParams.get("id") : null;
      const numericId = profileId || parsed.pathname.match(/\/(\d{6,})(?:\/|$)/)?.[1] || parsed.pathname.match(/-(\d{6,})(?:\/|$)/)?.[1];
      const firstSlug = parsed.pathname.split("/").filter(Boolean)[0] || "";
      const slug = firstSlug && !systemSlugs.has(firstSlug.toLowerCase()) && /^[A-Za-z0-9._-]{3,}$/.test(firstSlug) ? firstSlug : "";
      const id = numericId || slug;
      return id ? { id, href: parsed.toString().split("?")[0].split("#")[0] } : null;
    };

    const anchors = Array.from(document.querySelectorAll('a[role="link"], a[href*="facebook.com"], a[href^="/"], a[href*="asset_id="], a[href*="page_id="], a[href*="/pages/edit"]'));
    for (const a of anchors) {
      const parsed =
        parseHref(a.getAttribute("href") || "") ||
        parseHref(a.getAttribute("data-hovercard") || "") ||
        parseHref(a.getAttribute("ajaxify") || "");
      if (!parsed) continue;
      const container = a.closest('[role="listitem"], [role="article"], [data-pagelet], div[aria-label], div') || a;
      const imgAlt = a.querySelector("img[alt]")?.getAttribute("alt") || container.querySelector?.("img[alt]")?.getAttribute("alt") || "";
      const aria = a.getAttribute("aria-label") || "";
      const title = a.getAttribute("title") || "";
      const ownText = Array.from(a.childNodes || [])
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || "")
        .join(" ");
      const headings = Array.from(container.querySelectorAll?.('h1,h2,h3,strong,span[dir="auto"],div[dir="auto"]') || [])
        .map((el) => el.textContent || "");
      const lines = [ownText, a.textContent, ...headings, container.textContent]
        .flatMap((text) => String(text || "").split(/\n|\s{2,}/))
        .map(validName)
        .filter(Boolean);
      const name = [imgAlt, aria, title, ...lines].map(validName).find(Boolean) || "";
      const avatar = a.querySelector("img[src]")?.getAttribute("src") || container.querySelector?.("img[src]")?.getAttribute("src") || null;
      // Emit even if name is missing — dedupePageCandidate assigns a fallback
      // so we don't silently drop otherwise-valid page links.
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
      if (s.length < 1 || s.length > 200) return "";
      if (/^(Pages|Create|Manage|Home|Meta Business Suite|Business Suite|الصفحات|إنشاء|إدارة|الرئيسية)$/i.test(s)) return "";
      return s;
    };
    const push = (id, name, url, avatar) => {
      id = String(id || "").trim();
      const cleaned = validName(name);
      if (!id || seen.has(id)) return;
      if (!/^\d{5,}$/.test(id) && !/^[A-Za-z0-9._-]{3,}$/.test(id)) return;
      seen.add(id);
      out.push({ id, name: cleaned || `Page ${id}`, link: url || `https://www.facebook.com/${id}`, avatar_url: avatar || null });
    };
    const safeJsonParse = (text) => {
      try { return JSON.parse(text); } catch { return null; }
    };
    const pageContextKey = (key) => /(^|_|\b)(page|pages|owned_pages|managed_pages|business_pages|page_profiles|profile_switcher|asset|assets)(_|\b|$)/i.test(String(key || ""));
    const walk = (value, depth = 0, inPageContext = false) => {
      if (!value || depth > 12) return;
      if (Array.isArray(value)) {
        for (const item of value) walk(item, depth + 1, inPageContext);
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
      const looksLikePage = /Page/i.test(type) || obj.page_id || obj.pageID || obj.pageId || /\/pages\/manager|\/pages\/edit|asset_id=|business\.facebook\.com\/latest/i.test(String(url || ""));
      if (looksLikePage && id && name) push(id, name, url, avatar);
      if (!looksLikePage && inPageContext && id && name) push(id, name, url, avatar);
      for (const key of Object.keys(obj)) {
        const child = obj[key];
        if (child && (typeof child === "object" || Array.isArray(child))) walk(child, depth + 1, inPageContext || pageContextKey(key));
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

      const entityRe = /"(?:__typename|type)"\s*:\s*"(?:Page|XFBPage|BusinessPage|CometPage)"[\s\S]{0,1600}?"(?:id|page_id|pageID)"\s*:\s*"?(\d{5,})"?[\s\S]{0,1600}?"(?:name|title|display_name)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g;
      while ((m = entityRe.exec(text))) {
        let name = m[2];
        try { name = JSON.parse(`"${name}"`); } catch {}
        push(m[1], name, null, null);
      }
    }
    return out;
  });
}

async function emitDiagnostic(report, data) {
  await report({
    result: {
      target: DIAGNOSTIC_TARGET,
      status: "skipped",
      data: {
        kind: "extract_pages_diagnostic",
        at: new Date().toISOString(),
        ...data,
      },
    },
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
  await emitDiagnostic(report, { event: "started", surfaces: PAGE_SURFACES.length });

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
    const finalUrl = page.url();
    if (/\/login(?:\/|\?|$)|checkpoint|two_factor|two_step_verification/i.test(page.url())) {
      await emitDiagnostic(report, { event: "session_rejected", surface: url, finalUrl });
      await report({ status: "failed", errorMessage: "SESSION_EXPIRED: حساب فيسبوك حوّلك لتسجيل الدخول أو checkpoint. أعد ربط الكوكيز." });
      return;
    }

    await autoScroll(page, 12);

    const [rendered, boot] = await Promise.all([
      collectFromRenderedPage(page).catch(() => []),
      collectFromBootData(page).catch(() => []),
    ]);
    await emitDiagnostic(report, {
      event: "surface_scanned",
      surface: url,
      finalUrl,
      renderedCount: rendered.length,
      bootCount: boot.length,
      collectedCount: collected.size,
    });
    for (const candidate of [...rendered, ...boot]) await emitCandidate(candidate);

    lastVisibleText = await page.evaluate(() => (document.body?.innerText || "").slice(0, 1000)).catch(() => lastVisibleText);
  }

  if (!openedAny) {
    await emitDiagnostic(report, { event: "no_surface_opened" });
    await report({ status: "failed", errorMessage: "تعذر فتح صفحات فيسبوك من المتصفح." });
    return;
  }

  if (collected.size === 0) {
    const hasPermissionHint = /no pages|not have any pages|create.*page|ليس لديك.*صفحات|لا توجد.*صفحات|إنشاء صفحة/i.test(lastVisibleText);
    await report({
      status: "failed",
      errorMessage: hasPermissionHint
        ? `فتح البوت صفحة إدارة الصفحات بنجاح لكن فيسبوك عرض أن الحساب لا يدير صفحات. آخر مسار: ${lastUrl}`
        : `فشل اكتشاف الصفحات من واجهة فيسبوك رغم فتحها. تم حفظ سجل تشخيص لكل مسار لمعرفة هل الفشل في التنقل أم DOM أم BootData. آخر مسار: ${lastUrl}`,
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

module.exports = { runExtractPages, collectFromRenderedPage, collectFromBootData, dedupePageCandidate };