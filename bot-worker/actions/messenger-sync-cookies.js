// Syncs Messenger conversations for a Page using the bot cookies session.
// Payload: { pageId, pageName?, maxConversations }
// Emits one result row per contact:
//   { target: psid, status: "success", data: { kind:"contact", psid, full_name, last_message_at, page_id } }

async function collectConversations(page, maxConversations) {
  const start = Date.now();
  const seen = new Map();
  // Scroll the conversation list and collect entries.
  for (let i = 0; i < 60; i += 1) {
    if (Date.now() - start > 4 * 60 * 1000) break;
    const batch = await page.evaluate(() => {
      const items = [];
      const rows = document.querySelectorAll('a[href*="/messages/t/"], [role="row"] a[href*="/messages/t/"]');
      for (const a of rows) {
        const href = a.getAttribute("href") || "";
        const m = href.match(/\/messages\/t\/(\d{5,})/);
        if (!m) continue;
        const psid = m[1];
        // Name usually shown in a <span> inside the row.
        const container = a.closest('[role="row"], [role="link"]') || a;
        const nameEl = container.querySelector('[role="none"] span, span[dir="auto"], strong, span');
        const name = (nameEl?.innerText || a.innerText || "").trim().split("\n")[0];
        items.push({ psid, name: name.slice(0, 200) });
      }
      return items;
    });
    for (const c of batch) if (!seen.has(c.psid)) seen.set(c.psid, c);
    if (seen.size >= maxConversations) break;
    // Scroll the list container (fallback to window scroll).
    await page.evaluate(() => {
      const list = document.querySelector('[role="grid"], [aria-label*="Chats" i], [aria-label*="الدردشات"]');
      if (list) list.scrollBy(0, list.clientHeight);
      else window.scrollBy(0, window.innerHeight);
    });
    await new Promise((r) => setTimeout(r, 1500));
  }
  return Array.from(seen.values()).slice(0, maxConversations);
}

async function runMessengerSyncCookies({ page, job, report }) {
  const { pageId, pageName = null, maxConversations = 2000 } = job.payload || {};
  if (!pageId) {
    await report({ status: "failed", errorMessage: "pageId is required" });
    return;
  }
  const url = `https://www.facebook.com/messages/t/?entry_point=page_inbox&page_id=${encodeURIComponent(pageId)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (_) {
    // Fallback to legacy inbox URL.
    try {
      await page.goto(`https://www.facebook.com/${pageId}/inbox`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    } catch (e) {
      await report({ status: "failed", errorMessage: `تعذر فتح صندوق واردات الصفحة: ${e.message}` });
      return;
    }
  }
  // Guard against redirect to login/checkpoint.
  if (/\/login|checkpoint/i.test(page.url())) {
    await report({ status: "failed", errorMessage: "SESSION_EXPIRED: أعد ربط حساب البوت." });
    return;
  }
  await new Promise((r) => setTimeout(r, 4000));

  const contacts = await collectConversations(page, maxConversations);
  if (contacts.length === 0) {
    await report({ status: "failed", errorMessage: "لم نعثر على أي محادثات. تأكد أن هذه الصفحة تديرها وأن لديها رسائل." });
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
