// Post a message to multiple groups, with delay + spin syntax support.
function expandSpin(text) {
  return text.replace(/\{\{spin:([^}]+)\}\}/g, (_, options) => {
    const choices = options.split("|");
    return choices[Math.floor(Math.random() * choices.length)];
  });
}

async function runPostToGroups({ page, job, report }) {
  const { content, groupIds, intervalMinutes } = job.payload;
  const total = groupIds.length;
  let processed = 0;

  for (const gid of groupIds) {
    try {
      await page.goto(`https://www.facebook.com/groups/${gid}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(3000 + Math.random() * 2000);

      // Click "Write something"
      const composerSel = '[role="button"][aria-label*="Write"], [role="button"][aria-label*="اكتب"]';
      const composer = await page.waitForSelector(composerSel, { timeout: 15_000 });
      await composer.click();
      await page.waitForTimeout(1500);

      // Type into the editable composer
      const editableSel = '[role="dialog"] [contenteditable="true"]';
      await page.waitForSelector(editableSel, { timeout: 10_000 });
      await page.type(editableSel, expandSpin(content), { delay: 25 });
      await page.waitForTimeout(1200);

      // Click Post
      const postBtn = await page.$('[role="dialog"] [aria-label="Post"], [role="dialog"] [aria-label="نشر"]');
      if (postBtn) await postBtn.click();
      await page.waitForTimeout(5000);

      processed++;
      await report({
        progress: Math.round((processed / total) * 100),
        processedItems: processed,
        result: { target: gid, status: "success" },
      });

      // Delay between groups (jittered)
      if (processed < total) {
        const wait = intervalMinutes * 60_000 + Math.floor(Math.random() * 15_000);
        await page.waitForTimeout(wait);
      }
    } catch (e) {
      processed++;
      await report({
        progress: Math.round((processed / total) * 100),
        processedItems: processed,
        result: { target: gid, status: "failed", error: String(e.message || e) },
      });
    }
  }
  await report({ status: "completed" });
}

module.exports = { runPostToGroups };
