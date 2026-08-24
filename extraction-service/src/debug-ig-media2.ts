/** Probe v2: auto-pick a POPULAR post from a profile, then capture the
 *  likers/comments/hashtag endpoints. Run: npx tsx src/debug-ig-media2.ts <sessionId> <username> <hashtag> */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";
import { config } from "./config.js";

async function main() {
  const sessionId = process.argv[2];
  const username = process.argv[3] || "tourismegypt";
  const hashtag = process.argv[4] || "";
  if (!sessionId) throw new Error("usage: debug-ig-media2 <sessionId> [username] [hashtag]");

  await browserPool.init();
  const { cookies, userAgent } = await igSupabaseService.getIgSessionAndCookies(sessionId);
  const { page, contextId } = await igContextManager.createContext(sessionId, cookies, undefined, userAgent);

  try {
    // Pick a recent post shortcode straight from the profile grid links.
    await page.goto(`${config.igBaseUrl}/${username}/`, { waitUntil: "domcontentloaded", timeout: config.igNavTimeoutMs });
    await page.waitForTimeout(3500);
    // Scroll the grid to force posts to load, then read links.
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 1000);
      await page.waitForTimeout(1200);
    }
    let sc = await page.evaluate(() => {
      const a = document.querySelector('a[href*="/p/"], a[href*="/reel/"]');
      const href = a ? a.getAttribute("href") || "" : "";
      return href.match(/\/(?:p|reel)\/([^/]+)/)?.[1] ?? null;
    });
    console.log("picked shortcode (grid):", sc);

    const hits: string[] = [];
    const handler = (req: { url: () => string; method: () => string; postData: () => string | null }) => {
      try {
        const url = req.url();
        if (!url.includes("/api/") && !url.includes("/graphql")) return;
        const u = new URL(url);
        let vars = u.searchParams.get("variables") || "";
        if (!vars) { vars = new URLSearchParams(req.postData() || "").get("variables") || ""; }
        hits.push(`${req.method()} ${u.pathname}${vars ? ` V=${vars.slice(0, 200)}` : ""}`);
      } catch { /* never throw */ }
    };
    page.on("request", handler as never);

    // Load the post page
    hits.length = 0;
    await page.goto(`${config.igBaseUrl}/p/${sc}/`, { waitUntil: "domcontentloaded", timeout: config.igNavTimeoutMs });
    await page.waitForTimeout(4500);
    console.log("--- POST PAGE:", hits.length);
    for (const h of hits.slice(0, 12)) console.log("  ", h);
    hits.length = 0;

    // Comments: scroll down inside the article to force-load all comments
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(1500);
    }
    console.log("--- AFTER SCROLL:", hits.length);
    for (const h of hits.slice(0, 10)) console.log("  ", h);
    hits.length = 0;

    const commentLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('ul ul a[href^="/"]')).slice(0, 6).map((a) => a.getAttribute("href")),
    );
    console.log("comment authors sample:", JSON.stringify(commentLinks));

    // Likers dialog (only works when likes > 0)
    const clicked = await page.evaluate(() => {
      const cands = Array.from(document.querySelectorAll('a[href*="/liked_by/"], section button, button, [role="button"]')) as HTMLElement[];
      for (const el of cands) {
        const txt = (el.textContent || "").trim();
        if (/^[\d,.KkMm]+\s*(likes?|إعجاب)/i.test(txt)) { el.click(); return txt.slice(0, 30); }
      }
      return null;
    });
    console.log("likers click:", clicked);
    await page.waitForTimeout(4000);
    console.log("--- LIKERS DIALOG:", hits.length);
    for (const h of hits.slice(0, 8)) console.log("  ", h);
    hits.length = 0;
    const likerRows = await page.evaluate(() => document.querySelectorAll('div[role="dialog"] a[href^="/"]').length);
    console.log("likers rows in dialog:", likerRows);

    // Hashtag: capture the media-carrying graphql call
    if (hashtag) {
      await page.goto(`${config.igBaseUrl}/explore/tags/${encodeURIComponent(hashtag)}/`, { waitUntil: "domcontentloaded", timeout: config.igNavTimeoutMs });
      await page.waitForTimeout(5000);
      console.log("--- HASHTAG PAGE:", hits.length);
      for (const h of hits.slice(0, 12)) console.log("  ", h);
      hits.length = 0;
      // scroll to trigger pagination
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, 1200);
        await page.waitForTimeout(1800);
      }
      console.log("--- HASHTAG SCROLL:", hits.length);
      for (const h of hits.slice(0, 10)) console.log("  ", h);
      const mediaCount = await page.evaluate(() => document.querySelectorAll('a[href*="/p/"]').length);
      console.log("post links visible:", mediaCount);
    }
  } finally {
    await igContextManager.releaseContext(contextId);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
