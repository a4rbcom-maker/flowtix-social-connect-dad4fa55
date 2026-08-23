/** IG followers dialog probe — dumps the live DOM shapes the extractor
 *  must match (audit RC6). Run: npx tsx src/debug-ig-dialog.ts <sessionId> <username> */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";
import { config } from "./config.js";

async function main() {
  const sessionId = process.argv[2];
  const username = process.argv[3] || "instagram";
  if (!sessionId) throw new Error("usage: debug-ig-dialog <sessionId> <username>");

  await browserPool.init();
  const { cookies, userAgent } = await igSupabaseService.getIgSessionAndCookies(sessionId);
  const { page, contextId } = await igContextManager.createContext(sessionId, cookies, undefined, userAgent);
  try {
    await page.goto(`${config.igBaseUrl}/${username}/`, { waitUntil: "domcontentloaded", timeout: config.igNavTimeoutMs });
    await page.waitForTimeout(3500);
    console.log("URL:", page.url());

    const probe = await page.evaluate(() => {
      const out: Record<string, unknown> = {};
      // Header anchors (old selector target)
      const headerLinks = Array.from(document.querySelectorAll('header a[href*="/followers/"], header a[href*="/following/"]'));
      out.headerLinks = headerLinks.map((a) => ({ href: a.getAttribute("href"), text: (a.textContent || "").trim().slice(0, 60) }));
      // Any followers/following anchors anywhere
      const anyLinks = Array.from(document.querySelectorAll('a[href*="/followers/"], a[href*="/following/"]'));
      out.anyFollowerLinks = anyLinks.slice(0, 6).map((a) => ({ href: a.getAttribute("href"), text: (a.textContent || "").trim().slice(0, 60), tag: a.tagName }));
      // Links with counts
      const countLinks = Array.from(document.querySelectorAll("header a, main a")).filter((a) => /\d/.test(a.textContent || "")).slice(0, 10);
      out.countLinks = countLinks.map((a) => ({ href: a.getAttribute("href"), text: (a.textContent || "").trim().slice(0, 80) }));
      // Dialog containers
      out.dialogCount = document.querySelectorAll('div[role="dialog"]').length;
      // Private markers
      const body = document.body.innerText.slice(0, 400);
      out.bodySnippet = body.replace(/\n+/g, " | ");
      return out;
    });
    console.log(JSON.stringify(probe, null, 2));

    // Try clicking the followers counter by TEXT (new DOM: a[href="#"])
    const clicked = await page.evaluate((tab: string) => {
      const wantFollowing = tab === "following";
      const cands = Array.from(document.querySelectorAll('a[href="#"], button, [role="button"], [role="tab"]')) as HTMLElement[];
      for (const el of cands) {
        const txt = (el.textContent || "").trim().toLowerCase();
        if (!txt) continue;
        const hasNum = /\d/.test(txt);
        const word = wantFollowing ? /following|متابَع|يتابع/ : /followers|متابع/;
        if (hasNum && word.test(txt) && txt.length < 60) {
          el.click();
          return "clicked:" + txt.slice(0, 40);
        }
      }
      return "no-counter-found";
    }, process.argv[4] || "followers");
    console.log("click:", clicked);
    await page.waitForTimeout(3500);
    const after = await page.evaluate(() => ({
      url: location.href,
      dialogCount: document.querySelectorAll('div[role="dialog"]').length,
      dialogText: (document.querySelector('div[role="dialog"]') as HTMLElement | null)?.innerText?.slice(0, 400) ?? null,
      dialogLinks: Array.from(document.querySelectorAll('div[role="dialog"] a[href^="/"]')).slice(0, 5).map((a) => a.getAttribute("href")),
    }));
    console.log("after:", JSON.stringify(after, null, 2));
  } finally {
    await igContextManager.releaseContext(contextId);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
