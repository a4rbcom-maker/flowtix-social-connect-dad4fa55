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
  await new Promise(r => setTimeout(r, 6000));

  // Detect login / access issues early
  const access = await page.evaluate(() => {
    const t = document.body ? document.body.innerText : "";
    return {
      url: location.href,
      hasLogin: /log in|تسجيل الدخول|login/i.test(t) && location.href.includes("/login"),
      hasJoin: /Join group|انضمام إلى المجموعة|طلب الانضمام/i.test(t),
      bodyLen: t.length,
    };
  });
  if (access.hasLogin || access.url.includes("/login")) {
    if (job.account?.id) {
      await report({ accountStatus: { accountId: job.account.id, status: "invalid", error: "Session cookies rejected by Facebook" } });
    }
    await report({ status: "failed", errorMessage: "SESSION_EXPIRED: انتهت صلاحية جلسة حساب فيسبوك المرتبط. أعد تصدير الكوكيز وحدّث الحساب." });
    return;
  }

  const seen = new Set();
  const cap = Math.min(Math.max(50, Number(maxMembers) || 2000), 5000);
  const keywords = (Array.isArray(filterKeywords) ? filterKeywords : [])
    .map((k) => String(k).trim().toLowerCase()).filter(Boolean);

  let emptyScrolls = 0;
  const maxScrolls = 250;
  let rawSeenTotal = 0; // total raw profiles found before keyword filter

  for (let i = 0; i < maxScrolls && seen.size < cap && emptyScrolls < 6; i++) {
    const batch = await page.evaluate(() => {
      const out = [];
      // Members page uses listitem cards; also fall back to any profile/user link
      const cards = Array.from(document.querySelectorAll('div[role="listitem"], div[data-visualcompletion="ignore-dynamic"] > div > div'));
      const scope = cards.length > 0 ? cards : [document.body];

      const seenLocal = new Set();
      for (const card of scope) {
        const links = card.querySelectorAll('a[href*="/user/"], a[href*="/groups/"][href*="/user/"], a[href*="profile.php?id="], a[role="link"][href^="/"]');
        for (const a of links) {
          const href = a.getAttribute("href") || "";
          const name = (a.textContent || "").trim();
          if (!name || name.length < 2 || name.length > 80) continue;
          // skip obvious non-name links
          if (/^(Add friend|Message|إضافة صديق|رسالة|متابعة|Follow)$/i.test(name)) continue;

          let id = null;
          const m1 = href.match(/\/user\/(\d+)/);
          const m2 = href.match(/profile\.php\?id=(\d+)/);
          if (m1) id = m1[1];
          else if (m2) id = m2[1];
          else {
            const slug = href.match(/^\/([A-Za-z0-9.][A-Za-z0-9._-]{2,})(?:\/|$|\?)/);
            if (slug && !["groups","pages","events","watch","marketplace","profile.php","photo","reel","stories","help","privacy","policies","login","reg","messages","settings","notifications"].includes(slug[1])) {
              id = slug[1];
            }
          }
          if (!id) continue;
          if (seenLocal.has(id)) continue;
          seenLocal.add(id);

          const cardText = (card.textContent || "").trim().slice(0, 600);
          const profile = href.startsWith("http") ? href.split("?")[0] : `https://www.facebook.com${href.split("?")[0]}`;
          out.push({ id, name, profile, cardText });
          break; // one member per card
        }
      }
      return out;
    });

    let newCount = 0;
    for (const m of batch) {
      if (seen.has(m.id)) continue;
      rawSeenTotal++;
      if (keywords.length > 0) {
        const blob = m.cardText.toLowerCase();
        if (!keywords.some((k) => blob.includes(k))) continue;
      }
      seen.add(m.id);
      newCount++;
      const bio = m.cardText.split(m.name).slice(1).join(m.name).trim().slice(0, 200);
      await report({
        result: {
          target: m.id,
          status: "success",
          data: {
            fb_user_id: m.id,
            name: m.name,
            profile_url: m.profile,
            bio_snippet: bio,
            source: "group",
            source_id: groupId,
          },
        },
      });
      if (seen.size >= cap) break;
    }
    if (newCount === 0) emptyScrolls++; else emptyScrolls = 0;

    await page.evaluate(() => window.scrollBy(0, 2000));
    await new Promise(r => setTimeout(r, rand(2200, 4500)));

    await report({
      progress: Math.min(99, Math.round((seen.size / cap) * 100)),
      processedItems: seen.size,
      totalItems: cap,
      status: "running",
    });
  }

  if (seen.size === 0) {
    let reason;
    if (rawSeenTotal === 0) {
      reason = `No member cards found on page. Likely causes: account not a member of the group, group requires approval, or Facebook DOM changed. URL=${access.url}`;
    } else {
      reason = `Found ${rawSeenTotal} members but all were filtered out by keywords [${keywords.join(", ")}]. Try removing the keyword filter.`;
    }
    await report({ status: "failed", errorMessage: reason, progress: 100 });
    return;
  }

  await report({
    progress: 100,
    processedItems: seen.size,
    totalItems: seen.size,
    status: "completed",
  });
}

module.exports = { runExtractGroupMembers };
