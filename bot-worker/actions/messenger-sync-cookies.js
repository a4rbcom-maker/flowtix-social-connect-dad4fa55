// Syncs Messenger conversations for a Page using the bot cookies session.
// Payload: { pageId, pageName?, maxConversations }

async function verifyFacebookSession(page) {
  // Check the base facebook.com session is alive BEFORE touching Business Suite.
  // Business Suite has its own login redirect that can trigger even when the
  // core cookies are fine (e.g. account not enrolled in Business Suite),
  // which used to be misreported as SESSION_EXPIRED.
  try {
    await page.goto("https://www.facebook.com/me", { waitUntil: "domcontentloaded", timeout: 45_000 });
    const url = page.url();
    if (/\/login|checkpoint|\/recover/i.test(url)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

async function tryOpenInbox(page, pageId) {
  // Strictly use Meta Business Suite only. Do NOT fall back to
  // facebook.com/messages or legacy Page inbox URLs: those can silently open the
  // personal Messenger inbox and pollute the selected Page with personal chats.
  const candidates = [
    `https://business.facebook.com/latest/inbox?asset_id=${encodeURIComponent(pageId)}`,
    `https://business.facebook.com/latest/inbox/messenger?asset_id=${encodeURIComponent(pageId)}`,
    `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(pageId)}&mailbox_id=${encodeURIComponent(pageId)}`,
    `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(pageId)}`,
  ];
  for (const url of candidates) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const currentUrl = page.url();
      // Skip surface-specific login redirects — not a session expiry.
      if (/\/login|checkpoint/i.test(currentUrl)) continue;
      const openedExpectedBusinessInbox = await page.evaluate((expectedPageId) => {
        const current = new URL(window.location.href);
        const onBusinessSuite = /(^|\.)business\.facebook\.com$/i.test(current.hostname);
        const inInbox = /\/latest\/inbox/i.test(current.pathname);
        const params = new URLSearchParams(current.search);
        const selectedAsset = params.get("asset_id") || params.get("mailbox_id") || params.get("page_id") || "";
        return onBusinessSuite && inInbox && selectedAsset === String(expectedPageId);
      }, String(pageId));
      if (!openedExpectedBusinessInbox) continue;
      await new Promise((r) => setTimeout(r, 5000));
      const hasThreads = await page.evaluate(() =>
        Boolean(
          document.querySelector(
            '[role="row"], [role="listitem"], a[href*="thread"], a[href*="selected_item_id"], a[href*="thread_id"]',
          ),
        ),
      );
      if (hasThreads) return { ok: true, url: currentUrl };
    } catch (_) {
      /* try next */
    }
  }
  return { ok: false };
}

async function collectConversations(page, maxConversations) {
  const start = Date.now();
  const seen = new Map();
  let stableRounds = 0;
  let lastCount = 0;
  for (let i = 0; i < 200; i += 1) {
    if (Date.now() - start > 8 * 60 * 1000) break;
    const batch = await page.evaluate(() => {
      const current = new URL(window.location.href);
      if (!/(^|\.)business\.facebook\.com$/i.test(current.hostname) || !/\/latest\/inbox/i.test(current.pathname)) {
        return [];
      }
      const items = [];
      const rows = Array.from(
        document.querySelectorAll(
          '[role="row"], [role="listitem"], a[href*="thread_fbid"], a[href*="selected_item_id"], a[href*="thread_id"]',
        ),
      );
      for (const row of rows) {
        const html = row.outerHTML || "";
        const href = row instanceof HTMLAnchorElement ? row.href : row.querySelector("a[href]")?.href || "";
        const psidMatch =
          href.match(/[?&](?:selected_item_id|participant_id|user_id|profile_id|psid)=(\d{5,})/) ||
          html.match(/thread_fbid[=:]"?(\d{5,})"?/) ||
          html.match(/user_id[=:]"?(\d{5,})"?/) ||
          html.match(/other_user_id[=:]"?(\d{5,})"?/) ||
          html.match(/participant_id[=:]"?(\d{5,})"?/) ||
          html.match(/profile_id[=:]"?(\d{5,})"?/) ||
          html.match(/"id":"(\d{10,})"/);
        if (!psidMatch) continue;
        const psid = psidMatch[1];
        const nameEl = row.querySelector(
          'span[dir="auto"] span, span[dir="auto"], strong, [aria-label], [data-visualcompletion="ignore-dynamic"] span',
        );
        const name = (nameEl?.innerText || nameEl?.getAttribute?.("aria-label") || row.innerText || "").trim().split("\n")[0];
        if (!psid || /^(Inbox|Messenger|Search|Chats|All|Unread|Spam|Done|صندوق|بحث|الكل|غير مقروء)$/i.test(name)) continue;
        items.push({ psid, name: name.slice(0, 200) });
      }
      return items;
    });
    for (const c of batch) if (!seen.has(c.psid)) seen.set(c.psid, c);
    if (seen.size >= maxConversations) break;

    if (seen.size === lastCount) {
      stableRounds += 1;
      if (stableRounds >= 6) break;
    } else {
      stableRounds = 0;
      lastCount = seen.size;
    }

    await page.evaluate(() => {
      const scrollables = Array.from(document.querySelectorAll("div")).filter((el) => {
        const style = window.getComputedStyle(el);
        return (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          el.clientHeight > 200 &&
          el.scrollHeight > el.clientHeight
        );
      });
      scrollables.sort((a, b) => b.clientHeight - a.clientHeight);
      const target = scrollables[0];
      if (target) target.scrollBy(0, target.clientHeight);
      else window.scrollBy(0, window.innerHeight);
    });
    await new Promise((r) => setTimeout(r, 1800));
  }
  return Array.from(seen.values()).slice(0, maxConversations);
}

async function runMessengerSyncCookies({ page, job, report }) {
  const { pageId, pageName = null, maxConversations = 5000 } = job.payload || {};
  if (!pageId) {
    await report({ status: "failed", errorMessage: "pageId is required" });
    return;
  }
  if (!/^\d{5,}$/.test(String(pageId))) {
    await report({
      status: "failed",
      errorMessage:
        "معرّف الصفحة الحالي غير رقمي، وهذا يعني أنه ناتج من طريقة جلب قديمة وقد يفتح Inbox غلط. اضغط «جلب صفحاتي المدارة» مرة أخرى ثم اختر الصفحة من القائمة الجديدة.",
    });
    return;
  }

  // 1) Verify base facebook.com session first — only THIS constitutes SESSION_EXPIRED.
  const sessionOk = await verifyFacebookSession(page);
  if (!sessionOk) {
    await report({
      status: "failed",
      errorMessage: "SESSION_EXPIRED: انتهت جلسة حساب البوت على فيسبوك. حدّث الكوكيز من نفس المتصفح المسجّل دخوله.",
    });
    return;
  }

  // 2) Try to open an inbox surface. A failure here is NOT a session expiry.
  const opened = await tryOpenInbox(page, pageId);
  if (!opened.ok) {
    await report({
      status: "failed",
      errorMessage:
        "تعذّر فتح صندوق واردات الصفحة داخل Meta Business Suite بالمعرّف المحدد. لم يتم جلب أي أسماء حتى لا نخلطها مع رسائل الحساب الشخصي. تأكّد أن حساب البوت مسؤول على هذه الصفحة ولديه صلاحية إدارة الرسائل.",
    });
    return;
  }

  const contacts = await collectConversations(page, maxConversations);
  if (contacts.length === 0) {
    await report({
      status: "failed",
      errorMessage:
        "فتحنا صندوق واردات الصفحة لكن لم نعثر على محادثات. تأكد أن الصفحة عليها رسائل فعلاً وأن حساب البوت له صلاحية عرضها.",
    });
    return;
  }
  let done = 0;
  for (const c of contacts) {
    await report({
      result: {
        target: c.psid,
        status: "success",
        data: {
          kind: "messenger_contact",
          psid: c.psid,
          full_name: c.name || null,
          page_id: pageId,
          page_name: pageName,
        },
      },
      processedItems: ++done,
      totalItems: contacts.length,
      progress: Math.min(99, Math.round((done / contacts.length) * 100)),
    });
  }
  await report({ status: "completed", processedItems: done, totalItems: contacts.length, progress: 100 });
}

module.exports = { runMessengerSyncCookies };
