// Post a message to multiple groups, with random delay range, spin syntax, and media support.
const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");
const http = require("http");

function expandSpin(text) {
  return (text || "").replace(/\{\{spin:([^}]+)\}\}/g, (_, options) => {
    const choices = options.split("|");
    return choices[Math.floor(Math.random() * choices.length)];
  });
}

function randomBetween(min, max) {
  const lo = Math.max(0, Math.min(min, max));
  const hi = Math.max(min, max);
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

function downloadToTmp(url) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const client = u.protocol === "http:" ? http : https;
      const ext = path.extname(u.pathname).split("?")[0] || ".bin";
      const tmp = path.join(os.tmpdir(), `flowtix-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
      const file = fs.createWriteStream(tmp);
      client.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close(); fs.unlink(tmp, () => {});
          return downloadToTmp(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) { file.close(); fs.unlink(tmp, () => {}); return reject(new Error(`Download ${res.statusCode}`)); }
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve(tmp)));
      }).on("error", (err) => { file.close(); fs.unlink(tmp, () => {}); reject(err); });
    } catch (err) { reject(err); }
  });
}

async function attachMedia(page, filePaths) {
  // Find a file input inside the open dialog (Facebook lazily renders one when "Photo/video" is clicked).
  // Try to click the photo/video button first.
  const photoBtnSel = '[role="dialog"] [aria-label*="Photo"], [role="dialog"] [aria-label*="صورة"], [role="dialog"] [aria-label*="فيديو"]';
  const photoBtn = await page.$(photoBtnSel);
  if (photoBtn) { try { await photoBtn.click(); } catch {} }
  await new Promise(r => setTimeout(r, 800));

  const input = await page.waitForSelector('[role="dialog"] input[type="file"]', { timeout: 8000 }).catch(() => null);
  if (!input) throw new Error("Could not find media upload input");
  await input.uploadFile(...filePaths);
  // wait for thumbnails to appear
  await new Promise(r => setTimeout(r, 4000 + filePaths.length * 1500));
}

async function runPostToGroups({ page, job, report }) {
  const p = job.payload || {};
  const content = p.content || "";
  const groupIds = p.groupIds || [];
  const mediaUrls = Array.isArray(p.mediaUrls) ? p.mediaUrls : [];
  const delayMin = Number.isFinite(p.delayMinSeconds) ? p.delayMinSeconds : (p.intervalMinutes || 1) * 60;
  const delayMax = Number.isFinite(p.delayMaxSeconds) ? p.delayMaxSeconds : delayMin + 15;

  const total = groupIds.length;
  let processed = 0;

  // Pre-download media once for the whole campaign.
  let mediaFiles = [];
  if (mediaUrls.length > 0) {
    await report({
      result: {
        target: "__media__",
        status: "skipped",
        data: { event: "media_download_start", count: mediaUrls.length, at: new Date().toISOString() },
      },
    });
    try {
      const t0 = Date.now();
      mediaFiles = await Promise.all(mediaUrls.map((u) => downloadToTmp(u)));
      await report({
        result: {
          target: "__media__",
          status: "skipped",
          data: {
            event: "media_download_done",
            count: mediaFiles.length,
            durationMs: Date.now() - t0,
            at: new Date().toISOString(),
          },
        },
      });
    } catch (e) {
      await report({
        result: {
          target: "__media__",
          status: "failed",
          error: `Media download failed: ${e.message}`,
          data: { event: "media_download_failed", at: new Date().toISOString() },
        },
      });
      await report({ status: "failed", errorMessage: `Media download failed: ${e.message}` });
      return;
    }
  }

  try {
    for (const gid of groupIds) {
      try {
        await page.goto(`https://www.facebook.com/groups/${gid}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));

        // Click "Write something"
        const composerSel = '[role="button"][aria-label*="Write"], [role="button"][aria-label*="اكتب"]';
        const composer = await page.waitForSelector(composerSel, { timeout: 15_000 });
        await composer.click();
        await new Promise(r => setTimeout(r, 1500));

        // Type into the editable composer
        const editableSel = '[role="dialog"] [contenteditable="true"]';
        await page.waitForSelector(editableSel, { timeout: 10_000 });
        if (content) await page.type(editableSel, expandSpin(content), { delay: 25 });
        await new Promise(r => setTimeout(r, 800));

        // Attach media if any
        if (mediaFiles.length > 0) {
          const tUp = Date.now();
          await attachMedia(page, mediaFiles);
          await report({
            result: {
              target: "__media__",
              status: "skipped",
              data: {
                event: "media_upload_done",
                target: gid,
                count: mediaFiles.length,
                durationMs: Date.now() - tUp,
                at: new Date().toISOString(),
              },
            },
          });
        }

        // Click Post
        const postBtn = await page.$('[role="dialog"] [aria-label="Post"], [role="dialog"] [aria-label="نشر"]');
        if (postBtn) await postBtn.click();
        await new Promise(r => setTimeout(r, 6000));

        processed++;
        await report({
          progress: Math.round((processed / total) * 100),
          processedItems: processed,
          result: { target: gid, status: "success" },
        });
      } catch (e) {
        processed++;
        await report({
          progress: Math.round((processed / total) * 100),
          processedItems: processed,
          result: { target: gid, status: "failed", error: String(e.message || e) },
        });
      }

      // Random delay between groups
      if (processed < total) {
        const wait = randomBetween(delayMin, delayMax) * 1000;
        await new Promise(r => setTimeout(r, wait));
      }
    }
    await report({ status: "completed" });
  } finally {
    // Cleanup temp media files
    const cleanedCount = mediaFiles.length;
    await Promise.all(
      mediaFiles.map((f) => new Promise((resolve) => fs.unlink(f, () => resolve()))),
    );
    if (cleanedCount > 0) {
      await report({
        result: {
          target: "__media__",
          status: "skipped",
          data: {
            event: "media_cleanup_done",
            count: cleanedCount,
            at: new Date().toISOString(),
          },
        },
      });
    }
  }
}

module.exports = { runPostToGroups };
