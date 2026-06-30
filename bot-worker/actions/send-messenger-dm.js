// Sends a Messenger DM to a list of Facebook profiles.
// Payload: { recipients: [{profile, name?}], message, intervalSeconds, imageUrls? }
// {name} in message is replaced by recipient's name.
// If imageUrls is non-empty, an image is attached with each send (round-robin).

const os = require("os");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");

const MESSAGE_ACTION_PATTERN = "Message|Messenger|Send message|Send a message|Private message|رسالة|مراسلة|راسل|إرسال رسالة|ارسال رسالة|إرسل رسالة|ارسل رسالة|إرسال|ارسال";
const MESSAGE_ACTION_RE = new RegExp(MESSAGE_ACTION_PATTERN, "i");

// Extract a numeric Facebook user ID from any of the URL shapes we see
// (profile.php?id=, /groups/<gid>/user/<uid>/, raw numeric, m.me/<id>).
function extractFbUserId(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  if (/^\d{5,}$/.test(s)) return s;
  const patterns = [
    /\/groups\/[^/]+\/user\/(\d{5,})/i,
    /profile\.php\?id=(\d{5,})/i,
    /\/user\/(\d{5,})/i,
    /messages\/t\/(\d{5,})/i,
    /m\.me\/(\d{5,})/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

function toProfileUrl(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  // Keep group-member URLs intact. Facebook often shows the Message action
  // on /groups/<groupId>/user/<userId> while the normalized profile.php?id=
  // page hides it or renders a different action set.
  if (/^https?:\/\/[^/]*facebook\.com\/groups\/[^/]+\/user\/\d{5,}/i.test(s)) {
    return s.split("?")[0].replace(/\/$/, "");
  }
  const id = extractFbUserId(s);
  if (id) return `https://www.facebook.com/profile.php?id=${id}`;
  if (/^https?:\/\//i.test(s)) return s.split("?")[0].replace(/\/$/, "");
  return `https://www.facebook.com/${s.replace(/^\/+/, "").replace(/\/$/, "")}`;
}

function toMessengerUrl(input) {
  const id = extractFbUserId(input);
  return id ? `https://www.facebook.com/messages/t/${id}` : null;
}


function downloadToTmp(url) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const client = u.protocol === "http:" ? http : https;
      const ext = (path.extname(u.pathname) || ".jpg").slice(0, 8);
      const tmp = path.join(os.tmpdir(), `dm-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
      const file = fs.createWriteStream(tmp);
      client.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(tmp)));
      }).on("error", reject);
    } catch (e) { reject(e); }
  });
}

async function attachImage(page, localPath) {
  // Try to find a file input in the composer (Messenger lazy-renders one).
  const handle = await page.$('input[type="file"]');
  if (!handle) return false;
  await handle.uploadFile(localPath);
  // Wait for FB to render the preview chip before sending.
  await new Promise((r) => setTimeout(r, 4000));
  return true;
}

async function findComposer(page) {
  return page.evaluate(() => {
    const normalize = (v) => String(v || "").replace(/\s+/g, " ").trim();
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 12 && r.bottom > 0 && r.right > 0;
    };
    const isMessengerComposer = (el) => {
      const label = normalize([
        el.getAttribute("aria-label"),
        el.getAttribute("aria-placeholder"),
        el.getAttribute("placeholder"),
        el.getAttribute("data-testid"),
        el.getAttribute("role"),
      ].filter(Boolean).join(" "));
      if (/search|بحث|comment|تعليق|post|منشور/i.test(label)) return false;
      if (/(^|\s)(Aa|Message|Type a message|Write a message|رسالة|اكتب رسالة|اكتب رسالتك)(\s|$)/i.test(label)) return true;
      const r = el.getBoundingClientRect();
      const inChatArea = r.top > window.innerHeight * 0.35 && r.height <= 90;
      const hasMessengerUi = /Messenger|ماسنجر|الدردشات|الرسائل والمكالمات/i.test(document.body?.innerText || "");
      return hasMessengerUi && inChatArea;
    };
    return Array.from(document.querySelectorAll('[contenteditable="true"]')).some((el) => isVisible(el) && isMessengerComposer(el));
  });
}

async function diagnoseDmPage(page) {
  const currentUrl = page.url();
  if (/\/login|checkpoint|two_factor|two_step/i.test(currentUrl)) {
    return { ok: false, reason: "SESSION_EXPIRED" };
  }

  return await page.evaluate(() => {
    const text = document.body?.innerText || "";
    const lower = text.toLowerCase();
    const normalize = (v) => String(v || "").replace(/\s+/g, " ").trim();
    const hasComposer = Array.from(document.querySelectorAll('[contenteditable="true"]')).some((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 40 || r.height <= 12 || r.bottom <= 0 || r.right <= 0) return false;
      const label = normalize([
        el.getAttribute("aria-label"),
        el.getAttribute("aria-placeholder"),
        el.getAttribute("placeholder"),
        el.getAttribute("data-testid"),
        el.getAttribute("role"),
      ].filter(Boolean).join(" "));
      if (/search|بحث|comment|تعليق|post|منشور/i.test(label)) return false;
      if (/(^|\s)(Aa|Message|Type a message|Write a message|رسالة|اكتب رسالة|اكتب رسالتك)(\s|$)/i.test(label)) return true;
      return /Messenger|ماسنجر|الدردشات|الرسائل والمكالمات/i.test(text) && r.top > window.innerHeight * 0.35 && r.height <= 90;
    });
    if (hasComposer) return { ok: true, reason: null };

    if (/can(?:not|'t|’t) message|can't reply|you can no longer send messages|this person isn't available|recipient unavailable/i.test(text)) {
      return { ok: false, reason: "RECIPIENT_PRIVACY" };
    }
    if (/لا يمكنك مراسلة|لا يمكن مراسلة|غير متاح|لا تستطيع إرسال|لا يمكنك الرد/i.test(text)) {
      return { ok: false, reason: "RECIPIENT_PRIVACY" };
    }
    if (/temporarily blocked|action blocked|you're restricted|we limit how often|try again later/i.test(text)) {
      return { ok: false, reason: "ACCOUNT_RATE_LIMIT" };
    }
    if (/تم حظرك مؤقت|الإجراء محظور|حاول مرة أخرى لاحق|نحد من عدد المرات/i.test(text)) {
      return { ok: false, reason: "ACCOUNT_RATE_LIMIT" };
    }
    if (lower.includes("messenger") || text.includes("ماسنجر") || text.includes("الدردشات")) {
      return { ok: false, reason: "THREAD_NOT_AVAILABLE" };
    }
    return { ok: false, reason: "COMPOSER_NOT_FOUND" };
  });
}

function dmErrorMessage(reason) {
  if (reason === "SESSION_EXPIRED") return "SESSION_EXPIRED: Facebook redirected to login/checkpoint — reconnect the bot account";
  if (reason === "RECIPIENT_PRIVACY") return "RECIPIENT_PRIVACY: recipient blocks non-friend messages or DMs are closed";
  if (reason === "ACCOUNT_RATE_LIMIT") return "ACCOUNT_RATE_LIMIT: Facebook temporarily limited this bot account";
  if (reason === "THREAD_NOT_AVAILABLE") return "THREAD_NOT_AVAILABLE: Messenger thread is not available for this recipient";
  if (reason === "PROFILE_MESSAGE_BUTTON_MISSING") return "MESSAGE_ACTION_NOT_DETECTED: could not open the profile Message/مراسلة/إرسال action";
  return "COMPOSER_NOT_FOUND: could not find Messenger message box";
}

async function openViaMessenger(page, profile) {
  const mUrl = toMessengerUrl(profile);
  if (!mUrl) return { ok: false, reason: "NO_NUMERIC_ID" };
  try {
    await page.goto(mUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (_) { return { ok: false, reason: "MESSENGER_NAV_FAILED" }; }
  // Messenger lazy-loads — give it a real chance before declaring failure.
  if (await waitForComposer(page, 12000)) return { ok: true, reason: null };
  return await diagnoseDmPage(page);
}

async function waitForComposer(page, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await findComposer(page)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function clickVisibleMessageAction(page) {
  const locators = [
    page.getByRole("button", { name: MESSAGE_ACTION_RE }),
    page.getByRole("link", { name: MESSAGE_ACTION_RE }),
    page.getByText(MESSAGE_ACTION_RE),
    page.locator('[aria-label*="مراسلة"], [aria-label*="رسالة"], [aria-label*="إرسال"], [aria-label*="ارسال"], [aria-label*="Message" i], [aria-label*="Messenger" i], [title*="مراسلة"], [title*="رسالة"], [title*="إرسال"], [title*="Message" i], [title*="Messenger" i]'),
    page.locator('a[href*="/messages/t/"], a[href*="m.me/"]'),
  ];
  for (const locator of locators) {
    try {
      const count = Math.min(await locator.count(), 8);
      for (let i = 0; i < count; i += 1) {
        const item = locator.nth(i);
        if (await item.isVisible({ timeout: 1000 }).catch(() => false)) {
          await item.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
          await item.click({ timeout: 5000 });
          return true;
        }
      }
    } catch (_) { /* try next locator */ }
  }
  return false;
}

async function openViaProfile(page, profile) {
  const url = toProfileUrl(profile);
  if (!url) return { ok: false, reason: "NO_PROFILE_URL" };
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (_) { return { ok: false, reason: "PROFILE_NAV_FAILED" }; }
  // Group-member mini-profiles render the action bar after a short delay.
  await new Promise((r) => setTimeout(r, 6000));
  if (/\/login|checkpoint/i.test(page.url())) return { ok: false, reason: "SESSION_EXPIRED" };

  // Nudge the page so lazy action buttons hydrate.
  await page.evaluate(() => { window.scrollBy(0, 200); window.scrollBy(0, -200); }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));

  let clicked = await page.evaluate(async () => {
    const normalize = (v) => String(v || "").replace(/\s+/g, " ").trim();
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const MESSAGE_RE = /Message|Messenger|Send message|Send a message|Private message|رسالة|مراسلة|راسل|إرسال رسالة|ارسال رسالة|إرسل رسالة|ارسل رسالة|إرسال|ارسال/i;
    const NEGATIVE_RE = /Add friend|Friend request|Follow|Following|Unfollow|Like|Share|Comment|Search|Block|Report|Copy link|Invite|Join|View profile|See more|Menu|More|إضافة صديق|طلب صداقة|صديق|متابعة|إلغاء المتابعة|إعجاب|مشاركة|تعليق|بحث|حظر|إبلاغ|نسخ الرابط|دعوة|انضمام|عرض الملف|مشاهدة الملف|القائمة|المزيد|خيارات/i;
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return r.width > 8 && r.height > 8 && r.bottom > 0 && r.right > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const clickableOf = (el) => el.closest?.('a[href], [role="button"], [role="link"], [tabindex="0"], [aria-label], div[role="button"]') || el;
    const labelOf = (el) => {
      const target = clickableOf(el);
      const describedBy = normalize((target.getAttribute("aria-describedby") || "").split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" "));
      const own = [
        target.innerText,
        target.textContent,
        target.getAttribute("aria-label"),
        target.getAttribute("title"),
        target.getAttribute("data-tooltip-content"),
        target.getAttribute("data-tooltiptext"),
        target.getAttribute("href"),
        describedBy,
      ];
      const parent = target.parentElement ? [target.parentElement.getAttribute("aria-label"), target.parentElement.getAttribute("title")] : [];
      return normalize([...own, ...parent].filter(Boolean).join(" "));
    };
    const isMessageAction = (el) => {
      const label = labelOf(el);
      if (!label) return false;
      const href = el.getAttribute?.("href") || clickableOf(el).getAttribute?.("href") || "";
      if (/\/messages\/(t\/)?\d|m\.me\//i.test(href)) return true;
      if (!MESSAGE_RE.test(label)) return false;
      // Standalone Arabic "إرسال/ارسال" is valid for Facebook's localized profile message action,
      // but never click obvious friend/share/search/navigation actions.
      return !NEGATIVE_RE.test(label.replace(/إرسال رسالة|ارسال رسالة|إرسل رسالة|ارسل رسالة|Message|Messenger/gi, ""));
    };
    const clickElement = (el) => {
      const target = clickableOf(el);
      target.scrollIntoView?.({ block: "center", inline: "center" });
      target.click();
      return true;
    };
    const scoreAction = (el) => {
      const label = labelOf(el);
      const href = el.getAttribute?.("href") || clickableOf(el).getAttribute?.("href") || "";
      if (/\/messages\/(t\/)?\d|m\.me\//i.test(href)) return 100;
      if (/^(Message|Messenger|رسالة|مراسلة|إرسال رسالة|ارسال رسالة)$/i.test(label)) return 90;
      if (/Message|Messenger|مراسلة|إرسال رسالة|ارسال رسالة|رسالة/i.test(label)) return 80;
      if (/(^|\s)(إرسال|ارسال)(\s|$)/i.test(label) && !NEGATIVE_RE.test(label)) return 70;
      return 0;
    };
    const getActions = () => Array.from(document.querySelectorAll(
      'a[href], [role="button"], [role="link"], [tabindex="0"], [aria-label], [title], div[role="button"], span[role="button"]'
    )).map(clickableOf).filter((el, index, arr) => arr.indexOf(el) === index && isVisible(el));

    // 1) Direct Messenger link wins.
    const direct = getActions().find((el) => /\/messages\/(t\/)?\d|m\.me\//i.test(el.getAttribute("href") || ""));
    if (direct) return clickElement(direct);

    // 2) Visible action button labelled Message / مراسلة / إرسال (including text in child spans or aria labels).
    let target = getActions()
      .map((el) => ({ el, score: scoreAction(el) }))
      .filter((x) => x.score > 0 && isMessageAction(x.el))
      .sort((a, b) => b.score - a.score)[0]?.el;
    if (target) return clickElement(target);

    // 3) Open any overflow menus and look again.
    const menus = getActions().filter((b) => {
      const aria = normalize(b.getAttribute("aria-label") || b.getAttribute("title"));
      const text = normalize(b.innerText || b.textContent);
      return /^(More|Menu|Actions|Options|المزيد|خيارات|إجراءات|⋯|\.\.\.)$/i.test(text) || /More|Menu|Actions|Options|See more options|Profile actions|المزيد|خيارات|خيارات أخرى|إجراءات|عرض المزيد/i.test(aria);
    });
    for (const menu of menus.slice(0, 4)) {
      clickElement(menu);
      await wait(900);
      const items = Array.from(document.querySelectorAll(
        '[role="menuitem"], [role="menuitemradio"], [role="button"], [role="link"], a[href], [tabindex="0"], [aria-label]'
      )).map(clickableOf).filter((el, index, arr) => arr.indexOf(el) === index && isVisible(el));
      const item = items
        .map((el) => ({ el, score: scoreAction(el) }))
        .filter((x) => x.score > 0 && isMessageAction(x.el))
        .sort((a, b) => b.score - a.score)[0]?.el;
      if (item) return clickElement(item);
    }
    return false;
  });

  if (!clicked) clicked = await clickVisibleMessageAction(page);
  if (!clicked) return { ok: false, reason: "PROFILE_MESSAGE_BUTTON_MISSING" };
  await waitForComposer(page, 12000);
  return await diagnoseDmPage(page);
}


async function sendToOne(page, profile, message, imagePath) {
  // 1) Preferred: open Messenger thread directly (works for /groups/.../user/<id>/ too).
  let opened = await openViaMessenger(page, profile);
  // 2) Fallback: visit the profile and click the Message button.
  if (!opened.ok) {
    const fallback = await openViaProfile(page, profile);
    opened = fallback.ok ? fallback : opened.reason === "SESSION_EXPIRED" ? opened : fallback;
  }
  if (!opened.ok) {
    return { status: "failed", error: dmErrorMessage(opened.reason) };
  }

  if (imagePath) {
    try { await attachImage(page, imagePath); } catch (_) { /* send text only */ }
  }

  const typed = await page.evaluate((msg) => {
    const normalize = (v) => String(v || "").replace(/\s+/g, " ").trim();
    const candidates = Array.from(document.querySelectorAll('[contenteditable="true"]'));
    const editor = candidates.find((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 40 || r.height <= 12 || r.bottom <= 0 || r.right <= 0) return false;
      const label = normalize([
        el.getAttribute("aria-label"),
        el.getAttribute("aria-placeholder"),
        el.getAttribute("placeholder"),
        el.getAttribute("data-testid"),
        el.getAttribute("role"),
      ].filter(Boolean).join(" "));
      if (/search|بحث|comment|تعليق|post|منشور/i.test(label)) return false;
      if (/(^|\s)(Aa|Message|Type a message|Write a message|رسالة|اكتب رسالة|اكتب رسالتك)(\s|$)/i.test(label)) return true;
      const hasMessengerUi = /Messenger|ماسنجر|الدردشات|الرسائل والمكالمات/i.test(document.body?.innerText || "");
      return hasMessengerUi && r.top > window.innerHeight * 0.35 && r.height <= 90;
    });
    if (!editor) return false;
    editor.focus();
    document.execCommand("insertText", false, msg);
    return true;
  }, message);
  if (!typed) return { status: "failed", error: dmErrorMessage("COMPOSER_NOT_FOUND") };

  await new Promise((r) => setTimeout(r, 1500));
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => {
    const normalize = (v) => String(v || "").replace(/\s+/g, " ").trim();
    const buttons = Array.from(document.querySelectorAll('[role="button"], [aria-label], [data-testid]'));
    const send = buttons.find((el) => {
      const label = `${normalize(el.textContent)} ${normalize(el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("data-testid"))}`;
      return /(Send|إرسال)/i.test(label);
    });
    if (send) send.click();
  });
  await new Promise((r) => setTimeout(r, 2500));

  return { status: "success" };
}


async function runSendMessengerDm({ page, job, report }) {
  const { recipients = [], message = "", intervalSeconds = 180, imageUrls = [] } = job.payload || {};
  if (!Array.isArray(recipients) || recipients.length === 0) {
    await report({ status: "failed", errorMessage: "No recipients" });
    return;
  }
  if (!message || !message.trim()) {
    await report({ status: "failed", errorMessage: "Empty message" });
    return;
  }

  // Pre-download images once to a tmp file each; rotate across sends.
  const localImages = [];
  for (const url of Array.isArray(imageUrls) ? imageUrls : []) {
    try { localImages.push(await downloadToTmp(url)); } catch (e) { console.warn("[dm] image download failed", url, e.message); }
  }

  const wait = Math.max(30, Math.min(Number(intervalSeconds) || 180, 3600)) * 1000;
  let done = 0;
  for (const r of recipients) {
    const personalized = message.replace(/\{name\}/gi, r.name || "");
    const img = localImages.length ? localImages[done % localImages.length] : null;
    const res = await sendToOne(page, r.profile, personalized, img);
    await report({
      result: { target: r.profile, status: res.status, error: res.error, data: { name: r.name ?? null, image: img ? path.basename(img) : null } },
      processedItems: ++done,
      totalItems: recipients.length,
      progress: Math.min(99, Math.round((done / recipients.length) * 100)),
    });
    const jitter = Math.floor(Math.random() * (wait * 0.3));
    await new Promise((r2) => setTimeout(r2, wait + jitter));
  }

  // Cleanup tmp images
  for (const p of localImages) { try { fs.unlinkSync(p); } catch (_) { /* ignore */ } }

  await report({ status: "completed", processedItems: done, totalItems: recipients.length, progress: 100 });
}

module.exports = { runSendMessengerDm };
