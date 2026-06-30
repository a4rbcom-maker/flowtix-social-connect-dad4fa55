// Sends a Messenger DM to a list of Facebook profiles.
// Payload: { recipients: [{profile, name?}], message, intervalSeconds, imageUrls? }
// {name} in message is replaced by recipient's name.
// If imageUrls is non-empty, an image is attached with each send (round-robin).

const os = require("os");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");

function toProfileUrl(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s.split("?")[0].replace(/\/$/, "");
  if (/^\d{5,}$/.test(s)) return `https://www.facebook.com/profile.php?id=${s}`;
  return `https://www.facebook.com/${s.replace(/^\/+/, "").replace(/\/$/, "")}`;
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

async function sendToOne(page, profile, message, imagePath) {
  const url = toProfileUrl(profile);
  if (!url) return { status: "failed", error: "invalid profile" };

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 3500));

  if (/\/login|checkpoint/i.test(page.url())) {
    return { status: "failed", error: "session lost" };
  }

  // Click "Message" button (English/Arabic)
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[role="button"], a[role="link"]'));
    const target = btns.find((b) => /^\s*(Message|رسالة|إرسال رسالة)\s*$/i.test((b.textContent || "").trim()));
    if (target) { target.click(); return true; }
    return false;
  });
  if (!clicked) return { status: "failed", error: "Message button not visible (not friends / closed DMs)" };

  await new Promise((r) => setTimeout(r, 3000));

  if (imagePath) {
    try { await attachImage(page, imagePath); } catch (e) { /* fall through, send text only */ }
  }

  // Find the message composer (contenteditable)
  const typed = await page.evaluate((msg) => {
    const editor = document.querySelector('[contenteditable="true"][role="textbox"]')
      || document.querySelector('div[aria-label*="message" i][contenteditable="true"]')
      || document.querySelector('div[aria-label*="رسالة"][contenteditable="true"]');
    if (!editor) return false;
    editor.focus();
    document.execCommand("insertText", false, msg);
    return true;
  }, message);
  if (!typed) return { status: "failed", error: "composer not found" };

  await new Promise((r) => setTimeout(r, 1500));
  await page.keyboard.press("Enter");
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
