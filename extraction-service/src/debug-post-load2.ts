/**
 * Diagnostic 2: retry page loads until graphql comments traffic appears.
 * The post page sometimes renders without firing the comments query (soft
 * load). This loop: goto → wait → check comments fired → click View all →
 * check again, up to N rounds, printing graphql POST bodies (doc_id + vars).
 */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";
import { config } from "./config.js";
import type { Request } from "playwright";

async function main() {
  const sessionId = process.argv[2];
  const shortcode = process.argv[3] ?? "Dc1LGfkITiZ";
  await browserPool.init();
  const { cookies, proxy, userAgent } = await igSupabaseService.getIgSessionAndCookies(sessionId);
  const created = await igContextManager.createContext(sessionId, cookies, proxy, userAgent);
  const page = created.page;
  try {
    const hits: { friendly: string; docId: string; vars: string }[] = [];
    const seen = new Set<string>();
    const onReq = (req: Request): void => {
      try {
        const u = req.url();
        if (!u.includes("/graphql/query")) return;
        const sp = new URL(u).searchParams;
        const form = new URLSearchParams(req.method() === "POST" ? req.postData() ?? "" : "");
        const docId = sp.get("doc_id") || form.get("doc_id") || "?";
        const friendly = sp.get("fb_api_req_friendly_name") || form.get("fb_api_req_friendly_name") || "?";
        const vars = (sp.get("variables") || form.get("variables") || "").slice(0, 120);
        const key = docId + friendly;
        if (!seen.has(key)) {
          seen.add(key);
          hits.push({ friendly, docId, vars });
          console.log(`  REQ: ${friendly} doc=${docId} vars=${vars}`);
        }
      } catch { /* never throw */ }
    };
    page.on("request", onReq);

    for (let round = 1; round <= 3; round++) {
      console.log(`\n=== ROUND ${round} ===`);
      hits.length = 0; seen.clear();
      await page.goto(`${config.igBaseUrl}/p/${shortcode}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(5000);
      const commentReqs = hits.filter((h) => /comment|PolarisPost/i.test(h.friendly) || h.vars.includes(shortcode));
      console.log("graphql unique this round:", hits.length, "| comment-shaped:", commentReqs.length);
      if (commentReqs.length > 0) break;
      // click view-all then re-check
      const clicked = await page.evaluate(`(() => {
        const btns = Array.from(document.querySelectorAll('span, div[role="button"], button, a'));
        for (const b of btns) {
          const t = (b.textContent || "").trim();
          if (/((view|see) all|all \\d+|comments|عرض|مزيد|تحميل|load more)/i.test(t) && t.length < 60) { b.click(); return t; }
        }
        return null;
      })()`).then((r) => r as string | null).catch(() => null);
      console.log("clicked:", clicked);
      await page.waitForTimeout(5000);
      const commentReqs2 = hits.filter((h) => /comment|PolarisPost/i.test(h.friendly) || h.vars.includes(shortcode));
      console.log("after click, comment-shaped:", commentReqs2.length);
      if (commentReqs2.length > 0) break;
      // scroll comment pane too
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(4000);
      const commentReqs3 = hits.filter((h) => /comment|PolarisPost/i.test(h.friendly) || h.vars.includes(shortcode));
      console.log("after scroll, comment-shaped:", commentReqs3.length);
      if (commentReqs3.length > 0) break;
    }
    console.log("\nALL UNIQUE GRAPHQL QUERIES THIS RUN:");
    for (const h of hits) console.log(`  ${h.friendly} doc=${h.docId} vars=${h.vars}`);
  } finally {
    await igContextManager.releaseContext(sessionId).catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("PROBE-ERROR:", e); process.exit(1); });
