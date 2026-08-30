/** Live probe: mbasic messenger availability (Task 6) + your-pages DOM shapes
 *  for /list-pages hardening (Task 5).
 *  Run: npx tsx src/debug-messenger-probe.ts <sessionId> */
import { browserPool } from "./services/browser-pool.js";
import { contextManager } from "./services/context-manager.js";
import { supabaseService } from "./services/supabase.js";
import { config } from "./config.js";

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) throw new Error("usage: debug-messenger-probe <sessionId>");
  await browserPool.init();
  const { cookies, userAgent, storageState } = await supabaseService.getSessionAndCookies(sessionId);
  const { page, contextId } = await contextManager.createContext(sessionId, cookies, undefined, userAgent, storageState);
  try {
    // ─── Part A: mbasic availability (Task 6) ───
    for (const url of [
      "https://mbasic.facebook.com/messages/",
      "https://mbasic.facebook.com/home.php",
    ]) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2500);
        const finalUrl = page.url();
        const html = await page.content();
        const msgLinks = (html.match(/\/messages\/t\/\d+/g) || []).length;
        const threadLinks = (html.match(/\/messages\/thread\/|tid=/g) || []).length;
        console.log(JSON.stringify({ probe: "mbasic", url, finalUrl, htmlLen: html.length, msgLinks, threadLinks }));
      } catch (e) {
        console.log(JSON.stringify({ probe: "mbasic", url, error: String(e).substring(0, 120) }));
      }
    }

    // ─── Part B: your-pages DOM shapes for list-pages hardening (Task 5) ───
    await page.goto("https://www.facebook.com/pages/?category=your_pages", { waitUntil: "domcontentloaded", timeout: config.fbNavTimeoutMs });
    await page.waitForTimeout(4000);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const pagesProbe = await page.evaluate(() => {
      const out: Record<string, unknown> = {};
      out.finalUrl = location.href;
      out.bodySnippet = document.body.innerText.slice(0, 400).replace(/\n+/g, " | ");
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
      const SKIP = new Set(["www", "facebook", "pages", "watch", "marketplace", "login", "help", "privacy", "terms", "policies", "business", "gaming"]);
      const cand = anchors.filter((a) => {
        const href = a.getAttribute("href") || "";
        const m = href.match(/facebook\.com\/([a-zA-Z0-9.]+)/);
        return !!(m && !SKIP.has(m[1].toLowerCase()));
      });
      out.anchorCount = anchors.length;
      out.pageLikeAnchors = cand.slice(0, 12).map((a) => ({
        href: (a.getAttribute("href") || "").substring(0, 90),
        text: (a.textContent || "").trim().substring(0, 60),
        hasImg: !!a.querySelector("img"),
      }));
      const html = document.documentElement.innerHTML;
      out.hasPageListMarkers = html.includes('"page_list"') || html.includes("PagesProfileSet") || html.includes('"pageID"');
      out.hasFollowersText = /متابع|follower/i.test(document.body.innerText);
      return out;
    });
    console.log(JSON.stringify({ probe: "your_pages", ...pagesProbe }));
  } finally {
    await contextManager.releaseContext(contextId).catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("PROBE FAILED:", String(e).substring(0, 300)); process.exit(1); });
