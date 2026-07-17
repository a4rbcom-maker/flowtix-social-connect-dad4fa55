// Broadcasts a message from a Page inbox to the given PSIDs, using cookies.
// Payload: { pageId, text, imageUrl?, intervalSeconds, recipients: [{psid, name}] }
const os = require("os");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");

function downloadToTmp(url) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const client = u.protocol === "http:" ? http : https;
      const ext = (path.extname(u.pathname) || ".jpg").slice(0, 8);
      const tmp = path.join(os.tmpdir(), `mm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
      const file = fs.createWriteStream(tmp);
      client.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 400) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(tmp)));
      }).on("error", reject);
    } catch (e) { reject(e); }
  });
}

async function findComposer(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[contenteditable="true"]'));
    return nodes.some((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 12 && r.bottom > 0;
    });
  });
}

async function waitForComposer(page, timeoutMs = 15_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await findComposer(page)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function sendOne(page, pageId, psid, text, imagePath) {
  const url = `https://www.facebook.com/messages/t/${psid}?entry_point=page_inbox&page_id=${encodeURIComponent(pageId)}`;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  } catch (e) {
    return { status: "failed", error: `NAV_FAILED: ${e.message}` };
  }
  if (/\/login|checkpoint/i.test(page.url())) return { status: "failed", error: "SESSION_EXPIRED" };
  const ok = await waitForComposer(page, 15_000);
  if (!ok) return { status: "failed", error: "COMPOSER_NOT_FOUND" };

  if (imagePath) {
    try {
      const input = await page.$('input[type="file"]');
      if (input) {
        await input.uploadFile(imagePath);
        await new Promise((r) => setTimeout(r, 3500));
      }
    } catch (_) { /* text only */ }
  }

  const typed = await page.evaluate((msg) => {
    const el = Array.from(document.querySelectorAll('[contenteditable="true"]')).find((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 40 && r.height > 12 && r.bottom > 0;
    });
    if (!el) return false;
    el.focus();
    document.execCommand("insertText", false, msg);
    return true;
  }, text);
  if (!typed) return { status: "failed", error: "COMPOSER_TYPE_FAILED" };
  await new Promise((r) => setTimeout(r, 1200));
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 2000));
  return { status: "success" };
}

async function runMessengerSendCookies({ page, job, report }) {
  const { pageId, text = "", imageUrl = null, intervalSeconds = 6, recipients = [] } = job.payload || {};
  if (!pageId) { await report({ status: "failed", errorMessage: "pageId is required" }); return; }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    await report({ status: "failed", errorMessage: "No recipients" }); return;
  }
  if (!text.trim()) { await report({ status: "failed", errorMessage: "Empty text" }); return; }

  let localImage = null;
  if (imageUrl) {
    try { localImage = await downloadToTmp(imageUrl); }
    catch (e) { console.warn("[mm] image download failed", e.message); }
  }

  const wait = Math.max(3, Math.min(Number(intervalSeconds) || 6, 600)) * 1000;
  let done = 0;
  for (const r of recipients) {
    const personalized = text.replace(/\{name\}/gi, r.name || "");
    const res = await sendOne(page, pageId, r.psid, personalized, localImage);
    await report({
      result: { target: String(r.psid), status: res.status, error: res.error, data: { name: r.name ?? null } },
      processedItems: ++done,
      totalItems: recipients.length,
      progress: Math.min(99, Math.round((done / recipients.length) * 100)),
    });
    const jitter = Math.floor(Math.random() * wait * 0.3);
    await new Promise((r2) => setTimeout(r2, wait + jitter));
  }
  if (localImage) { try { fs.unlinkSync(localImage); } catch (_) { /* ignore */ } }
  await report({ status: "completed", processedItems: done, totalItems: recipients.length, progress: 100 });
}

module.exports = { runMessengerSendCookies };
