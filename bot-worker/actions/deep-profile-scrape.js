// Deep Profile Scrape — visits each Facebook profile and extracts public
// Bio / intro / city / work / education / contact text. Best-effort; FB
// hides most data from non-friends, so we extract whatever is visible.

function toProfileUrl(input) {
  const s = String(input || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s.split("?")[0].replace(/\/$/, "");
  if (/^\d{5,}$/.test(s)) return `https://www.facebook.com/profile.php?id=${s}`;
  return `https://www.facebook.com/${s.replace(/^\/+/, "").replace(/\/$/, "")}`;
}

function aboutUrl(profileUrl) {
  if (profileUrl.includes("profile.php?id=")) {
    return profileUrl + "&sk=about_contact_and_basic_info";
  }
  return profileUrl + "/about_contact_and_basic_info";
}

const PHONE_RE = /(?:\+?\d[\s\-().]?){8,15}\d/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

async function scrapeOne(page, rawTarget) {
  const profileUrl = toProfileUrl(rawTarget);
  if (!profileUrl) return { target: rawTarget, status: "failed", error: "invalid profile" };

  try {
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 3500));

    if (/\/login|checkpoint/i.test(page.url())) {
      return { target: rawTarget, status: "failed", error: "session lost / login required" };
    }

    // Try About → contact & basic info for richer data
    let aboutText = "";
    try {
      await page.goto(aboutUrl(profileUrl), { waitUntil: "domcontentloaded", timeout: 45_000 });
      await new Promise((r) => setTimeout(r, 2500));
      aboutText = await page.evaluate(() => document.body ? document.body.innerText : "");
    } catch { /* ignore */ }

    // Main profile snapshot
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));

    const snap = await page.evaluate(() => {
      const name = document.querySelector("h1")?.innerText?.trim() || "";
      const bodyText = document.body ? document.body.innerText : "";
      // Try to grab a few intro lines (usually inside a card under the cover photo)
      const intro = Array.from(document.querySelectorAll("div[role='main'] div"))
        .map((el) => el.innerText || "")
        .filter((t) => t && t.length < 400 && /lives in|works at|studied|from|يعيش|يعمل|درس|من /i.test(t))
        .slice(0, 8);
      return { name, bodyText: bodyText.slice(0, 8000), intro };
    });

    const combined = `${snap.bodyText}\n${aboutText}`;
    const phones = Array.from(new Set((combined.match(PHONE_RE) || []).map((p) => p.replace(/[^\d+]/g, "")).filter((p) => p.length >= 9 && p.length <= 15)));
    const emails = Array.from(new Set(combined.match(EMAIL_RE) || []));

    // Simple keyword extraction for city / work / education
    const cityMatch = combined.match(/(?:Lives in|From|يعيش في|من)\s+([^\n،,]{2,60})/i);
    const workMatch = combined.match(/(?:Works at|يعمل (?:في|لدى))\s+([^\n،,]{2,80})/i);
    const eduMatch  = combined.match(/(?:Studied at|Studies at|درس في|يدرس في)\s+([^\n،,]{2,80})/i);

    return {
      target: rawTarget,
      status: "success",
      data: {
        profile: profileUrl,
        name: snap.name || null,
        intro: snap.intro,
        city: cityMatch ? cityMatch[1].trim() : null,
        work: workMatch ? workMatch[1].trim() : null,
        education: eduMatch ? eduMatch[1].trim() : null,
        phones,
        emails,
        bio: aboutText ? aboutText.slice(0, 2000) : null,
      },
    };
  } catch (e) {
    return { target: rawTarget, status: "failed", error: String(e.message || e) };
  }
}

async function runDeepProfileScrape({ page, job, report }) {
  const { profiles = [] } = job.payload || {};
  if (!Array.isArray(profiles) || profiles.length === 0) {
    await report({ status: "failed", errorMessage: "No profiles provided" });
    return;
  }

  let done = 0;
  let consecutiveFailures = 0;
  let sessionLost = false;

  for (let i = 0; i < profiles.length; i++) {
    const target = profiles[i];
    let result;
    try {
      // Hard per-profile timeout so one slow page can't stall the whole job.
      result = await Promise.race([
        scrapeOne(page, target),
        new Promise((resolve) => setTimeout(
          () => resolve({ target, status: "failed", error: "per-profile timeout (90s)" }),
          90_000,
        )),
      ]);
    } catch (e) {
      result = { target, status: "failed", error: String(e && e.message || e) };
    }

    if (result.status === "failed" && /login|checkpoint|session/i.test(result.error || "")) {
      sessionLost = true;
    }

    await report({
      result,
      processedItems: ++done,
      totalItems: profiles.length,
      progress: Math.min(99, Math.round((done / profiles.length) * 100)),
    });

    if (result.status === "success") {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
    }

    // Abort early if FB clearly killed the session — the rest will all fail.
    if (sessionLost || consecutiveFailures >= 15) {
      await report({
        status: "failed",
        errorMessage: sessionLost
          ? `Session lost after ${done}/${profiles.length} profiles. Re-sync cookies and resume.`
          : `Aborted: ${consecutiveFailures} consecutive failures at profile ${done}.`,
        processedItems: done,
        totalItems: profiles.length,
      });
      return;
    }

    // Polite jitter between profiles
    await new Promise((r) => setTimeout(r, 2500 + Math.floor(Math.random() * 2500)));
  }

  await report({ status: "completed", processedItems: done, totalItems: profiles.length, progress: 100 });
}

module.exports = { runDeepProfileScrape };
