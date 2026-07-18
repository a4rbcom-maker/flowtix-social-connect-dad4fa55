// Syncs Messenger conversations for a Page using the bot cookies session.
// Payload: { pageId, pageName?, maxConversations }

// NOTE: We intentionally do NOT hit facebook.com/me here.
// The worker's ensureLogin() has already verified the base FB session before
// dispatching this action. Adding a second /me navigation used to double
// Facebook's "new login" fingerprint and increased the chance FB invalidated
// the user's real browser session. Removed on purpose.


function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function inspectInboxSurface(page, expectedPageId, expectedPageName) {
  return page.evaluate(({ expectedPageId, expectedPageName }) => {
    const current = new URL(window.location.href);
    const params = new URLSearchParams(current.search);
    const selectedAsset = params.get("asset_id") || params.get("mailbox_id") || params.get("page_id") || params.get("selected_asset_id") || "";
    const onBusinessSuite = /(^|\.)business\.facebook\.com$/i.test(current.hostname);
    const inInbox = /\/latest\/inbox/i.test(current.pathname);
    const title = document.title || "";
    const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 4000);
    const html = document.documentElement.innerHTML || "";
    const expectedName = String(expectedPageName || "").trim().toLowerCase();
    const bodyLower = bodyText.toLowerCase();
    const htmlHasPageId = html.includes(String(expectedPageId));
    const bodyHasPageName = expectedName.length > 1 && bodyLower.includes(expectedName);
    const hasThreads = Boolean(
      document.querySelector(
        '[role="row"], [role="listitem"], a[href*="thread"], a[href*="selected_item_id"], a[href*="thread_id"], a[href*="participant_id"]',
      ),
    );
    const noAccess = /you don.?t have access|not available|permission|ليس لديك|غير متاح|صلاحية|إذن|لا يمكنك الوصول/i.test(bodyText);
    const loginLike = /log in|login|checkpoint|تسجيل الدخول|تحقق/i.test(bodyText) || /\/login|checkpoint/i.test(current.href);

    return {
      url: current.href,
      title,
      selectedAsset,
      onBusinessSuite,
      inInbox,
      selectedAssetMatches: selectedAsset === String(expectedPageId),
      htmlHasPageId,
      bodyHasPageName,
      hasThreads,
      noAccess,
      loginLike,
    };
  }, { expectedPageId: String(expectedPageId), expectedPageName: expectedPageName || "" });
}

function inboxFailureMessage(snapshot, pageId, pageName) {
  const safePageName = pageName ? ` (${pageName})` : "";
  if (!snapshot) {
    return `تعذّر فتح صندوق واردات الصفحة ${pageId}${safePageName}. لم نستطع قراءة حالة صفحة Meta Business Suite بعد فتحها.`;
  }
  if (snapshot.loginLike) {
    return `فيسبوك طلب تسجيل دخول/تحقق عند فتح Meta Business Suite للصفحة ${pageId}${safePageName}. جلسة Facebook الأساسية تعمل، لكن Business Suite رفضها؛ افتح business.facebook.com بنفس الحساب وتأكد أنه لا يطلب Login أو Checkpoint ثم حدّث Cookies.`;
  }
  if (snapshot.noAccess) {
    return `تم فتح Meta Business Suite لكن الحساب لا يملك صلاحية رسائل لهذه الصفحة ${pageId}${safePageName}. أضف حساب البوت كمسؤول/محرر للصفحة مع صلاحية Messaging ثم حدّث Cookies.`;
  }
  if (!snapshot.onBusinessSuite) {
    return `فيسبوك حوّل البوت خارج Meta Business Suite أثناء فتح رسائل الصفحة ${pageId}${safePageName}. لم نحفظ أي أسماء حتى لا نخلطها مع الحساب الشخصي.`;
  }
  if (!snapshot.inInbox) {
    return `تم دخول Business Suite لكن لم يتم فتح شاشة Inbox للصفحة ${pageId}${safePageName}. افتح Inbox الصفحة يدوياً مرة واحدة من نفس الحساب ثم أعد المحاولة.`;
  }
  return `فتحنا Business Inbox لكن لم نستطع تأكيد أنه تابع للصفحة المختارة ${pageId}${safePageName}. لم نحفظ أي أسماء حتى لا نخلطها مع رسائل صفحة أخرى أو الحساب الشخصي. آخر تحقق: asset=${snapshot.selectedAsset || "غير ظاهر"}.`;
}

async function tryOpenInbox(page, pageId, pageName) {
  // STRICT MODE: only accept when Facebook confirms asset_id === pageId in the URL.
  // If FB drops the asset_id param → the account does NOT manage this page in
  // Business Suite; do NOT fall back to name/html heuristics (they matched the
  // personal inbox before).
  const candidates = [
    `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(pageId)}&mailbox_id=${encodeURIComponent(pageId)}`,
    `https://business.facebook.com/latest/inbox?asset_id=${encodeURIComponent(pageId)}`,
    `https://business.facebook.com/latest/inbox/messenger?asset_id=${encodeURIComponent(pageId)}`,
    `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(pageId)}`,
  ];
  let lastSnapshot = null;
  for (const url of candidates) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const currentUrl = page.url();
      if (/\/login|checkpoint/i.test(currentUrl)) continue;
      await new Promise((r) => setTimeout(r, 5000));
      const snapshot = await inspectInboxSurface(page, pageId, pageName);
      lastSnapshot = snapshot;
      // STRICT: URL must still carry our asset_id after FB's own redirects.
      if (snapshot.onBusinessSuite && snapshot.inInbox && snapshot.selectedAssetMatches) {
        return { ok: true, url: snapshot.url, snapshot };
      }
    } catch (_) {
      /* try next */
    }
  }
  // FB never accepted asset_id → the account does not manage this page inside
  // Business Suite (or the page is not linked to a Business portfolio).
  const explicit = lastSnapshot && lastSnapshot.onBusinessSuite && !lastSnapshot.selectedAssetMatches
    ? `الحساب لا يدير هذه الصفحة (${pageId}${pageName ? ` — ${pageName}` : ""}) داخل Meta Business Suite. افتح business.facebook.com بنفس الحساب وتأكد أن الصفحة تظهر كأصل مُدار (Managed Asset) ثم أعد المحاولة.`
    : inboxFailureMessage(lastSnapshot, pageId, pageName);
  return { ok: false, snapshot: lastSnapshot, message: explicit };
}

async function collectConversations(page, maxConversations, expectedPageId) {
  const start = Date.now();
  const seen = new Map();
  let stableRounds = 0;
  let lastCount = 0;
  for (let i = 0; i < 200; i += 1) {
    if (Date.now() - start > 8 * 60 * 1000) break;
    const batch = await page.evaluate((expectedPageId) => {
      const current = new URL(window.location.href);
      if (!/(^|\.)business\.facebook\.com$/i.test(current.hostname) || !/\/latest\/inbox/i.test(current.pathname)) {
        return { items: [], scopeOk: false };
      }
      // Verify current URL still scoped to our page.
      const params = new URLSearchParams(current.search);
      const currentAsset = params.get("asset_id") || params.get("mailbox_id") || "";
      if (currentAsset && currentAsset !== String(expectedPageId)) {
        return { items: [], scopeOk: false };
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
        // STRICT: thread anchor must reference our page via asset_id/mailbox_id.
        if (href) {
          const hrefParams = (() => { try { return new URL(href).searchParams; } catch { return null; } })();
          const hAsset = hrefParams?.get("asset_id") || hrefParams?.get("mailbox_id") || "";
          if (hAsset && hAsset !== String(expectedPageId)) continue;
          // If href has no asset scoping at all, require the DOM ancestor URL scope (already checked above).
        }
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
        // Never accept the page id itself as a contact psid.
        if (psid === String(expectedPageId)) continue;
        const nameEl = row.querySelector(
          'span[dir="auto"] span, span[dir="auto"], strong, [aria-label], [data-visualcompletion="ignore-dynamic"] span',
        );
        const name = (nameEl?.innerText || nameEl?.getAttribute?.("aria-label") || row.innerText || "").trim().split("\n")[0];
        if (!psid || /^(Inbox|Messenger|Search|Chats|All|Unread|Spam|Done|صندوق|بحث|الكل|غير مقروء)$/i.test(name)) continue;
        items.push({ psid, name: name.slice(0, 200) });
      }
      return { items, scopeOk: true };
    }, String(expectedPageId));

    if (!batch.scopeOk) break; // page navigated away from our asset scope — stop.
    for (const c of batch.items) if (!seen.has(c.psid)) seen.set(c.psid, c);
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

  // Session was already verified by ensureLogin() in the worker before
  // dispatching this action; skip the extra /me hop to reduce FB fingerprint.



  // 2) Try to open an inbox surface. A failure here is NOT a session expiry.
  const opened = await tryOpenInbox(page, pageId, pageName);
  if (!opened.ok) {
    await report({
      status: "failed",
      errorMessage: opened.message ||
        "تعذّر فتح صندوق واردات الصفحة داخل Meta Business Suite. لم يتم جلب أي أسماء حتى لا نخلطها مع رسائل الحساب الشخصي.",
    });
    return;
  }

  const contacts = await collectConversations(page, maxConversations, pageId);
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
