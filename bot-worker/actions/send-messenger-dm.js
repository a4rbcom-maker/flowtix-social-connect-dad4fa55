// Sends a Messenger DM to a list of Facebook profiles.
// Payload: { recipients: [{profile, name?}], message, intervalSeconds }
// {name} in message is replaced by recipient's name.

function toProfileUrl(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s.split("?")[0].replace(/\/$/, "");
  if (/^\d{5,}$/.test(s)) return `https://www.facebook.com/profile.php?id=${s}`;
  return `https://www.facebook.com/${s.replace(/^\/+/, "").replace(/\/$/, "")}`;
}

async function sendToOne(page, profile, message) {
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
  const { recipients = [], message = "", intervalSeconds = 180 } = job.payload || {};
  if (!Array.isArray(recipients) || recipients.length === 0) {
    await report({ status: "failed", errorMessage: "No recipients" });
    return;
  }
  if (!message || !message.trim()) {
    await report({ status: "failed", errorMessage: "Empty message" });
    return;
  }

  const wait = Math.max(30, Math.min(Number(intervalSeconds) || 180, 3600)) * 1000;
  let done = 0;
  for (const r of recipients) {
    const personalized = message.replace(/\{name\}/gi, r.name || "");
    const res = await sendToOne(page, r.profile, personalized);
    await report({
      result: { target: r.profile, status: res.status, error: res.error, data: { name: r.name ?? null } },
      processedItems: ++done,
      progress: Math.min(99, Math.round((done / recipients.length) * 100)),
    });
    // jittered wait between sends
    const jitter = Math.floor(Math.random() * (wait * 0.3));
    await new Promise((r2) => setTimeout(r2, wait + jitter));
  }

  await report({ status: "completed", processedItems: done, progress: 100 });
}

module.exports = { runSendMessengerDm };
