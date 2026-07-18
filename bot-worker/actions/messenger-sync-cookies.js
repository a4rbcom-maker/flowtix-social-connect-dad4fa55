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
  // Try multiple inbox surfaces. We accept the first one that renders threads
  // WITHOUT redirecting us to a login page. Business Suite redirects to its
  // own /login even with valid facebook.com cookies for accounts that aren't
  // enrolled — that's NOT a session expiry, just a missing surface.
  const candidates = [
    // Meta Business Suite (best: real page inbox)
    `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(pageId)}&mailbox_id=${encodeURIComponent(pageId)}`,
    `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(pageId)}`,
    // Legacy Pages inbox
    `https://www.facebook.com/${encodeURIComponent(pageId)}/inbox/`,
    // Messenger with page_inbox hint (fallback)
    `https://www.facebook.com/messages/t/?entry_point=page_inbox&page_id=${encodeURIComponent(pageId)}`,
  ];
  for (const url of candidates) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const currentUrl = page.url();
      // Skip surface-specific login redirects — not a session expiry.
      if (/\/login|checkpoint/i.test(currentUrl)) continue;
      await new Promise((r) => setTimeout(r, 5000));
      const hasThreads = await page.evaluate(() =>
        Boolean(
          document.querySelector(
            '[role="row"], [role="listitem"], a[href*="/inbox/"], a[href*="thread"], a[href*="/messages/t/"]',
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
      const items = [];
      const rows = Array.from(
        document.querySelectorAll(
          '[role="row"], [role="listitem"], a[href*="thread_fbid"], a[href*="/inbox/"], a[href*="/messages/t/"]',
        ),
      );
      for (const row of rows) {
        const html = row.outerHTML || "";
        const psidMatch =
          html.match(/thread_fbid[=:]"?(\d{5,})"?/) ||
          html.match(/user_id[=:]"?(\d{5,})"?/) ||
          html.match(/\/messages\/t\/(\d{5,})/) ||
          html.match(/"id":"(\d{10,})"/);
        if (!psidMatch) continue;
        const psid = psidMatch[1];
        const nameEl = row.querySelector(
          'span[dir="auto"] span, span[dir="auto"], strong, [data-visualcompletion="ignore-dynamic"] span',
        );
        const name = (nameEl?.innerText || row.innerText || "").trim().split("\n")[0];
        if (!psid) continue;
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
        "تعذّر فتح صندوق واردات الصفحة. تأكّد أن حساب البوت مسؤول على هذه الصفحة ولديه صلاحية إدارة الرسائل (Messaging). الجلسة نفسها ما زالت صالحة.",
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
