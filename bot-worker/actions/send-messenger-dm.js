// Sends a Messenger DM to a list of Facebook profiles.
// Payload: { recipients: [{profile, name?}], message, intervalSeconds, imageUrls? }
// {name} in message is replaced by recipient's name.
// If imageUrls is non-empty, an image is attached with each send (round-robin).

const os = require("os");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");

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
    const sel = [
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][aria-label]',
      '[contenteditable="true"][data-lexical-editor="true"]',
      'div[aria-label*="message" i][contenteditable="true"]',
      'div[aria-label*="رسالة"][contenteditable="true"]',
      'div[aria-label*="Aa"][contenteditable="true"]',
      'div[aria-placeholder*="Aa"][contenteditable="true"]',
      'div[aria-label*="Aa"][contenteditable="true"]',
    ];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (el) return true;
    }
    return false;
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
    const hasComposer = !!(
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      document.querySelector('[contenteditable="true"][aria-label]') ||
      document.querySelector('[contenteditable="true"][data-lexical-editor="true"]') ||
      document.querySelector('div[aria-label*="message" i][contenteditable="true"]') ||
      document.querySelector('div[aria-label*="رسالة"][contenteditable="true"]') ||
      document.querySelector('div[aria-label*="Aa"][contenteditable="true"]') ||
      document.querySelector('div[aria-placeholder*="Aa"][contenteditable="true"]')
    );
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
  if (reason === "PROFILE_MESSAGE_BUTTON_MISSING") return "PROFILE_MESSAGE_BUTTON_MISSING: profile has no visible Message button";
  return "COMPOSER_NOT_FOUND: could not find Messenger message box";
}

async function openViaMessenger(page, profile) {
  const mUrl = toMessengerUrl(profile);
  if (!mUrl) return { ok: false, reason: "NO_NUMERIC_ID" };
  try {
    await page.goto(mUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (_) { return { ok: false, reason: "MESSENGER_NAV_FAILED" }; }
  await new Promise((r) => setTimeout(r, 4000));
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
    page.getByRole("button", { name: /^(مراسلة|رسالة|إرسال رسالة|Message|Send message)$/i }),
    page.getByText(/^(مراسلة|رسالة|إرسال رسالة|Message|Send message)$/i),
    page.locator('[aria-label*="مراسلة"], [aria-label*="رسالة"], [aria-label*="Message" i], [title*="مراسلة"], [title*="Message" i]'),
  ];
  for (const locator of locators) {
    try {
      const count = Math.min(await locator.count(), 5);
      for (let i = 0; i < count; i += 1) {
        const item = locator.nth(i);
        if (await item.isVisible({ timeout: 1000 }).catch(() => false)) {
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
  await new Promise((r) => setTimeout(r, 3500));
  if (/\/login|checkpoint/i.test(page.url())) return { ok: false, reason: "SESSION_EXPIRED" };
  let clicked = await page.evaluate(async () => {
    const normalize = (v) => String(v || "").replace(/\s+/g, " ").trim();
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const isMessageAction = (el) => {
      const text = normalize(el.textContent);
      const aria = normalize(el.getAttribute("aria-label") || el.getAttribute("title"));
      const label = `${text} ${aria}`;
      if (/^(إضافة صديق|Add friend|تعرف على الإسهامات|View profile|عرض الملف الشخصي)$/i.test(text)) return false;
      return /(Message|Messenger|Send message|رسالة|مراسلة|إرسال رسالة)/i.test(label);
    };
    const getActions = () => Array.from(document.querySelectorAll('[role="button"], a[role="link"], a[href*="/messages/"], a[href*="m.me/"]'));
    const directLink = getActions().find((el) => /\/messages\/|m\.me\//i.test(el.getAttribute("href") || ""));
    if (directLink) { directLink.click(); return true; }
    const target = getActions().find(isMessageAction);
    if (target) { target.click(); return true; }

    // Some profile/group-member pages hide the Message action under an actions
    // menu. Open likely menus, then search again.
    const menus = getActions().filter((b) => {
      const text = normalize(b.textContent);
      const aria = normalize(b.getAttribute("aria-label") || b.getAttribute("title"));
      return /^(More|Menu|المزيد|خيارات|More options|⋯|\.\.\.)$/i.test(text) || /More|Menu|المزيد|خيارات|See more/i.test(aria);
    });
    for (const menu of menus.slice(0, 3)) {
      menu.click();
      await wait(800);
      const menuItems = getActions().concat(Array.from(document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')));
      const item = menuItems.find(isMessageAction);
      if (item) { item.click(); return true; }
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
    const editor = document.querySelector('[contenteditable="true"][role="textbox"]')
      || document.querySelector('[contenteditable="true"][aria-label]')
      || document.querySelector('[contenteditable="true"][data-lexical-editor="true"]')
      || document.querySelector('div[aria-label*="message" i][contenteditable="true"]')
      || document.querySelector('div[aria-label*="رسالة"][contenteditable="true"]')
      || document.querySelector('div[aria-label*="Aa"][contenteditable="true"]')
      || document.querySelector('div[aria-placeholder*="Aa"][contenteditable="true"]');
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
