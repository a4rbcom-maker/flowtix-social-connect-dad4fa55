/** Live probe v3: what actually loads the managed-pages list?
 *  v1: your_pages DOM has NO page cards (only nav). v2: zero matching graphql.
 *  v3: click "Pages you manage", log ALL graphql doc_ids + Page-typename hits,
 *  and follow any navigation.
 *  Run: npx tsx src/debug-pages-managed.ts <sessionId> */
import { browserPool } from "./services/browser-pool.js";
import { contextManager } from "./services/context-manager.js";
import { supabaseService } from "./services/supabase.js";
import type { Response } from "playwright";

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) throw new Error("usage: debug-pages-managed <sessionId>");
  await browserPool.init();
  const { cookies, userAgent, storageState } = await supabaseService.getSessionAndCookies(sessionId);
  const { page, contextId } = await contextManager.createContext(sessionId, cookies, undefined, userAgent, storageState);

  const gql: string[] = [];
  const onPage = (resp: Response) => {
    try {
      const url = resp.url();
      if (!url.includes("graphql") || resp.status() !== 200) return;
      const docId = resp.request().postData()?.match(/doc_id[=:](\d+)/)?.[1] || "?";
      gql.push(docId);
    } catch { /* ignore */ }
  };
  page.on("response", onPage);

  try {
    await page.goto("https://www.facebook.com/pages/?category=your_pages", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(6000);
    console.log(JSON.stringify({ step: "landing", url: page.url(), gqlSoFar: gql.length }));

    // Click the "Pages you manage" section (Arabic + English)
    const clicked = await page.evaluate(() => {
      const cands = Array.from(document.querySelectorAll("a, div[role=\"button\"], button, span, h2, h3")) as HTMLElement[];
      for (const el of cands) {
        const t = (el.innerText || "").trim();
        if (/^(Pages you manage|الصفحات التي تديرها|Pages you manage)$/.test(t) || t === "Pages you manage") {
          (el.closest("a") as HTMLElement || el).click();
          return t;
        }
      }
      return "";
    });
    await page.waitForTimeout(8000);
    console.log(JSON.stringify({ step: "after-click", clicked, url: page.url(), gql: gql.slice(0, 30) }));

    // Dump anchors again on whatever page we landed on
    const anchors = await page.evaluate(() => {
      const SKIP = new Set(["www", "facebook", "pages", "watch", "marketplace", "login", "help", "privacy", "terms", "policies", "business", "gaming", "latest", "home", "recent"]);
      return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
        .map((a) => a.getAttribute("href") || "")
        .filter((h) => {
          const m = h.match(/facebook\.com\/([a-zA-Z0-9.]+)/);
          return !!(m && !SKIP.has(m[1].toLowerCase()));
        })
        .slice(0, 20);
    });
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 600).replace(/\n+/g, " | "));
    console.log(JSON.stringify({ step: "anchors", count: anchors.length, anchors, bodyText }, null, 1));
    page.off("response", onPage);
  } finally {
    await contextManager.releaseContext(contextId).catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("PROBE FAILED:", String(e).substring(0, 300)); process.exit(1); });
