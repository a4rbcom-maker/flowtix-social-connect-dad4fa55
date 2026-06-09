// Extracts visible members of a public/joined Facebook group.
// Strategy: open /groups/{id}/members, scroll progressively, parse name + profile link + id.

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function runExtractGroupMembers({ page, job, report }) {
  const { groupId, maxMembers = 2000, filterKeywords = [] } = job.payload || {};
  if (!groupId) {
    await report({ status: "failed", errorMessage: "Missing groupId in payload" });
    return;
  }

  const url = `https://www.facebook.com/groups/${groupId}/members`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(5000);

  const seen = new Set();
  const cap = Math.min(Math.max(50, Number(maxMembers) || 2000), 5000);
  const keywords = (Array.isArray(filterKeywords) ? filterKeywords : [])
    .map((k) => String(k).trim().toLowerCase()).filter(Boolean);

  let emptyScrolls = 0;
  const maxScrolls = 200;

  for (let i = 0; i < maxScrolls && seen.size < cap && emptyScrolls < 4; i++) {
    const batch = await page.evaluate(() => {
      const out = [];
      const links = Array.from(document.querySelectorAll(
        'a[href*="/groups/"][href*="/user/"], a[href*="facebook.com/profile.php"], a[href^="/"][role="link"]'
      ));
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        const name = (a.textContent || "").trim();
        if (!name || name.length < 2 || name.length > 80) continue;

        let id = null;
        const m1 = href.match(/\/user\/(\d+)/);
        const m2 = href.match(/profile\.php\?id=(\d+)/);
        if (m1) id = m1[1];
        else if (m2) id = m2[1];
        else {
          const slug = href.match(/facebook\.com\/([A-Za-z0-9._-]+)(?:\/|$|\?)/);
          if (slug && !["groups", "pages", "events", "watch", "marketplace", "profile.php"].includes(slug[1])) {
            id = slug[1];
          }
        }
        if (!id) continue;

        // Try to grab a small bio snippet from the card's parent
        let bio = "";
        const card = a.closest('[role="listitem"], div[data-pagelet], li, div');
        if (card) {
          const text = (card.textContent || "").trim();
          // Take text after the name (up to ~120 chars) — likely the bio/role
          const after = text.split(name).slice(1).join(name).trim();
          bio = after.slice(0, 160);
        }
        const profile = href.startsWith("http") ? href.split("?")[0] : `https://www.facebook.com${href.split("?")[0]}`;
        out.push({ id, name, profile, bio });
      }
      return out;
    });

    let newCount = 0;
    for (const m of batch) {
      if (seen.has(m.id)) continue;
      if (keywords.length > 0) {
        const blob = `${m.name} ${m.bio}`.toLowerCase();
        if (!keywords.some((k) => blob.includes(k))) continue;
      }
      seen.add(m.id);
      newCount++;
      await report({
        result: {
          target: m.id,
          status: "success",
          data: {
            fb_user_id: m.id,
            name: m.name,
            profile_url: m.profile,
            bio_snippet: m.bio,
            source: "group",
            source_id: groupId,
          },
        },
      });
      if (seen.size >= cap) break;
    }
    if (newCount === 0) emptyScrolls++; else emptyScrolls = 0;

    await page.evaluate(() => window.scrollBy(0, 1800));
    await page.waitForTimeout(rand(2000, 4500));

    await report({
      progress: Math.min(99, Math.round((seen.size / cap) * 100)),
      processedItems: seen.size,
      totalItems: cap,
      status: "running",
    });
  }

  await report({
    progress: 100,
    processedItems: seen.size,
    totalItems: seen.size,
    status: "completed",
  });
}

module.exports = { runExtractGroupMembers };
