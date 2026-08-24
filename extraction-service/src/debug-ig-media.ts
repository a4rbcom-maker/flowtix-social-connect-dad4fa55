/** Probe: what endpoints do post-likers / comments / hashtag pages use?
 *  Run: npx tsx src/debug-ig-media.ts <sessionId> <postUrlOrShortcode> [hashtag] */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";
import { config } from "./config.js";

async function main() {
  const sessionId = process.argv[2];
  const shortcode = process.argv[3] || "";
  const hashtag = process.argv[4] || "";
  if (!sessionId) throw new Error("usage: debug-ig-media <sessionId> <shortcode> <hashtag>");

  await browserPool.init();
  const { cookies, userAgent } = await igSupabaseService.getIgSessionAndCookies(sessionId);
  const { page, contextId } = await igContextManager.createContext(sessionId, cookies, undefined, userAgent);

  try {
    // 1) Post page: capture likers/comments endpoints
    if (shortcode) {
      const hits: string[] = [];
      const handler = (req: { url: () => string; method: () => string; postData: () => string | null }) => {
        const url = req.url();
        if (!url.includes("/api/") && !url.includes("/graphql")) return;
        let vars = new URL(url).searchParams.get("variables") || "";
        if (!vars) { try { vars = new URLSearchParams(req.postData() || "").get("variables") || ""; } catch { /* ignore */ } }
        hits.push(`${req.method()} ${new URL(url).pathname} ${vars.slice(0, 160)}`);
      };
      page.on("request", handler as never);
      await page.goto(`${config.igBaseUrl}/p/${shortcode}/`, { waitUntil: "domcontentloaded", timeout: config.igNavTimeoutMs });
      await page.waitForTimeout(4000);
      console.log("--- post page requests:", hits.length);
      for (const h of hits.slice(0, 10)) console.log("  ", h);
      hits.length = 0;

      // open likers dialog
      const clicked = await page.evaluate(() => {
        const cands = Array.from(document.querySelectorAll('a[href*="/liked_by/"], button, [role="button"]')) as HTMLElement[];
        for (const el of cands) {
          const txt = (el.textContent || "").trim();
          if (/[\d,.]+/.test(txt) && /likes?/i.test(txt)) { el.click(); return txt.slice(0, 30); }
        }
        return null;
      });
      console.log("likers click:", clicked);
      await page.waitForTimeout(3500);
      console.log("--- after likers click:", hits.length);
      for (const h of hits.slice(0, 8)) console.log("  ", h);
      hits.length = 0;

      // scroll comments into view (comments load with the page usually)
      console.log("--- comment section probe ---");
      const c = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('ul a[href^="/"]')).slice(0, 5).map((a) => a.getAttribute("href"));
        return links;
      });
      console.log("commenter links sample:", JSON.stringify(c));
    }

    // 2) Hashtag page
    if (hashtag) {
      const hits2: string[] = [];
      const handler2 = (req: { url: () => string; method: () => string; postData: () => string | null }) => {
        const url = req.url();
        if (!url.includes("/api/") && !url.includes("/graphql")) return;
        let vars = new URL(url).searchParams.get("variables") || "";
        if (!vars) { try { vars = new URLSearchParams(req.postData() || "").get("variables") || ""; } catch { /* ignore */ } }
        hits2.push(`${req.method()} ${new URL(url).pathname} ${vars.slice(0, 140)}`);
      };
      page.on("request", handler2 as never);
      await page.goto(`${config.igBaseUrl}/explore/tags/${hashtag}/`, { waitUntil: "domcontentloaded", timeout: config.igNavTimeoutMs });
      await page.waitForTimeout(4500);
      console.log("--- hashtag page requests:", hits2.length);
      for (const h of hits2.slice(0, 10)) console.log("  ", h);

      // count media nodes in embedded JSON
      const probe = await page.evaluate(async (tag: string) => {
        const html = await fetch(`https://www.instagram.com/explore/tags/${tag}/`, { credentials: "include" }).then((r) => r.text());
        const m = html.match(/"edge_hashtag_to_media":\{"count":(\d+)/) || html.match(/"media_count":(\d+)/);
        const sections = (html.match(/"shortcode":"([^"]+)"/g) || []).length;
        const ids = html.match(/"id":"(\d+)_(\d+)"/g)?.length || 0;
        return { count: m ? Number(m[1]) : null, shortcodesInHtml: sections, mediaIds: ids };
      }, hashtag).catch((e) => ({ error: String(e).slice(0, 120) }));
      console.log("hashtag embedded:", JSON.stringify(probe));
    }
  } finally {
    await igContextManager.releaseContext(contextId);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
