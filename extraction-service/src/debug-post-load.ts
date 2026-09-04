/**
 * Minimal diagnostic: what does the post page ACTUALLY load for this session?
 * Prints final URL, article presence, comment DOM count, and every graphql
 * request URL seen for 12s after load.
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
    const reqUrls: string[] = [];
    const onReq = (req: Request): void => {
      const u = req.url();
      if (u.includes("/graphql/query") || u.includes("/api/v1/")) reqUrls.push(`${req.method()} ${u.slice(0, 130)}`);
    };
    page.on("request", onReq);
    await page.goto(`${config.igBaseUrl}/p/${shortcode}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(6000);
    const state = await page.evaluate(`(() => {
      return {
        finalUrl: location.href,
        title: document.title.slice(0, 60),
        articles: document.querySelectorAll("article").length,
        timeEls: document.querySelectorAll("time").length,
        anyText: document.body.innerText.slice(0, 200).replace(/\\n/g, " | "),
        commentWords: (document.body.innerText.match(/comment/gi) || []).length,
      };
    })()`).then((r) => r as Record<string, unknown>);
    console.log("STATE:", JSON.stringify(state, null, 1));
    console.log("GRAPHQL/API REQUESTS (" + reqUrls.length + "):");
    for (const r of reqUrls.slice(0, 25)) console.log("  " + r);
    // try clicking View-all and watch 8 more seconds
    await page.evaluate(`(() => {
      const btns = Array.from(document.querySelectorAll('span, div[role="button"], button, a'));
      for (const b of btns) {
        const t = (b.textContent || "").trim();
        if (/((view|see) all|all \\d+|comments|عرض|مزيد|تحميل|load more|MORE)/i.test(t) && t.length < 60) { b.click(); return t; }
      }
      return null;
    })()`).then((r) => console.log("CLICKED:", r));
    await page.waitForTimeout(8000);
    console.log("AFTER-CLICK REQUESTS (" + reqUrls.length + " total):");
    for (const r of reqUrls.slice(25, 55)) console.log("  " + r);
  } finally {
    await igContextManager.releaseContext(sessionId).catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("PROBE-ERROR:", e); process.exit(1); });
