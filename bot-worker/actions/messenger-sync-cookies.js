// Syncs Messenger conversations for a Page using the bot cookies session.
// Payload: { pageId, pageName?, maxConversations }
// Emits one result row per contact:
//   { target: psid, status: "success", data: { kind:"messenger_contact", psid, full_name, page_id, page_name } }
//
// IMPORTANT: We must open the *Page* inbox (Meta Business Suite), NOT the
// personal Messenger inbox. The old URL `facebook.com/messages/t/?entry_point=page_inbox&page_id=...`
// silently redirects to the personal inbox, so previous runs returned the
// bot account's own DMs (13 items) instead of the page's real conversations.

async function openPageInbox(page, pageId) {
  // Try Business Suite inbox variants (real page inbox).
  const candidates = [
    `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(pageId)}&mailbox_id=${encodeURIComponent(pageId)}`,
    `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(pageId)}`,
    `https://business.facebook.com/latest/inbox?asset_id=${encodeURIComponent(pageId)}`,
    `https://business.facebook.com/${encodeURIComponent(pageId)}/inbox/`,
  ];
  for (const url of candidates) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (/\/login|checkpoint/i.test(page.url())) continue;
      // Wait for the inbox list to render.
      await new Promise((r) => setTimeout(r, 5000));
      const hasThreads = await page.evaluate(() =>
        Boolean(document.querySelector('[role="row"], [role="listitem"], a[href*="/inbox/"], a[href*="thread"]')),
      );
      if (hasThreads) return { ok: true, url };
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
      // Business Suite thread rows expose participant PSID via various links.
      const rows = Array.from(
        document.querySelectorAll('[role="row"], [role="listitem"], a[href*="thread_fbid"], a[href*="/inbox/"]'),
      );
      for (const row of rows) {
        const html = row.outerHTML || "";
        // Try to extract a PSID (numeric >= 5 digits).
        const psidMatch =
          html.match(/thread_fbid[=:]"?(\d{5,})"?/) ||
          html.match(/user_id[=:]"?(\d{5,})"?/) ||
          html.match(/\/messages\/t\/(\d{5,})/) ||
          html.match(/"id":"(\d{10,})"/);
        if (!psidMatch) continue;
        const psid = psidMatch[1];
        const nameEl =
          row.querySelector('span[dir="auto"] span, span[dir="auto"], strong, [data-visualcompletion="ignore-dynamic"] span');
        const name = (nameEl?.innerText || row.innerText || "").trim().split("\n")[0];
        if (!psid) continue;
        items.push({ psid, name: name.slice(0, 200) });
      }
      return items;
    });
    for (const c of batch) if (!seen.has(c.psid)) seen.set(c.psid, c);
    if (seen.size >= maxConversations) break;

    // Detect end of list: if count didn't grow for several rounds, stop.
    if (seen.size === lastCount) {
      stableRounds += 1;
      if (stableRounds >= 6) break;
    } else {
      stableRounds = 0;
      lastCount = seen.size;
    }

    // Scroll the inner inbox list (Business Suite uses a virtualized grid).
    await page.evaluate(() => {
      const scrollables = Array.from(document.querySelectorAll('div')).filter((el) => {
        const style = window.getComputedStyle(el);
        return (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          el.clientHeight > 200 &&
          el.scrollHeight > el.clientHeight
        );
      });
      // Prefer the tallest scrollable (usually the inbox list).
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

  const opened = await openPageInbox(page, pageId);
  if (!opened.ok) {
    if (/\/login|checkpoint/i.test(page.url())) {
      await report({ status: "failed", errorMessage: "SESSION_EXPIRED: أعد ربط حساب البوت." });
    } else {
      await report({
        status: "failed",
        errorMessage:
          "تعذر فتح صندوق واردات الصفحة عبر Meta Business Suite. تأكد أن حساب البوت لديه صلاحية إدارة الرسائل على هذه الصفحة.",
      });
    }
    return;
  }

  const contacts = await collectConversations(page, maxConversations);
  if (contacts.length === 0) {
    await report({
      status: "failed",
      errorMessage:
        "فتحنا صندوق واردات الصفحة لكن لم نعثر على محادثات. تأكد أن هذه الصفحة عليها رسائل وأن حساب البوت مسؤول عنها.",
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
