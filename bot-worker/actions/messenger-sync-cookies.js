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
  const readVisibleItems = async () => page.evaluate((expectedPageId) => {
    const current = new URL(window.location.href);
    if (!/(^|\.)business\.facebook\.com$/i.test(current.hostname) || !/\/latest\/inbox/i.test(current.pathname)) {
      return { items: [], clickIndexes: [], scopeOk: false };
    }
    // Verify current URL still scoped to our page.
    const params = new URLSearchParams(current.search);
    const currentAsset = params.get("asset_id") || params.get("mailbox_id") || "";
    if (currentAsset && currentAsset !== String(expectedPageId)) {
      return { items: [], clickIndexes: [], scopeOk: false };
    }

    const ignoredNameRe = /^(Inbox|Messenger|Search|Chats|All|Unread|Spam|Done|صندوق|بحث|الكل|غير مقروء|مكتمل|الرسائل)$/i;
    const cleanName = (value) => String(value || "").replace(/\s+/g, " ").trim().split("\n")[0].slice(0, 200);
    const items = [];
    const clickIndexes = [];
    const candidates = Array.from(
      document.querySelectorAll(
        'a[href*="thread_fbid"], a[href*="selected_item_id"], a[href*="thread_id"], a[href*="participant_id"], [role="row"], [role="listitem"], [tabindex="0"]',
      ),
    ).filter((row) => {
      const rect = row.getBoundingClientRect();
      const text = cleanName(row.innerText || row.getAttribute?.("aria-label") || "");
      return rect.width >= 160 && rect.height >= 24 && rect.bottom > 0 && rect.top < window.innerHeight && text && !ignoredNameRe.test(text);
    });

    candidates.slice(0, 40).forEach((row, index) => {
      row.setAttribute("data-flowtix-conversation-index", String(index));
      const html = row.outerHTML || "";
      const href = row instanceof HTMLAnchorElement ? row.href : row.querySelector("a[href]")?.href || "";
      if (href) {
        const hrefParams = (() => { try { return new URL(href).searchParams; } catch { return null; } })();
        const hAsset = hrefParams?.get("asset_id") || hrefParams?.get("mailbox_id") || "";
        if (hAsset && hAsset !== String(expectedPageId)) return;
      }
      const psidMatch =
        href.match(/[?&](?:selected_item_id|participant_id|user_id|profile_id|psid)=(\d{5,})/) ||
        html.match(/thread_fbid[=:]"?(\d{5,})"?/) ||
        html.match(/user_id[=:]"?(\d{5,})"?/) ||
        html.match(/other_user_id[=:]"?(\d{5,})"?/) ||
        html.match(/participant_id[=:]"?(\d{5,})"?/) ||
        html.match(/profile_id[=:]"?(\d{5,})"?/) ||
        html.match(/"id":"(\d{10,})"/);
      const nameEl = row.querySelector(
        'span[dir="auto"] span, span[dir="auto"], strong, [aria-label], [data-visualcompletion="ignore-dynamic"] span',
      );
      const name = cleanName(nameEl?.innerText || nameEl?.getAttribute?.("aria-label") || row.innerText || "");
      if (psidMatch?.[1] && psidMatch[1] !== String(expectedPageId)) {
        items.push({ psid: psidMatch[1], name });
      } else {
        clickIndexes.push(index);
      }
    });
    return { items, clickIndexes, scopeOk: true };
  }, String(expectedPageId));

  const clickAndReadItem = async (index) => {
    const before = page.url();
    const clicked = await page.evaluate((index) => {
      const el = document.querySelector(`[data-flowtix-conversation-index="${index}"]`);
      if (!el) return { ok: false };
      const text = String(el.innerText || el.getAttribute?.("aria-label") || "").replace(/\s+/g, " ").trim().split("\n")[0].slice(0, 200);
      el.scrollIntoView({ block: "center", inline: "nearest" });
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return { ok: true, name: text };
    }, index);
    if (!clicked.ok) return null;
    await new Promise((r) => setTimeout(r, 1200));
    const current = page.url();
    const parsed = await page.evaluate((expectedPageId) => {
      const current = new URL(window.location.href);
      const params = current.searchParams;
      const asset = params.get("asset_id") || params.get("mailbox_id") || "";
      if (asset && asset !== String(expectedPageId)) return { scopeOk: false };
      const psid =
        params.get("selected_item_id") ||
        params.get("participant_id") ||
        params.get("thread_id") ||
        params.get("user_id") ||
        params.get("profile_id") ||
        "";
      return { scopeOk: true, psid: /^\d{5,}$/.test(psid) ? psid : "" };
    }, String(expectedPageId));
    if (!parsed.scopeOk) return { scopeOk: false };
    if (current !== before && !current.includes("latest/inbox")) return { scopeOk: false };
    if (!parsed.psid || parsed.psid === String(expectedPageId)) return null;
    return { psid: parsed.psid, name: clicked.name };
  };

  for (let i = 0; i < 200; i += 1) {
    if (Date.now() - start > 8 * 60 * 1000) break;
    const batch = await readVisibleItems();

    if (!batch.scopeOk) break; // page navigated away from our asset scope — stop.
    for (const c of batch.items) if (!seen.has(c.psid)) seen.set(c.psid, c);
    for (const index of batch.clickIndexes.slice(0, 12)) {
      if (seen.size >= maxConversations) break;
      const clicked = await clickAndReadItem(index);
      if (clicked && clicked.scopeOk === false) return Array.from(seen.values()).slice(0, maxConversations);
      if (clicked?.psid && !seen.has(clicked.psid)) seen.set(clicked.psid, clicked);
    }
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
